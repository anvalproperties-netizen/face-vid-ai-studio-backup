/**
 * @face-vid/api — Hardened Real-Time Communication, Ticket Auth & WebRTC Signaling Hub
 *
 * Implements Phase 1-R2 Security Hardening:
 * 1. RFC 6455 compliant WebSocket server with origin validation, client frame masking enforcement (1002),
 *    frame (64 KB) and assembled message (128 KB) payload limits (1009), control-frame constraints,
 *    and fragmented message assembly.
 * 2. Short-lived (15s), single-use connection ticket authentication (rtt_*) for SSE and WebSockets,
 *    eliminating long-lived bearer tokens from URL query parameters.
 * 3. Revalidation of session revocation and periodic ping/pong liveness checks with zombie cleanup.
 * 4. Authoritative user blocking enforcement for calls and signaling.
 * 5. Broadcaster-authorized Live Audience Radar with 30s authoritative timeouts and broadcast-scoped
 *    pseudonymous blip identifiers (zero GPS / zero IP address exposure).
 */

import crypto from 'node:crypto';
import type http from 'node:http';
import type net from 'node:net';
import type { Response } from 'express';
import {
  AccountStatus,
  RealtimeEventType,
  type CallSignalingPayload,
  type LiveRadarBlip,
  type RealtimeEventEnvelope,
} from '../../../../packages/shared/src/index.ts';
import { databaseFoundationService } from '../database/database.service.ts';
import { apiLogger } from '../common/logger.ts';

const WS_MAGIC_STRING = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_FRAME_PAYLOAD_BYTES = 64 * 1024; // 64 KB
const MAX_MESSAGE_PAYLOAD_BYTES = 128 * 1024; // 128 KB
const TICKET_TTL_MS = 15_000; // 15 seconds
const RADAR_TIMEOUT_MS = 30_000; // 30 seconds authoritative

export interface RealtimeTicket {
  ticketId: string;
  userId: string;
  sessionId: string;
  purpose: 'WEBSOCKET' | 'SSE';
  expiresAtEpochMs: number;
}

export interface ActiveRealtimeConnection {
  connectionId: string;
  userId: string;
  sessionId: string;
  connectedAtIso: string;
  lastPongEpochMs: number;
  transport: 'WEBSOCKET' | 'SSE';
  socket?: net.Socket;
  sseResponse?: Response;
}

export interface ActiveCallState {
  callId: string;
  callerUserId: string;
  receiverUserId: string;
  callType: 'VOICE' | 'VIDEO';
  isPrepaid: boolean;
  ratePerMinuteUsd: number;
  status: 'RINGING' | 'CONNECTED' | 'ENDED' | 'REJECTED';
  startedAtIso: string;
  connectedAtIso?: string;
  endedAtIso?: string;
  durationSeconds: number;
}

export interface ViewerPresenceRecord {
  viewerId: string;
  sessionId: string;
  streamId: string;
  lastHeartbeatEpochMs: number;
  joinedAtIso: string;
  isPrivateMode: boolean;
  pseudonymLabel: string;
}

export class RealtimeService {
  // Connections map: connectionId -> ActiveRealtimeConnection
  private connections = new Map<string, ActiveRealtimeConnection>();
  // User index: userId -> Set of connectionIds
  private userConnections = new Map<string, Set<string>>();
  // Active call sessions: callId -> ActiveCallState
  private activeCalls = new Map<string, ActiveCallState>();
  // User event rate limiter: userId -> array of epoch timestamps
  private userEventVelocity = new Map<string, number[]>();
  // Live audience presence: streamId -> Map<viewerId, ViewerPresenceRecord>
  private streamPresence = new Map<string, Map<string, ViewerPresenceRecord>>();
  // Short-lived single-use ticket registry: ticketId -> RealtimeTicket
  private tickets = new Map<string, RealtimeTicket>();
  // Liveness interval handle
  private livenessInterval: NodeJS.Timeout | null = null;

  // Server-held cryptographic secret for Audience Radar pseudonyms
  private radarServerSecret: Buffer = (() => {
    const envSecret = process.env.RADAR_SERVER_SECRET;
    if (envSecret && envSecret.trim().length >= 32) {
      return Buffer.from(envSecret.trim(), 'utf8');
    }
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'CRITICAL SECURITY ERROR: RADAR_SERVER_SECRET environment variable is missing or insecure in production.'
      );
    }
    // Isolated random secret for development and disposable testing
    return crypto.randomBytes(32);
  })();

  // Broadcast-session nonce registry: streamId -> unique session nonce
  private streamSessionNonces = new Map<string, string>();

  constructor() {
    this.startLivenessChecker();

    // Register immediate session termination hook on database session revocation
    databaseFoundationService.onSessionRevocation((sessionId, reason) => {
      this.terminateSessionConnections(sessionId, reason);
    });
  }

  public getStreamSessionNonce(streamId: string): string {
    let nonce = this.streamSessionNonces.get(streamId);
    if (!nonce) {
      nonce = crypto.randomBytes(16).toString('hex');
      this.streamSessionNonces.set(streamId, nonce);
    }
    return nonce;
  }

  // ===========================================================================
  // 1. TICKET-BASED AUTHENTICATION (NO LONG-LIVED TOKENS IN URLS)
  // ===========================================================================

  /**
   * Issues a short-lived (15s), single-use ticket for WebSocket or SSE connection.
   */
  public issueRealtimeTicket(params: {
    token: string;
    purpose: 'WEBSOCKET' | 'SSE';
  }): { ticket: string; expiresInSeconds: number } {
    const auth = this.authenticateSessionToken(params.token);
    const ticketId = `rtt_${crypto.randomBytes(24).toString('base64url')}`;
    const expiresAtEpochMs = Date.now() + TICKET_TTL_MS;

    const ticket: RealtimeTicket = {
      ticketId,
      userId: auth.userId,
      sessionId: auth.sessionId,
      purpose: params.purpose,
      expiresAtEpochMs,
    };

    this.tickets.set(ticketId, ticket);

    // Redacted ticket log: log only truncated SHA-256 hash digest, zero raw token entropy
    const ticketDigest = crypto.createHash('sha256').update(ticketId).digest('hex').slice(0, 8);
    apiLogger.info('Issued short-lived realtime connection ticket', {
      userId: auth.userId,
      purpose: params.purpose,
      ticketSha256Digest: ticketDigest,
      ttlSeconds: 15,
    });

    return { ticket: ticketId, expiresInSeconds: 15 };
  }

  /**
   * Atomically consumes a single-use connection ticket.
   * Throws if ticket is missing, expired, already consumed, purpose-mismatched,
   * or if the user account/session has been revoked in the interim.
   */
  public consumeRealtimeTicket(
    ticketId: string,
    expectedPurpose: 'WEBSOCKET' | 'SSE'
  ): { userId: string; sessionId: string } {
    if (!ticketId || typeof ticketId !== 'string') {
      throw new Error('Authentication ticket is required.');
    }

    const ticket = this.tickets.get(ticketId);
    if (!ticket) {
      throw new Error('Invalid or already consumed realtime ticket (Replay Rejected).');
    }

    // Atomic single-use consumption: immediately delete from registry
    this.tickets.delete(ticketId);

    if (Date.now() > ticket.expiresAtEpochMs) {
      throw new Error('Realtime connection ticket has expired. Please obtain a fresh ticket.');
    }

    if (ticket.purpose !== expectedPurpose) {
      throw new Error(`Ticket purpose mismatch: expected ${expectedPurpose}, found ${ticket.purpose}`);
    }

    // Revalidate session revocation and user active state in database
    const session = databaseFoundationService.findDeviceSessionById(ticket.sessionId);
    if (!session || session.revoked) {
      throw new Error('Device session has been revoked.');
    }
    if (new Date(session.expiresAtIso).getTime() < Date.now()) {
      throw new Error('Device session has expired.');
    }

    const user = databaseFoundationService.findUserById(ticket.userId);
    if (!user || user.accountStatus === AccountStatus.SUSPENDED) {
      throw new Error('User account is invalid or suspended.');
    }

    return { userId: ticket.userId, sessionId: ticket.sessionId };
  }

  /**
   * Validates a session token and returns the authenticated userId and sessionId.
   * Throws if token is invalid, expired, revoked, or account suspended.
   */
  public authenticateSessionToken(token: string): { userId: string; sessionId: string } {
    if (!token || typeof token !== 'string') {
      throw new Error('Authentication required: Token is missing or invalid.');
    }

    const session = databaseFoundationService.findDeviceSessionByToken(token);
    if (!session) {
      throw new Error('Invalid or unrecognized session token.');
    }

    if (session.revoked) {
      throw new Error('Session has been revoked.');
    }

    if (new Date(session.expiresAtIso).getTime() < Date.now()) {
      throw new Error('Session has expired.');
    }

    const user = databaseFoundationService.findUserById(session.userId);
    if (!user || user.accountStatus === AccountStatus.SUSPENDED) {
      throw new Error('User account is invalid or suspended.');
    }

    return { userId: session.userId, sessionId: session.sessionId };
  }

  // ===========================================================================
  // 2. ORIGIN VALIDATION
  // ===========================================================================

  public isAllowedOrigin(origin?: string): boolean {
    if (!origin) {
      // Native mobile apps and non-browser clients do not send Origin header
      return true;
    }

    try {
      const parsed = new URL(origin);
      const host = parsed.host.toLowerCase();

      // 1. Local development and loopback bindings
      if (
        host === 'localhost:3000' ||
        host === '127.0.0.1:3000' ||
        host.startsWith('localhost:') ||
        host.startsWith('127.0.0.1:')
      ) {
        return true;
      }

      // 2. Explicit production and staging domains
      const explicitDomains = new Set([
        'facevid.com',
        'www.facevid.com',
        'app.facevid.com',
        'admin.facevid.com',
        'api.facevid.com',
        'ais-dev-kfcuuutsogwfsmc76ng224-747888986661.europe-west2.run.app',
        'ais-pre-kfcuuutsogwfsmc76ng224-747888986661.europe-west2.run.app',
      ]);

      if (explicitDomains.has(host)) {
        return true;
      }

      // 3. Exact subdomains of facevid.com (strictly requiring dot prefix and alphanumeric labels)
      if (host.endsWith('.facevid.com')) {
        const subdomain = host.slice(0, -'.facevid.com'.length);
        if (/^[a-z0-9-]+$/.test(subdomain) && !subdomain.includes('.')) {
          return true;
        }
      }

      // 4. Explicit environment-configured allowed hosts
      if (process.env.FACEVID_ALLOWED_ORIGINS) {
        const envHosts = process.env.FACEVID_ALLOWED_ORIGINS.split(',').map((h) => h.trim().toLowerCase());
        if (envHosts.includes(host)) {
          return true;
        }
      }

      return false;
    } catch {
      return false;
    }
  }

  /**
   * Enforces event rate limiting (max 25 events per 10 seconds).
   */
  private checkRateLimit(userId: string): void {
    const now = Date.now();
    const timestamps = this.userEventVelocity.get(userId) || [];
    const windowStart = now - 10000;
    const recent = timestamps.filter((t) => t > windowStart);
    if (recent.length >= 25) {
      throw new Error('Realtime event rate limit exceeded. Please throttle messaging/signaling.');
    }
    recent.push(now);
    this.userEventVelocity.set(userId, recent);
  }

  // ===========================================================================
  // 3. HARDENED NATIVE RFC 6455 WEBSOCKET UPGRADE & FRAMING
  // ===========================================================================

  /**
   * Safely ends a socket with optional HTTP or close data, guarding against EPIPE and destroyed streams.
   */
  private safeEndSocket(socket: net.Socket, data?: string | Buffer): void {
    if (!socket || socket.destroyed) return;
    try {
      if (data && socket.writable && !socket.writableEnded) {
        socket.end(data);
      } else {
        socket.destroy();
      }
    } catch {
      try {
        socket.destroy();
      } catch {
        // Ignored
      }
    }
  }

  /**
   * Handles native RFC 6455 WebSocket Upgrade with complete security hardening.
   */
  public handleUpgrade(req: http.IncomingMessage, socket: net.Socket, _head: Buffer): void {
    try {
      // 1. Origin Validation
      const origin = req.headers.origin;
      if (origin && !this.isAllowedOrigin(origin)) {
        apiLogger.warn('WebSocket upgrade rejected: Unauthorized origin', { origin });
        this.safeEndSocket(socket, 'HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\nUnauthorized Origin.\n');
        return;
      }

      // 2. Ticket / Auth Validation
      const urlObj = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

      // Strict rejection of long-lived session token in query parameters
      if (urlObj.searchParams.get('token')) {
        apiLogger.warn('WebSocket upgrade rejected: Long-lived token in query parameter');
        this.safeEndSocket(
          socket,
          'HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n' +
            'Long-lived tokens in query parameters are prohibited. Obtain a short-lived ticket via POST /api/v1/realtime/ticket.\n'
        );
        return;
      }

      const ticket = urlObj.searchParams.get('ticket');
      let auth: { userId: string; sessionId: string };

      if (ticket) {
        try {
          auth = this.consumeRealtimeTicket(ticket, 'WEBSOCKET');
        } catch (err) {
          apiLogger.info('WebSocket upgrade ticket rejected', {
            reason: err instanceof Error ? err.message : String(err),
          });
          this.safeEndSocket(socket, 'HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
          return;
        }
      } else if (
        req.headers.authorization &&
        req.headers.authorization.startsWith('Bearer ')
      ) {
        try {
          auth = this.authenticateSessionToken(req.headers.authorization.slice(7).trim());
        } catch (err) {
          this.safeEndSocket(socket, 'HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
          return;
        }
      } else {
        this.safeEndSocket(socket, 'HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
        return;
      }

      const secKey = req.headers['sec-websocket-key'];
      if (!secKey) {
        this.safeEndSocket(socket, 'HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
        return;
      }

      // Compute RFC 6455 accept header
      const secAccept = crypto
        .createHash('sha1')
        .update(secKey + WS_MAGIC_STRING)
        .digest('base64');

      const protocolHeader = req.headers['sec-websocket-protocol']
        ? `Sec-WebSocket-Protocol: ${req.headers['sec-websocket-protocol']}\r\n`
        : '';

      const responseHeaders = [
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${secAccept}`,
        protocolHeader,
      ]
        .filter(Boolean)
        .join('\r\n') + '\r\n\r\n';

      socket.write(responseHeaders);

      const connectionId = `conn_ws_${crypto.randomBytes(8).toString('hex')}`;
      const conn: ActiveRealtimeConnection = {
        connectionId,
        userId: auth.userId,
        sessionId: auth.sessionId,
        connectedAtIso: new Date().toISOString(),
        lastPongEpochMs: Date.now(),
        transport: 'WEBSOCKET',
        socket,
      };

      this.registerConnection(conn);

      apiLogger.info('Hardened WebSocket client connected', {
        userId: auth.userId,
        connectionId,
      });

      // Send initial connection acknowledgment
      this.sendToConnection(conn, {
        eventType: RealtimeEventType.SYSTEM_NOTIFICATION,
        eventId: `ev_ack_${Date.now()}`,
        timestampIso: new Date().toISOString(),
        payload: {
          status: 'CONNECTED',
          connectionId,
          userId: auth.userId,
          message: 'FACE VID Hardened Real-Time Communication Hub connected.',
        },
      });

      // Frame buffer parser for RFC 6455 with payload caps and unmasked frame rejection
      let buffer = Buffer.alloc(0);
      const messageFragments: Buffer[] = [];
      let totalAssembledLength = 0;

      socket.on('data', (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);

        while (buffer.length >= 2) {
          const firstByte = buffer[0];
          const secondByte = buffer[1];
          const isFinal = (firstByte & 0x80) !== 0;
          const opcode = firstByte & 0x0f;
          const isMasked = (secondByte & 0x80) !== 0;
          let payloadLength = secondByte & 0x7f;
          let offset = 2;

          // RFC 6455 Section 5.1: Client-to-server frames MUST be masked.
          // If unmasked, server MUST close the connection with Code 1002 (Protocol Error).
          if (!isMasked) {
            apiLogger.warn('WebSocket Protocol Error: Unmasked frame from client rejected (Code 1002)');
            this.sendCloseFrameWithCode(socket, 1002, 'Client frame must be masked per RFC 6455 Section 5.1');
            socket.destroy();
            return;
          }

          if (payloadLength === 126) {
            if (buffer.length < 4) return;
            payloadLength = buffer.readUInt16BE(2);
            offset = 4;
          } else if (payloadLength === 127) {
            if (buffer.length < 10) return;
            payloadLength = buffer.readUInt32BE(6);
            offset = 10;
          }

          // Enforce Frame Payload Limit (64 KB)
          if (payloadLength > MAX_FRAME_PAYLOAD_BYTES) {
            apiLogger.warn('WebSocket Close: Frame exceeds 64 KB payload limit (Code 1009)', {
              payloadLength,
            });
            this.sendCloseFrameWithCode(socket, 1009, 'Frame payload exceeds 64 KB limit');
            socket.destroy();
            return;
          }

          // Enforce RFC 6455 Section 5.5: Control frames must not be fragmented and <= 125 bytes
          const isControlFrame = (opcode & 0x08) !== 0;
          if (isControlFrame) {
            if (!isFinal) {
              this.sendCloseFrameWithCode(socket, 1002, 'Fragmented control frames are prohibited');
              socket.destroy();
              return;
            }
            if (payloadLength > 125) {
              this.sendCloseFrameWithCode(socket, 1002, 'Control frame payload exceeds 125 bytes');
              socket.destroy();
              return;
            }
          }

          if (buffer.length < offset + 4) return; // Need masking key
          const maskingKey = buffer.subarray(offset, offset + 4);
          offset += 4;

          if (buffer.length < offset + payloadLength) return; // Wait for full payload

          let payload = buffer.subarray(offset, offset + payloadLength);
          buffer = buffer.subarray(offset + payloadLength);

          // Unmask payload in-place
          payload = Buffer.from(payload);
          for (let i = 0; i < payload.length; i++) {
            payload[i] ^= maskingKey[i % 4];
          }

          // Handle Control Frames: 0x08 Close, 0x09 Ping, 0x0A Pong
          if (opcode === 0x08) {
            this.sendCloseFrameWithCode(socket, 1000, 'Normal Closure');
            socket.destroy();
            return;
          } else if (opcode === 0x09) {
            this.sendPongFrame(socket, payload);
          } else if (opcode === 0x0a) {
            conn.lastPongEpochMs = Date.now();
          } else if (opcode === 0x01 || opcode === 0x00) {
            // Text frame (0x01) or Continuation frame (0x00)
            totalAssembledLength += payload.length;
            if (totalAssembledLength > MAX_MESSAGE_PAYLOAD_BYTES) {
              apiLogger.warn('WebSocket Close: Assembled message exceeds 128 KB limit (Code 1009)');
              this.sendCloseFrameWithCode(socket, 1009, 'Message exceeds 128 KB limit');
              socket.destroy();
              return;
            }

            messageFragments.push(payload);

            if (isFinal) {
              const fullBuffer = Buffer.concat(messageFragments);
              messageFragments.length = 0;
              totalAssembledLength = 0;
              const text = fullBuffer.toString('utf8');
              this.handleIncomingClientMessage(auth.userId, text);
            }
          }
        }
      });

      socket.on('close', () => {
        this.unregisterConnection(connectionId);
      });

      socket.on('error', (err: any) => {
        const isBenignDisconnect =
          err?.code === 'EPIPE' ||
          err?.code === 'ECONNRESET' ||
          err?.code === 'ECONNABORTED' ||
          err?.code === 'ETIMEDOUT' ||
          err?.code === 'ERR_STREAM_WRITE_AFTER_END' ||
          (typeof err?.message === 'string' &&
            (err.message.includes('EPIPE') ||
              err.message.includes('ECONNRESET') ||
              err.message.includes('write after end')));

        if (!isBenignDisconnect) {
          apiLogger.warn('WebSocket socket error', {
            connectionId,
            error: err?.message || String(err),
          });
        } else {
          apiLogger.debug('WebSocket client disconnected cleanly', {
            connectionId,
            code: err?.code,
          });
        }
        this.unregisterConnection(connectionId);
      });
    } catch (err) {
      apiLogger.error('WebSocket upgrade fatal error', {
        error: err instanceof Error ? err.message : String(err),
      });
      try {
        socket.destroy();
      } catch {
        // Ignored
      }
    }
  }

  // ===========================================================================
  // 4. LIVENESS CHECKER & STALE / REVOKED CONNECTION CLEANUP
  // ===========================================================================

  private startLivenessChecker(): void {
    if (this.livenessInterval) clearInterval(this.livenessInterval);

    this.livenessInterval = setInterval(() => {
      const now = Date.now();
      for (const [connId, conn] of this.connections.entries()) {
        // 1. Session Revocation / Expiry Recheck
        const session = databaseFoundationService.findDeviceSessionById(conn.sessionId);
        if (!session || session.revoked || new Date(session.expiresAtIso).getTime() < now) {
          apiLogger.info('Terminating connection due to revoked/expired session', {
            userId: conn.userId,
            sessionId: conn.sessionId,
          });
          if (conn.socket) {
            this.sendCloseFrameWithCode(conn.socket, 1008, 'Session Revoked or Expired');
            conn.socket.destroy();
          } else if (conn.sseResponse) {
            conn.sseResponse.end();
          }
          this.unregisterConnection(connId);
          continue;
        }

        // 2. WebSocket Ping / Pong Liveness
        if (conn.transport === 'WEBSOCKET' && conn.socket && !conn.socket.destroyed) {
          // If no pong received for > 50s, treat as zombie connection
          if (now - conn.lastPongEpochMs > 50_000) {
            apiLogger.warn('WebSocket zombie connection terminated: ping timeout', {
              connectionId: connId,
              userId: conn.userId,
            });
            conn.socket.destroy();
            this.unregisterConnection(connId);
            continue;
          }

          // Send heartbeat ping frame
          this.sendPingFrame(conn.socket);
        }
      }
    }, 25_000);
  }

  /**
   * Registers an active connection.
   */
  public registerConnection(conn: ActiveRealtimeConnection): void {
    this.connections.set(conn.connectionId, conn);
    const userSet = this.userConnections.get(conn.userId) || new Set();
    userSet.add(conn.connectionId);
    this.userConnections.set(conn.userId, userSet);
  }

  public getActiveConnectionsCount(userId?: string): number {
    if (userId) {
      return this.userConnections.get(userId)?.size || 0;
    }
    return this.connections.size;
  }

  /**
   * Unregisters and cleans up a connection.
   */
  public unregisterConnection(connectionId: string): void {
    const conn = this.connections.get(connectionId);
    if (!conn) return;

    this.connections.delete(connectionId);
    const userSet = this.userConnections.get(conn.userId);
    if (userSet) {
      userSet.delete(connectionId);
      if (userSet.size === 0) {
        this.userConnections.delete(conn.userId);
      }
    }

    if (conn.socket && !conn.socket.destroyed) {
      try {
        conn.socket.destroy();
      } catch {
        // Ignored
      }
    }
  }

  /**
   * Delivers an event envelope to all active connections for a given user.
   */
  public sendToUser<T>(userId: string, event: RealtimeEventEnvelope<T>): boolean {
    const connIds = this.userConnections.get(userId);
    if (!connIds || connIds.size === 0) {
      return false;
    }

    let delivered = false;
    for (const id of connIds) {
      const conn = this.connections.get(id);
      if (conn) {
        this.sendToConnection(conn, event);
        delivered = true;
      }
    }
    return delivered;
  }

  /**
   * Broadcasts an event to matching active connections.
   */
  public broadcast<T>(
    event: RealtimeEventEnvelope<T>,
    filter?: (userId: string) => boolean
  ): number {
    let sentCount = 0;
    for (const [userId, connIds] of this.userConnections.entries()) {
      if (filter && !filter(userId)) continue;
      for (const id of connIds) {
        const conn = this.connections.get(id);
        if (conn) {
          this.sendToConnection(conn, event);
          sentCount++;
        }
      }
    }
    return sentCount;
  }

  /**
   * Encodes and writes an event envelope to a specific connection with backpressure checking.
   */
  private sendToConnection(conn: ActiveRealtimeConnection, event: RealtimeEventEnvelope<any>): void {
    const serialized = JSON.stringify(event);

    if (conn.transport === 'WEBSOCKET' && conn.socket && !conn.socket.destroyed) {
      this.sendWebSocketTextFrame(conn.socket, serialized);
    } else if (conn.transport === 'SSE' && conn.sseResponse && !conn.sseResponse.writableEnded) {
      try {
        conn.sseResponse.write(
          `event: ${event.eventType}\nid: ${event.eventId}\ndata: ${serialized}\n\n`
        );
      } catch {
        // Safe catch on SSE write failure
      }
    }
  }

  /**
   * Sends unmasked RFC 6455 text frame from server to client with backpressure check.
   */
  private sendWebSocketTextFrame(socket: net.Socket, text: string): void {
    if (!socket || socket.destroyed || !socket.writable || socket.writableEnded) {
      return;
    }
    const payload = Buffer.from(text, 'utf8');
    const length = payload.length;

    let header: Buffer;
    if (length < 126) {
      header = Buffer.alloc(2);
      header[0] = 0x81; // FIN + text opcode
      header[1] = length; // Unmasked (server to client)
    } else if (length <= 65535) {
      header = Buffer.alloc(4);
      header[0] = 0x81;
      header[1] = 126;
      header.writeUInt16BE(length, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x81;
      header[1] = 127;
      header.writeUInt32BE(0, 2); // upper 32 bits
      header.writeUInt32BE(length, 6); // lower 32 bits
    }

    try {
      const canContinue = socket.write(Buffer.concat([header, payload]), (err) => {
        if (err) {
          try {
            socket.destroy();
          } catch {
            // Ignored
          }
        }
      });
      if (!canContinue) {
        // Backpressure signaled: client is consuming slowly
        socket.once('drain', () => {});
      }
    } catch {
      // Ignored
    }
  }

  public sendCloseFrameWithCode(socket: net.Socket, code: number = 1000, reason: string = ''): void {
    if (!socket || socket.destroyed || !socket.writable || socket.writableEnded) {
      return;
    }
    try {
      const reasonBuf = Buffer.from(reason, 'utf8').subarray(0, 120);
      const payload = Buffer.alloc(2 + reasonBuf.length);
      payload.writeUInt16BE(code, 0);
      reasonBuf.copy(payload, 2);
      const header = Buffer.from([0x88, payload.length]);
      socket.write(Buffer.concat([header, payload]), () => {
        try {
          socket.destroy();
        } catch {
          // Ignored
        }
      });
    } catch {
      try {
        socket.destroy();
      } catch {
        // Ignored
      }
    }
  }

  private sendPingFrame(socket: net.Socket): void {
    if (!socket || socket.destroyed || !socket.writable || socket.writableEnded) {
      return;
    }
    try {
      socket.write(Buffer.from([0x89, 0x00]), (err) => {
        if (err) {
          try {
            socket.destroy();
          } catch {
            // Ignored
          }
        }
      });
    } catch {
      // Ignored
    }
  }

  private sendPongFrame(socket: net.Socket, payload: Buffer): void {
    if (!socket || socket.destroyed || !socket.writable || socket.writableEnded) {
      return;
    }
    try {
      const header = Buffer.from([0x8a, payload.length]);
      socket.write(Buffer.concat([header, payload]), (err) => {
        if (err) {
          try {
            socket.destroy();
          } catch {
            // Ignored
          }
        }
      });
    } catch {
      // Ignored
    }
  }

  /**
   * Dispatches client-submitted real-time messages.
   */
  private handleIncomingClientMessage(userId: string, rawText: string): void {
    try {
      this.checkRateLimit(userId);
      const parsed = JSON.parse(rawText);
      if (parsed.type === 'CALL_SIGNAL' && parsed.payload) {
        this.handleCallSignal(userId, parsed.payload);
      } else if (parsed.type === 'PING') {
        this.sendToUser(userId, {
          eventType: RealtimeEventType.SYSTEM_NOTIFICATION,
          eventId: `pong_${Date.now()}`,
          timestampIso: new Date().toISOString(),
          payload: { type: 'PONG' },
        });
      }
    } catch (err) {
      apiLogger.warn('Invalid incoming client realtime payload', {
        userId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ===========================================================================
  // 5. WEBRTC CALL SIGNALING ENGINE WITH AUTHORITATIVE USER BLOCKING
  // ===========================================================================

  /**
   * Initiates a real call session between two authenticated users.
   */
  public initiateCallSession(params: {
    callerUserId: string;
    receiverUserId: string;
    callType: 'VOICE' | 'VIDEO';
    isPrepaid?: boolean;
    ratePerMinuteUsd?: number;
  }): ActiveCallState {
    this.checkRateLimit(params.callerUserId);

    if (params.callerUserId === params.receiverUserId) {
      throw new Error('Self-calling is not permitted.');
    }

    // Authoritative User Blocking Enforcement
    if (databaseFoundationService.isUserBlocked(params.callerUserId, params.receiverUserId)) {
      throw new Error('Communication blocked by user preferences.');
    }

    const receiver = databaseFoundationService.findUserById(params.receiverUserId);
    if (!receiver) {
      throw new Error('Receiver account does not exist.');
    }
    if (receiver.accountStatus === AccountStatus.SUSPENDED) {
      throw new Error('Receiver account is suspended.');
    }

    const caller = databaseFoundationService.findUserById(params.callerUserId);
    if (!caller) {
      throw new Error('Caller account does not exist.');
    }

    const callId = `call_${crypto.randomBytes(8).toString('hex')}`;
    const nowIso = new Date().toISOString();

    const callState: ActiveCallState = {
      callId,
      callerUserId: params.callerUserId,
      receiverUserId: params.receiverUserId,
      callType: params.callType,
      isPrepaid: Boolean(params.isPrepaid),
      ratePerMinuteUsd: params.isPrepaid ? params.ratePerMinuteUsd || 2.5 : 0.0,
      status: 'RINGING',
      startedAtIso: nowIso,
      durationSeconds: 0,
    };

    this.activeCalls.set(callId, callState);

    // Relay CALL_INCOMING event to receiver
    this.sendToUser(params.receiverUserId, {
      eventType: RealtimeEventType.CALL_INCOMING,
      eventId: `ev_call_ring_${callId}`,
      timestampIso: nowIso,
      payload: {
        callId,
        callerUserId: params.callerUserId,
        callerHandle: `@${caller.userId}`,
        callType: params.callType,
        isPrepaid: callState.isPrepaid,
        ratePerMinuteUsd: callState.ratePerMinuteUsd,
      },
    });

    apiLogger.info('WebRTC Call Initiated & Signaling Ring Dispatched', {
      callId,
      caller: params.callerUserId,
      receiver: params.receiverUserId,
      type: params.callType,
    });

    return callState;
  }

  /**
   * Handles incoming WebRTC signaling with participant and blocking authorization.
   */
  public handleCallSignal(senderUserId: string, payload: CallSignalingPayload): void {
    this.checkRateLimit(senderUserId);

    const call = this.activeCalls.get(payload.callId);
    if (!call) {
      throw new Error(`Call session ${payload.callId} not found or already terminated.`);
    }

    // Verify sender is an authorized participant of this specific call
    const isCaller = call.callerUserId === senderUserId;
    const isReceiver = call.receiverUserId === senderUserId;
    if (!isCaller && !isReceiver) {
      throw new Error('Authorization Violation: You are not a participant in this call.');
    }

    // Authoritative User Blocking Check
    if (databaseFoundationService.isUserBlocked(call.callerUserId, call.receiverUserId)) {
      throw new Error('Communication blocked by user preferences.');
    }

    const targetUserId = isCaller ? call.receiverUserId : call.callerUserId;
    const nowIso = new Date().toISOString();

    switch (payload.signalType) {
      case 'CALL_ACCEPT':
        if (!isReceiver) {
          throw new Error('Only the designated call receiver can accept the call.');
        }
        call.status = 'CONNECTED';
        call.connectedAtIso = nowIso;
        this.sendToUser(call.callerUserId, {
          eventType: RealtimeEventType.CALL_ACCEPTED,
          eventId: `ev_call_accept_${call.callId}`,
          timestampIso: nowIso,
          payload: { callId: call.callId, acceptedAtIso: nowIso },
        });
        break;

      case 'CALL_DECLINE':
        call.status = 'REJECTED';
        call.endedAtIso = nowIso;
        this.sendToUser(call.callerUserId, {
          eventType: RealtimeEventType.CALL_DECLINED,
          eventId: `ev_call_decline_${call.callId}`,
          timestampIso: nowIso,
          payload: { callId: call.callId, reason: payload.reason || 'DECLINED' },
        });
        this.activeCalls.delete(call.callId);
        break;

      case 'CALL_END':
        call.status = 'ENDED';
        call.endedAtIso = nowIso;
        const endEvent: RealtimeEventEnvelope = {
          eventType: RealtimeEventType.CALL_ENDED,
          eventId: `ev_call_end_${call.callId}`,
          timestampIso: nowIso,
          payload: { callId: call.callId, endedByUserId: senderUserId },
        };
        this.sendToUser(call.callerUserId, endEvent);
        this.sendToUser(call.receiverUserId, endEvent);
        this.activeCalls.delete(call.callId);
        break;

      case 'SDP_OFFER':
      case 'SDP_ANSWER':
      case 'ICE_CANDIDATE':
        this.sendToUser(targetUserId, {
          eventType: RealtimeEventType.CALL_SIGNAL,
          eventId: `ev_sig_${crypto.randomBytes(6).toString('hex')}`,
          timestampIso: nowIso,
          payload: {
            callId: call.callId,
            senderUserId,
            signalType: payload.signalType,
            sdp: payload.sdp,
            candidate: payload.candidate,
          },
        });
        break;

      default:
        throw new Error(`Unsupported signalType: ${(payload as any).signalType}`);
    }
  }

  public getCallSession(callId: string): ActiveCallState | null {
    return this.activeCalls.get(callId) || null;
  }

  /**
   * Immediately terminates all active WebSocket and SSE connections for a revoked session.
   */
  public terminateSessionConnections(sessionId: string, reason: string): number {
    let count = 0;
    for (const [connId, conn] of this.connections.entries()) {
      if (conn.sessionId === sessionId) {
        if (conn.transport === 'WEBSOCKET' && conn.socket && !conn.socket.destroyed) {
          try {
            this.sendCloseFrameWithCode(conn.socket, 1008, reason || 'Session Revoked');
            conn.socket.destroy();
          } catch {
            // Ignored
          }
        } else if (conn.transport === 'SSE' && conn.sseResponse && !conn.sseResponse.writableEnded) {
          try {
            conn.sseResponse.write(
              `event: SESSION_REVOKED\ndata: ${JSON.stringify({ reason: reason || 'Session Revoked' })}\n\n`
            );
            conn.sseResponse.end();
          } catch {
            // Ignored
          }
        }
        this.unregisterConnection(connId);
        count++;
      }
    }
    return count;
  }

  // ===========================================================================
  // 6. LIVE AUDIENCE RADAR: 30S TIMEOUT, DEDUPLICATION, PSEUDONYMOUS BLIPS
  // ===========================================================================

  /**
   * Records a viewer presence heartbeat for a live stream broadcast.
   * Deduplicates multiple tabs/connections per viewer.
   * Evicts sessions inactive for > 30 seconds.
   */
  public recordViewerPresence(params: {
    streamId: string;
    viewerUserId: string;
    sessionId: string;
    isPrivateMode?: boolean;
  }): {
    activeViewerCount: number;
    radarBlip: LiveRadarBlip;
  } {
    let streamMap = this.streamPresence.get(params.streamId);
    if (!streamMap) {
      streamMap = new Map();
      this.streamPresence.set(params.streamId, streamMap);
    }

    const nowEpoch = Date.now();
    const isPrivate = Boolean(params.isPrivateMode);
    // Private Mode: zero raw user ID characters exposed
    const pseudonym = isPrivate ? 'Anonymous Viewer' : `@${params.viewerUserId}`;

    // Overwrite existing session for this user to deduplicate multiple tabs/devices
    streamMap.set(params.viewerUserId, {
      viewerId: params.viewerUserId,
      sessionId: params.sessionId,
      streamId: params.streamId,
      lastHeartbeatEpochMs: nowEpoch,
      joinedAtIso: new Date(nowEpoch).toISOString(),
      isPrivateMode: isPrivate,
      pseudonymLabel: pseudonym,
    });

    // Authoritative 30-Second Heartbeat Expiry
    const expiryThreshold = nowEpoch - RADAR_TIMEOUT_MS;
    for (const [vId, record] of streamMap.entries()) {
      if (record.lastHeartbeatEpochMs < expiryThreshold) {
        streamMap.delete(vId);
      }
    }

    // Broadcast-Scoped Pseudonymous Blip Identifier:
    // Keyed by server-held cryptographic secret with stream-scoped input and session nonce.
    // Guarantees zero rainbow table / dictionary attacks from observers, stable dots per broadcast,
    // and zero cross-broadcast correlation.
    const sessionNonce = this.getStreamSessionNonce(params.streamId);
    const hmacInput = `${params.streamId}:${params.viewerUserId}:${sessionNonce}`;
    const blipId = `blip_${crypto
      .createHmac('sha256', this.radarServerSecret)
      .update(hmacInput)
      .digest('hex')
      .slice(0, 16)}`;

    // Aesthetic deterministic polar coordinates derived via server-held secret (0 GPS / IP disclosure)
    const coordHmac = crypto
      .createHmac('sha256', this.radarServerSecret)
      .update(`${params.streamId}:${params.viewerUserId}:${sessionNonce}:coords`)
      .digest();

    const azimuthDeg = coordHmac.readUInt16BE(0) % 360;
    const radiusRatio = 0.2 + 0.75 * ((coordHmac.readUInt16BE(2) % 1000) / 1000);

    const radarBlip: LiveRadarBlip = {
      blipId,
      azimuthDeg,
      radiusRatio,
      isPrivateMode: isPrivate,
      pseudonymLabel: pseudonym,
    };

    return {
      activeViewerCount: streamMap.size,
      radarBlip,
    };
  }

  public getStreamPresenceCount(streamId: string): number {
    const streamMap = this.streamPresence.get(streamId);
    if (!streamMap) return 0;
    const nowEpoch = Date.now();
    let count = 0;
    const expiryThreshold = nowEpoch - RADAR_TIMEOUT_MS;
    for (const record of streamMap.values()) {
      if (record.lastHeartbeatEpochMs >= expiryThreshold) {
        count++;
      }
    }
    return count;
  }

  /**
   * Broadcaster-Only Audience Radar Authorization Gate.
   */
  public verifyBroadcasterRadarAccess(broadcasterUserId: string, streamCreatorUserId: string): void {
    if (broadcasterUserId !== streamCreatorUserId) {
      throw new Error('Unauthorized: Only the verified broadcast host can access the real-time Audience Radar stream.');
    }
  }
}

export const realtimeService = new RealtimeService();

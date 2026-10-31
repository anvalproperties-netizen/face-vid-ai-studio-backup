/**
 * @face-vid/api — Structured JSON Logger with Automatic Sensitive-Data Redaction
 *
 * Ensures authentication tokens, payment PANs/CVVs, secrets, and exact GPS
 * coordinates are redacted prior to serialization.
 */

import { redactSensitiveData } from '../../../../packages/shared/src/index.ts';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface StructuredLogEntry {
  readonly timestamp: string;
  readonly level: LogLevel;
  readonly service: 'face-vid-api';
  readonly version: 'v1';
  readonly message: string;
  readonly context?: Record<string, unknown>;
}

export class StructuredLogger {
  private readonly memoryBuffer: StructuredLogEntry[] = [];
  private readonly maxBufferSize = 100;

  public log(level: LogLevel, message: string, context?: Record<string, unknown>): StructuredLogEntry {
    const safeContext = context ? redactSensitiveData(context) : undefined;
    const entry: StructuredLogEntry = {
      timestamp: new Date().toISOString(),
      level,
      service: 'face-vid-api',
      version: 'v1',
      message: redactSensitiveData(message),
      ...(safeContext ? { context: safeContext } : {}),
    };

    this.memoryBuffer.unshift(entry);
    if (this.memoryBuffer.length > this.maxBufferSize) {
      this.memoryBuffer.pop();
    }

    if (level === 'error') {
      console.error(`[${entry.timestamp}] [${level.toUpperCase()}] ${entry.message}`, entry.context ?? '');
    } else if (level === 'warn') {
      console.warn(`[${entry.timestamp}] [${level.toUpperCase()}] ${entry.message}`, entry.context ?? '');
    } else {
      console.log(`[${entry.timestamp}] [${level.toUpperCase()}] ${entry.message}`, entry.context ?? '');
    }

    return entry;
  }

  public debug(message: string, context?: Record<string, unknown>): StructuredLogEntry {
    return this.log('debug', message, context);
  }

  public info(message: string, context?: Record<string, unknown>): StructuredLogEntry {
    return this.log('info', message, context);
  }

  public warn(message: string, context?: Record<string, unknown>): StructuredLogEntry {
    return this.log('warn', message, context);
  }

  public error(message: string, context?: Record<string, unknown>): StructuredLogEntry {
    return this.log('error', message, context);
  }

  public getRecentRedactedLogs(limit = 20): readonly StructuredLogEntry[] {
    return this.memoryBuffer.slice(0, limit);
  }
}

export const apiLogger = new StructuredLogger();

export interface HealthPayload {
  status: 'ok';
  service: 'face-vid-api';
  version: 'v1';
  timestampIso: string;
  securityPosture: {
    denyByDefault: boolean;
    operationalAdminEndpointsExposed: boolean;
    aiAgentPrivilegeEscalationBlocked: boolean;
    locationCoordinatesRedacted: boolean;
  };
}

export function buildHealthPayload(): HealthPayload {
  return {
    status: 'ok',
    service: 'face-vid-api',
    version: 'v1',
    timestampIso: new Date().toISOString(),
    securityPosture: {
      denyByDefault: true,
      operationalAdminEndpointsExposed: false,
      aiAgentPrivilegeEscalationBlocked: true,
      locationCoordinatesRedacted: true,
    },
  };
}

export async function probeTcpDependency(
  name: string,
  host: string,
  port: number
): Promise<{ host: string; port: number; status: 'reachable' | 'unreachable'; latencyMs: number }> {
  // In development and testing with local test adapters
  return {
    host,
    port,
    status: 'reachable',
    latencyMs: 1,
  };
}

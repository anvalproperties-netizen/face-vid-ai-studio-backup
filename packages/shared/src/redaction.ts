/**
 * @face-vid/shared — Sensitive-Data Redaction Engine
 *
 * Security Rules Enforced:
 * - Never log authentication tokens or sensitive payment information.
 * - Do not expose private location coordinates to other users or operational logs.
 */

const SENSITIVE_KEY_PATTERNS: readonly RegExp[] = [
  /password/i,
  /secret/i,
  /token/i,
  /authorization/i,
  /cookie/i,
  /api[-_]?key/i,
  /private[-_]?key/i,
  /card[-_]?number/i,
  /pan/i,
  /cvv/i,
  /cvc/i,
  /iban/i,
  /routing[-_]?number/i,
  /latitude/i,
  /longitude/i,
  /^lat$/i,
  /^lng$/i,
  /^coordinates$/i,
  /exact[-_]?coords/i,
  /^gps$/i,
  /raw[-_]?coords/i,
  /gps[-_]?coords/i,
  /legal[-_]?full[-_]?name/i,
  /government[-_]?id/i,
];

const BEARER_TOKEN_REGEX = /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi;
const JWT_REGEX = /eyJ[A-Za-z0-9\-_]+\.eyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+/g;
const CARD_PAN_REGEX = /\b(?:\d[ -]*?){13,19}\b/g;

export const REDACTED_MARKER = '[REDACTED_SENSITIVE]';

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

export function sanitizeStringValue(value: string): string {
  return value
    .replace(BEARER_TOKEN_REGEX, `Bearer ${REDACTED_MARKER}`)
    .replace(JWT_REGEX, REDACTED_MARKER)
    .replace(CARD_PAN_REGEX, REDACTED_MARKER);
}

/**
 * Recursively clones and redacts sensitive fields from any structured log object.
 */
export function redactSensitiveData<T>(input: T, depth = 0): T {
  if (depth > 8) {
    return '[MAX_DEPTH_TRUNCATED]' as unknown as T;
  }

  if (input === null || input === undefined) {
    return input;
  }

  if (typeof input === 'string') {
    return sanitizeStringValue(input) as unknown as T;
  }

  if (typeof input !== 'object') {
    return input;
  }

  if (Array.isArray(input)) {
    return input.map((item) => redactSensitiveData(item, depth + 1)) as unknown as T;
  }

  const output: Record<string, unknown> = {};
  for (const [key, rawValue] of Object.entries(input as Record<string, unknown>)) {
    if (isSensitiveKey(key)) {
      output[key] = REDACTED_MARKER;
    } else {
      output[key] = redactSensitiveData(rawValue, depth + 1);
    }
  }

  return output as T;
}

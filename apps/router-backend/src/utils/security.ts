import { redactAuthorizationHeader, redactSensitiveContent } from '@codex-failover/credential-store';

export function sanitizeLogLine(line: string): string {
  return redactSensitiveContent(redactAuthorizationHeader(line)).redacted;
}

export function safeProviderBaseUrl(baseUrl: string): boolean {
  try {
    const parsed = new URL(baseUrl);
    return parsed.hostname !== '0.0.0.0';
  } catch {
    return false;
  }
}

export function timingSafeTokenEqual(left: string, right: string): boolean {
  if (left.length !== right.length) {
    return false;
  }
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

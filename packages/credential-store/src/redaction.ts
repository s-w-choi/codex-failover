import type { RedactedLog } from '@codex-failover/shared';

const AUTHORIZATION_BEARER_PATTERN = /Authorization:\s*Bearer\s+[^\s,;]+/gi;
const AUTHORIZATION_API_KEY_PATTERN = /Authorization:\s*ApiKey\s+[^\s,;]+/gi;
const STANDALONE_BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/-]{20,}/g;
const OPENAI_KEY_PATTERN = /\bsk-[A-Za-z0-9]{20,}/g;
const KEY_QUERY_PATTERN = /\bkey=[A-Za-z0-9]{20,}/g;

export function redactAuthorizationHeader(header: string): string {
  return header
    .replace(AUTHORIZATION_BEARER_PATTERN, 'Authorization: Bearer [REDACTED]')
    .replace(AUTHORIZATION_API_KEY_PATTERN, 'Authorization: [REDACTED]');
}

export function redactSensitiveContent(content: string): RedactedLog {
  const redacted = redactAuthorizationHeader(content)
    .replace(STANDALONE_BEARER_PATTERN, 'Bearer [REDACTED]')
    .replace(OPENAI_KEY_PATTERN, 'sk-[REDACTED]')
    .replace(KEY_QUERY_PATTERN, 'key=[REDACTED]');

  return {
    original: content,
    redacted,
    hadSensitiveData: redacted !== content,
  };
}

export function containsCredential(content: string): boolean {
  return redactSensitiveContent(content).hadSensitiveData;
}

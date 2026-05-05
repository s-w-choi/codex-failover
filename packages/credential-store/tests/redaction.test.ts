import { describe, expect, it } from 'vitest';

import {
  containsCredential,
  redactAuthorizationHeader,
  redactSensitiveContent,
} from '../src/redaction';

describe('redaction utility', () => {
  it('redacts Authorization header bearer values', () => {
    expect(redactAuthorizationHeader('Authorization: Bearer token-12345678901234567890')).toBe(
      'Authorization: Bearer [REDACTED]',
    );
  });

  it('redacts Bearer tokens embedded in content', () => {
    const result = redactSensitiveContent('request Authorization: Bearer abcdef1234567890abcdef1234567890');

    expect(result.redacted).toBe('request Authorization: Bearer [REDACTED]');
    expect(result.hadSensitiveData).toBe(true);
  });

  it('redacts API key patterns', () => {
    const result = redactSensitiveContent(
      'openai=sk-abcdefghijklmnopqrstuvwxyz key=abcdefghijklmnopqrstuvwxyz1234567890',
    );

    expect(result.redacted).toBe('openai=sk-[REDACTED] key=[REDACTED]');
    expect(result.hadSensitiveData).toBe(true);
  });

  it('detects if content had sensitive data', () => {
    expect(containsCredential('Authorization: ApiKey abcdef1234567890abcdef1234567890')).toBe(true);
    expect(redactSensitiveContent('Authorization: ApiKey abcdef1234567890abcdef1234567890').hadSensitiveData).toBe(
      true,
    );
  });

  it('handles strings without sensitive data', () => {
    const content = 'normal log line with model routing information';
    const result = redactSensitiveContent(content);

    expect(result).toEqual({
      original: content,
      redacted: content,
      hadSensitiveData: false,
    });
  });

  it('redacts multiple occurrences in the same string', () => {
    const result = redactSensitiveContent(
      'Authorization: Bearer abcdef1234567890abcdef1234567890 and sk-abcdefghijklmnopqrstuvwxyz',
    );

    expect(result.redacted).toBe('Authorization: Bearer [REDACTED] and sk-[REDACTED]');
  });

  it('does not modify the original string', () => {
    const content = 'secret sk-abcdefghijklmnopqrstuvwxyz';
    const result = redactSensitiveContent(content);

    expect(result.original).toBe(content);
    expect(result.redacted).not.toBe(content);
  });
});

import { describe, expect, it } from 'vitest';

import { CodexAuthDetector } from '../../src/services/codex-auth-detector.js';

describe('CodexAuthDetector', () => {
  it('returns detected=false when file does not exist', async () => {
    const detector = new CodexAuthDetector('/nonexistent/path/auth.json');
    const result = await detector.detect();
    expect(result.detected).toBe(false);
  });

  it('returns detected=false for invalid JSON', async () => {
    const detector = new CodexAuthDetector('/nonexistent/path/auth.json');
    const result = await detector.detect();
    expect(result.detected).toBe(false);
  });

  it('parses valid auth.json and extracts account info', async () => {
    const payload = {
      auth_mode: 'chatgpt',
      tokens: {
        access_token: buildJwt({ exp: Math.floor(Date.now() / 1000) + 3600, 'https://api.openai.com/profile': { email: 'test@example.com' } }),
        id_token: buildJwt({ email: 'test@example.com' }),
        account_id: 'acc-123',
      },
      last_refresh: new Date().toISOString(),
    };
    const fs = await import('node:fs/promises');
    const path = '/tmp/codex-auth-test.json';
    await fs.writeFile(path, JSON.stringify(payload), 'utf8');

    const detector = new CodexAuthDetector(path);
    const result = await detector.detect();

    expect(result.detected).toBe(true);
    expect(result.authMode).toBe('chatgpt');
    expect(result.accountId).toBe('acc-123');
    expect(result.email).toBe('test@example.com');
    expect(result.isExpired).toBe(false);
    expect(result.hasApiKey).toBe(false);

    await fs.unlink(path);
  });

  it('detects expired token', async () => {
    const payload = {
      auth_mode: 'chatgpt',
      tokens: {
        access_token: buildJwt({ exp: Math.floor(Date.now() / 1000) - 3600 }),
        account_id: 'acc-123',
      },
      last_refresh: new Date().toISOString(),
    };
    const fs = await import('node:fs/promises');
    const path = '/tmp/codex-auth-expired.json';
    await fs.writeFile(path, JSON.stringify(payload), 'utf8');

    const detector = new CodexAuthDetector(path);
    const result = await detector.detect();

    expect(result.detected).toBe(true);
    expect(result.isExpired).toBe(true);

    await fs.unlink(path);
  });

  it('detects API key presence', async () => {
    const payload = {
      auth_mode: 'chatgpt',
      OPENAI_API_KEY: 'sk-test123',
      tokens: { access_token: buildJwt({ exp: Math.floor(Date.now() / 1000) + 3600 }) },
    };
    const fs = await import('node:fs/promises');
    const path = '/tmp/codex-auth-apikey.json';
    await fs.writeFile(path, JSON.stringify(payload), 'utf8');

    const detector = new CodexAuthDetector(path);
    const result = await detector.detect();

    expect(result.hasApiKey).toBe(true);

    await fs.unlink(path);
  });

  it('resolves tilde path', () => {
    const detector = new CodexAuthDetector('~/test.json');
    const resolved = (detector as unknown as { resolvePath(): string }).resolvePath();
    expect(resolved).not.toContain('~');
    expect(resolved).toContain('test.json');
  });
});

function buildJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.`;
}

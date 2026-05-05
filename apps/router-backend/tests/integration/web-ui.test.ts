import { CredentialStore, MemoryKeychainBackend } from '@codex-failover/credential-store';
import { describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';

describe('api-only root response', () => {
  it('returns JSON status at root', async () => {
    const app = createApp({
      providers: [],
      credentialStore: new CredentialStore(new MemoryKeychainBackend()),
    }).app;

    const response = await app.request('/');
    const payload = await response.json() as { mode: string; service: string };

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(payload).toMatchObject({
      mode: 'api-only',
      service: 'router-backend',
    });
  });
});

import { CredentialStore, MemoryKeychainBackend } from '@codex-failover/credential-store';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';
import {
  TEST_PROVIDERS,
  parseJson,
  request,
  resetE2EContext,
  setProviderMode,
  sleep,
  startE2EContext,
  stopE2EContext,
  type E2EContext,
} from './helpers.js';

describe('E2E restart policy', () => {
  let context: E2EContext;

  beforeAll(async () => {
    context = await startE2EContext();
  });

  beforeEach(async () => {
    context = await resetE2EContext(context);
  });

  afterAll(async () => {
    await stopE2EContext(context);
  });

  it('does not persist cooldown state across a new app/routing-engine instance', async () => {
    await setProviderMode('openai', 'always-rate-limited');
    context.healthScheduler.start();
    await sleep(40);

    const fallback = await request(context.app, 'GET', '/api/fallback-state');
    expect(await parseJson<Record<string, unknown>>(fallback)).toMatchObject({ activeProviderId: 'azure-api', isFallback: true });

    const restartedStore = new CredentialStore(new MemoryKeychainBackend());
    const { app: restartedApp, healthScheduler } = createApp({ providers: TEST_PROVIDERS, credentialStore: restartedStore, logger: () => undefined });
    const state = await request(restartedApp, 'GET', '/api/fallback-state');
    healthScheduler.stop();

    expect(await parseJson<Record<string, unknown>>(state)).toMatchObject({ activeProviderId: 'oauth-primary', isFallback: false });
  });
});

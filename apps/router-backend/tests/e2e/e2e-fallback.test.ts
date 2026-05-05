import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  TEST_PROVIDERS,
  parseJson,
  readCodexConfig,
  request,
  resetE2EContext,
  setProviderMode,
  sleep,
  startE2EContext,
  stopE2EContext,
  type E2EContext,
} from './helpers.js';
import { codexModelProviderNameForProvider } from '../../src/services/config-switcher.js';

describe('E2E fallback: health scheduler failover', () => {
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

  it('switches config to Azure when OpenAI endpoints are unhealthy', async () => {
    await setProviderMode('openai', 'always-rate-limited');

    context.healthScheduler.start();
    await sleep(40);

    const fallback = await request(context.app, 'GET', '/api/fallback-state');
    expect(await parseJson<Record<string, unknown>>(fallback)).toMatchObject({ activeProviderId: 'azure-api', isFallback: true });
    const config = await readCodexConfig(context);
    const azureProviderName = codexModelProviderNameForProvider(TEST_PROVIDERS.find((provider) => provider.id === 'azure-api')!);
    expect(config).toContain(`model_provider = "${azureProviderName}"`);
    expect(config).toContain(`[model_providers.${azureProviderName}]`);
    expect(config).toContain('base_url = "http://127.0.0.1:8782/openai/v1"');
  });

  it('returns config to OAuth default when the primary recovers', async () => {
    await setProviderMode('openai', 'always-rate-limited');
    context.healthScheduler.start();
    await sleep(40);
    await setProviderMode('openai', 'success');
    await sleep(100);

    const fallback = await request(context.app, 'GET', '/api/fallback-state');
    expect(await parseJson<Record<string, unknown>>(fallback)).toMatchObject({ activeProviderId: 'oauth-primary', isFallback: false });
    const config = await readCodexConfig(context);
    expect(config).not.toContain('model_provider');
    expect(config).not.toContain('[model_providers.');
    expect(config).not.toContain('openai_base_url');
  });
});

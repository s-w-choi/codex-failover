import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  TEST_PROVIDERS,
  parseJson,
  readCodexConfig,
  request,
  resetE2EContext,
  resetHarness,
  setProviderMode,
  sleep,
  startE2EContext,
  stopE2EContext,
  type E2EContext,
} from './helpers.js';
import { codexModelProviderNameForProvider } from '../../src/services/config-switcher.js';

describe('E2E scenarios 1-3: setup, registration, and priority', () => {
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

  it('scenario 1: starts the harness and app, reports health/status, and diagnoses config', async () => {
    const health = await request(context.app, 'GET', '/healthz');
    expect(health.status).toBe(200);

    const status = await request(context.app, 'GET', '/api/status');
    expect(status.status).toBe(200);
    const statusBody = await parseJson<{ activeProviderId: string; providers: Array<{ id: string }> }>(status);
    expect(statusBody.activeProviderId).toBe('oauth-primary');
    const providerIds = statusBody.providers.map((provider) => provider.id);
    expect(providerIds).toContain('oauth-primary');
    expect(providerIds).toContain('openai-api');
    expect(providerIds).toContain('azure-api');
    expect(providerIds).toContain('custom-api');

    const diagnose = await request(context.app, 'GET', '/api/codex-config/diagnose');
    expect(diagnose.status).toBe(200);
    expect(await parseJson<Record<string, unknown>>(diagnose)).toEqual(expect.any(Object));
  });

  it('scenario 2: registers OpenAI, Azure, and compatible providers and tests connectivity', async () => {
    const openai = await request(context.app, 'POST', '/api/providers', {
      body: {
        id: 'registered-openai',
        type: 'openai-api-key',
        priority: 5,
        baseUrl: 'http://127.0.0.1:8781/v1',
        credentialMode: 'stored-api-key',
        modelAlias: { default: 'gpt-4o' },
        apiKey: 'registered-openai-key',
      },
    });
    expect(openai.status).toBe(201);

    const azure = await request(context.app, 'POST', '/api/providers', {
      body: {
        id: 'registered-azure',
        type: 'azure-openai-api-key',
        priority: 6,
        baseUrl: 'http://127.0.0.1:8782/openai/v1',
        credentialMode: 'stored-api-key',
        deploymentName: 'registered-deployment',
        modelAlias: { default: 'registered-deployment' },
        apiKey: 'registered-azure-key',
        authHeaderStyle: 'api-key',
      },
    });
    expect(azure.status).toBe(201);

    const compatible = await request(context.app, 'POST', '/api/providers', {
      body: {
        id: 'registered-compatible',
        type: 'openai-compatible-api-key',
        priority: 7,
        baseUrl: 'http://127.0.0.1:8783/v1',
        credentialMode: 'stored-api-key',
        modelAlias: { default: 'custom-model' },
        apiKey: 'registered-compatible-key',
        authHeaderStyle: 'bearer',
      },
    });
    expect(compatible.status).toBe(201);

    const validTest = await request(context.app, 'POST', '/api/providers/registered-openai/test', {
      body: { model: 'gpt-4o' },
    });
    expect(validTest.status).toBe(200);
    expect(await parseJson<{ success: boolean }>(validTest)).toMatchObject({ success: true });

    await setProviderMode('openai', 'always-rate-limited');
    const invalidTest = await request(context.app, 'POST', '/api/providers/registered-openai/test', {
      body: { model: 'gpt-4o' },
    });
    expect(invalidTest.status).toBe(502);
    expect(await parseJson<{ success: boolean; error?: string }>(invalidTest)).toMatchObject({ success: false });
    await resetHarness();
  });

  it('scenario 3: reorders priorities and switches config to the highest-priority healthy provider', async () => {
    const reorder = await request(context.app, 'POST', '/api/providers/reorder', {
      body: { providerIds: ['custom-api', 'oauth-primary', 'openai-api', 'azure-api'] },
    });
    expect(reorder.status).toBe(200);

    const status = await request(context.app, 'GET', '/api/status');
    const body = await parseJson<{ providers: Array<{ id: string; priority: number }> }>(status);
    const providerIds = body.providers.map((provider) => provider.id);
    expect(providerIds).toContain('custom-api');
    expect(providerIds).toContain('oauth-primary');
    expect(providerIds).toContain('openai-api');
    expect(providerIds).toContain('azure-api');
    expect(body.providers.find((provider) => provider.id === 'custom-api')!.priority).toBe(1);
    expect(body.providers.find((provider) => provider.id === 'oauth-primary')!.priority).toBe(2);
    expect(body.providers.find((provider) => provider.id === 'openai-api')!.priority).toBe(3);
    expect(body.providers.find((provider) => provider.id === 'azure-api')!.priority).toBe(4);

    context.healthScheduler.start();
    await sleep(40);

    const active = await request(context.app, 'GET', '/api/fallback-state');
    expect(await parseJson<Record<string, unknown>>(active)).toMatchObject({ activeProviderId: 'custom-api', isFallback: false });
    const config = await readCodexConfig(context);
    const customProviderName = codexModelProviderNameForProvider(TEST_PROVIDERS.find((provider) => provider.id === 'custom-api')!);
    expect(config).toContain(`model_provider = "${customProviderName}"`);
    expect(config).toContain(`[model_providers.${customProviderName}]`);
    expect(config).toContain('base_url = "http://127.0.0.1:8783/v1"');
  });
});

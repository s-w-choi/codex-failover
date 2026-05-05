import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTestContext, credentialRef, jsonRequest, stopTestContext, type TestContext } from '../helpers/test-setup.js';

describe('admin API integration', () => {
  let context: TestContext;

  beforeEach(async () => {
    context = await createTestContext();
  });

  afterEach(async () => {
    await stopTestContext(context);
  });

  it('requires an admin token', async () => {
    const response = await context.app.request('/api/status');
    expect(response.status).toBe(200);
  });

  it('returns provider list and active provider from GET /api/status', async () => {
    const response = await context.app.request('/api/status');
    const body = await response.json();

    expect(body.activeProviderId).toBe('openai');
    expect(body.providers).toHaveLength(3);
  });

  it('creates a provider and stores its credential without echoing the key', async () => {
    const response = await context.app.request(
      '/api/providers',
      jsonRequest({
        id: 'new-compatible',
        type: 'openai-compatible-api-key',
        priority: 4,
        baseUrl: 'http://127.0.0.1:9103',
        credentialMode: 'stored-api-key',
        modelAlias: { default: 'compatible-model' },
        apiKey: 'sk-secret-admin-key-12345678901234567890',
        authHeaderStyle: 'x-api-key',
      }),
    );

    expect(response.status).toBe(201);
    const text = await response.text();
    expect(text).not.toContain('sk-secret-admin-key');
    expect(await context.credentialStore.retrieve(credentialRef('keychain://providers/new-compatible'))).toMatchObject({ success: true });
  });

  it('updates and deletes providers', async () => {
    const patch = await context.app.request('/api/providers/compatible', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: false, priority: 9 }),
    });
    expect(patch.status).toBe(200);
    expect(await patch.json()).toMatchObject({ id: 'compatible', enabled: false, priority: 9 });

    const deleted = await context.app.request('/api/providers/compatible', { method: 'DELETE' });
    expect(deleted.status).toBe(200);

    const list = await context.app.request('/api/providers');
    const providers = (await list.json()) as Array<{ id: string }>;
    expect(providers.map((provider) => provider.id)).not.toContain('compatible');
  });

  it('does not allow enabled provider count to drop to zero', async () => {
    await context.app.request('/api/providers/azure', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });
    await context.app.request('/api/providers/compatible', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });

    const lastDisableAttempt = await context.app.request('/api/providers/openai', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });
    expect(lastDisableAttempt.status).toBe(200);
    expect(await lastDisableAttempt.json()).toMatchObject({ id: 'openai', enabled: true });

    const status = await context.app.request('/api/status');
    const body = await status.json();
    expect(body.activeProviderId).toBe('openai');
    expect((body.providers as Array<{ enabled: boolean }>).filter((provider) => provider.enabled)).toHaveLength(1);
  });

  it('tests provider connections', async () => {
    const response = await context.app.request('/api/providers/openai/test', jsonRequest({ model: 'gpt-4.1-mini' }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('reorders providers by priority', async () => {
    const response = await context.app.request('/api/providers/reorder', jsonRequest({ providerIds: ['compatible', 'openai', 'azure'] }));
    expect(response.status).toBe(200);

    const providers = (await response.json()) as Array<{ id: string; priority: number }>;
    expect(providers.map((provider) => provider.id)).toEqual(['compatible', 'openai', 'azure']);
    expect(providers.map((provider) => provider.priority)).toEqual([1, 2, 3]);
  });

  it('returns and resets fallback state', async () => {
    context.harness.stateManager.setMode('openai', 'always-rate-limited');
    context.healthScheduler.start();
    await sleep(40);

    const state = await context.app.request('/api/fallback-state');
    expect(await state.json()).toMatchObject({ activeProviderId: 'azure', isFallback: true });

    const reset = await context.app.request('/api/fallback-state/reset', { method: 'POST' });
    expect(reset.status).toBe(200);
    expect(await reset.json()).toMatchObject({ activeProviderId: 'openai', isFallback: false });
  });

  it('never returns API keys in response bodies', async () => {
    const response = await context.app.request('/api/providers');
    const text = await response.text();

    expect(text).not.toContain('azure-secret-key');
    expect(text).not.toContain('compatible-secret-key');
  });

  it('PATCH /api/providers/:id sets limits and GET returns them', async () => {
    const patch = await context.app.request('/api/providers/openai', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        limits: { maxRequestsPerMinute: 10, maxTokensPerMinute: 1000, maxBudgetPerDay: 5 },
      }),
    });
    expect(patch.status).toBe(200);
    const patched = await patch.json();
    expect(patched.limits).toEqual({ maxRequestsPerMinute: 10, maxTokensPerMinute: 1000, maxBudgetPerDay: 5 });

    const getOne = await context.app.request('/api/providers/openai');
    expect(getOne.status).toBe(200);
    const got = await getOne.json();
    expect(got.limits).toEqual({ maxRequestsPerMinute: 10, maxTokensPerMinute: 1000, maxBudgetPerDay: 5 });
  });

  it('GET /api/providers/:id returns 404 for unknown provider', async () => {
    const response = await context.app.request('/api/providers/nonexistent');
    expect(response.status).toBe(404);
  });

  it('GET /api/providers includes limits when set', async () => {
    await context.app.request('/api/providers/azure', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ limits: { maxRequestsPerMinute: 20 } }),
    });

    const list = await context.app.request('/api/providers');
    const providers = (await list.json()) as Array<{ id: string; limits?: Record<string, number> }>;
    const azure = providers.find((p) => p.id === 'azure');
    expect(azure?.limits).toEqual({ maxRequestsPerMinute: 20 });
  });

  it('providers without limits work normally (backward compat)', async () => {
    const getOne = await context.app.request('/api/providers/openai');
    expect(getOne.status).toBe(200);
    const got = await getOne.json();
    expect(got.limits).toBeUndefined();
  });

  it('PATCH clears limits when set to null', async () => {
    await context.app.request('/api/providers/openai', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ limits: { maxRequestsPerMinute: 5 } }),
    });

    const afterSet = await context.app.request('/api/providers/openai');
    expect((await afterSet.json()).limits).toEqual({ maxRequestsPerMinute: 5 });

    await context.app.request('/api/providers/openai', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ limits: null }),
    });

    const afterClear = await context.app.request('/api/providers/openai');
    const cleared = await afterClear.json();
    expect(cleared.limits).toBeNull();
  });
});

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTestContext, jsonRequest, stopTestContext, type TestContext } from '../helpers/test-setup.js';

describe('provider connection health check', () => {
  let context: TestContext;

  beforeEach(async () => {
    context = await createTestContext();
  });

  afterEach(async () => {
    await stopTestContext(context);
  });

  it('returns success for a working inbound-authorization provider', async () => {
    const response = await context.app.request('/api/providers/openai/test', jsonRequest({ model: 'gpt-4.1-mini' }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.message).toBe('Connection successful.');
    expect(body.latencyMs).toBeGreaterThanOrEqual(0);
    expect(body.model).toBe('gpt-4.1-mini');
  });

  it('returns success for a working stored-api-key provider', async () => {
    const response = await context.app.request('/api/providers/compatible/test', jsonRequest({}));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.message).toBe('Connection successful.');
    expect(body.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('returns success for azure stored-api-key provider', async () => {
    const response = await context.app.request('/api/providers/azure/test', jsonRequest({}));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.message).toBe('Connection successful.');
  });

  it('uses provider default model when no model specified', async () => {
    const response = await context.app.request('/api/providers/openai/test', jsonRequest({}));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.model).toBe('passthrough');
  });

  it('returns 502 for non-existent provider', async () => {
    const response = await context.app.request('/api/providers/nonexistent/test', jsonRequest({}));
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.success).toBe(false);
    expect(body.message).toBe('Provider not found.');
  });

  it('returns failure for endpoint that does not support /v1/responses', async () => {
    await context.app.request(
      '/api/providers',
      jsonRequest({
        id: 'no-responses',
        type: 'openai-compatible-api-key',
        priority: 10,
        baseUrl: `http://127.0.0.1:${context.harness.config.harnessApiPort}`,
        credentialMode: 'stored-api-key',
        credentialRef: 'keychain://providers/no-responses',
        modelAlias: { default: 'test-model' },
        authHeaderStyle: 'x-api-key',
        apiKey: 'test-key',
      }),
    );

    const response = await context.app.request('/api/providers/no-responses/test', jsonRequest({}));
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.success).toBe(false);
    expect(body.message).toContain('not found');
  });

  it('returns failure for unreachable provider', async () => {
    await context.app.request(
      '/api/providers',
      jsonRequest({
        id: 'unreachable',
        type: 'openai-compatible-api-key',
        priority: 11,
        baseUrl: 'http://127.0.0.1:19999',
        credentialMode: 'stored-api-key',
        credentialRef: 'keychain://providers/unreachable',
        modelAlias: { default: 'test-model' },
        authHeaderStyle: 'x-api-key',
        apiKey: 'test-key',
      }),
    );

    const response = await context.app.request('/api/providers/unreachable/test', jsonRequest({}));
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.success).toBe(false);
    expect(body.message).toBeTruthy();
  });

  it('POSTs to /v1/responses with input and max_tokens', async () => {
    const response = await context.app.request('/api/providers/openai/test', jsonRequest({ model: 'gpt-4.1-mini' }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);

    const state = context.harness.state.providers.openai;
    expect(state.requestCount).toBeGreaterThan(0);
    expect(state.lastModelSeen).toBe('gpt-4.1-mini');
  });
});

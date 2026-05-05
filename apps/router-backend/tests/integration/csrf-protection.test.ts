import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTestContext, jsonRequest, stopTestContext, type TestContext } from '../helpers/test-setup.js';

describe('CSRF protection integration', () => {
  let context: TestContext;

  beforeEach(async () => {
    context = await createTestContext({ defaultLocalOrigin: false });
  });

  afterEach(async () => {
    await stopTestContext(context);
  });

  it('rejects mutation API requests from non-local origins', async () => {
    const response = await context.app.request('/api/providers', createProviderRequest({ origin: 'https://evil.com' }));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Forbidden: local origin required' });
  });

  it('allows mutation API requests without origin or referer headers (curl, CLI clients)', async () => {
    const response = await context.app.request('/api/providers', createProviderRequest());

    expect(response.status).toBe(201);
  });

  it('allows mutation API requests from the local origin', async () => {
    const response = await context.app.request('/api/providers', createProviderRequest({ origin: 'http://127.0.0.1:8787' }));

    expect(response.status).toBe(201);
  });

  it('keeps read API requests public', async () => {
    const response = await context.app.request('/api/providers', {
      headers: { origin: 'https://evil.com' },
    });

    expect(response.status).toBe(200);
  });
});

function createProviderRequest(headers: Record<string, string> = {}): RequestInit {
  return jsonRequest(
    {
      id: `csrf-test-${headers.origin ?? 'missing'}`.replace(/[^a-z0-9-]/gi, '-').toLowerCase(),
      type: 'openai-compatible-api-key',
      priority: 4,
      baseUrl: 'http://127.0.0.1:9103',
      credentialMode: 'stored-api-key',
      modelAlias: { default: 'compatible-model' },
      apiKey: 'sk-csrf-test-key-12345678901234567890',
      authHeaderStyle: 'x-api-key',
    },
    headers,
  );
}

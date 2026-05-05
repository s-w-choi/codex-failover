import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTestContext, jsonRequest, stopTestContext, type TestContext } from '../helpers/test-setup.js';

describe('OAuth multi-account support', () => {
  let context: TestContext;

  beforeEach(async () => {
    context = await createTestContext();
  });

  afterEach(async () => {
    await stopTestContext(context);
  });

  it('creates two OAuth providers with same baseUrl but different accountId', async () => {
    const provider1 = await context.app.request(
      '/api/providers',
      jsonRequest({
        id: 'oauth-personal',
        type: 'openai-oauth-pass-through',
        priority: 10,
        baseUrl: 'https://api.openai.com',
        credentialMode: 'inbound-authorization',
        modelAlias: { default: 'passthrough' },
        accountId: 'personal',
      }),
    );
    expect(provider1.status).toBe(201);
    expect(await provider1.json()).toMatchObject({ id: 'oauth-personal', accountId: 'personal' });

    const provider2 = await context.app.request(
      '/api/providers',
      jsonRequest({
        id: 'oauth-work',
        type: 'openai-oauth-pass-through',
        priority: 11,
        baseUrl: 'https://api.openai.com',
        credentialMode: 'inbound-authorization',
        modelAlias: { default: 'passthrough' },
        accountId: 'work',
      }),
    );
    expect(provider2.status).toBe(201);
    expect(await provider2.json()).toMatchObject({ id: 'oauth-work', accountId: 'work' });
  });

  it('GET /api/providers lists both OAuth providers with accountIds', async () => {
    await context.app.request(
      '/api/providers',
      jsonRequest({
        id: 'oauth-personal',
        type: 'openai-oauth-pass-through',
        priority: 10,
        baseUrl: 'https://api.openai.com',
        credentialMode: 'inbound-authorization',
        modelAlias: { default: 'passthrough' },
        accountId: 'personal',
      }),
    );
    await context.app.request(
      '/api/providers',
      jsonRequest({
        id: 'oauth-work',
        type: 'openai-oauth-pass-through',
        priority: 11,
        baseUrl: 'https://api.openai.com',
        credentialMode: 'inbound-authorization',
        modelAlias: { default: 'passthrough' },
        accountId: 'work',
      }),
    );

    const response = await context.app.request('/api/providers');
    const providers = (await response.json()) as Array<{ id: string; accountId?: string }>;
    const oauthProviders = providers.filter((p) => p.id === 'oauth-personal' || p.id === 'oauth-work');
    expect(oauthProviders).toHaveLength(2);

    const personal = oauthProviders.find((p) => p.id === 'oauth-personal');
    const work = oauthProviders.find((p) => p.id === 'oauth-work');
    expect(personal?.accountId).toBe('personal');
    expect(work?.accountId).toBe('work');
  });

  it('PATCH /api/providers/:id can change accountId', async () => {
    await context.app.request(
      '/api/providers',
      jsonRequest({
        id: 'oauth-personal',
        type: 'openai-oauth-pass-through',
        priority: 10,
        baseUrl: 'https://api.openai.com',
        credentialMode: 'inbound-authorization',
        modelAlias: { default: 'passthrough' },
        accountId: 'personal',
      }),
    );

    const patch = await context.app.request('/api/providers/oauth-personal', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accountId: 'team' }),
    });
    expect(patch.status).toBe(200);
    expect(await patch.json()).toMatchObject({ id: 'oauth-personal', accountId: 'team' });
  });

  it('provider without accountId defaults to "default"', async () => {
    const response = await context.app.request(
      '/api/providers',
      jsonRequest({
        id: 'oauth-plain',
        type: 'openai-oauth-pass-through',
        priority: 12,
        baseUrl: 'https://api.openai.com',
        credentialMode: 'inbound-authorization',
        modelAlias: { default: 'passthrough' },
      }),
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.accountId).toBe('default');
  });

  it('existing providers without accountId have default value', async () => {
    const response = await context.app.request('/api/providers/openai');
    const provider = await response.json();
    expect(provider.accountId).toBe('default');
  });
});

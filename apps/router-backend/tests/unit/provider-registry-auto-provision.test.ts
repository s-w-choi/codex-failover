import { describe, expect, it } from 'vitest';

import { ProviderRegistry } from '../../src/services/provider-registry.js';
import { createMockCredentialStore } from '../helpers/test-setup.js';

describe('ProviderRegistry.autoProvisionOAuthProvider', () => {
  it('creates oauth provider when none exists', async () => {
    const registry = new ProviderRegistry([], createMockCredentialStore(), '/tmp/test-oauth.json');
    const provider = await registry.autoProvisionOAuthProvider();

    expect(provider).toBeDefined();
    expect(provider!.id).toBe('openai-oauth');
    expect(provider!.type).toBe('openai-oauth-pass-through');
    expect(provider!.priority).toBe(1);
    expect(provider!.credentialMode).toBe('inbound-authorization');
    expect(provider!.enabled).toBe(true);
  });

  it('creates oauth provider with accountId', async () => {
    const registry = new ProviderRegistry([], createMockCredentialStore(), '/tmp/test-oauth-acc.json');
    const provider = await registry.autoProvisionOAuthProvider('acc-456');

    expect(provider!.id).toBe('openai-oauth-acc-456');
    expect(provider!.accountId).toBe('acc-456');
  });

  it('returns undefined when oauth provider already exists', async () => {
    const registry = new ProviderRegistry([], createMockCredentialStore(), '/tmp/test-oauth-dup.json');
    await registry.autoProvisionOAuthProvider();
    const second = await registry.autoProvisionOAuthProvider();

    expect(second).toBeUndefined();
  });

  it('does not overwrite existing providers', async () => {
    const fs = await import('node:fs/promises');
    const path = '/tmp/test-oauth-preserve.json';
    const registry = new ProviderRegistry(
      [
        {
          id: 'existing',
          type: 'openai-api-key',
          priority: 1,
          baseUrl: 'https://api.openai.com/v1',
          credentialMode: 'stored-api-key',
          enabled: true,
          modelAlias: { default: 'gpt-4' },
        },
      ],
      createMockCredentialStore(),
      path,
    );

    const provider = await registry.autoProvisionOAuthProvider();
    expect(provider).toBeDefined();

    const list = registry.list();
    expect(list).toHaveLength(2);
    expect(list.some((p) => p.id === 'existing')).toBe(true);

    await fs.unlink(path).catch(() => {});
  });
});

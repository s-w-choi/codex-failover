import { describe, expect, it } from 'vitest';

import type { Provider } from '@codex-failover/shared';

import { ProviderRegistry } from '../../src/services/provider-registry.js';
import { createMockCredentialStore } from '../helpers/test-setup.js';

describe('ProviderRegistry toggle rules', () => {
  it('keeps the last enabled provider enabled when disable is requested', async () => {
    const registry = new ProviderRegistry(
      [
        provider({
          id: 'openai',
          priority: 1,
          enabled: true,
        }),
        provider({
          id: 'azure',
          priority: 2,
          enabled: false,
        }),
      ],
      createMockCredentialStore(),
      '/tmp/provider-registry-toggle-last-enabled.json',
    );

    const updated = await registry.update('openai', { enabled: false });
    const enabled = registry.list().filter((p) => p.enabled);

    expect(updated.enabled).toBe(true);
    expect(enabled).toHaveLength(1);
    expect(enabled[0]?.id).toBe('openai');
  });

  it('re-enables a previously disabled provider as fallback by appending enabled priority', async () => {
    const registry = new ProviderRegistry(
      [
        provider({
          id: 'openai',
          priority: 1,
          enabled: true,
        }),
        provider({
          id: 'azure',
          priority: 2,
          enabled: true,
        }),
      ],
      createMockCredentialStore(),
      '/tmp/provider-registry-toggle-priority.json',
    );

    await registry.update('openai', { enabled: false });
    const reenabled = await registry.update('openai', { enabled: true });
    const enabled = registry.list().filter((p) => p.enabled);

    expect(reenabled.priority).toBeGreaterThan(2);
    expect(enabled.map((p) => p.id)).toEqual(['azure', 'openai']);
  });

  it('forces the first provider to be active when all initial providers are disabled', () => {
    const registry = new ProviderRegistry(
      [
        provider({
          id: 'openai',
          priority: 2,
          enabled: false,
        }),
        provider({
          id: 'azure',
          priority: 1,
          enabled: false,
        }),
      ],
      createMockCredentialStore(),
      '/tmp/provider-registry-toggle-initial-normalize.json',
    );

    const enabled = registry.list().filter((p) => p.enabled);
    expect(enabled).toHaveLength(1);
    expect(enabled[0]?.id).toBe('azure');
  });

  it('auto-enables provider on create when it would otherwise make enabled count zero', async () => {
    const registry = new ProviderRegistry([], createMockCredentialStore(), '/tmp/provider-registry-toggle-create-normalize.json');
    const created = await registry.create({
      id: 'openai',
      type: 'openai-api-key',
      priority: 1,
      baseUrl: 'https://api.openai.com/v1',
      credentialMode: 'stored-api-key',
      enabled: false,
      modelAlias: { default: 'gpt-4.1' },
    });

    const enabled = registry.list().filter((p) => p.enabled);
    expect(created.enabled).toBe(true);
    expect(enabled).toHaveLength(1);
    expect(enabled[0]?.id).toBe('openai');
  });

  it('keeps one provider active after deleting the last enabled provider', async () => {
    const registry = new ProviderRegistry(
      [
        provider({
          id: 'openai',
          priority: 1,
          enabled: true,
        }),
        provider({
          id: 'azure',
          priority: 2,
          enabled: false,
        }),
      ],
      createMockCredentialStore(),
      '/tmp/provider-registry-toggle-delete-normalize.json',
    );

    const deleted = await registry.delete('openai');
    const list = registry.list();
    const enabled = list.filter((p) => p.enabled);

    expect(deleted).toBe(true);
    expect(list.map((p) => p.id)).toEqual(['azure']);
    expect(enabled).toHaveLength(1);
    expect(enabled[0]?.id).toBe('azure');
  });
});

function provider(overrides: Partial<Provider> & Pick<Provider, 'id'>): Provider {
  return {
    id: overrides.id,
    type: overrides.type ?? 'openai-api-key',
    priority: overrides.priority ?? 1,
    baseUrl: overrides.baseUrl ?? 'https://api.openai.com/v1',
    credentialMode: overrides.credentialMode ?? 'stored-api-key',
    credentialRef: overrides.credentialRef ?? `keychain://providers/${overrides.id}`,
    enabled: overrides.enabled ?? true,
    modelAlias: overrides.modelAlias ?? { default: 'gpt-4.1' },
    deploymentName: overrides.deploymentName,
    region: overrides.region,
    cooldownTtlMs: overrides.cooldownTtlMs,
    authHeaderStyle: overrides.authHeaderStyle,
    limits: overrides.limits,
    accountId: overrides.accountId ?? 'default',
  };
}

import type { Provider, ProxyRequestContext } from '@codex-failover/shared';

export function provider(overrides: Partial<Provider> & Pick<Provider, 'id'>): Provider {
  return {
    id: overrides.id,
    type: 'openai-api-key',
    priority: 10,
    baseUrl: `https://${overrides.id}.example.test`,
    credentialMode: 'stored-api-key',
    enabled: true,
    modelAlias: { default: 'gpt-4.1' },
    ...overrides,
  };
}

export function context(overrides: Partial<ProxyRequestContext> = {}): ProxyRequestContext {
  return {
    incomingModel: 'gpt-5',
    isStream: false,
    requestBody: {},
    ...overrides,
  };
}

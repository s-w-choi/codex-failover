import { CredentialStore, MemoryKeychainBackend } from '@codex-failover/credential-store';
import type { Provider } from '@codex-failover/shared';
import { describe, expect, it } from 'vitest';

import { RoutingService } from '../../src/services/routing-service.js';

describe('RoutingService health reports', () => {
  it('delegates reportFailure and reportSuccess to the routing engine', () => {
    const service = new RoutingService(providers(), new CredentialStore(new MemoryKeychainBackend()));

    service.reportFailure('primary', 503, new Headers(), { error: { message: 'down' } });
    service.reportSuccess('secondary', 42);

    expect(service.getActiveProvider()).toBe('secondary');
    expect(service.getCooldownStates()).toEqual([
      expect.objectContaining({ providerId: 'primary' }),
    ]);
  });
});

function providers(): Provider[] {
  return [
    {
      id: 'primary',
      type: 'openai-oauth-pass-through',
      priority: 1,
      baseUrl: 'https://api.openai.com/v1',
      credentialMode: 'inbound-authorization',
      enabled: true,
      modelAlias: { default: 'gpt-test' },
    },
    {
      id: 'secondary',
      type: 'openai-api-key',
      priority: 2,
      baseUrl: 'https://secondary.example/v1',
      credentialMode: 'stored-api-key',
      credentialRef: 'keychain://secondary',
      enabled: true,
      modelAlias: { default: 'gpt-test' },
    },
  ];
}

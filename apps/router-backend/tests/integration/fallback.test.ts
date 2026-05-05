import { CredentialStore, MemoryKeychainBackend } from '@codex-failover/credential-store';
import { describe, expect, it } from 'vitest';

import { RoutingService } from '../../src/services/routing-service.js';
import { createTestHarness, providerFixtures } from '../helpers/test-setup.js';

describe('fallback integration', () => {
  it('switches active provider when health reports primary failure and secondary success', async () => {
    const harness = createTestHarness();
    const credentialStore = new CredentialStore(new MemoryKeychainBackend());
    await credentialStore.store('keychain://providers/azure', 'azure-secret-key');
    await credentialStore.store('keychain://providers/compatible', 'compatible-secret-key');
    const routingService = new RoutingService(providerFixtures(harness), credentialStore);

    expect(routingService.getActiveProvider()).toBe('openai');

    routingService.reportFailure('openai', 503, new Headers(), { error: { message: 'unhealthy' } });
    routingService.reportSuccess('azure', 10);

    expect(routingService.getActiveProvider()).toBe('azure');
    expect(routingService.getCooldownStates()).toEqual([
      expect.objectContaining({ providerId: 'openai' }),
    ]);
  });

  it('switches back to primary when health reports recovery', async () => {
    const harness = createTestHarness();
    const credentialStore = new CredentialStore(new MemoryKeychainBackend());
    await credentialStore.store('keychain://providers/azure', 'azure-secret-key');
    await credentialStore.store('keychain://providers/compatible', 'compatible-secret-key');
    const routingService = new RoutingService(providerFixtures(harness), credentialStore);

    routingService.reportFailure('openai', 503, new Headers(), { error: { message: 'unhealthy' } });
    routingService.reportSuccess('azure', 10);
    routingService.reportSuccess('openai', 5);

    expect(routingService.getActiveProvider()).toBe('openai');
    expect(routingService.getCooldownStates()).toEqual([]);
  });
});

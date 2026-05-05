import { CredentialStore, MemoryKeychainBackend } from '@codex-failover/credential-store';
import type { Provider } from '@codex-failover/shared';
import { describe, expect, it, vi } from 'vitest';

import { CodexConfigService } from '../../src/services/codex-config.js';
import { codexModelProviderNameForProvider, ConfigSwitcher } from '../../src/services/config-switcher.js';

describe('ConfigSwitcher', () => {
  it('generates Azure model provider config with experimental_bearer_token', async () => {
    const service = new FakeCodexConfigService();
    const credentialStore = new CredentialStore(new MemoryKeychainBackend());
    await credentialStore.store('keychain://azure', 'azure-secret');
    const switcher = new ConfigSwitcher(service, credentialStore);

    const selected = provider({
      id: 'azure',
      type: 'azure-openai-api-key',
      baseUrl: 'https://docshunt-openai-foundry-dev.cognitiveservices.azure.com/openai/responses?api-version=2025-04-01-preview',
      credentialRef: 'keychain://azure',
      deploymentName: 'gpt-5.3-codex',
    });
    const providerName = codexModelProviderNameForProvider(selected);

    await switcher.switchToProvider(selected);

    expectCleaned(service);
    expect(service.setModelProvider).toHaveBeenCalledWith(providerName);
    expect(service.setModelProviderSection).toHaveBeenCalledWith(providerName, {
      name: 'Azure OpenAI',
      base_url: 'https://docshunt-openai-foundry-dev.cognitiveservices.azure.com/openai/v1',
      experimental_bearer_token: 'azure-secret',
      wire_api: 'responses',
    });
    expect(service.setModel).toHaveBeenCalledWith('gpt-5.3-codex');
  });

  it('restores the backup model when switching from Azure back to OAuth', async () => {
    const service = new FakeCodexConfigService();
    const credentialStore = new CredentialStore(new MemoryKeychainBackend());
    await credentialStore.store('keychain://azure', 'azure-secret');
    const switcher = new ConfigSwitcher(service, credentialStore);

    await switcher.switchToProvider(provider({
      id: 'azure',
      type: 'azure-openai-api-key',
      credentialRef: 'keychain://azure',
      deploymentName: 'gpt-5.3-codex',
    }));
    await switcher.switchToProvider(provider({
      id: 'oauth',
      type: 'openai-oauth-pass-through',
      credentialMode: 'inbound-authorization',
    }));

    expect(service.readBackupModel).toHaveBeenCalledOnce();
    expect(service.setModel).toHaveBeenNthCalledWith(1, 'gpt-5.3-codex');
    expect(service.setModel).toHaveBeenNthCalledWith(2, 'gpt-backup-original');
  });

  it('restores backup model across non-OAuth switches', async () => {
    const service = new FakeCodexConfigService();
    const credentialStore = new CredentialStore(new MemoryKeychainBackend());
    await credentialStore.store('keychain://east', 'east-secret');
    await credentialStore.store('keychain://west', 'west-secret');
    const switcher = new ConfigSwitcher(service, credentialStore);

    await switcher.switchToProvider(provider({
      id: 'azure-east',
      type: 'azure-openai-api-key',
      credentialRef: 'keychain://east',
      deploymentName: 'gpt-5.3-codex',
    }));
    await switcher.switchToProvider(provider({
      id: 'azure-west',
      type: 'azure-openai-api-key',
      credentialRef: 'keychain://west',
      deploymentName: 'gpt-5.3-codex-west',
    }));
    await switcher.switchToProvider(provider({
      id: 'oauth',
      type: 'openai-oauth-pass-through',
      credentialMode: 'inbound-authorization',
    }));

    expect(service.setModel).toHaveBeenNthCalledWith(1, 'gpt-5.3-codex');
    expect(service.setModel).toHaveBeenNthCalledWith(2, 'gpt-5.3-codex-west');
    expect(service.setModel).toHaveBeenNthCalledWith(3, 'gpt-backup-original');
  });

  it('cleans config for OpenAI OAuth providers without model_provider section', async () => {
    const service = new FakeCodexConfigService();
    const switcher = new ConfigSwitcher(service, new CredentialStore(new MemoryKeychainBackend()));

    await switcher.switchToProvider(provider({ id: 'oauth', type: 'openai-oauth-pass-through', credentialMode: 'inbound-authorization' }));

    expectCleaned(service);
    expect(service.setModel).toHaveBeenCalledWith('gpt-backup-original');
    expect(service.setModelProvider).not.toHaveBeenCalled();
    expect(service.setModelProviderSection).not.toHaveBeenCalled();
  });

  it('generates OpenAI API key model provider config', async () => {
    const service = new FakeCodexConfigService();
    const credentialStore = new CredentialStore(new MemoryKeychainBackend());
    await credentialStore.store('keychain://openai', 'openai-secret');
    const switcher = new ConfigSwitcher(service, credentialStore);

    const selected = provider({ id: 'openai-api', type: 'openai-api-key', credentialRef: 'keychain://openai' });
    const providerName = codexModelProviderNameForProvider(selected);

    await switcher.switchToProvider(selected);

    expect(service.setModelProvider).toHaveBeenCalledWith(providerName);
    expect(service.setModelProviderSection).toHaveBeenCalledWith(providerName, {
      name: 'OpenAI API Key',
      base_url: 'https://api.openai.com/v1',
      experimental_bearer_token: 'openai-secret',
      wire_api: 'responses',
    });
  });

  it('generates custom model provider config', async () => {
    const service = new FakeCodexConfigService();
    const credentialStore = new CredentialStore(new MemoryKeychainBackend());
    await credentialStore.store('keychain://custom', 'custom-secret');
    const switcher = new ConfigSwitcher(service, credentialStore);

    const selected = provider({
      id: 'custom-api',
      type: 'openai-compatible-api-key',
      baseUrl: 'https://custom.example/v1',
      credentialRef: 'keychain://custom',
    });
    const providerName = codexModelProviderNameForProvider(selected);

    await switcher.switchToProvider(selected);

    expect(service.setModelProvider).toHaveBeenCalledWith(providerName);
    expect(service.setModelProviderSection).toHaveBeenCalledWith(providerName, {
      name: 'Custom Provider',
      base_url: 'https://custom.example/v1',
      experimental_bearer_token: 'custom-secret',
      wire_api: 'responses',
    });
  });

  it('throws when API key is not available', async () => {
    const service = new FakeCodexConfigService();
    const switcher = new ConfigSwitcher(service, new CredentialStore(new MemoryKeychainBackend()));

    await expect(switcher.switchToProvider(provider({ id: 'no-key', type: 'openai-api-key', credentialRef: 'keychain://missing' }))).rejects.toThrow('Cannot switch to no-key: API key not available.');
  });

  it('saves current model for the previous provider before switching', async () => {
    const service = new FakeCodexConfigService();
    const credentialStore = new CredentialStore(new MemoryKeychainBackend());
    await credentialStore.store('keychain://azure', 'azure-secret');
    const switcher = new ConfigSwitcher(service, credentialStore);

    await switcher.switchToProvider(provider({ id: 'oauth', type: 'openai-oauth-pass-through', credentialMode: 'inbound-authorization' }));
    await switcher.switchToProvider(provider({ id: 'azure', type: 'azure-openai-api-key', credentialRef: 'keychain://azure', deploymentName: 'gpt-5.3-codex' }));

    expect(service.saveProviderModel).toHaveBeenCalledWith('oauth', 'gpt-current');
  });

  it('restores saved per-provider model over backup model', async () => {
    const service = new FakeCodexConfigService();
    service.readProviderModel = vi.fn<(id: string) => Promise<string | undefined>>().mockImplementation(async (id: string) => {
      if (id === 'oauth') return 'gpt-5.5-user-choice';
      return undefined;
    });
    const credentialStore = new CredentialStore(new MemoryKeychainBackend());
    await credentialStore.store('keychain://azure', 'azure-secret');
    const switcher = new ConfigSwitcher(service, credentialStore);

    await switcher.switchToProvider(provider({ id: 'azure', type: 'azure-openai-api-key', credentialRef: 'keychain://azure', deploymentName: 'gpt-5.3-codex' }));
    await switcher.switchToProvider(provider({ id: 'oauth', type: 'openai-oauth-pass-through', credentialMode: 'inbound-authorization' }));

    expect(service.setModel).toHaveBeenNthCalledWith(2, 'gpt-5.5-user-choice');
  });

  it('does not rewrite config when provider is already current', async () => {
    const service = new FakeCodexConfigService();
    const credentialStore = new CredentialStore(new MemoryKeychainBackend());
    await credentialStore.store('keychain://test', 'test-secret');
    const switcher = new ConfigSwitcher(service, credentialStore);
    const selected = provider({ id: 'test-api', credentialRef: 'keychain://test' });

    await switcher.switchToProvider(selected);
    await switcher.switchToProvider(selected);

    expect(service.removeModelProvider).toHaveBeenCalledOnce();
    expect(service.setModelProvider).toHaveBeenCalledOnce();
  });
});

class FakeCodexConfigService extends CodexConfigService {
  override readModel = vi.fn<() => Promise<string | undefined>>().mockResolvedValue('gpt-current');
  override readBackupModel = vi.fn<() => Promise<string | undefined>>().mockResolvedValue('gpt-backup-original');
  override readProviderModel = vi.fn<(id: string) => Promise<string | undefined>>().mockResolvedValue(undefined);
  override saveProviderModel = vi.fn<(id: string, model: string) => Promise<void>>().mockResolvedValue(undefined);
  override setModel = vi.fn<(modelName: string) => Promise<void>>().mockResolvedValue(undefined);
  override setModelProvider = vi.fn<(providerName: string) => Promise<void>>().mockResolvedValue(undefined);
  override removeModelProvider = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  override setModelProviderSection = vi.fn<(name: string, fields: Record<string, string>) => Promise<void>>().mockResolvedValue(undefined);
  override removeAllModelProviderSections = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  override cleanupLegacyProxySettings = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
}

function expectCleaned(service: FakeCodexConfigService): void {
  expect(service.removeModelProvider).toHaveBeenCalledOnce();
  expect(service.removeAllModelProviderSections).toHaveBeenCalledOnce();
  expect(service.cleanupLegacyProxySettings).toHaveBeenCalledOnce();
}

function provider(overrides: Partial<Provider>): Provider {
  return {
    id: 'provider',
    type: 'openai-api-key',
    priority: 1,
    baseUrl: 'https://api.example/v1',
    credentialMode: 'stored-api-key',
    enabled: true,
    modelAlias: { default: 'gpt-test' },
    ...overrides,
  };
}

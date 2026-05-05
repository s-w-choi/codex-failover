import { CredentialStore, MemoryKeychainBackend } from '@codex-failover/credential-store';
import type { Provider } from '@codex-failover/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CodexConfigService } from '../../src/services/codex-config.js';
import { ConfigSwitcher } from '../../src/services/config-switcher.js';
import { HealthScheduler } from '../../src/services/health-scheduler.js';
import { NotificationService } from '../../src/services/notification-service.js';
import { ProviderHealthChecker, type ConnectionTestResult } from '../../src/services/provider-health-checker.js';
import { ProviderRegistry } from '../../src/services/provider-registry.js';
import { RoutingService } from '../../src/services/routing-service.js';

describe('HealthScheduler', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports provider health and switches config when active provider changes', async () => {
    const registry = new ProviderRegistry(providers(), new CredentialStore(new MemoryKeychainBackend()));
    const routingService = new RoutingService(registry.list(), new CredentialStore(new MemoryKeychainBackend()));
    const healthChecker = new FakeHealthChecker({ primary: false, secondary: true });
    const configSwitcher = new FakeConfigSwitcher();
    const notificationService = new FakeNotificationService();
    const scheduler = new HealthScheduler(routingService, registry, healthChecker, configSwitcher, notificationService, { checkIntervalMs: 5 });

    scheduler.start();
    await sleep(20);
    scheduler.stop();

    expect(routingService.getActiveProvider()).toBe('secondary');
    expect(configSwitcher.switchedTo).toEqual(['secondary']);
    expect(notificationService.messages).toHaveLength(1);
  });
});

class FakeHealthChecker extends ProviderHealthChecker {
  constructor(private readonly states: Record<string, boolean>) {
    super(new CredentialStore(new MemoryKeychainBackend()));
  }

  override async testConnection(provider: Provider | undefined): Promise<ConnectionTestResult> {
    if (!provider) {
      return { success: false, message: 'missing', latencyMs: 0 };
    }
    const success = this.states[provider.id] ?? false;
    return { success, message: success ? 'ok' : 'down', latencyMs: success ? 7 : 0 };
  }
}

class FakeConfigSwitcher extends ConfigSwitcher {
  readonly switchedTo: string[] = [];
  private currentProviderId?: string;

  constructor() {
    super(new FakeCodexConfigService(), new CredentialStore(new MemoryKeychainBackend()));
  }

  override async switchToProvider(provider: Provider): Promise<void> {
    this.switchedTo.push(provider.id);
    this.currentProviderId = provider.id;
  }

  override getCurrentProviderId(): string | undefined {
    return this.currentProviderId;
  }
}

class FakeNotificationService extends NotificationService {
  readonly messages: Array<{ title: string; message: string }> = [];

  override async send(notification: { title: string; message: string }): Promise<void> {
    this.messages.push(notification);
  }
}

class FakeCodexConfigService extends CodexConfigService {
  override setModelProvider = vi.fn<(providerName: string) => Promise<void>>().mockResolvedValue(undefined);
  override removeModelProvider = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  override setModelProviderSection = vi.fn<(name: string, fields: Record<string, string>) => Promise<void>>().mockResolvedValue(undefined);
  override removeAllModelProviderSections = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  override cleanupLegacyProxySettings = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
}

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

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

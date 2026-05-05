import type { Provider } from '@codex-failover/shared';

import type { ConfigSwitcher } from './config-switcher.js';
import type { NotificationService } from './notification-service.js';
import type { ProviderHealthChecker } from './provider-health-checker.js';
import type { ProviderRegistry } from './provider-registry.js';
import type { RoutingService } from './routing-service.js';

export interface HealthSchedulerOptions {
  checkIntervalMs?: number;
}

export class HealthScheduler {
  private timerId: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private readonly checkIntervalMs: number;

  constructor(
    private readonly routingService: RoutingService,
    private readonly registry: ProviderRegistry,
    private readonly healthChecker: ProviderHealthChecker,
    private readonly configSwitcher: ConfigSwitcher,
    private readonly notificationService: NotificationService,
    options: HealthSchedulerOptions = {},
  ) {
    this.checkIntervalMs = options.checkIntervalMs ?? 30_000;
  }

  start(): void {
    if (this.timerId) return;
    void this.runChecks();
    this.timerId = setInterval(() => { void this.runChecks(); }, this.checkIntervalMs);
  }

  stop(): void {
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  isRunning(): boolean {
    return this.timerId !== null;
  }

  private async runChecks(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const providers = this.registry.list().filter((provider: Provider) => provider.enabled);
      const previousActiveId = this.routingService.getActiveProvider();

      let selectedHealthyProvider: Provider | undefined;
      let selectedLatencyMs: number | undefined;
      for (const provider of providers) {
        const result = await this.healthChecker.testConnection(provider);
        if (result.success) {
          if (!selectedHealthyProvider) {
            selectedHealthyProvider = provider;
            selectedLatencyMs = result.latencyMs;
          }
        } else {
          this.routingService.reportFailure(provider.id, 503, new Headers(), { error: { message: result.message } });
        }
      }

      if (selectedHealthyProvider) {
        this.routingService.reportSuccess(selectedHealthyProvider.id, selectedLatencyMs);
      }

      const newActiveId = this.routingService.getActiveProvider();
      if (newActiveId !== previousActiveId || this.configSwitcher.getCurrentProviderId() !== newActiveId) {
        const newProvider = providers.find((provider) => provider.id === newActiveId);
        if (newProvider) {
          await this.configSwitcher.switchToProvider(newProvider);
          const primaryProvider = providers[0];
          if (primaryProvider && newActiveId !== primaryProvider.id) {
            void this.notificationService.send({
              title: 'codex-failover',
              message: `Switched to ${newActiveId} (primary ${primaryProvider.id} is unhealthy). Restart Codex to apply.`,
            });
          }
        }
      }
    } finally {
      this.running = false;
    }
  }
}

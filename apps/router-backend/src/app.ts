import type { CredentialStore } from '@codex-failover/credential-store';
import { ProviderScorer } from '@codex-failover/provider-core';
import type { Provider } from '@codex-failover/shared';
import type { ModelPricing, PricingProvider, PricingScraper, RateLimitTracker, UsageRecorder, UsageStore } from '@codex-failover/usage-tracker';
import { Hono } from 'hono';

import { localOriginAuth } from './middleware/local-origin-auth.js';
import { requestLogger, type RequestLogSink } from './middleware/request-logger.js';
import { createAdminRoutes } from './routes/admin.js';
import { createDashboardRoutes } from './routes/dashboard.js';
import { createHealthRoutes } from './routes/health.js';
import { CodexAuthDetector } from './services/codex-auth-detector.js';
import { CodexConfigService } from './services/codex-config.js';
import { CodexProviderUsageAccumulator } from './services/codex-provider-usage-accumulator.js';
import type { CodexSessionUsageReader } from './services/codex-session-usage.js';
import { ConfigSwitcher } from './services/config-switcher.js';
import { HealthScheduler } from './services/health-scheduler.js';
import { NotificationService } from './services/notification-service.js';
import { ProviderHealthChecker } from './services/provider-health-checker.js';
import { ProviderRegistry } from './services/provider-registry.js';
import { RoutingService } from './services/routing-service.js';
import { UsagePoller } from './services/usage-poller.js';

export interface CreateAppOptions {
  providers: Provider[];
  credentialStore: CredentialStore;
  dashboard?: {
    usageStore: UsageStore;
    rateLimitTracker: RateLimitTracker;
    pricingScraper: PricingScraper;
    pricingProvider?: PricingProvider;
    usageRecorder?: UsageRecorder;
    codexSessionUsageService?: CodexSessionUsageReader;
    codexProviderUsageStatePath?: string;
  };
  logger?: RequestLogSink;
  codexConfigService?: CodexConfigService;
  persistencePath?: string;
  scorerWeights?: { costWeight: number; latencyWeight: number };
  healthCheckIntervalMs?: number;
}

export interface AppRuntime {
  app: Hono;
  healthScheduler: HealthScheduler;
  usagePoller?: UsagePoller;
  codexProviderUsageAccumulator?: CodexProviderUsageAccumulator;
}

export function createApp(options: CreateAppOptions): AppRuntime {
  const app = new Hono();
  const startedAt = Date.now();
  const registry = new ProviderRegistry(options.providers, options.credentialStore, options.persistencePath);
  const notificationService = new NotificationService();

  const scorerWeights = options.scorerWeights ?? { costWeight: 0, latencyWeight: 0 };
  const scorerOptions = scorerWeights.costWeight + scorerWeights.latencyWeight > 0
    ? { scorer: new ProviderScorer(), pricing: new Map<string, number>(), weights: scorerWeights }
    : undefined;

  const routingService = new RoutingService(options.providers, options.credentialStore, {
    notificationService,
    scorerOptions,
  });

  void registry.loadPersisted().then(async () => {
    if (!options.persistencePath) {
      return;
    }
    const detector = new CodexAuthDetector();
    const authInfo = await detector.detect();
    if (authInfo.detected && !authInfo.isExpired) {
      await registry.autoProvisionOAuthProvider(authInfo.accountId);
    }
    routingService.updateProviders(registry.list());
  });

  const healthChecker = new ProviderHealthChecker(options.credentialStore);
  const codexConfig = options.codexConfigService ?? new CodexConfigService();
  const configSwitcher = new ConfigSwitcher(codexConfig, options.credentialStore);
  const healthScheduler = new HealthScheduler(
    routingService,
    registry,
    healthChecker,
    configSwitcher,
    notificationService,
    { checkIntervalMs: options.healthCheckIntervalMs },
  );
  const usagePoller = options.dashboard
    ? new UsagePoller(
      registry,
      options.credentialStore,
      options.dashboard.usageStore,
      options.dashboard.pricingProvider ?? new ZeroPricingProvider(),
    )
    : undefined;
  const codexProviderUsageAccumulator = options.dashboard?.codexSessionUsageService
    ? new CodexProviderUsageAccumulator(
      registry,
      routingService,
      codexConfig,
      options.dashboard.codexSessionUsageService,
      options.dashboard.usageStore,
      options.dashboard.pricingProvider ?? new ZeroPricingProvider(),
      { statePath: options.dashboard.codexProviderUsageStatePath },
    )
    : undefined;

  app.use('*', requestLogger(options.logger));
  app.use('/api/*', localOriginAuth());
  app.route('/', createHealthRoutes());
  app.route(
    '/',
    createAdminRoutes({
      registry,
      routingService,
      healthChecker,
      configSwitcher,
      codexConfigService: codexConfig,
      usageStore: options.dashboard?.usageStore,
      startedAt,
    }),
  );

  if (options.dashboard) {
    app.route(
      '/',
      createDashboardRoutes({
        usageStore: options.dashboard.usageStore,
        rateLimitTracker: options.dashboard.rateLimitTracker,
        pricingScraper: options.dashboard.pricingScraper,
        providerRegistry: registry,
        activeProviderReader: routingService,
        codexSessionUsageService: options.dashboard.codexSessionUsageService,
        codexProviderUsageAccumulator,
      }),
    );
  }

  app.get('/', (context) => context.json({
    ok: true,
    service: 'router-backend',
    mode: 'api-only',
    docs: {
      health: ['/healthz', '/readyz'],
    },
  }));

  return { app, healthScheduler, usagePoller, codexProviderUsageAccumulator };
}

class ZeroPricingProvider implements PricingProvider {
  getPricing(): ModelPricing | undefined {
    return undefined;
  }

  async refreshPricing(): Promise<void> {
    return undefined;
  }
}

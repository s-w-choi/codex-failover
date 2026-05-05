import type { ProviderTestRequest, ReorderRequest } from '@codex-failover/shared';
import type { UsageStore } from '@codex-failover/usage-tracker';
import { Hono } from 'hono';

import { CodexAuthDetector, type CodexAuthInfo } from '../services/codex-auth-detector.js';
import { CodexConfigService } from '../services/codex-config.js';
import { CodexLoginService } from '../services/codex-login-service.js';
import type { ConfigSwitcher } from '../services/config-switcher.js';
import type { ProviderHealthChecker } from '../services/provider-health-checker.js';
import type { ProviderRegistry, ProviderRegistryCreateInput } from '../services/provider-registry.js';
import type { RoutingService } from '../services/routing-service.js';

export interface AdminRouteOptions {
  registry: ProviderRegistry;
  routingService: RoutingService;
  healthChecker: ProviderHealthChecker;
  configSwitcher: ConfigSwitcher;
  codexConfigService?: CodexConfigService;
  codexLoginService?: CodexLoginService;
  usageStore?: UsageStore;
  startedAt: number;
}

export function createAdminRoutes(options: AdminRouteOptions): Hono {
  const app = new Hono();
  const codexConfig = options.codexConfigService ?? new CodexConfigService();
  const codexLogin = options.codexLoginService ?? new CodexLoginService();

  const syncConfig = () => syncConfigToActiveProvider(options.registry, options.routingService, options.configSwitcher);

  app.get('/api/status', async (context) => {
    const codexAuth = await codexAuthForStatus();
    return context.json({
      activeProviderId: options.routingService.getActiveProvider(),
      providers: options.registry.listStates(options.routingService.getCooldownStates()),
      cooldownStates: options.routingService.getCooldownStates(),
      uptime: Date.now() - options.startedAt,
      codexInstalled: await codexConfig.isInstalled(),
      codexAuth,
    });
  });

  app.get('/api/providers', (context) => context.json(options.registry.list()));

  app.get('/api/providers/:id', (context) => {
    const provider = options.registry.get(context.req.param('id'));
    if (!provider) {
      return context.json({ error: 'Provider not found.' }, 404);
    }
    return context.json(provider);
  });

  app.post('/api/providers', async (context) => {
    const input = await readJson<ProviderRegistryCreateInput>(context.req.raw);
    try {
      const provider = await options.registry.create(input);
      options.routingService.updateProviders(options.registry.list());
      await syncConfig();
      return context.json(provider, 201);
    } catch (error) {
      return context.json({ error: errorMessage(error) }, 400);
    }
  });

  app.patch('/api/providers/:id', async (context) => {
    const input = await readJson<ProviderRegistryCreateInput>(context.req.raw);
    try {
      const provider = await options.registry.update(context.req.param('id'), input);
      options.routingService.updateProviders(options.registry.list());
      await syncConfig();
      return context.json(provider);
    } catch (error) {
      return context.json({ error: errorMessage(error) }, 404);
    }
  });

  app.delete('/api/providers/:id', async (context) => {
    const providerId = context.req.param('id');
    const deleted = await options.registry.delete(providerId);
    if (deleted && options.usageStore) {
      options.usageStore.deleteProviderUsage(providerId);
    }
    options.routingService.updateProviders(options.registry.list());
    await syncConfig();
    return context.json({ success: deleted });
  });

  app.post('/api/providers/:id/test', async (context) => {
    const input = await readJson<Partial<ProviderTestRequest>>(context.req.raw);
    const provider = options.registry.get(context.req.param('id'));
    const result = await options.healthChecker.testConnection(provider, input.model);
    return context.json(result, result.success ? 200 : 502);
  });

  app.post('/api/providers/:id/login', async (context) => {
    const provider = options.registry.get(context.req.param('id'));
    if (!provider) {
      return context.json({ error: 'Provider not found.' }, 404);
    }
    const input = await readJson<{ deviceAuth?: boolean }>(context.req.raw);
    const result = await codexLogin.execute(input.deviceAuth);
    if (result.success) {
      options.routingService.clearProviderCooldown(context.req.param('id'));
    }
    return context.json(result);
  });

  app.post('/api/providers/reorder', async (context) => {
    const input = await readJson<ReorderRequest>(context.req.raw);
    try {
      const providers = await options.registry.reorder(input.providerIds ?? []);
      options.routingService.updateProviders(providers);
      await syncConfig();
      return context.json(providers);
    } catch (error) {
      return context.json({ error: errorMessage(error) }, 400);
    }
  });

  app.get('/api/fallback-state', (context) => context.json(fallbackState(options.registry, options.routingService)));

  app.post('/api/fallback-state/reset', async (context) => {
    options.routingService.resetState();
    await syncConfig();
    return context.json(fallbackState(options.registry, options.routingService));
  });

  app.get('/api/codex-config/diagnose', async (context) => context.json(await codexConfig.diagnoseProjectConfig()));

  app.post('/api/codex-config/install', async (context) => {
    return context.json(await codexConfig.install());
  });

  app.post('/api/codex-config/restore', async (context) => context.json(await codexConfig.restore()));

  return app;
}

async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    return {} as T;
  }
}

async function codexAuthForStatus(): Promise<CodexAuthInfo> {
  const authDetector = new CodexAuthDetector();
  return authDetector.detect();
}

function fallbackState(registry: ProviderRegistry, routingService: RoutingService) {
  const activeProviderId = routingService.getActiveProvider();
  const primaryProviderId = registry.list().find((p) => p.enabled)?.id ?? '';
  const cooldownInfo = routingService.getCooldownStates().find((entry) => entry.providerId === primaryProviderId);
  return {
    activeProviderId,
    isFallback: activeProviderId !== primaryProviderId && primaryProviderId !== '',
    ...(cooldownInfo ? { cooldownInfo } : {}),
    stickySessions: [],
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Request failed.';
}

function syncConfigToActiveProvider(
  registry: ProviderRegistry,
  routingService: RoutingService,
  configSwitcher: ConfigSwitcher,
): Promise<void> {
  const activeId = routingService.getActiveProvider();
  if (activeId && activeId !== configSwitcher.getCurrentProviderId()) {
    const provider = registry.get(activeId);
    if (provider) {
      return configSwitcher.switchToProvider(provider).catch(() => {});
    }
  }
  return Promise.resolve();
}

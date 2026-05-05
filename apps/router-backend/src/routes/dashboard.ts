import { Hono } from 'hono';

import type { DailyUsage, PricingScraper, RateLimitTracker, UsageStore } from '@codex-failover/usage-tracker';

import type { ProviderRegistry } from '../services/provider-registry.js';
import type { CodexSessionUsageReader, CodexSessionUsageSnapshot } from '../services/codex-session-usage.js';

export interface UsageSampler {
  sample(options?: { force?: boolean }): Promise<void>;
}

export interface DashboardRouteOptions {
  usageStore: UsageStore;
  rateLimitTracker: RateLimitTracker;
  pricingScraper: PricingScraper;
  providerRegistry: ProviderRegistry;
  codexSessionUsageService?: CodexSessionUsageReader;
  codexProviderUsageAccumulator?: UsageSampler;
}

export function createDashboardRoutes(options: DashboardRouteOptions): Hono {
  const app = new Hono();

  app.get('/api/dashboard/overview', (context) => {
    const summary = options.usageStore.getOverallSummary(30);
    const rateLimits = options.rateLimitTracker.getAllStates();
    return context.json({ ...summary, rateLimits });
  });

  app.get('/api/dashboard/usage-today', async (context) => {
    const force = context.req.query('refresh') === '1';
    await options.codexProviderUsageAccumulator?.sample({ force });
    const today = new Date().toISOString().slice(0, 10);
    const daily = options.usageStore.getDailyUsage({ startDate: today, endDate: today });
    const rateLimits = options.rateLimitTracker.getAllStates();
    const providers = options.providerRegistry.list();
    const codexSnapshots = await readCodexSnapshots(options.codexSessionUsageService, force);
    const codexSession = codexSnapshots[0];
    const codexLimitSession = codexSnapshots.find((snapshot) => snapshot.limits.available);

    const byProvider: Record<string, {
      providerId: string;
      type: string;
      enabled: boolean;
      totalTokens: number;
      totalInputTokens: number;
      totalOutputTokens: number;
      requestCount: number;
      estimatedCostUsd: number;
      rateLimit?: {
        remainingRequests: number;
        limitRequests: number;
        remainingTokens: number;
        limitTokens: number;
        resetRequests: string;
        resetTokens: string;
      };
    }> = {};

    for (const provider of providers) {
      byProvider[provider.id] = {
        providerId: provider.id,
        type: provider.type,
        enabled: provider.enabled,
        totalTokens: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        requestCount: 0,
        estimatedCostUsd: 0,
      };
    }

    for (const entry of daily) {
      const existing = byProvider[entry.providerId];
      if (existing) {
        existing.totalTokens += entry.totalTokens;
        existing.totalInputTokens += entry.totalInputTokens;
        existing.totalOutputTokens += entry.totalOutputTokens;
        existing.requestCount += entry.requestCount;
        existing.estimatedCostUsd += entry.estimatedCostUsd;
      } else {
        byProvider[entry.providerId] = {
          providerId: entry.providerId,
          type: 'unknown',
          enabled: true,
          totalTokens: entry.totalTokens,
          totalInputTokens: entry.totalInputTokens,
          totalOutputTokens: entry.totalOutputTokens,
          requestCount: entry.requestCount,
          estimatedCostUsd: entry.estimatedCostUsd,
        };
      }
    }

    for (const rl of rateLimits) {
      const entry = byProvider[rl.providerId];
      if (entry) {
        entry.rateLimit = {
          remainingRequests: rl.remainingRequests,
          limitRequests: rl.limitRequests,
          remainingTokens: rl.remainingTokens,
          limitTokens: rl.limitTokens,
          resetRequests: rl.resetRequests,
          resetTokens: rl.resetTokens,
        };
      }
    }

    return context.json({
      providers: Object.values(byProvider),
      ...(codexSession ? { codexSession } : {}),
      ...(codexLimitSession ? { codexLimitSession } : {}),
    });
  });

  app.get('/api/dashboard/usage', (context) => {
    const startDate = context.req.query('startDate') ?? getDefaultStartDate();
    const endDate = context.req.query('endDate') ?? getDefaultEndDate();
    const providerId = context.req.query('providerId');
    const daily = options.usageStore.getDailyUsage({ providerId, startDate, endDate });
    return context.json({ daily });
  });

  app.get('/api/dashboard/costs', (context) => {
    const startDate = context.req.query('startDate') ?? getDefaultStartDate();
    const endDate = context.req.query('endDate') ?? getDefaultEndDate();
    const daily = options.usageStore.getDailyUsage({ startDate, endDate });
    const byProvider = groupByProvider(daily);
    return context.json({ daily, byProvider });
  });

  app.get('/api/dashboard/pricing', (context) => {
    const pricing = options.pricingScraper.getCachedPricing();
    return context.json({ pricing });
  });

  app.get('/api/dashboard/providers/:id', (context) => {
    const providerId = context.req.param('id');
    const summary = options.usageStore.getProviderSummary(providerId, 30);
    const rateLimit = options.rateLimitTracker.getState(providerId);
    const provider = options.providerRegistry.list().find((candidate) => candidate.id === providerId);
    return context.json({ ...summary, provider, rateLimit });
  });

  app.post('/api/dashboard/pricing/refresh', async (context) => {
    await options.pricingScraper.refreshIfNeeded();
    return context.json({ success: true });
  });

  return app;
}

async function readCodexSnapshots(service: CodexSessionUsageReader | undefined, force: boolean): Promise<CodexSessionUsageSnapshot[]> {
  if (!service) {
    return [];
  }
  if (service.getRecentSnapshots) {
    return service.getRecentSnapshots({ force });
  }
  const snapshot = force && service.refresh ? await service.refresh() : await service.getLatestSnapshot();
  return snapshot ? [snapshot] : [];
}

function getDefaultStartDate(): string {
  return formatDate(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
}

function getDefaultEndDate(): string {
  return formatDate(new Date());
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function groupByProvider(daily: DailyUsage[]): Record<string, { estimatedCostUsd: number; totalTokens: number; requestCount: number }> {
  return daily.reduce<Record<string, { estimatedCostUsd: number; totalTokens: number; requestCount: number }>>((accumulator, entry) => {
    const current = accumulator[entry.providerId] ?? { estimatedCostUsd: 0, totalTokens: 0, requestCount: 0 };
    accumulator[entry.providerId] = {
      estimatedCostUsd: current.estimatedCostUsd + entry.estimatedCostUsd,
      totalTokens: current.totalTokens + entry.totalTokens,
      requestCount: current.requestCount + entry.requestCount,
    };
    return accumulator;
  }, {});
}

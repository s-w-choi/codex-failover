import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CredentialStore, MemoryKeychainBackend } from '@codex-failover/credential-store';
import type { Provider } from '@codex-failover/shared';
import { PricingScraper, RateLimitTracker, UsageStore } from '@codex-failover/usage-tracker';
import type { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';
import { createDashboardRoutes } from '../../src/routes/dashboard.js';
import type { CodexRateLimitSnapshot, CodexSessionUsageReader, CodexSessionUsageSnapshot } from '../../src/services/codex-session-usage.js';
import { codexModelProviderNameForProvider } from '../../src/services/config-switcher.js';
import { ProviderRegistry } from '../../src/services/provider-registry.js';

describe('dashboard API integration', () => {
  let context: DashboardTestContext;

  beforeEach(async () => {
    context = await createDashboardTestContext();
  });

  afterEach(async () => {
    context.usageStore.close();
    await rm(context.tempDir, { recursive: true, force: true });
  });

  it('returns summary with zeros for an empty database', async () => {
    const response = await context.app.request('/api/dashboard/overview');
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ totalCost: 0, totalTokens: 0, requestCount: 0, byProvider: {}, rateLimits: [] });
  });

  it('returns an empty daily usage array', async () => {
    const response = await context.app.request('/api/dashboard/usage');
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ daily: [] });
  });

  it('returns empty daily costs grouped by provider', async () => {
    const response = await context.app.request('/api/dashboard/costs');
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ daily: [], byProvider: {} });
  });

  it('returns cached or fallback pricing', async () => {
    const response = await context.app.request('/api/dashboard/pricing');
    const body = (await response.json()) as { pricing: Array<{ provider: string; models: unknown[] }> };

    expect(response.status).toBe(200);
    expect(body.pricing.length).toBeGreaterThan(0);
    expect(body.pricing.some((entry) => entry.provider === 'openai')).toBe(true);
  });

  it('returns a provider summary', async () => {
    const response = await context.app.request('/api/dashboard/providers/openai');
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ totalCost: 0, totalTokens: 0, requestCount: 0 });
  });

  it('includes the latest Codex session usage snapshot in usage-today', async () => {
    const snapshotContext = await createDashboardTestContext({
      codexSessionUsageService: {
        getLatestSnapshot: async () => ({
          source: 'codex-session',
          sessionId: 'session-1',
          updatedAt: '2026-05-04T16:25:56.360Z',
          usage: {
            total: { inputTokens: 100, cachedInputTokens: 0, outputTokens: 25, reasoningOutputTokens: 0, totalTokens: 125 },
            last: { inputTokens: 100, cachedInputTokens: 0, outputTokens: 25, reasoningOutputTokens: 0, totalTokens: 125 },
            contextWindowTokens: 1_000,
            contextUsedTokens: 125,
            contextLeftPercent: 88,
          },
          limits: { available: false, limitId: 'codex' },
        }),
      },
    });

    try {
      const response = await snapshotContext.app.request('/api/dashboard/usage-today');
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.codexSession).toMatchObject({
        source: 'codex-session',
        sessionId: 'session-1',
        usage: { total: { totalTokens: 125 }, contextLeftPercent: 88 },
        limits: { available: false, limitId: 'codex' },
      });
    } finally {
      snapshotContext.usageStore.close();
      await rm(snapshotContext.tempDir, { recursive: true, force: true });
    }
  });

  it('includes the most recent Codex limit snapshot separately from the latest usage snapshot', async () => {
    const latestApiSnapshot = codexSnapshot({
      sessionId: 'api-session',
      totalTokens: 250,
      limits: { available: false, limitId: 'codex' },
    });
    const latestLimitSnapshot = codexSnapshot({
      sessionId: 'oauth-session',
      totalTokens: 125,
      limits: {
        available: true,
        limitId: 'codex',
        primary: { usedPercent: 5, remainingPercent: 95, windowMinutes: 300, resetsAt: 1_777_929_810 },
      },
    });
    const snapshotContext = await createDashboardTestContext({
      codexSessionUsageService: {
        getLatestSnapshot: async () => latestApiSnapshot,
        getRecentSnapshots: async () => [latestApiSnapshot, latestLimitSnapshot],
      },
    });

    try {
      const response = await snapshotContext.app.request('/api/dashboard/usage-today');
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.codexSession).toMatchObject({ sessionId: 'api-session', limits: { available: false } });
      expect(body.codexLimitSession).toMatchObject({
        sessionId: 'oauth-session',
        limits: { available: true, primary: { remainingPercent: 95 } },
      });
    } finally {
      snapshotContext.usageStore.close();
      await rm(snapshotContext.tempDir, { recursive: true, force: true });
    }
  });

  it('does not attach OAuth limit snapshots to API key providers', async () => {
    const openaiApi = provider({ id: 'openai-api', type: 'openai-api-key' });
    const oauthLimitSnapshot = codexSnapshot({
      sessionId: 'oauth-session',
      modelProvider: 'openai',
      totalTokens: 125,
      limits: {
        available: true,
        limitId: 'codex',
        primary: { usedPercent: 5, remainingPercent: 95, windowMinutes: 300, resetsAt: 1_777_929_810 },
      },
    });
    const snapshotContext = await createDashboardTestContext({
      providers: [openaiApi],
      activeProviderId: 'openai-api',
      codexSessionUsageService: {
        getLatestSnapshot: async () => oauthLimitSnapshot,
        getRecentSnapshots: async () => [oauthLimitSnapshot],
      },
    });

    try {
      const response = await snapshotContext.app.request('/api/dashboard/usage-today');
      const body = (await response.json()) as {
        providers: Array<{ providerId: string; codexSession?: CodexSessionUsageSnapshot }>;
        codexLimitSession?: CodexSessionUsageSnapshot;
      };
      const providerUsage = body.providers.find((candidate) => candidate.providerId === 'openai-api');

      expect(response.status).toBe(200);
      expect(providerUsage?.codexSession).toBeUndefined();
      expect(body.codexLimitSession).toMatchObject({ sessionId: 'oauth-session', limits: { available: true } });
    } finally {
      snapshotContext.usageStore.close();
      await rm(snapshotContext.tempDir, { recursive: true, force: true });
    }
  });

  it('attaches matching Codex API session usage to the active fallback provider with partial token-only usage', async () => {
    const oauthPrimary = provider({ id: 'oauth-primary', type: 'openai-oauth-pass-through', priority: 1, credentialMode: 'inbound-authorization', credentialRef: undefined });
    const azureFallback = provider({ id: 'azure-api', type: 'azure-openai-api-key', priority: 2, deploymentName: 'codex-deployment' });
    const azureSnapshot = codexSnapshot({
      sessionId: 'azure-session',
      modelProvider: codexModelProviderNameForProvider(azureFallback),
      inputTokens: 4_430_000,
      outputTokens: 20_000,
      totalTokens: 4_450_000,
      limits: { available: false, limitId: 'codex' },
    });
    const oauthLimitSnapshot = codexSnapshot({
      sessionId: 'oauth-session',
      totalTokens: 120,
      limits: {
        available: true,
        limitId: 'codex',
        primary: { usedPercent: 5, remainingPercent: 95, windowMinutes: 300, resetsAt: 1_777_929_810 },
      },
    });
    const snapshotContext = await createDashboardTestContext({
      providers: [oauthPrimary, azureFallback],
      activeProviderId: 'azure-api',
      codexSessionUsageService: {
        getLatestSnapshot: async () => oauthLimitSnapshot,
        getRecentSnapshots: async () => [oauthLimitSnapshot, azureSnapshot],
      },
    });

    try {
      snapshotContext.usageStore.recordUsage({
        id: 'partial-session-delta',
        providerId: 'azure-api',
        model: 'codex-deployment',
        inputTokens: 3_590_000,
        outputTokens: 20_000,
        cachedTokens: 0,
        reasoningTokens: 0,
        totalTokens: 3_610_000,
        costUsd: 0,
        requestId: 'codex-session:azure-session:partial',
        requestCount: 0,
        timestamp: Date.now(),
      });

      const response = await snapshotContext.app.request('/api/dashboard/usage-today');
      const body = (await response.json()) as {
        providers: Array<{ providerId: string; totalTokens: number; localSessionTokens: number; requestCount: number; codexSession?: CodexSessionUsageSnapshot }>;
        codexSession?: CodexSessionUsageSnapshot;
        codexLimitSession?: CodexSessionUsageSnapshot;
      };
      const azureUsage = body.providers.find((candidate) => candidate.providerId === 'azure-api');

      expect(response.status).toBe(200);
      expect(body.codexSession).toMatchObject({ sessionId: 'azure-session', usage: { total: { inputTokens: 4_430_000, outputTokens: 20_000, totalTokens: 4_450_000 } } });
      expect(body.codexLimitSession).toMatchObject({ sessionId: 'oauth-session', limits: { available: true } });
      expect(azureUsage).toMatchObject({
        totalTokens: 0,
        localSessionTokens: 3_610_000,
        requestCount: 0,
        codexSession: { sessionId: 'azure-session', usage: { total: { inputTokens: 4_430_000, outputTokens: 20_000, totalTokens: 4_450_000 } } },
      });
    } finally {
      snapshotContext.usageStore.close();
      await rm(snapshotContext.tempDir, { recursive: true, force: true });
    }
  });
});

interface DashboardTestContext {
  app: Hono;
  usageStore: UsageStore;
  tempDir: string;
}

async function createDashboardTestContext(options: {
  providers?: Provider[];
  activeProviderId?: string;
  codexSessionUsageService?: CodexSessionUsageReader;
} = {}): Promise<DashboardTestContext> {
  const tempDir = await mkdtemp(join(tmpdir(), 'codex-dashboard-test-'));
  const usageStore = new UsageStore(':memory:');
  const rateLimitTracker = new RateLimitTracker();
  const pricingScraper = new PricingScraper({ cachePath: join(tempDir, 'pricing.json') });
  const credentialStore = new CredentialStore(new MemoryKeychainBackend());
  if (options.activeProviderId !== undefined) {
    const providerRegistry = new ProviderRegistry(options.providers ?? [], credentialStore);
    const app = createDashboardRoutes({
      usageStore,
      rateLimitTracker,
      pricingScraper,
      providerRegistry,
      activeProviderReader: { getActiveProvider: () => options.activeProviderId ?? '' },
      codexSessionUsageService: options.codexSessionUsageService,
    });
    return { app, usageStore, tempDir };
  }
  const { app } = createApp({
    providers: options.providers ?? [],
    credentialStore,
    dashboard: { usageStore, rateLimitTracker, pricingScraper, codexSessionUsageService: options.codexSessionUsageService },
  });

  return { app, usageStore, tempDir };
}

function codexSnapshot(options: {
  sessionId: string;
  modelProvider?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens: number;
  limits: CodexRateLimitSnapshot;
}): CodexSessionUsageSnapshot {
  const inputTokens = options.inputTokens ?? options.totalTokens;
  const outputTokens = options.outputTokens ?? 0;
  return {
    source: 'codex-session',
    sessionId: options.sessionId,
    ...(options.modelProvider ? { modelProvider: options.modelProvider } : {}),
    updatedAt: '2026-05-04T16:25:56.360Z',
    usage: {
      total: { inputTokens, cachedInputTokens: 0, outputTokens, reasoningOutputTokens: 0, totalTokens: options.totalTokens },
      last: { inputTokens, cachedInputTokens: 0, outputTokens, reasoningOutputTokens: 0, totalTokens: options.totalTokens },
      contextWindowTokens: 1_000,
      contextUsedTokens: options.totalTokens,
      contextLeftPercent: 75,
    },
    limits: options.limits,
  };
}

function provider(overrides: Partial<Provider>): Provider {
  return {
    id: 'azure-api',
    type: 'azure-openai-api-key',
    priority: 1,
    baseUrl: 'https://example.openai.azure.com/openai/v1',
    credentialMode: 'stored-api-key',
    credentialRef: 'keychain://azure-api',
    enabled: true,
    modelAlias: { default: 'gpt-test' },
    ...overrides,
  };
}

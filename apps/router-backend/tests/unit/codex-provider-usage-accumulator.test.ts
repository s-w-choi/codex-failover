import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CredentialStore, MemoryKeychainBackend } from '@codex-failover/credential-store';
import type { Provider } from '@codex-failover/shared';
import type { ModelPricing, PricingProvider } from '@codex-failover/usage-tracker';
import { UsageStore } from '@codex-failover/usage-tracker';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CodexProviderUsageAccumulator, type ActiveProviderReader } from '../../src/services/codex-provider-usage-accumulator.js';
import type { CodexSessionUsageReader, CodexSessionUsageSnapshot } from '../../src/services/codex-session-usage.js';
import { codexModelProviderNameForProvider } from '../../src/services/config-switcher.js';
import { ProviderRegistry } from '../../src/services/provider-registry.js';

describe('CodexProviderUsageAccumulator', () => {
  let tempDir: string;
  let usageStore: UsageStore;
  let snapshot: CodexSessionUsageSnapshot | undefined;
  let activeProvider: MutableActiveProvider;
  let modelProvider: MutableModelProvider;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'codex-provider-usage-'));
    usageStore = new UsageStore(':memory:');
    snapshot = undefined;
    activeProvider = new MutableActiveProvider('azure');
    modelProvider = new MutableModelProvider('azure');
  });

  afterEach(async () => {
    usageStore.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  it('uses the first active API provider Codex session observation as a baseline', async () => {
    snapshot = snapshotWithUsage({ inputTokens: 100, outputTokens: 40, totalTokens: 140 });
    const accumulator = createAccumulator([provider({ id: 'azure', type: 'azure-openai-api-key', deploymentName: 'gpt-5.3-codex' })]);

    await accumulator.sample();

    expect(dailyUsage('azure')).toBeUndefined();
  });

  it('records only the delta from later samples in the same Codex session', async () => {
    snapshot = snapshotWithUsage({ inputTokens: 100, outputTokens: 40, totalTokens: 140 });
    const accumulator = createAccumulator([provider({ id: 'azure', type: 'azure-openai-api-key' })]);

    await accumulator.sample();
    snapshot = snapshotWithUsage({ inputTokens: 130, outputTokens: 70, totalTokens: 200 });
    await accumulator.sample();

    expect(dailyUsage('azure')).toMatchObject({
      totalInputTokens: 30,
      totalOutputTokens: 30,
      totalTokens: 60,
      requestCount: 0,
    });
  });

  it('uses OAuth samples as a baseline instead of attributing them to the next API provider', async () => {
    const accumulator = createAccumulator([
      provider({ id: 'oauth', type: 'openai-oauth-pass-through', credentialMode: 'inbound-authorization', credentialRef: undefined }),
      provider({ id: 'azure', type: 'azure-openai-api-key' }),
    ]);

    activeProvider.providerId = 'oauth';
    modelProvider.providerName = undefined;
    snapshot = snapshotWithUsage({ inputTokens: 100, outputTokens: 40, totalTokens: 140 });
    await accumulator.sample();

    activeProvider.providerId = 'azure';
    modelProvider.providerName = 'azure';
    snapshot = snapshotWithUsage({ inputTokens: 125, outputTokens: 55, totalTokens: 180 });
    await accumulator.sample();

    expect(dailyUsage('azure')).toMatchObject({
      totalInputTokens: 25,
      totalOutputTokens: 15,
      totalTokens: 40,
      requestCount: 0,
    });
  });

  it('does not attribute Codex OAuth limit snapshots to active API providers', async () => {
    modelProvider.providerName = undefined;
    snapshot = snapshotWithUsage({ inputTokens: 100, outputTokens: 40, totalTokens: 140 }, { oauthLimits: true });
    const accumulator = createAccumulator([provider({ id: 'openai', type: 'openai-api-key' })]);

    await accumulator.sample();

    expect(dailyUsage('openai')).toBeUndefined();
  });

  it('attributes API deltas when Codex config points at the active API provider', async () => {
    activeProvider.providerId = 'openai';
    modelProvider.providerName = 'openai-api';
    snapshot = snapshotWithUsage({ inputTokens: 100, outputTokens: 40, totalTokens: 140 }, { oauthLimits: true });
    const accumulator = createAccumulator([provider({ id: 'openai', type: 'openai-api-key' })]);

    await accumulator.sample();
    snapshot = snapshotWithUsage({ inputTokens: 125, outputTokens: 55, totalTokens: 180 }, { oauthLimits: true });
    await accumulator.sample();

    expect(dailyUsage('openai')).toMatchObject({ totalTokens: 40, requestCount: 0 });
  });

  it('uses id-specific Codex model provider names to separate providers of the same type', async () => {
    const east = provider({ id: 'azure-east', type: 'azure-openai-api-key', deploymentName: 'east-deployment' });
    const west = provider({ id: 'azure-west', type: 'azure-openai-api-key', deploymentName: 'west-deployment' });
    activeProvider.providerId = 'azure-east';
    modelProvider.providerName = 'azure';
    snapshot = snapshotWithUsage(
      { inputTokens: 100, outputTokens: 40, totalTokens: 140 },
      { modelProvider: codexModelProviderNameForProvider(west) },
    );
    const accumulator = createAccumulator([east, west]);

    await accumulator.sample();
    snapshot = snapshotWithUsage(
      { inputTokens: 125, outputTokens: 55, totalTokens: 180 },
      { modelProvider: codexModelProviderNameForProvider(west) },
    );
    await accumulator.sample();

    expect(dailyUsage('azure-east')).toBeUndefined();
    expect(dailyUsage('azure-west')).toMatchObject({
      providerId: 'azure-west',
      model: 'west-deployment',
      totalTokens: 40,
      requestCount: 0,
    });
  });

  it('does not attribute legacy type-level model provider names when multiple providers match', async () => {
    activeProvider.providerId = '';
    modelProvider.providerName = undefined;
    snapshot = snapshotWithUsage(
      { inputTokens: 100, outputTokens: 40, totalTokens: 140 },
      { modelProvider: 'azure' },
    );
    const accumulator = createAccumulator([
      provider({ id: 'azure-east', type: 'azure-openai-api-key' }),
      provider({ id: 'azure-west', type: 'azure-openai-api-key' }),
    ]);

    await accumulator.sample();

    expect(dailyUsage('azure-east')).toBeUndefined();
    expect(dailyUsage('azure-west')).toBeUndefined();
  });

  it('uses provider reclassification as a baseline instead of recording the full session total', async () => {
    const west = provider({ id: 'azure-west', type: 'azure-openai-api-key', deploymentName: 'west-deployment' });
    activeProvider.providerId = 'azure-west';
    modelProvider.providerName = undefined;
    snapshot = snapshotWithUsage({ inputTokens: 100, outputTokens: 40, totalTokens: 140 });
    const accumulator = createAccumulator([west]);

    await accumulator.sample();
    snapshot = snapshotWithUsage(
      { inputTokens: 125, outputTokens: 55, totalTokens: 180 },
      { modelProvider: codexModelProviderNameForProvider(west) },
    );
    await accumulator.sample();

    expect(dailyUsage('azure-west')).toBeUndefined();
  });

  it('does not add local token-only usage once real request usage exists for the provider today', async () => {
    usageStore.recordUsage({
      id: 'real-usage',
      providerId: 'azure',
      model: 'gpt-5.3-codex',
      inputTokens: 10,
      outputTokens: 5,
      cachedTokens: 0,
      reasoningTokens: 0,
      totalTokens: 15,
      costUsd: 0,
      requestId: 'request-1',
      timestamp: Date.UTC(2026, 0, 15, 9, 0),
    });
    snapshot = snapshotWithUsage({ inputTokens: 100, outputTokens: 40, totalTokens: 140 });
    const accumulator = createAccumulator([provider({ id: 'azure', type: 'azure-openai-api-key' })]);

    await accumulator.sample();

    expect(dailyUsage('azure')).toMatchObject({ totalTokens: 15, requestCount: 1 });
  });

  function createAccumulator(providers: Provider[]): CodexProviderUsageAccumulator {
    const registry = new ProviderRegistry(providers, new CredentialStore(new MemoryKeychainBackend()));
    const reader: CodexSessionUsageReader = {
      getLatestSnapshot: async () => snapshot,
    };

    return new CodexProviderUsageAccumulator(
      registry,
      activeProvider,
      modelProvider,
      reader,
      usageStore,
      new FakePricingProvider(),
      { statePath: join(tempDir, 'state.json'), now: () => new Date(Date.UTC(2026, 0, 15, 12, 0)) },
    );
  }

  function dailyUsage(providerId: string) {
    return usageStore.getDailyUsage({ providerId, startDate: '2026-01-15', endDate: '2026-01-15' })[0];
  }
});

class MutableActiveProvider implements ActiveProviderReader {
  constructor(public providerId: string) {}

  getActiveProvider(): string {
    return this.providerId;
  }
}

class MutableModelProvider {
  constructor(public providerName: string | undefined) {}

  async readModelProvider(): Promise<string | undefined> {
    return this.providerName;
  }
}

class FakePricingProvider implements PricingProvider {
  getPricing(_providerType: string, model: string): ModelPricing {
    return {
      model,
      inputPricePer1kTokens: 0.01,
      outputPricePer1kTokens: 0.03,
      cachedInputPricePer1kTokens: 0.002,
    };
  }

  async refreshPricing(): Promise<void> {
    return undefined;
  }
}

function provider(overrides: Partial<Provider>): Provider {
  return {
    id: 'azure',
    type: 'azure-openai-api-key',
    priority: 1,
    baseUrl: 'https://example.openai.azure.com/openai/v1',
    credentialMode: 'stored-api-key',
    credentialRef: 'keychain://azure',
    enabled: true,
    modelAlias: { default: 'gpt-test' },
    ...overrides,
  };
}

function snapshotWithUsage(
  total: { inputTokens: number; outputTokens: number; totalTokens: number },
  options: { oauthLimits?: boolean; modelProvider?: string } = {},
): CodexSessionUsageSnapshot {
  return {
    source: 'codex-session',
    sessionId: 'session-1',
    ...(options.modelProvider ? { modelProvider: options.modelProvider } : {}),
    updatedAt: '2026-01-15T16:25:56.360Z',
    usage: {
      total: { cachedInputTokens: 0, reasoningOutputTokens: 0, ...total },
      last: { cachedInputTokens: 0, reasoningOutputTokens: 0, ...total },
      contextWindowTokens: 1_000,
      contextUsedTokens: total.totalTokens,
      contextLeftPercent: 90,
    },
    limits: options.oauthLimits
      ? { available: true, primary: { usedPercent: 10, remainingPercent: 90, windowMinutes: 300, resetsAt: 1_777_913_000 } }
      : { available: false },
  };
}

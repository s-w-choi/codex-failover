import { CredentialStore, MemoryKeychainBackend } from '@codex-failover/credential-store';
import type { Provider } from '@codex-failover/shared';
import type { ModelPricing, PricingProvider } from '@codex-failover/usage-tracker';
import { UsageStore } from '@codex-failover/usage-tracker';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProviderRegistry } from '../../src/services/provider-registry.js';
import { UsagePoller } from '../../src/services/usage-poller.js';

describe('UsagePoller', () => {
  let credentialStore: CredentialStore;
  let usageStore: UsageStore;
  let pricingProvider: FakePricingProvider;
  let fetchMock: ReturnType<typeof vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>>;

  beforeEach(() => {
    credentialStore = new CredentialStore(new MemoryKeychainBackend());
    usageStore = new UsageStore(':memory:');
    pricingProvider = new FakePricingProvider();
    fetchMock = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    usageStore.close();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('calls the OpenAI usage API for OpenAI API key providers', async () => {
    await credentialStore.store('keychain://openai', 'openai-secret');
    fetchMock.mockResolvedValue(jsonResponse(usageResponse([{ model: 'gpt-4o-mini', inputTokens: 1_200, outputTokens: 800, cachedTokens: 100 }])));
    const poller = createPoller([provider({ credentialRef: 'keychain://openai' })]);

    await poller.poll();

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('https://api.openai.com/v1/organization/usage/completions?');
    expect(String(url)).toContain('bucket_width=1h');
    expect(String(url)).toContain('group_by=model');
    expect(String(url)).toContain('limit=24');
    expect(init?.headers).toEqual({ Authorization: 'Bearer openai-secret' });
    expect(polledUsage()).toMatchObject({ requestCount: 1, totalTokens: 2_000, estimatedCostUsd: 0.0047 });
  });

  it('skips Azure, compatible, and OAuth providers', async () => {
    const poller = createPoller([
      provider({ id: 'azure', type: 'azure-openai-api-key', credentialRef: 'keychain://azure' }),
      provider({ id: 'compatible', type: 'openai-compatible-api-key', credentialRef: 'keychain://compatible' }),
      provider({ id: 'oauth', type: 'openai-oauth-pass-through', credentialMode: 'inbound-authorization', credentialRef: undefined }),
    ]);

    await poller.poll();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(usageStore.getOverallSummary(1).requestCount).toBe(0);
  });

  it('does not record duplicate buckets twice', async () => {
    await credentialStore.store('keychain://openai', 'openai-secret');
    fetchMock.mockImplementation(async () => jsonResponse(usageResponse([{ model: 'gpt-4o-mini', inputTokens: 100, outputTokens: 50 }])));
    const poller = createPoller([provider({ credentialRef: 'keychain://openai' })]);

    await poller.poll();
    await poller.poll();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(polledUsage()).toMatchObject({ requestCount: 1, totalTokens: 150 });
  });

  it('does not throw when the usage API fails', async () => {
    await credentialStore.store('keychain://openai', 'openai-secret');
    fetchMock.mockResolvedValue(new Response('unauthorized', { status: 401 }));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const poller = createPoller([provider({ credentialRef: 'keychain://openai' })]);

    await expect(poller.poll()).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Usage polling failed for provider openai'));
    expect(usageStore.getOverallSummary(1).requestCount).toBe(0);
  });

  it('start and stop manage the interval', async () => {
    vi.useFakeTimers();
    await credentialStore.store('keychain://openai', 'openai-secret');
    fetchMock.mockResolvedValue(jsonResponse(usageResponse([{ model: 'gpt-4o-mini', inputTokens: 10, outputTokens: 5 }])));
    const poller = createPoller([provider({ credentialRef: 'keychain://openai' })], { pollIntervalMs: 1_000 });

    poller.start();
    poller.stop();
    await vi.advanceTimersByTimeAsync(2_000);

    expect(fetchMock).toHaveBeenCalledOnce();
  });

  function createPoller(providers: Provider[], options?: { pollIntervalMs?: number }): UsagePoller {
    return new UsagePoller(new ProviderRegistry(providers, credentialStore), credentialStore, usageStore, pricingProvider, options);
  }

  function polledUsage(): { requestCount: number; totalTokens: number; estimatedCostUsd: number } {
    const [usage] = usageStore.getDailyUsage({ startDate: '2024-11-01', endDate: '2024-11-01' });

    return {
      requestCount: usage?.requestCount ?? 0,
      totalTokens: usage?.totalTokens ?? 0,
      estimatedCostUsd: usage?.estimatedCostUsd ?? 0,
    };
  }
});

class FakePricingProvider implements PricingProvider {
  getPricing(_providerType: string, model: string): ModelPricing | undefined {
    return {
      model,
      inputPricePer1kTokens: 0.002,
      outputPricePer1kTokens: 0.003,
      cachedInputPricePer1kTokens: 0.001,
    };
  }

  async refreshPricing(): Promise<void> {
    return undefined;
  }
}

function provider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: 'openai',
    type: 'openai-api-key',
    priority: 1,
    baseUrl: 'https://api.openai.com/v1',
    credentialMode: 'stored-api-key',
    credentialRef: 'keychain://openai',
    enabled: true,
    modelAlias: { default: 'gpt-4o-mini' },
    ...overrides,
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

function usageResponse(results: Array<{ model: string; inputTokens: number; outputTokens: number; cachedTokens?: number }>): unknown {
  return {
    data: [
      {
        start_time: 1_730_419_200,
        end_time: 1_730_422_800,
        results: results.map((result) => ({
          input_tokens: result.inputTokens,
          output_tokens: result.outputTokens,
          input_cached_tokens: result.cachedTokens,
          num_model_requests: 1,
          model: result.model,
        })),
      },
    ],
  };
}

import { describe, expect, it, vi } from 'vitest';

import type { PricingProvider } from '../src/pricing-provider';
import { UsageRecorder } from '../src/usage-recorder';
import type { UsageStore } from '../src/usage-store';

const store = {} as UsageStore;

const pricingProvider: PricingProvider = {
  getPricing: (_providerType, model) => ({
    model,
    inputPricePer1kTokens: 0.01,
    outputPricePer1kTokens: 0.03,
    cachedInputPricePer1kTokens: 0.002,
  }),
  async refreshPricing() {},
};

describe('UsageRecorder', () => {
  const recorder = new UsageRecorder(store, pricingProvider);

  it('parses Responses API usage format', () => {
    expect(
      recorder.parseUsageFromBody({
        usage: {
          input_tokens: 100,
          output_tokens: 40,
          input_tokens_details: { cached_tokens: 20 },
          output_tokens_details: { reasoning_tokens: 5 },
        },
      }),
    ).toEqual({ inputTokens: 100, outputTokens: 40, cachedTokens: 20, reasoningTokens: 5, totalTokens: 140 });
  });

  it('parses Chat Completions usage format', () => {
    expect(
      recorder.parseUsageFromBody({
        usage: {
          prompt_tokens: 75,
          completion_tokens: 25,
          prompt_tokens_details: { cached_tokens: 10 },
          completion_tokens_details: { reasoning_tokens: 3 },
        },
      }),
    ).toEqual({ inputTokens: 75, outputTokens: 25, cachedTokens: 10, reasoningTokens: 3, totalTokens: 100 });
  });

  it('calculates cost from pricing', () => {
    expect(
      recorder.calculateCost('gpt-4o', {
        inputTokens: 1000,
        outputTokens: 500,
        cachedTokens: 200,
        reasoningTokens: 0,
        totalTokens: 1500,
      }),
    ).toBe(0.0234);
  });

  it('returns zero cost for zero usage', () => {
    expect(
      recorder.calculateCost('gpt-4o', {
        inputTokens: 0,
        outputTokens: 0,
        cachedTokens: 0,
        reasoningTokens: 0,
        totalTokens: 0,
      }),
    ).toBe(0);
  });

  it('records response cost using provider-specific pricing', async () => {
    const recordUsage = vi.fn();
    const providerPricing: PricingProvider = {
      getPricing: (providerType, model) => ({
        model,
        inputPricePer1kTokens: providerType === 'azure' ? 0.02 : 0.01,
        outputPricePer1kTokens: providerType === 'azure' ? 0.04 : 0.03,
      }),
      async refreshPricing() {},
    };
    const providerRecorder = new UsageRecorder({ recordUsage } as unknown as UsageStore, providerPricing);

    await providerRecorder.recordFromResponse(
      'azure',
      new Response(
        JSON.stringify({
          model: 'gpt-4o',
          usage: { prompt_tokens: 1000, completion_tokens: 500 },
        }),
        { headers: { 'x-request-id': 'request-123' } },
      ),
    );

    expect(recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        costUsd: 0.04,
        model: 'gpt-4o',
        providerId: 'azure',
        requestId: 'request-123',
      }),
    );
  });
});

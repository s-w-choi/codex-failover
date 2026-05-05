import type { ScrapedPricing } from './pricing-scraper.js';

export const FALLBACK_PRICES: Record<string, ScrapedPricing> = {
  openai: {
    provider: 'openai',
    scrapedAt: 0,
    expiresAt: 0,
    models: [
      { model: 'gpt-4.1', inputPricePer1kTokens: 0.002, outputPricePer1kTokens: 0.008 },
      { model: 'gpt-4.1-mini', inputPricePer1kTokens: 0.0004, outputPricePer1kTokens: 0.0016 },
      { model: 'gpt-4.1-nano', inputPricePer1kTokens: 0.0001, outputPricePer1kTokens: 0.0004 },
      { model: 'gpt-4o', inputPricePer1kTokens: 0.0025, outputPricePer1kTokens: 0.01 },
      { model: 'gpt-4o-mini', inputPricePer1kTokens: 0.00015, outputPricePer1kTokens: 0.0006 },
      { model: 'o3', inputPricePer1kTokens: 0.002, outputPricePer1kTokens: 0.008 },
      { model: 'o3-mini', inputPricePer1kTokens: 0.0011, outputPricePer1kTokens: 0.0044 },
      { model: 'o4-mini', inputPricePer1kTokens: 0.0011, outputPricePer1kTokens: 0.0044 },
    ],
  },
  azure: {
    provider: 'azure',
    scrapedAt: 0,
    expiresAt: 0,
    models: [
      { model: 'gpt-4.1', inputPricePer1kTokens: 0.002, outputPricePer1kTokens: 0.008 },
      { model: 'gpt-4.1-mini', inputPricePer1kTokens: 0.0004, outputPricePer1kTokens: 0.0016 },
      { model: 'gpt-4o', inputPricePer1kTokens: 0.0025, outputPricePer1kTokens: 0.01 },
      { model: 'gpt-4o-mini', inputPricePer1kTokens: 0.00015, outputPricePer1kTokens: 0.0006 },
      { model: 'o3-mini', inputPricePer1kTokens: 0.0011, outputPricePer1kTokens: 0.0044 },
    ],
  },
  deepseek: {
    provider: 'deepseek',
    scrapedAt: 0,
    expiresAt: 0,
    models: [
      {
        model: 'deepseek-chat',
        inputPricePer1kTokens: 0.00027,
        cachedInputPricePer1kTokens: 0.00007,
        outputPricePer1kTokens: 0.0011,
      },
      {
        model: 'deepseek-reasoner',
        inputPricePer1kTokens: 0.00055,
        cachedInputPricePer1kTokens: 0.00014,
        outputPricePer1kTokens: 0.00219,
      },
    ],
  },
};

export function withTimestamps(pricing: ScrapedPricing, ttlMs: number, now = Date.now()): ScrapedPricing {
  return {
    ...pricing,
    scrapedAt: now,
    expiresAt: now + ttlMs,
    models: pricing.models.map((model) => ({ ...model })),
  };
}

import { PricingCache } from './cache.js';
import { FALLBACK_PRICES, withTimestamps } from './fallback-prices.js';
import { scrapeAzurePricing } from './providers/azure.js';
import { scrapeDeepSeekPricing } from './providers/deepseek.js';
import { scrapeOpenAiPricing } from './providers/openai.js';

export interface ScrapedPricing {
  provider: string;
  scrapedAt: number;
  expiresAt: number;
  models: Array<{
    model: string;
    inputPricePer1kTokens: number;
    outputPricePer1kTokens: number;
    cachedInputPricePer1kTokens?: number;
    reasoningPricePer1kTokens?: number;
  }>;
}

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PROVIDERS = ['openai', 'azure', 'deepseek'] as const;

type ProviderName = (typeof PROVIDERS)[number];

type ProviderScraper = (ttlMs: number, cached?: ScrapedPricing) => Promise<ScrapedPricing>;

const SCRAPERS: Record<ProviderName, ProviderScraper> = {
  openai: scrapeOpenAiPricing,
  azure: scrapeAzurePricing,
  deepseek: scrapeDeepSeekPricing,
};

export class PricingScraper {
  private readonly cache: PricingCache;
  private readonly ttlMs: number;

  constructor(options: { cachePath: string; ttlMs?: number }) {
    this.cache = new PricingCache(options.cachePath);
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  }

  async scrapeAll(): Promise<ScrapedPricing[]> {
    const cached = this.cache.read();
    const results = await Promise.all(
      PROVIDERS.map((provider) => SCRAPERS[provider](this.ttlMs, findProvider(cached, provider))),
    );

    this.cache.write(results);
    return results;
  }

  async scrapeProvider(provider: string): Promise<ScrapedPricing> {
    if (!isProviderName(provider)) {
      throw new Error(`Unsupported pricing provider: ${provider}`);
    }

    const cached = this.cache.read();
    const result = await SCRAPERS[provider](this.ttlMs, findProvider(cached, provider));
    const merged = mergeProvider(cached, result);
    this.cache.write(merged);
    return result;
  }

  getCachedPricing(): ScrapedPricing[] {
    const cached = this.cache.read();

    if (cached.length > 0) {
      return cached;
    }

    return Object.values(FALLBACK_PRICES).map((pricing) => withTimestamps(pricing, this.ttlMs));
  }

  isCacheExpired(): boolean {
    return this.cache.isExpired(this.ttlMs);
  }

  async refreshIfNeeded(): Promise<void> {
    if (this.isCacheExpired()) {
      await this.scrapeAll();
    }
  }
}

function isProviderName(provider: string): provider is ProviderName {
  return PROVIDERS.includes(provider as ProviderName);
}

function findProvider(pricing: ScrapedPricing[], provider: string): ScrapedPricing | undefined {
  return pricing.find((entry) => entry.provider === provider);
}

function mergeProvider(pricing: ScrapedPricing[], result: ScrapedPricing): ScrapedPricing[] {
  const withoutProvider = pricing.filter((entry) => entry.provider !== result.provider);
  return [...withoutProvider, result];
}

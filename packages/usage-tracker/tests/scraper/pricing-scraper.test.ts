import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PricingCache } from '../../src/scraper/cache';
import { FALLBACK_PRICES } from '../../src/scraper/fallback-prices';
import { PricingScraper, type ScrapedPricing } from '../../src/scraper/pricing-scraper';

const originalFetch = globalThis.fetch;
const ttlMs = 7 * 24 * 60 * 60 * 1000;

describe('PricingScraper', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    globalThis.fetch = originalFetch;
  });

  it('uses fallback prices when no cache exists', () => {
    const temp = createTempCachePath();
    const scraper = new PricingScraper({ cachePath: temp.cachePath, ttlMs });

    try {
      const pricing = scraper.getCachedPricing();

      expect(pricing).toHaveLength(Object.keys(FALLBACK_PRICES).length);
      expect(pricing.find((entry) => entry.provider === 'openai')?.models).toEqual(
        FALLBACK_PRICES.openai.models,
      );
      expect(pricing.every((entry) => entry.scrapedAt > 0 && entry.expiresAt > entry.scrapedAt)).toBe(
        true,
      );
    } finally {
      temp.cleanup();
    }
  });

  it('reads cached pricing correctly', () => {
    const temp = createTempCachePath();
    const cachedPricing = [makePricing('openai', Date.now())];
    const cache = new PricingCache(temp.cachePath);

    try {
      cache.write(cachedPricing);

      expect(cache.read()).toEqual(cachedPricing);

      const scraper = new PricingScraper({ cachePath: temp.cachePath, ttlMs });
      expect(scraper.getCachedPricing()).toEqual(cachedPricing);
    } finally {
      temp.cleanup();
    }
  });

  it('reports expired cache as needing refresh', () => {
    const temp = createTempCachePath();
    const expiredAt = Date.now() - ttlMs - 1;

    try {
      writeFileSync(temp.cachePath, JSON.stringify([makePricing('openai', expiredAt)]), 'utf8');

      const scraper = new PricingScraper({ cachePath: temp.cachePath, ttlMs });

      expect(scraper.isCacheExpired()).toBe(true);
    } finally {
      temp.cleanup();
    }
  });

  it('reports fresh cache as not needing refresh', () => {
    const temp = createTempCachePath();

    try {
      writeFileSync(temp.cachePath, JSON.stringify([makePricing('openai', Date.now())]), 'utf8');

      const scraper = new PricingScraper({ cachePath: temp.cachePath, ttlMs });

      expect(scraper.isCacheExpired()).toBe(false);
    } finally {
      temp.cleanup();
    }
  });

  it('caches scrape results after a successful scrape', async () => {
    const temp = createTempCachePath();
    mockFetchWithHtml(
      '<html><body><section>gpt-4.1 input $3.00 / 1M tokens output $9.00 / 1M tokens</section></body></html>',
    );

    try {
      const scraper = new PricingScraper({ cachePath: temp.cachePath, ttlMs });
      const result = await scraper.scrapeProvider('openai');
      const cached = JSON.parse(readFileSync(temp.cachePath, 'utf8')) as ScrapedPricing[];

      expect(result.provider).toBe('openai');
      expect(result.models).toContainEqual({
        model: 'gpt-4.1',
        inputPricePer1kTokens: 0.003,
        outputPricePer1kTokens: 0.009,
      });
      expect(cached).toEqual([result]);
    } finally {
      temp.cleanup();
    }
  });

  it('refreshes expired cache by scraping all providers', async () => {
    const temp = createTempCachePath();
    mockFetchWithHtml('<html><body>No usable pricing table here</body></html>');

    try {
      writeFileSync(temp.cachePath, JSON.stringify([makePricing('openai', Date.now() - ttlMs - 1)]), 'utf8');

      const scraper = new PricingScraper({ cachePath: temp.cachePath, ttlMs });
      await scraper.refreshIfNeeded();

      const cached = JSON.parse(readFileSync(temp.cachePath, 'utf8')) as ScrapedPricing[];

      expect(cached.map((entry) => entry.provider).sort()).toEqual(['azure', 'deepseek', 'openai']);
      expect(cached.every((entry) => entry.scrapedAt > Date.now() - 5000)).toBe(true);
      expect(globalThis.fetch).toHaveBeenCalledTimes(3);
    } finally {
      temp.cleanup();
    }
  });
});

function createTempCachePath(): { cachePath: string; cleanup: () => void } {
  const directory = mkdtempSync(join(tmpdir(), 'usage-tracker-pricing-'));

  return {
    cachePath: join(directory, 'pricing.json'),
    cleanup: () => rmSync(directory, { force: true, recursive: true }),
  };
}

function makePricing(provider: string, scrapedAt: number): ScrapedPricing {
  return {
    provider,
    scrapedAt,
    expiresAt: scrapedAt + ttlMs,
    models: [{ model: `${provider}-model`, inputPricePer1kTokens: 0.001, outputPricePer1kTokens: 0.002 }],
  };
}

function mockFetchWithHtml(html: string): void {
  const response = new Response(html, {
    status: 200,
    headers: { 'content-type': 'text/html' },
  });

  globalThis.fetch = vi.fn(async () => response.clone());
}

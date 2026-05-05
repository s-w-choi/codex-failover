import type { ScrapedPricing } from '../pricing-scraper.js';

type ModelPricing = ScrapedPricing['models'][number];

const PRICE_PATTERN = /\$\s*([0-9]+(?:\.[0-9]+)?)/g;

export async function fetchHtml(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
      'user-agent': 'codex-failover-usage-tracker/0.1',
    },
  });

  if (!response.ok) {
    throw new Error(`Pricing page request failed: ${response.status}`);
  }

  return response.text();
}

export function buildPricing(provider: string, models: ModelPricing[], ttlMs: number): ScrapedPricing {
  const now = Date.now();

  return {
    provider,
    scrapedAt: now,
    expiresAt: now + ttlMs,
    models,
  };
}

export function parseKnownModelsFromHtml(html: string, knownModels: readonly string[]): ModelPricing[] {
  const text = decodeHtml(stripTags(html));
  const results: ModelPricing[] = [];

  for (const model of knownModels) {
    const index = text.toLowerCase().indexOf(model.toLowerCase());

    if (index === -1) {
      continue;
    }

    const window = text.slice(index, index + 800);
    const prices = extractPrices(window);

    if (prices.length >= 2) {
      results.push({
        model,
        inputPricePer1kTokens: normalizePer1k(prices[0], window),
        outputPricePer1kTokens: normalizePer1k(prices[1], window),
      });
    }
  }

  return dedupeModels(results);
}

export function pricingOrFallback(
  provider: string,
  parsedModels: ModelPricing[],
  ttlMs: number,
  cached: ScrapedPricing | undefined,
  fallback: ScrapedPricing,
): ScrapedPricing {
  if (parsedModels.length > 0) {
    return buildPricing(provider, parsedModels, ttlMs);
  }

  if (cached && cached.models.length > 0) {
    return buildPricing(provider, cached.models.map((model) => ({ ...model })), ttlMs);
  }

  return buildPricing(provider, fallback.models.map((model) => ({ ...model })), ttlMs);
}

function stripTags(html: string): string {
  return html.replace(/<script\b[^>]*>/gi, ' ').replace(/<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ');
}

function decodeHtml(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function extractPrices(text: string): number[] {
  const prices: number[] = [];

  for (const match of text.matchAll(PRICE_PATTERN)) {
    const price = Number(match[1]);

    if (Number.isFinite(price)) {
      prices.push(price);
    }
  }

  return prices;
}

function normalizePer1k(price: number, context: string): number {
  if (/1\s*(?:m|million)\s*tokens?/i.test(context)) {
    return price / 1000;
  }

  if (/1k|1\s*thousand/i.test(context)) {
    return price;
  }

  return price / 1000;
}

function dedupeModels(models: ModelPricing[]): ModelPricing[] {
  const seen = new Set<string>();
  const deduped: ModelPricing[] = [];

  for (const model of models) {
    if (!seen.has(model.model)) {
      seen.add(model.model);
      deduped.push(model);
    }
  }

  return deduped;
}

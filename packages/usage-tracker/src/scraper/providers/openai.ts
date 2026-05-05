import { FALLBACK_PRICES } from '../fallback-prices.js';
import type { ScrapedPricing } from '../pricing-scraper.js';
import { fetchHtml, parseKnownModelsFromHtml, pricingOrFallback } from './parser.js';

const OPENAI_PRICING_URL = 'https://openai.com/api/pricing/';
const OPENAI_MODELS = FALLBACK_PRICES.openai.models.map((model) => model.model);

export async function scrapeOpenAiPricing(
  ttlMs: number,
  cached?: ScrapedPricing,
): Promise<ScrapedPricing> {
  try {
    const html = await fetchHtml(OPENAI_PRICING_URL);
    const parsedModels = parseKnownModelsFromHtml(html, OPENAI_MODELS);
    return pricingOrFallback('openai', parsedModels, ttlMs, cached, FALLBACK_PRICES.openai);
  } catch {
    return pricingOrFallback('openai', [], ttlMs, cached, FALLBACK_PRICES.openai);
  }
}

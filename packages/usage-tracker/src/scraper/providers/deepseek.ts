import { FALLBACK_PRICES } from '../fallback-prices.js';
import type { ScrapedPricing } from '../pricing-scraper.js';
import { fetchHtml, parseKnownModelsFromHtml, pricingOrFallback } from './parser.js';

const DEEPSEEK_PRICING_URL = 'https://api.deepseek.com/pricing';
const DEEPSEEK_MODELS = FALLBACK_PRICES.deepseek.models.map((model) => model.model);

export async function scrapeDeepSeekPricing(
  ttlMs: number,
  cached?: ScrapedPricing,
): Promise<ScrapedPricing> {
  try {
    const html = await fetchHtml(DEEPSEEK_PRICING_URL);
    const parsedModels = parseKnownModelsFromHtml(html, DEEPSEEK_MODELS);
    return pricingOrFallback('deepseek', parsedModels, ttlMs, cached, FALLBACK_PRICES.deepseek);
  } catch {
    return pricingOrFallback('deepseek', [], ttlMs, cached, FALLBACK_PRICES.deepseek);
  }
}

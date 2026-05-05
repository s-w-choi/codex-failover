import { FALLBACK_PRICES } from '../fallback-prices.js';
import type { ScrapedPricing } from '../pricing-scraper.js';
import { fetchHtml, parseKnownModelsFromHtml, pricingOrFallback } from './parser.js';

const AZURE_PRICING_URL = 'https://azure.microsoft.com/en-us/pricing/details/cognitive-services/openai-service/';
const AZURE_MODELS = FALLBACK_PRICES.azure.models.map((model) => model.model);

export async function scrapeAzurePricing(ttlMs: number, cached?: ScrapedPricing): Promise<ScrapedPricing> {
  try {
    const html = await fetchHtml(AZURE_PRICING_URL);
    const parsedModels = parseKnownModelsFromHtml(html, AZURE_MODELS);
    return pricingOrFallback('azure', parsedModels, ttlMs, cached, FALLBACK_PRICES.azure);
  } catch {
    return pricingOrFallback('azure', [], ttlMs, cached, FALLBACK_PRICES.azure);
  }
}

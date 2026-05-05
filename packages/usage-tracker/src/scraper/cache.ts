import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ScrapedPricing } from './pricing-scraper.js';

export class PricingCache {
  constructor(private readonly cachePath: string) {}

  read(): ScrapedPricing[] {
    if (!existsSync(this.cachePath)) {
      return [];
    }

    try {
      const parsed: unknown = JSON.parse(readFileSync(this.cachePath, 'utf8'));

      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed.filter(isScrapedPricing);
    } catch {
      return [];
    }
  }

  write(pricing: ScrapedPricing[]): void {
    mkdirSync(dirname(this.cachePath), { recursive: true });
    writeFileSync(this.cachePath, `${JSON.stringify(pricing, null, 2)}\n`, 'utf8');
  }

  isExpired(ttlMs: number): boolean {
    const pricing = this.read();

    if (pricing.length === 0) {
      return true;
    }

    const now = Date.now();
    return pricing.some((entry) => entry.expiresAt <= now || entry.scrapedAt + ttlMs <= now);
  }

  clear(): void {
    if (existsSync(this.cachePath)) {
      rmSync(this.cachePath);
    }
  }
}

function isScrapedPricing(value: unknown): value is ScrapedPricing {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.provider === 'string' &&
    typeof value.scrapedAt === 'number' &&
    typeof value.expiresAt === 'number' &&
    Array.isArray(value.models) &&
    value.models.every(isModelPricing)
  );
}

function isModelPricing(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.model === 'string' &&
    typeof value.inputPricePer1kTokens === 'number' &&
    typeof value.outputPricePer1kTokens === 'number' &&
    optionalNumber(value.cachedInputPricePer1kTokens) &&
    optionalNumber(value.reasoningPricePer1kTokens)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function optionalNumber(value: unknown): boolean {
  return value === undefined || typeof value === 'number';
}

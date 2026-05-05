import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface ModelPricing {
  model: string;
  inputPricePer1kTokens: number;
  outputPricePer1kTokens: number;
  cachedInputPricePer1kTokens?: number;
}

export interface PricingProvider {
  getPricing(providerType: string, model: string): ModelPricing | undefined;
  refreshPricing(): Promise<void>;
}

type PricingCache = Record<string, Record<string, ModelPricing>>;

export class JsonFilePricingProvider implements PricingProvider {
  private cache: PricingCache = {};

  constructor(private readonly pricingPath: string = join(defaultUserDataDir(), 'pricing.json')) {
    this.loadCache();
  }

  getPricing(providerType: string, model: string): ModelPricing | undefined {
    return this.cache[providerType]?.[model] ?? this.cache.default?.[model];
  }

  async refreshPricing(): Promise<void> {
    this.loadCache();
  }

  private loadCache(): void {
    mkdirSync(dirname(this.pricingPath), { recursive: true });

    if (!existsSync(this.pricingPath)) {
      this.cache = {};
      return;
    }

    try {
      const parsed = JSON.parse(readFileSync(this.pricingPath, 'utf8')) as unknown;
      this.cache = parsePricingCache(parsed);
    } catch {
      this.cache = {};
    }
  }
}

function defaultUserDataDir(): string {
  return process.env.CODEX_FAILOVER_USER_DATA_DIR ?? process.env.XDG_DATA_HOME ?? join(homedir(), '.codex-failover');
}

function parsePricingCache(value: unknown): PricingCache {
  // Support both formats:
  // 1. ScrapedPricing[] format (written by PricingScraper): [{provider: 'openai', models: [...]}, ...]
  // 2. Legacy object format: {openai: {gpt-4: {...}}}
  if (Array.isArray(value)) {
    return parseScrapedPricingArray(value);
  }

  if (!isRecord(value)) {
    return {};
  }

  const cache: PricingCache = {};

  for (const [providerType, providerPricing] of Object.entries(value)) {
    if (!isRecord(providerPricing)) {
      continue;
    }

    const modelPricing: Record<string, ModelPricing> = {};

    for (const [model, pricing] of Object.entries(providerPricing)) {
      const parsedPricing = parseModelPricing(model, pricing);

      if (parsedPricing !== undefined) {
        modelPricing[model] = parsedPricing;
      }
    }

    cache[providerType] = modelPricing;
  }

  return cache;
}

function parseScrapedPricingArray(value: unknown[]): PricingCache {
  const cache: PricingCache = {};

  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.provider !== 'string' || !Array.isArray(entry.models)) {
      continue;
    }

    const modelPricing: Record<string, ModelPricing> = {};

    for (const modelEntry of entry.models) {
      const parsed = parseModelPricingFromScraped(modelEntry);
      if (parsed !== undefined) {
        modelPricing[parsed.model] = parsed;
      }
    }

    if (Object.keys(modelPricing).length > 0) {
      cache[entry.provider] = modelPricing;
    }
  }

  return cache;
}

function parseModelPricingFromScraped(value: unknown): ModelPricing | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const model = typeof value.model === 'string' ? value.model : undefined;
  const inputPricePer1kTokens = value.inputPricePer1kTokens;
  const outputPricePer1kTokens = value.outputPricePer1kTokens;
  const cachedInputPricePer1kTokens = value.cachedInputPricePer1kTokens;

  if (model === undefined || typeof inputPricePer1kTokens !== 'number' || typeof outputPricePer1kTokens !== 'number') {
    return undefined;
  }

  return {
    model,
    inputPricePer1kTokens,
    outputPricePer1kTokens,
    ...(typeof cachedInputPricePer1kTokens === 'number' ? { cachedInputPricePer1kTokens } : {}),
  };
}

function parseModelPricing(model: string, value: unknown): ModelPricing | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const inputPricePer1kTokens = value.inputPricePer1kTokens;
  const outputPricePer1kTokens = value.outputPricePer1kTokens;
  const cachedInputPricePer1kTokens = value.cachedInputPricePer1kTokens;

  if (typeof inputPricePer1kTokens !== 'number' || typeof outputPricePer1kTokens !== 'number') {
    return undefined;
  }

  return {
    model: typeof value.model === 'string' ? value.model : model,
    inputPricePer1kTokens,
    outputPricePer1kTokens,
    ...(typeof cachedInputPricePer1kTokens === 'number' ? { cachedInputPricePer1kTokens } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

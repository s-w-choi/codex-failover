import { randomUUID } from 'node:crypto';

import type { PricingProvider } from './pricing-provider.js';
import type { UsageRecord, UsageStore } from './usage-store.js';

export interface ParsedUsage {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  reasoningTokens: number;
  totalTokens: number;
}

export class UsageRecorder {
  constructor(
    private readonly store: UsageStore,
    private readonly pricingProvider: PricingProvider,
  ) {}

  async recordFromResponse(providerId: string, response: Response): Promise<void> {
    const body = await readResponseJson(response);
    const usage = this.parseUsageFromBody(body);
    const model = readModelFromBody(body);
    const requestId = response.headers.get('x-request-id') ?? response.headers.get('openai-request-id') ?? '';

    if (model === undefined || usage.totalTokens === 0) {
      return;
    }

    const record: UsageRecord = {
      id: randomUUID(),
      providerId,
      model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cachedTokens: usage.cachedTokens,
      reasoningTokens: usage.reasoningTokens,
      totalTokens: usage.totalTokens,
      costUsd: this.calculateCostForProvider(providerId, model, usage),
      requestId,
      timestamp: Date.now(),
    };

    this.store.recordUsage(record);
  }

  parseUsageFromBody(body: unknown): ParsedUsage {
    if (!isRecord(body) || !isRecord(body.usage)) {
      return emptyUsage();
    }

    const usage = body.usage;
    const inputTokens = readNumber(usage.input_tokens) ?? readNumber(usage.prompt_tokens) ?? 0;
    const outputTokens = readNumber(usage.output_tokens) ?? readNumber(usage.completion_tokens) ?? 0;
    const totalTokens = readNumber(usage.total_tokens) ?? inputTokens + outputTokens;
    const cachedTokens = readNestedNumber(usage.input_tokens_details, 'cached_tokens') ?? readNestedNumber(usage.prompt_tokens_details, 'cached_tokens') ?? 0;
    const reasoningTokens = readNestedNumber(usage.output_tokens_details, 'reasoning_tokens') ?? readNestedNumber(usage.completion_tokens_details, 'reasoning_tokens') ?? 0;

    return { inputTokens, outputTokens, cachedTokens, reasoningTokens, totalTokens };
  }

  calculateCost(model: string, usage: ParsedUsage): number {
    return this.calculateCostForProvider('default', model, usage);
  }

  calculateCostForProvider(providerType: string, model: string, usage: ParsedUsage): number {
    if (usage.totalTokens === 0) {
      return 0;
    }

    const pricing = this.pricingProvider.getPricing(providerType, model);

    if (pricing === undefined) {
      return 0;
    }

    const billableInputTokens = Math.max(0, usage.inputTokens - usage.cachedTokens);
    const cachedInputPrice = pricing.cachedInputPricePer1kTokens ?? pricing.inputPricePer1kTokens;
    const inputCost = (billableInputTokens / 1000) * pricing.inputPricePer1kTokens;
    const cachedInputCost = (usage.cachedTokens / 1000) * cachedInputPrice;
    const outputCost = (usage.outputTokens / 1000) * pricing.outputPricePer1kTokens;

    return roundCost(inputCost + cachedInputCost + outputCost);
  }
}

async function readResponseJson(response: Response): Promise<unknown> {
  try {
    return await response.clone().json();
  } catch {
    return undefined;
  }
}

function readModelFromBody(body: unknown): string | undefined {
  if (!isRecord(body)) {
    return undefined;
  }

  return typeof body.model === 'string' ? body.model : undefined;
}

function readNestedNumber(value: unknown, key: string): number | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  return readNumber(value[key]);
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function emptyUsage(): ParsedUsage {
  return { inputTokens: 0, outputTokens: 0, cachedTokens: 0, reasoningTokens: 0, totalTokens: 0 };
}

function roundCost(cost: number): number {
  return Math.round(cost * 1_000_000_000) / 1_000_000_000;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

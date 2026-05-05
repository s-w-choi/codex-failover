import { randomUUID } from 'node:crypto';

import type { CredentialStore } from '@codex-failover/credential-store';
import type { CredentialRef, Provider } from '@codex-failover/shared';
import type { PricingProvider, UsageRecord, UsageStore } from '@codex-failover/usage-tracker';

import type { ProviderRegistry } from './provider-registry.js';

const DEFAULT_POLL_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_LOOKBACK_SECONDS = 24 * 60 * 60;
const OPENAI_USAGE_PROVIDER_TYPES = new Set<string>(['openai-api-key']);

interface UsagePollerOptions {
  pollIntervalMs?: number;
}

interface OpenAIUsageBucket {
  startTime: number;
  endTime: number;
  results: OpenAIUsageResult[];
}

interface OpenAIUsageResult {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  requestCount: number;
  model: string;
}

export class UsagePoller {
  private readonly pollIntervalMs: number;
  private readonly lastPolledByProvider = new Map<string, number>();
  private readonly recordedKeysByProvider = new Map<string, Set<string>>();
  private timerId: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private readonly registry: ProviderRegistry,
    private readonly credentialStore: CredentialStore,
    private readonly usageStore: UsageStore,
    private readonly pricingProvider: PricingProvider,
    options?: UsagePollerOptions,
  ) {
    this.pollIntervalMs = options?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  }

  start(): void {
    if (this.timerId !== null) {
      return;
    }

    void this.poll();
    this.timerId = setInterval(() => { void this.poll(); }, this.pollIntervalMs);
  }

  stop(): void {
    if (this.timerId === null) {
      return;
    }

    clearInterval(this.timerId);
    this.timerId = null;
  }

  async poll(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;
    try {
      const providers = this.registry.list().filter((provider) => provider.enabled);

      for (const provider of providers) {
        if (!OPENAI_USAGE_PROVIDER_TYPES.has(provider.type)) {
          continue;
        }

        await this.pollOpenAIProvider(provider);
      }
    } finally {
      this.running = false;
    }
  }

  private async pollOpenAIProvider(provider: Provider): Promise<void> {
    try {
      const apiKey = await this.retrieveApiKey(provider);

      if (apiKey === undefined) {
        return;
      }

      const startTime = this.lastPolledByProvider.get(provider.id) ?? currentUnixSeconds() - DEFAULT_LOOKBACK_SECONDS;
      const buckets = await this.fetchOpenAIUsage(provider, apiKey, startTime);
      let newestTimestamp = startTime;

      for (const bucket of buckets) {
        newestTimestamp = Math.max(newestTimestamp, bucket.endTime, bucket.startTime);

        for (const result of bucket.results) {
          this.recordBucketResult(provider.id, bucket.startTime, result);
        }
      }

      this.lastPolledByProvider.set(provider.id, newestTimestamp);
    } catch (error) {
      console.warn(`Usage polling failed for provider ${provider.id}: ${errorMessage(error)}`);
    }
  }

  private async retrieveApiKey(provider: Provider): Promise<string | undefined> {
    if (provider.credentialRef === undefined || !this.credentialStore.validateCredentialRef(provider.credentialRef)) {
      return undefined;
    }

    const result = await this.credentialStore.retrieve(provider.credentialRef as CredentialRef);

    return result.success ? result.credential : undefined;
  }

  private async fetchOpenAIUsage(provider: Provider, apiKey: string, startTime: number): Promise<OpenAIUsageBucket[]> {
    const url = new URL(`${trimTrailingSlash(provider.baseUrl)}/organization/usage/completions`);
    url.searchParams.set('start_time', Math.floor(startTime).toString());
    url.searchParams.set('bucket_width', '1h');
    url.searchParams.set('group_by', 'model');
    url.searchParams.set('limit', '24');

    const response = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });

    if (!response.ok) {
      throw new Error(`usage API returned ${response.status}`);
    }

    return parseOpenAIUsageResponse(await response.json());
  }

  private recordBucketResult(providerId: string, bucketStartTime: number, result: OpenAIUsageResult): void {
    const requestId = `polled:${bucketStartTime}`;
    const dedupeKey = `${requestId}:${result.model}`;

    if (this.hasRecorded(providerId, dedupeKey)) {
      return;
    }

    const usage = {
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      cachedTokens: result.cachedTokens,
      reasoningTokens: 0,
      totalTokens: result.inputTokens + result.outputTokens,
    };
    const record: UsageRecord = {
      id: randomUUID(),
      providerId,
      model: result.model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
      cachedTokens: usage.cachedTokens,
      reasoningTokens: usage.reasoningTokens,
      costUsd: this.calculateCost(providerId, result.model, usage),
      requestId,
      requestCount: result.requestCount,
      timestamp: bucketStartTime * 1000,
    };

    this.usageStore.recordUsage(record);
    this.markRecorded(providerId, dedupeKey);
  }

  private calculateCost(providerId: string, model: string, usage: { inputTokens: number; outputTokens: number; cachedTokens: number; totalTokens: number }): number {
    if (usage.totalTokens === 0) {
      return 0;
    }

    const pricing = this.pricingProvider.getPricing(providerId, model);

    if (pricing === undefined) {
      return 0;
    }

    const billableInputTokens = Math.max(0, usage.inputTokens - usage.cachedTokens);
    const cachedInputPrice = pricing.cachedInputPricePer1kTokens ?? pricing.inputPricePer1kTokens;
    const inputCost = (billableInputTokens / 1000) * pricing.inputPricePer1kTokens;
    const cachedInputCost = (usage.cachedTokens / 1000) * cachedInputPrice;
    const outputCost = (usage.outputTokens / 1000) * pricing.outputPricePer1kTokens;

    return Math.round((inputCost + cachedInputCost + outputCost) * 1_000_000_000) / 1_000_000_000;
  }

  private hasRecorded(providerId: string, dedupeKey: string): boolean {
    return this.recordedKeysByProvider.get(providerId)?.has(dedupeKey) ?? false;
  }

  private markRecorded(providerId: string, dedupeKey: string): void {
    const providerKeys = this.recordedKeysByProvider.get(providerId) ?? new Set<string>();
    providerKeys.add(dedupeKey);
    this.recordedKeysByProvider.set(providerId, providerKeys);
  }
}

function parseOpenAIUsageResponse(body: unknown): OpenAIUsageBucket[] {
  if (!isRecord(body) || !Array.isArray(body.data)) {
    return [];
  }

  return body.data.flatMap(parseOpenAIUsageBucket);
}

function parseOpenAIUsageBucket(value: unknown): OpenAIUsageBucket[] {
  if (!isRecord(value) || !Array.isArray(value.results)) {
    return [];
  }

  const startTime = readNumber(value.start_time);
  const endTime = readNumber(value.end_time);

  if (startTime === undefined || endTime === undefined) {
    return [];
  }

  return [{ startTime, endTime, results: value.results.flatMap(parseOpenAIUsageResult) }];
}

function parseOpenAIUsageResult(value: unknown): OpenAIUsageResult[] {
  if (!isRecord(value)) {
    return [];
  }

  const model = typeof value.model === 'string' ? value.model : undefined;
  const inputTokens = readNumber(value.input_tokens);
  const outputTokens = readNumber(value.output_tokens);
  const cachedTokens = readNumber(value.input_cached_tokens) ?? 0;
  const requestCount = readNumber(value.num_model_requests) ?? 1;

  if (model === undefined || inputTokens === undefined || outputTokens === undefined) {
    return [];
  }

  return [{ model, inputTokens, outputTokens, cachedTokens, requestCount }];
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function currentUnixSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { Provider } from '@codex-failover/shared';
import type { PricingProvider, UsageRecord, UsageStore } from '@codex-failover/usage-tracker';

import type { CodexSessionUsageReader, CodexSessionUsageSnapshot, CodexTokenUsage } from './codex-session-usage.js';
import { codexModelProviderNameForProvider } from './config-switcher.js';
import type { ProviderRegistry } from './provider-registry.js';

const DEFAULT_SAMPLE_INTERVAL_MS = 5 * 60 * 1000;
const TRACKED_PROVIDER_TYPES = new Set<string>(['openai-api-key', 'azure-openai-api-key', 'openai-compatible-api-key']);

export interface ActiveProviderReader {
  getActiveProvider(): string;
}

export interface ModelProviderReader {
  readModelProvider(): Promise<string | undefined>;
}

export interface CodexProviderUsageAccumulatorOptions {
  sampleIntervalMs?: number;
  statePath?: string;
  now?: () => Date;
}

export interface CodexProviderUsageSampleOptions {
  force?: boolean;
}

interface AccumulatorState {
  sessions: Record<string, SessionBaseline>;
}

interface SessionBaseline {
  providerId: string;
  total: CodexTokenUsage;
  updatedAt: string;
}

export class CodexProviderUsageAccumulator {
  private readonly sampleIntervalMs: number;
  private readonly now: () => Date;
  private timerId: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private stateLoaded = false;
  private state: AccumulatorState = { sessions: {} };

  constructor(
    private readonly registry: ProviderRegistry,
    private readonly activeProviderReader: ActiveProviderReader,
    private readonly modelProviderReader: ModelProviderReader,
    private readonly codexSessionUsageReader: CodexSessionUsageReader,
    private readonly usageStore: UsageStore,
    private readonly pricingProvider: PricingProvider,
    private readonly options: CodexProviderUsageAccumulatorOptions = {},
  ) {
    this.sampleIntervalMs = options.sampleIntervalMs ?? DEFAULT_SAMPLE_INTERVAL_MS;
    this.now = options.now ?? (() => new Date());
  }

  start(): void {
    if (this.timerId !== null) {
      return;
    }

    void this.sample();
    this.timerId = setInterval(() => { void this.sample(); }, this.sampleIntervalMs);
  }

  stop(): void {
    if (this.timerId === null) {
      return;
    }

    clearInterval(this.timerId);
    this.timerId = null;
  }

  async sample(options: CodexProviderUsageSampleOptions = {}): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;
    try {
      await this.loadStateIfNeeded();

      const snapshots = await this.readSnapshots(options);
      const configuredModelProvider = await this.modelProviderReader.readModelProvider();
      const activeProviderId = this.activeProviderReader.getActiveProvider();
      for (const snapshot of snapshots) {
        await this.sampleSnapshot(snapshot, configuredModelProvider, activeProviderId);
      }
    } catch (error) {
      console.warn(`Codex provider usage accumulation failed: ${errorMessage(error)}`);
    } finally {
      this.running = false;
    }
  }

  private async readSnapshots(options: CodexProviderUsageSampleOptions): Promise<CodexSessionUsageSnapshot[]> {
    if (this.codexSessionUsageReader.getRecentSnapshots) {
      return this.codexSessionUsageReader.getRecentSnapshots({ force: options.force });
    }

    const snapshot = options.force && this.codexSessionUsageReader.refresh
      ? await this.codexSessionUsageReader.refresh()
      : await this.codexSessionUsageReader.getLatestSnapshot();
    return snapshot ? [snapshot] : [];
  }

  private async sampleSnapshot(snapshot: CodexSessionUsageSnapshot, configuredModelProvider: string | undefined, activeProviderId: string): Promise<void> {
    const total = snapshot.usage?.total;
    if (!total) {
      return;
    }

    const sessionKey = snapshot.sessionId ?? 'latest';
    const sessionModelProvider = snapshot.modelProvider ?? configuredModelProvider;
    const provider = this.resolveProviderForModelProvider(sessionModelProvider, activeProviderId, snapshot.modelProvider === undefined);
    const previous = this.state.sessions[sessionKey];
    const delta = previous && (previous.providerId === provider?.id || snapshot.modelProvider === undefined)
      ? tokenUsageDelta(total, previous.total)
      : cloneTokenUsage(total);

    if (!provider || !TRACKED_PROVIDER_TYPES.has(provider.type)) {
      await this.saveBaseline(sessionKey, sessionModelProvider ?? 'codex-oauth', total, snapshot.updatedAt);
      return;
    }

    if (!previous) {
      await this.saveBaseline(sessionKey, provider.id, total, snapshot.updatedAt);
      return;
    }

    if (previous.providerId !== provider.id && snapshot.modelProvider !== undefined) {
      await this.saveBaseline(sessionKey, provider.id, total, snapshot.updatedAt);
      return;
    }

    if (this.hasObservedUsageForProviderOnDate(provider.id, snapshot.updatedAt)) {
      await this.saveBaseline(sessionKey, provider.id, total, snapshot.updatedAt);
      return;
    }

    if (delta && delta.totalTokens > 0) {
      this.usageStore.recordUsage(this.createUsageRecord(provider, sessionKey, snapshot.updatedAt, delta));
    }

    await this.saveBaseline(sessionKey, provider.id, total, snapshot.updatedAt);
  }

  private resolveProviderForModelProvider(modelProvider: string | undefined, activeProviderId: string, preferActiveProvider: boolean): Provider | undefined {
    if (!modelProvider) {
      return undefined;
    }

    const providers = this.registry.list().filter((provider) => TRACKED_PROVIDER_TYPES.has(provider.type));
    const exact = providers.find((provider) => codexModelProviderNameForProvider(provider) === modelProvider);
    if (exact) {
      return exact;
    }

    const activeProvider = preferActiveProvider && activeProviderId ? this.registry.get(activeProviderId) : undefined;
    if (activeProvider && TRACKED_PROVIDER_TYPES.has(activeProvider.type) && legacyCodexModelProviderMatches(activeProvider, modelProvider)) {
      return activeProvider;
    }

    const legacyMatches = providers.filter((provider) => legacyCodexModelProviderMatches(provider, modelProvider));
    return legacyMatches.length === 1 ? legacyMatches[0] : undefined;
  }

  private createUsageRecord(provider: Provider, sessionKey: string, updatedAt: string, usage: CodexTokenUsage): UsageRecord {
    const model = provider.deploymentName ?? provider.modelAlias.default ?? 'codex-session';
    return {
      id: randomUUID(),
      providerId: provider.id,
      model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cachedTokens: usage.cachedInputTokens,
      reasoningTokens: usage.reasoningOutputTokens,
      totalTokens: usage.totalTokens,
      costUsd: this.calculateCost(provider, model, usage),
      requestId: `codex-session:${sessionKey}:${updatedAt}`,
      requestCount: 0,
      timestamp: timestampMs(updatedAt, this.now),
    };
  }

  private calculateCost(provider: Provider, model: string, usage: CodexTokenUsage): number {
    if (usage.totalTokens === 0) {
      return 0;
    }

    const pricing = this.pricingProvider.getPricing(pricingProviderKey(provider), model);
    if (pricing === undefined) {
      return 0;
    }

    const billableInputTokens = Math.max(0, usage.inputTokens - usage.cachedInputTokens);
    const cachedInputPrice = pricing.cachedInputPricePer1kTokens ?? pricing.inputPricePer1kTokens;
    const inputCost = (billableInputTokens / 1000) * pricing.inputPricePer1kTokens;
    const cachedInputCost = (usage.cachedInputTokens / 1000) * cachedInputPrice;
    const outputCost = (usage.outputTokens / 1000) * pricing.outputPricePer1kTokens;

    return Math.round((inputCost + cachedInputCost + outputCost) * 1_000_000_000) / 1_000_000_000;
  }

  private hasObservedUsageForProviderOnDate(providerId: string, updatedAt: string): boolean {
    const today = new Date(timestampMs(updatedAt, this.now)).toISOString().slice(0, 10);
    return this.usageStore
      .getDailyUsage({ providerId, startDate: today, endDate: today })
      .some((entry) => entry.requestCount > 0);
  }

  private async saveBaseline(sessionKey: string, providerId: string, total: CodexTokenUsage, updatedAt: string): Promise<void> {
    this.state.sessions[sessionKey] = { providerId, total: cloneTokenUsage(total), updatedAt };
    await this.saveState();
  }

  private async loadStateIfNeeded(): Promise<void> {
    if (this.stateLoaded) {
      return;
    }

    this.stateLoaded = true;
    if (!this.options.statePath) {
      return;
    }

    const content = await readFile(this.options.statePath, 'utf8').catch(() => undefined);
    if (!content) {
      return;
    }

    try {
      this.state = parseState(JSON.parse(content));
    } catch {
      this.state = { sessions: {} };
    }
  }

  private async saveState(): Promise<void> {
    if (!this.options.statePath) {
      return;
    }

    await mkdir(dirname(this.options.statePath), { recursive: true });
    await writeFile(this.options.statePath, JSON.stringify(this.state, null, 2), 'utf8');
  }
}

function tokenUsageDelta(current: CodexTokenUsage, previous: CodexTokenUsage): CodexTokenUsage | undefined {
  if (current.totalTokens <= previous.totalTokens) {
    return undefined;
  }

  return {
    inputTokens: Math.max(0, current.inputTokens - previous.inputTokens),
    cachedInputTokens: Math.max(0, current.cachedInputTokens - previous.cachedInputTokens),
    outputTokens: Math.max(0, current.outputTokens - previous.outputTokens),
    reasoningOutputTokens: Math.max(0, current.reasoningOutputTokens - previous.reasoningOutputTokens),
    totalTokens: current.totalTokens - previous.totalTokens,
  };
}

function cloneTokenUsage(usage: CodexTokenUsage): CodexTokenUsage {
  return { ...usage };
}

function pricingProviderKey(provider: Provider): string {
  if (provider.type === 'azure-openai-api-key') {
    return 'azure';
  }
  if (provider.type === 'openai-api-key') {
    return 'openai';
  }
  return provider.id;
}

function legacyCodexModelProviderMatches(provider: Provider, modelProvider: string): boolean {
  return legacyCodexModelProvider(provider) === modelProvider;
}

function legacyCodexModelProvider(provider: Provider): string {
  if (provider.type === 'azure-openai-api-key') {
    return 'azure';
  }
  if (provider.type === 'openai-api-key') {
    return 'openai-api';
  }
  return 'custom';
}

function timestampMs(value: string, now: () => Date): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : now().getTime();
}

function parseState(value: unknown): AccumulatorState {
  if (!isRecord(value) || !isRecord(value.sessions)) {
    return { sessions: {} };
  }

  const sessions: Record<string, SessionBaseline> = {};
  for (const [key, session] of Object.entries(value.sessions)) {
    if (!isRecord(session) || typeof session.providerId !== 'string' || typeof session.updatedAt !== 'string') {
      continue;
    }
    const total = parseTokenUsage(session.total);
    if (!total) {
      continue;
    }
    sessions[key] = { providerId: session.providerId, updatedAt: session.updatedAt, total };
  }

  return { sessions };
}

function parseTokenUsage(value: unknown): CodexTokenUsage | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const inputTokens = readNumber(value.inputTokens);
  const cachedInputTokens = readNumber(value.cachedInputTokens);
  const outputTokens = readNumber(value.outputTokens);
  const reasoningOutputTokens = readNumber(value.reasoningOutputTokens);
  const totalTokens = readNumber(value.totalTokens);

  if (
    inputTokens === undefined
    || cachedInputTokens === undefined
    || outputTokens === undefined
    || reasoningOutputTokens === undefined
    || totalTokens === undefined
  ) {
    return undefined;
  }

  return { inputTokens, cachedInputTokens, outputTokens, reasoningOutputTokens, totalTokens };
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

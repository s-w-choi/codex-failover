import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type UsageRecord, UsageStore } from '../src/usage-store';

describe('UsageStore', () => {
  let tempDir: string;
  let store: UsageStore;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'usage-store-'));
    store = new UsageStore(join(tempDir, 'usage.sqlite'));
  });

  afterEach(() => {
    store.close();
    rmSync(tempDir, { force: true, recursive: true });
  });

  const createRecord = (overrides: Partial<UsageRecord> = {}): UsageRecord => ({
    id: 'usage-1',
    providerId: 'openai',
    model: 'gpt-4o',
    inputTokens: 100,
    outputTokens: 50,
    cachedTokens: 10,
    reasoningTokens: 5,
    totalTokens: 150,
    costUsd: 0.25,
    requestId: 'request-1',
    timestamp: Date.UTC(2026, 0, 15, 13, 30),
    ...overrides,
  });

  it('records usage and queries it back through daily aggregation', () => {
    store.recordUsage(createRecord());

    const dailyUsage = store.getDailyUsage({ startDate: '2026-01-15', endDate: '2026-01-15' });

    expect(dailyUsage).toEqual([
      {
        date: '2026-01-15',
        providerId: 'openai',
        model: 'gpt-4o',
        totalInputTokens: 100,
        totalOutputTokens: 50,
        totalCachedTokens: 10,
        totalReasoningTokens: 5,
        totalTokens: 150,
        estimatedCostUsd: 0.25,
        requestCount: 1,
      },
    ]);
  });

  it('aggregates daily usage by provider and model', () => {
    store.recordUsage(createRecord({ id: 'usage-1', costUsd: 0.25, inputTokens: 100, totalTokens: 150 }));
    store.recordUsage(createRecord({ id: 'usage-2', costUsd: 0.75, inputTokens: 200, totalTokens: 300 }));

    const dailyUsage = store.getDailyUsage({ providerId: 'openai', startDate: '2026-01-15', endDate: '2026-01-15' });

    expect(dailyUsage[0]).toMatchObject({
      totalInputTokens: 300,
      totalTokens: 450,
      estimatedCostUsd: 1,
      requestCount: 2,
    });
  });

  it('can record token-only local usage without increasing request count', () => {
    store.recordUsage(createRecord({ id: 'local-usage', requestCount: 0, totalTokens: 250 }));

    const dailyUsage = store.getDailyUsage({ providerId: 'openai', startDate: '2026-01-15', endDate: '2026-01-15' });

    expect(dailyUsage[0]).toMatchObject({ totalTokens: 250, requestCount: 0 });
  });

  it('aggregates hourly usage', () => {
    store.recordUsage(createRecord({ id: 'usage-1', timestamp: Date.UTC(2026, 0, 15, 9, 5) }));
    store.recordUsage(createRecord({ id: 'usage-2', timestamp: Date.UTC(2026, 0, 15, 9, 30) }));
    store.recordUsage(createRecord({ id: 'usage-3', timestamp: Date.UTC(2026, 0, 15, 10, 0), providerId: 'anthropic' }));

    const hourlyUsage = store.getHourlyUsage({ providerId: 'openai', date: '2026-01-15' });

    expect(hourlyUsage).toHaveLength(1);
    expect(hourlyUsage[0]).toMatchObject({ hour: 9, requestCount: 2, totalTokens: 300 });
  });

  it('returns provider summary for the requested window', () => {
    store.recordUsage(createRecord({ id: 'recent', costUsd: 0.5, totalTokens: 100, timestamp: Date.now() }));
    store.recordUsage(createRecord({ id: 'old', costUsd: 1, totalTokens: 200, timestamp: Date.now() - 5 * 24 * 60 * 60 * 1000 }));

    expect(store.getProviderSummary('openai', 1)).toEqual({ totalCost: 0.5, totalTokens: 100, requestCount: 1 });
  });

  it('returns usage totals within a rolling window', () => {
    store.recordUsage(createRecord({ id: 'usage-1', totalTokens: 100, timestamp: Date.now() - 30_000 }));
    store.recordUsage(createRecord({ id: 'usage-2', totalTokens: 250, timestamp: Date.now() - 10_000 }));
    store.recordUsage(createRecord({ id: 'usage-3', providerId: 'anthropic', totalTokens: 500, timestamp: Date.now() }));

    expect(store.getUsageInWindow('openai', 60_000)).toEqual({ requestCount: 2, totalTokens: 350 });
  });

  it('returns zero usage totals when records are outside the rolling window', () => {
    store.recordUsage(createRecord({ id: 'old', totalTokens: 100, timestamp: Date.now() - 60_000 }));

    expect(store.getUsageInWindow('openai', 1)).toEqual({ requestCount: 0, totalTokens: 0 });
  });

  it('returns daily cost for a provider', () => {
    store.recordUsage(createRecord({ id: 'usage-1', costUsd: 0.25, timestamp: Date.UTC(2026, 0, 15, 9, 0) }));
    store.recordUsage(createRecord({ id: 'usage-2', costUsd: 0.75, timestamp: Date.UTC(2026, 0, 15, 10, 0) }));
    store.recordUsage(createRecord({ id: 'usage-3', costUsd: 1, timestamp: Date.UTC(2026, 0, 16, 0, 0) }));

    expect(store.getDailyCost('openai', '2026-01-15')).toBe(1);
  });

  it('returns zero daily cost for a non-existent provider', () => {
    store.recordUsage(createRecord({ costUsd: 0.25, timestamp: Date.UTC(2026, 0, 15, 9, 0) }));

    expect(store.getDailyCost('missing-provider', '2026-01-15')).toBe(0);
  });

  it('returns overall summary grouped by provider', () => {
    store.recordUsage(createRecord({ id: 'usage-1', providerId: 'openai', costUsd: 0.5, totalTokens: 100, timestamp: Date.now() }));
    store.recordUsage(createRecord({ id: 'usage-2', providerId: 'anthropic', costUsd: 0.25, totalTokens: 50, timestamp: Date.now() }));

    expect(store.getOverallSummary(1)).toEqual({
      totalCost: 0.75,
      totalTokens: 150,
      requestCount: 2,
      byProvider: {
        anthropic: { totalCost: 0.25, totalTokens: 50 },
        openai: { totalCost: 0.5, totalTokens: 100 },
      },
    });
  });

  it('returns zero summaries for an empty database', () => {
    expect(store.getProviderSummary('openai', 7)).toEqual({ totalCost: 0, totalTokens: 0, requestCount: 0 });
    expect(store.getOverallSummary(7)).toEqual({ totalCost: 0, totalTokens: 0, requestCount: 0, byProvider: {} });
  });

  it('filters daily usage by date range', () => {
    store.recordUsage(createRecord({ id: 'inside', timestamp: Date.UTC(2026, 0, 15, 0, 0) }));
    store.recordUsage(createRecord({ id: 'outside', timestamp: Date.UTC(2026, 0, 16, 0, 0) }));

    const dailyUsage = store.getDailyUsage({ startDate: '2026-01-15', endDate: '2026-01-15' });

    expect(dailyUsage).toHaveLength(1);
    expect(dailyUsage[0]?.date).toBe('2026-01-15');
  });
});

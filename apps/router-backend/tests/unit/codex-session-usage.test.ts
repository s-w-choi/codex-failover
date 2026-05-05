import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { CodexSessionUsageService, parseSessionModelProviderLine, parseTokenCountLine } from '../../src/services/codex-session-usage.js';

describe('CodexSessionUsageService', () => {
  let tempDir: string | undefined;

  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it('parses token usage and limits from Codex token_count events', () => {
    const snapshot = parseTokenCountLine(JSON.stringify(tokenCountEvent({
      info: {
        total_token_usage: {
          input_tokens: 1_230_000,
          cached_input_tokens: 120_000,
          output_tokens: 78_500,
          reasoning_output_tokens: 12_000,
          total_tokens: 1_308_500,
        },
        last_token_usage: {
          input_tokens: 70_000,
          cached_input_tokens: 40_000,
          output_tokens: 1_500,
          reasoning_output_tokens: 500,
          total_tokens: 71_500,
        },
        model_context_window: 258_400,
      },
      rate_limits: {
        limit_id: 'codex',
        primary: { used_percent: 0, window_minutes: 300, resets_at: 1_777_929_810 },
        secondary: { used_percent: 87, window_minutes: 10080, resets_at: 1_777_959_043 },
        plan_type: 'pro',
      },
    })));

    expect(snapshot).toMatchObject({
      source: 'codex-session',
      usage: {
        total: { inputTokens: 1_230_000, outputTokens: 78_500, totalTokens: 1_308_500 },
        contextUsedTokens: 71_500,
        contextWindowTokens: 258_400,
        contextLeftPercent: 72,
      },
      limits: {
        available: true,
        limitId: 'codex',
        planType: 'pro',
        primary: { remainingPercent: 100, windowMinutes: 300 },
        secondary: { remainingPercent: 13, windowMinutes: 10080 },
      },
    });
  });

  it('marks limits unavailable when Codex records API-key usage without limit windows', () => {
    const snapshot = parseTokenCountLine(JSON.stringify(tokenCountEvent({
      info: {
        total_token_usage: {
          input_tokens: 100,
          cached_input_tokens: 0,
          output_tokens: 25,
          reasoning_output_tokens: 0,
          total_tokens: 125,
        },
        last_token_usage: {
          input_tokens: 100,
          cached_input_tokens: 0,
          output_tokens: 25,
          reasoning_output_tokens: 0,
          total_tokens: 125,
        },
        model_context_window: 1_000,
      },
      rate_limits: {
        limit_id: 'codex',
        primary: null,
        secondary: null,
        credits: null,
        plan_type: null,
      },
    })));

    expect(snapshot?.usage?.total.totalTokens).toBe(125);
    expect(snapshot?.limits).toEqual({ available: false, limitId: 'codex' });
  });

  it('parses the model provider from Codex session metadata', () => {
    const provider = parseSessionModelProviderLine(JSON.stringify({
      timestamp: '2026-05-04T16:25:56.360Z',
      type: 'session_meta',
      payload: { id: 'session-1', model_provider: 'codex-failover-azure-1' },
    }));

    expect(provider).toBe('codex-failover-azure-1');
  });

  it('reads the newest session file that has a token_count event', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'codex-session-usage-'));
    const sessionDir = join(tempDir, '2026', '05', '05');
    await mkdir(sessionDir, { recursive: true });

    const olderPath = join(sessionDir, 'rollout-2026-05-05T00-00-00-019df38d-94d0-7f03-9144-0c07e301030f.jsonl');
    const newerPath = join(sessionDir, 'rollout-2026-05-05T01-00-00-019df3cc-fc26-7a70-97da-0ee3fc011cce.jsonl');

    await writeFile(
      olderPath,
      `${JSON.stringify(sessionMetaEvent({ model_provider: 'azure' }))}\n${JSON.stringify(tokenCountEvent({
        timestamp: '2026-05-04T15:00:00.000Z',
        info: usageInfo(10),
      }))}\n`,
    );
    await writeFile(
      newerPath,
      `${JSON.stringify(sessionMetaEvent({ model_provider: 'openai-api' }))}\nnot json\n${JSON.stringify(tokenCountEvent({
        timestamp: '2026-05-04T16:00:00.000Z',
        info: usageInfo(250),
      }))}\n`,
    );
    await utimes(olderPath, new Date('2026-05-04T15:00:00.000Z'), new Date('2026-05-04T15:00:00.000Z'));
    await utimes(newerPath, new Date('2026-05-04T16:00:00.000Z'), new Date('2026-05-04T16:00:00.000Z'));

    const service = new CodexSessionUsageService(tempDir, { cacheTtlMs: 0 });

    await expect(service.getLatestSnapshot()).resolves.toMatchObject({
      sessionId: '019df3cc-fc26-7a70-97da-0ee3fc011cce',
      modelProvider: 'openai-api',
      updatedAt: '2026-05-04T16:00:00.000Z',
      usage: { total: { totalTokens: 250 } },
    });
  });

  it('reads recent snapshots with session model providers', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'codex-session-usage-'));
    const sessionDir = join(tempDir, '2026', '05', '05');
    await mkdir(sessionDir, { recursive: true });

    await writeFile(
      join(sessionDir, 'rollout-2026-05-05T00-00-00-019df38d-94d0-7f03-9144-0c07e301030f.jsonl'),
      `${JSON.stringify(sessionMetaEvent({ model_provider: 'azure' }))}\n${JSON.stringify(tokenCountEvent({
        timestamp: '2026-05-04T15:00:00.000Z',
        info: usageInfo(100),
      }))}\n`,
    );
    await writeFile(
      join(sessionDir, 'rollout-2026-05-05T01-00-00-019df3cc-fc26-7a70-97da-0ee3fc011cce.jsonl'),
      `${JSON.stringify(sessionMetaEvent({ model_provider: 'codex-failover-openai-1' }))}\n${JSON.stringify(tokenCountEvent({
        timestamp: '2026-05-04T16:00:00.000Z',
        info: usageInfo(250),
      }))}\n`,
    );

    const service = new CodexSessionUsageService(tempDir, { cacheTtlMs: 0 });

    await expect(service.getRecentSnapshots()).resolves.toMatchObject([
      { modelProvider: 'codex-failover-openai-1', usage: { total: { totalTokens: 250 } } },
      { modelProvider: 'azure', usage: { total: { totalTokens: 100 } } },
    ]);
  });

  it('starts a server interval for refreshing the cached snapshot', () => {
    const setIntervalSpy = vi.spyOn(global, 'setInterval');
    const service = new CodexSessionUsageService('/tmp/missing-codex-sessions', { refreshIntervalMs: 1_000 });

    service.start();

    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 1_000);
    service.stop();
  });
});

function tokenCountEvent(overrides: { timestamp?: string; info?: unknown; rate_limits?: unknown }) {
  return {
    timestamp: overrides.timestamp ?? '2026-05-04T16:25:56.360Z',
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: overrides.info,
      rate_limits: overrides.rate_limits ?? {
        limit_id: 'codex',
        primary: null,
        secondary: null,
      },
    },
  };
}

function sessionMetaEvent(payload: { model_provider?: string }) {
  return {
    timestamp: '2026-05-04T16:25:56.360Z',
    type: 'session_meta',
    payload: { id: 'session-1', ...payload },
  };
}

function usageInfo(totalTokens: number) {
  return {
    total_token_usage: {
      input_tokens: totalTokens - 10,
      cached_input_tokens: 0,
      output_tokens: 10,
      reasoning_output_tokens: 0,
      total_tokens: totalTokens,
    },
    last_token_usage: {
      input_tokens: totalTokens - 10,
      cached_input_tokens: 0,
      output_tokens: 10,
      reasoning_output_tokens: 0,
      total_tokens: totalTokens,
    },
    model_context_window: 1_000,
  };
}

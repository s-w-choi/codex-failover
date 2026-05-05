import { describe, expect, it } from 'vitest';
import { DEFAULTS } from '@codex-failover/shared';
import { calculateRemainingRatio, parseRateLimit, parseRateLimitInfo } from '../src/rate-limit-parser';

describe('parseRateLimit', () => {
  it('detects HTTP 429 as rate limit', () => {
    expect(parseRateLimit(429, new Headers(), {}).isRateLimited).toBe(true);
  });

  it('detects error.type rate_limit from body', () => {
    const result = parseRateLimit(400, new Headers(), { error: { type: 'rate_limit' } });

    expect(result).toMatchObject({ isRateLimited: true, reason: 'rate_limit', source: 'error-body' });
  });

  it('detects error.type insufficient_quota from body', () => {
    const result = parseRateLimit(400, new Headers(), { error: { type: 'insufficient_quota' } });

    expect(result).toMatchObject({ isRateLimited: true, reason: 'insufficient_quota', source: 'error-body' });
  });

  it('detects error.code rate_limit_exceeded from body', () => {
    const result = parseRateLimit(400, new Headers(), { error: { code: 'rate_limit_exceeded' } });

    expect(result).toMatchObject({ isRateLimited: true, reason: 'rate_limit', source: 'error-body' });
  });

  it('parses x-ratelimit-reset-requests header', () => {
    const resetTime = Date.now() + 4000;
    const result = parseRateLimit(429, new Headers({ 'x-ratelimit-reset-requests': String(resetTime) }), {});

    expect(result.source).toBe('response-header');
    expect(result.rateLimitInfo?.resetTime).toBe(resetTime);
    expect(result.cooldownMs).toBeGreaterThan(0);
  });

  it('parses retry-after header in seconds', () => {
    const result = parseRateLimit(429, new Headers({ 'retry-after': '7' }), {});

    expect(result).toMatchObject({ source: 'response-header', cooldownMs: 7000 });
    expect(result.rateLimitInfo?.retryAfterMs).toBe(7000);
  });

  it('calculates remainingRatio from headers', () => {
    const result = parseRateLimit(
      200,
      new Headers({ 'x-ratelimit-remaining-requests': '3', 'x-ratelimit-limit-requests': '100' }),
      {},
    );

    expect(result.rateLimitInfo?.remainingRatio).toBe(0.03);
  });

  it('calculates remaining ratio from rate limit info', () => {
    expect(calculateRemainingRatio({ remainingRequests: 1, requestLimit: 10 })).toBe(0.1);
  });

  it('returns default TTL when no headers are available', () => {
    const result = parseRateLimit(429, new Headers(), {});

    expect(result.cooldownMs).toBe(DEFAULTS.PRIMARY_COOLDOWN_TTL_MS);
  });

  it('returns source default when neither response headers nor error body identify the limit', () => {
    const result = parseRateLimit(429, new Headers(), {});

    expect(result.source).toBe('default');
  });
});

describe('parseRateLimitInfo', () => {
  it('parses fallback header x-ratelimit-remaining when x-ratelimit-remaining-requests is absent', () => {
    const info = parseRateLimitInfo(
      new Headers({ 'x-ratelimit-remaining': '5', 'x-ratelimit-limit': '100' }),
    );

    expect(info?.remainingRequests).toBe(5);
    expect(info?.requestLimit).toBe(100);
    expect(info?.remainingRatio).toBe(0.05);
  });

  it('prefers x-ratelimit-remaining-requests over x-ratelimit-remaining', () => {
    const info = parseRateLimitInfo(
      new Headers({
        'x-ratelimit-remaining-requests': '3',
        'x-ratelimit-limit-requests': '100',
        'x-ratelimit-remaining': '99',
        'x-ratelimit-limit': '100',
      }),
    );

    expect(info?.remainingRequests).toBe(3);
    expect(info?.requestLimit).toBe(100);
  });

  it('returns undefined when no rate limit headers are present', () => {
    expect(parseRateLimitInfo(new Headers())).toBeUndefined();
  });

  it('calculates ratio as min of request and token ratios', () => {
    const info = parseRateLimitInfo(
      new Headers({
        'x-ratelimit-remaining-requests': '50',
        'x-ratelimit-limit-requests': '100',
        'x-ratelimit-remaining-tokens': '1',
        'x-ratelimit-limit-tokens': '1000',
      }),
    );

    expect(info?.remainingRatio).toBe(0.001);
  });
});

describe('calculateRemainingRatio boundary conditions', () => {
  it('returns ratio below threshold (0.02) for proactive ratio check', () => {
    const ratio = calculateRemainingRatio({ remainingRequests: 2, requestLimit: 100 });
    expect(ratio).toBe(0.02);
    expect(ratio! < DEFAULTS.REMAINING_RATIO_THRESHOLD).toBe(true);
  });

  it('returns ratio above threshold (0.05) for proactive ratio check', () => {
    const ratio = calculateRemainingRatio({ remainingRequests: 5, requestLimit: 100 });
    expect(ratio).toBe(0.05);
    expect(ratio! >= DEFAULTS.REMAINING_RATIO_THRESHOLD).toBe(true);
  });

  it('returns undefined when no ratio headers are present', () => {
    expect(calculateRemainingRatio({})).toBeUndefined();
  });

  it('returns ratio exactly at threshold (0.03) — not skipped because threshold is < not <=', () => {
    const ratio = calculateRemainingRatio({ remainingRequests: 3, requestLimit: 100 });
    expect(ratio).toBe(0.03);
    expect(ratio! < DEFAULTS.REMAINING_RATIO_THRESHOLD).toBe(false);
  });
});

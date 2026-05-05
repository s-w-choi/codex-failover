import { describe, expect, it } from 'vitest';

import { RateLimitTracker } from '../src/rate-limit-tracker';

describe('RateLimitTracker', () => {
  it('parses all supported rate limit headers', () => {
    const tracker = new RateLimitTracker();

    tracker.updateFromHeaders(
      'openai',
      new Headers({
        'x-ratelimit-limit-requests': '100',
        'x-ratelimit-remaining-requests': '25',
        'x-ratelimit-limit-tokens': '1000',
        'x-ratelimit-remaining-tokens': '400',
        'x-ratelimit-reset-requests': '1s',
        'x-ratelimit-reset-tokens': '2s',
      }),
    );

    expect(tracker.getState('openai')).toMatchObject({
      providerId: 'openai',
      limitRequests: 100,
      remainingRequests: 25,
      limitTokens: 1000,
      remainingTokens: 400,
      resetRequests: '1s',
      resetTokens: '2s',
    });
  });

  it('calculates remaining ratio from request and token limits', () => {
    const tracker = new RateLimitTracker();

    tracker.updateFromHeaders(
      'openai',
      new Headers({
        'x-ratelimit-limit-requests': '100',
        'x-ratelimit-remaining-requests': '50',
        'x-ratelimit-limit-tokens': '1000',
        'x-ratelimit-remaining-tokens': '250',
      }),
    );

    expect(tracker.getRemainingRatio('openai')).toBe(0.25);
  });

  it('updates state from new headers', () => {
    const tracker = new RateLimitTracker();

    tracker.updateFromHeaders('openai', new Headers({ 'x-ratelimit-limit-requests': '100', 'x-ratelimit-remaining-requests': '50' }));
    tracker.updateFromHeaders('openai', new Headers({ 'x-ratelimit-limit-requests': '100', 'x-ratelimit-remaining-requests': '10' }));

    expect(tracker.getState('openai')?.remainingRequests).toBe(10);
    expect(tracker.getAllStates()).toHaveLength(1);
  });

  it('leaves state undefined when headers are missing', () => {
    const tracker = new RateLimitTracker();

    tracker.updateFromHeaders('openai', new Headers());

    expect(tracker.getState('openai')).toBeUndefined();
    expect(tracker.getRemainingRatio('openai')).toBe(1);
  });
});

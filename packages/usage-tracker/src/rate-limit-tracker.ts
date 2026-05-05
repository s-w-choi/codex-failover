export interface RateLimitState {
  providerId: string;
  limitRequests: number;
  remainingRequests: number;
  limitTokens: number;
  remainingTokens: number;
  resetRequests: string;
  resetTokens: string;
  timestamp: number;
}

const RATE_LIMIT_HEADERS = [
  'x-ratelimit-limit-requests',
  'x-ratelimit-remaining-requests',
  'x-ratelimit-limit-tokens',
  'x-ratelimit-remaining-tokens',
  'x-ratelimit-reset-requests',
  'x-ratelimit-reset-tokens',
] as const;

export class RateLimitTracker {
  private readonly states = new Map<string, RateLimitState>();

  updateFromHeaders(providerId: string, headers: Headers): void {
    if (!RATE_LIMIT_HEADERS.some((header) => headers.has(header))) {
      return;
    }

    const current = this.states.get(providerId);
    const state: RateLimitState = {
      providerId,
      limitRequests: parseNumberHeader(headers, 'x-ratelimit-limit-requests') ?? current?.limitRequests ?? 0,
      remainingRequests: parseNumberHeader(headers, 'x-ratelimit-remaining-requests') ?? current?.remainingRequests ?? 0,
      limitTokens: parseNumberHeader(headers, 'x-ratelimit-limit-tokens') ?? current?.limitTokens ?? 0,
      remainingTokens: parseNumberHeader(headers, 'x-ratelimit-remaining-tokens') ?? current?.remainingTokens ?? 0,
      resetRequests: headers.get('x-ratelimit-reset-requests') ?? current?.resetRequests ?? '',
      resetTokens: headers.get('x-ratelimit-reset-tokens') ?? current?.resetTokens ?? '',
      timestamp: Date.now(),
    };

    this.states.set(providerId, state);
  }

  getState(providerId: string): RateLimitState | undefined {
    return this.states.get(providerId);
  }

  getRemainingRatio(providerId: string): number {
    const state = this.states.get(providerId);

    if (state === undefined) {
      return 1;
    }

    const ratios = [
      state.limitRequests > 0 ? state.remainingRequests / state.limitRequests : undefined,
      state.limitTokens > 0 ? state.remainingTokens / state.limitTokens : undefined,
    ].filter((ratio): ratio is number => ratio !== undefined);

    if (ratios.length === 0) {
      return 1;
    }

    return Math.max(0, Math.min(1, ...ratios));
  }

  getAllStates(): RateLimitState[] {
    return [...this.states.values()];
  }
}

function parseNumberHeader(headers: Headers, name: string): number | undefined {
  const value = headers.get(name);

  if (value === null) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);

  return Number.isFinite(parsed) ? parsed : undefined;
}

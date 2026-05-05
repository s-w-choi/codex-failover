import type { CooldownReason } from './routing.js';

export interface RateLimitInfo {
  remainingRequests?: number;
  requestLimit?: number;
  remainingTokens?: number;
  tokenLimit?: number;
  remainingBudget?: number;
  budgetLimit?: number;
  resetTime?: number;
  retryAfterMs?: number;
  remainingRatio?: number;
}

export interface RateLimitParseResult {
  isRateLimited: boolean;
  cooldownMs: number;
  reason: CooldownReason;
  source: 'response-header' | 'error-body' | 'default';
  rateLimitInfo?: RateLimitInfo;
}

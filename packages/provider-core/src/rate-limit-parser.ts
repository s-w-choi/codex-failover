import { DEFAULTS, type CooldownReason, type RateLimitInfo, type RateLimitParseResult } from '@codex-failover/shared';

type ErrorBody = {
  error?: {
    type?: unknown;
    code?: unknown;
  };
};

function isErrorBody(body: unknown): body is ErrorBody {
  return typeof body === 'object' && body !== null && 'error' in body;
}

function numericHeader(headers: Headers, name: string): number | undefined {
  const value = headers.get(name);
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseRetryAfterMs(headers: Headers): number | undefined {
  const value = headers.get('retry-after');
  if (!value) {
    return undefined;
  }

  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000);
  }

  const dateTime = Date.parse(value);
  return Number.isFinite(dateTime) ? Math.max(0, dateTime - Date.now()) : undefined;
}

function parseResetTime(headers: Headers): number | undefined {
  const reset =
    numericHeader(headers, 'x-ratelimit-reset-requests') ??
    numericHeader(headers, 'x-ratelimit-reset-tokens') ??
    numericHeader(headers, 'x-ratelimit-reset');

  if (reset === undefined) {
    return undefined;
  }

  return reset < 10_000_000_000 ? reset * 1000 : reset;
}

export function parseRateLimitInfo(headers: Headers): RateLimitInfo | undefined {
  const info: RateLimitInfo = {
    remainingRequests:
      numericHeader(headers, 'x-ratelimit-remaining-requests') ??
      numericHeader(headers, 'x-ratelimit-remaining'),
    requestLimit:
      numericHeader(headers, 'x-ratelimit-limit-requests') ??
      numericHeader(headers, 'x-ratelimit-limit'),
    remainingTokens: numericHeader(headers, 'x-ratelimit-remaining-tokens'),
    tokenLimit: numericHeader(headers, 'x-ratelimit-limit-tokens'),
    remainingBudget: numericHeader(headers, 'x-ratelimit-remaining-budget'),
    budgetLimit: numericHeader(headers, 'x-ratelimit-limit-budget'),
    resetTime: parseResetTime(headers),
    retryAfterMs: parseRetryAfterMs(headers),
  };

  const remainingRatio = calculateRemainingRatio(info);
  const withRatio: RateLimitInfo = remainingRatio === undefined ? info : { ...info, remainingRatio };
  const hasValue = Object.values(withRatio).some((value) => value !== undefined);

  return hasValue ? withRatio : undefined;
}

function detectBodyReason(body: unknown): CooldownReason | undefined {
  if (!isErrorBody(body) || typeof body.error !== 'object' || body.error === null) {
    return undefined;
  }

  if (body.error.type === 'insufficient_quota') {
    return 'insufficient_quota';
  }

  if (body.error.type === 'rate_limit' || body.error.code === 'rate_limit_exceeded') {
    return 'rate_limit';
  }

  return undefined;
}

export function calculateRemainingRatio(info: RateLimitInfo): number | undefined {
  const ratios = [
    info.remainingRequests !== undefined && info.requestLimit ? info.remainingRequests / info.requestLimit : undefined,
    info.remainingTokens !== undefined && info.tokenLimit ? info.remainingTokens / info.tokenLimit : undefined,
    info.remainingBudget !== undefined && info.budgetLimit ? info.remainingBudget / info.budgetLimit : undefined,
  ].filter((ratio): ratio is number => ratio !== undefined && Number.isFinite(ratio));

  return ratios.length > 0 ? Math.min(...ratios) : undefined;
}

export function parseRateLimit(status: number, headers: Headers, body: unknown): RateLimitParseResult {
  const rateLimitInfo = parseRateLimitInfo(headers);
  const bodyReason = detectBodyReason(body);
  const headerCooldownMs = rateLimitInfo?.retryAfterMs ??
    (rateLimitInfo?.resetTime !== undefined ? Math.max(0, rateLimitInfo.resetTime - Date.now()) : undefined);
  const lowRemaining =
    rateLimitInfo?.remainingRatio !== undefined && rateLimitInfo.remainingRatio <= DEFAULTS.REMAINING_RATIO_THRESHOLD;
  const isRateLimited = status === 429 || bodyReason !== undefined || lowRemaining;

  let source: RateLimitParseResult['source'] = 'default';
  if (headerCooldownMs !== undefined) {
    source = 'response-header';
  } else if (bodyReason !== undefined) {
    source = 'error-body';
  }

  return {
    isRateLimited,
    cooldownMs: headerCooldownMs ?? DEFAULTS.PRIMARY_COOLDOWN_TTL_MS,
    reason: bodyReason ?? 'rate_limit',
    source,
    ...(rateLimitInfo ? { rateLimitInfo } : {}),
  };
}

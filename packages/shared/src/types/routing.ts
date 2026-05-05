import type { RouterError } from './errors.js';

export interface CooldownInfo {
  providerId: string;
  reason: CooldownReason;
  cooldownUntil: number;
  source: 'response-header' | 'default-ttl' | 'manual';
}

export type CooldownReason =
  | 'rate_limit'
  | 'insufficient_quota'
  | 'provider_error'
  | 'manual';

export type FallbackTrigger =
  | 'http_429'
  | 'rate_limit_error'
  | 'insufficient_quota'
  | 'provider_error'
  | 'proactive_ratio';

export interface RoutingDecision {
  providerId: string;
  sessionSticky: boolean;
  fallbackTrigger?: FallbackTrigger;
  modelRewrite: {
    incoming: string;
    outgoing: string;
  };
}

export interface RoutingError extends RouterError {}

export interface RoutingResult {
  success: boolean;
  providerId: string;
  response?: unknown;
  error?: RoutingError;
  fallbackUsed?: boolean;
}

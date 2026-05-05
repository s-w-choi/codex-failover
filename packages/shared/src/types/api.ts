import type { CodexAuthInfo, ProviderState } from './provider.js';
import type { CooldownInfo } from './routing.js';
import type { SessionKey, StickySession } from './session.js';

export interface StatusResponse {
  activeProviderId: string;
  providers: ProviderState[];
  cooldownStates: CooldownInfo[];
  uptime: number;
  codexInstalled?: boolean;
  codexAuth?: CodexAuthInfo;
}

export interface ProviderTestRequest {
  providerId: string;
  model?: string;
}

export interface ProviderTestResult {
  success: boolean;
  latencyMs: number;
  model?: string;
  error?: string;
}

export interface ReorderRequest {
  providerIds: string[];
}

export interface FallbackStateResponse {
  activeProviderId: string;
  isFallback: boolean;
  cooldownInfo?: CooldownInfo;
  stickySessions: StickySession[];
}

export interface ProxyRequestContext {
  incomingModel: string;
  authorizationHeader?: string;
  previousResponseId?: string;
  isStream: boolean;
  sessionKey?: SessionKey;
  requestBody: unknown;
}

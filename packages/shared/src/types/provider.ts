import type { CooldownInfo } from './routing.js';

export type ProviderType =
  | 'openai-oauth-pass-through'
  | 'openai-api-key'
  | 'azure-openai-api-key'
  | 'openai-compatible-api-key';

export type CredentialMode = 'inbound-authorization' | 'stored-api-key';

export type ModelAliasMap = Record<string, string>;

export interface ProviderLimits {
  maxRequestsPerMinute?: number;
  maxTokensPerMinute?: number;
  maxBudgetPerDay?: number;
}

export interface Provider {
  id: string;
  type: ProviderType;
  priority: number;
  baseUrl: string;
  credentialMode: CredentialMode;
  credentialRef?: string;
  enabled: boolean;
  modelAlias: ModelAliasMap;
  deploymentName?: string;
  region?: string;
  cooldownTtlMs?: number;
  authHeaderStyle?: 'bearer' | 'api-key' | 'x-api-key';
  limits?: ProviderLimits;
  accountId?: string;
  alias?: string;
}

export interface ProviderState extends Provider {
  status: 'active' | 'cooldown' | 'disabled';
  cooldown?: CooldownInfo;
}

export interface CodexAuthInfo {
  detected: boolean;
  authMode?: string;
  accountId?: string;
  email?: string;
  expiresAt?: number;
  isExpired?: boolean;
  hasApiKey?: boolean;
}

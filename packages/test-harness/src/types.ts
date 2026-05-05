export type HarnessProviderMode =
  | 'success'
  | 'always-rate-limited'
  | 'insufficient-quota'
  | 'fail-next-request'
  | 'recover-after-ms'
  | 'delayed-response'
  | 'malformed-json'
  | 'missing-rate-limit-headers'
  | 'stream-success'
  | 'stream-fail-before-first-byte'
  | 'stream-fail-after-first-byte'
  | 'stateful-response';

export type HarnessProviderType = 'mock-openai' | 'mock-azure' | 'mock-compatible';

export type HarnessAuthorizationType = 'bearer' | 'api-key' | 'none';

export interface HarnessRateLimitHeaders {
  remainingRequests: number;
  requestLimit: number;
  remainingTokens: number;
  tokenLimit: number;
  resetTime?: number;
}

export interface HarnessProviderState {
  id: string;
  type: HarnessProviderType;
  mode: HarnessProviderMode;
  requestCount: number;
  lastAuthorizationType?: HarnessAuthorizationType;
  lastModelSeen?: string;
  responseIds: Record<string, string>;
  failNextCount: number;
  recoverAt?: number;
  latencyMs: number;
  rateLimitHeaders?: HarnessRateLimitHeaders;
}

export interface HarnessState {
  providers: Record<string, HarnessProviderState>;
}

export interface HarnessConfig {
  openaiPort: number;
  azurePort: number;
  compatiblePort: number;
  harnessApiPort: number;
}

export interface HarnessInstance {
  config: HarnessConfig;
  state: HarnessState;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface HarnessProviderRequest {
  model?: unknown;
  stream?: unknown;
  previous_response_id?: unknown;
  input?: unknown;
}

export interface MockProviderOptions {
  id: string;
  type: HarnessProviderType;
  responsesPath: string;
  modelsPath: string;
  defaultModel: string;
  serviceName: string;
}

declare module '@codex-failover/credential-store' {
  import type { CredentialRef, CredentialStoreResult, RedactedLog } from '@codex-failover/shared';

  export interface KeychainBackend {
    getPassword(service: string, account: string): Promise<string | null>;
    setPassword(service: string, account: string, password: string): Promise<void>;
    deletePassword(service: string, account: string): Promise<boolean>;
  }

  export class CredentialStore {
    constructor(backend?: KeychainBackend);
    store(ref: CredentialRef, credential: string): Promise<CredentialStoreResult>;
    retrieve(ref: CredentialRef): Promise<CredentialStoreResult>;
    delete(ref: CredentialRef): Promise<CredentialStoreResult>;
    validateCredentialRef(ref: string): ref is CredentialRef;
    static isConfigSafe(config: Record<string, unknown>): boolean;
  }

  export class MemoryKeychainBackend implements KeychainBackend {
    getPassword(service: string, account: string): Promise<string | null>;
    setPassword(service: string, account: string, password: string): Promise<void>;
    deletePassword(service: string, account: string): Promise<boolean>;
  }

  export function redactAuthorizationHeader(header: string): string;
  export function redactSensitiveContent(content: string): RedactedLog;
}

declare module '@codex-failover/provider-core' {
  import type { CooldownInfo, Provider, ProxyRequestContext, RouterError, RoutingDecision } from '@codex-failover/shared';

  export interface ScoreWeights {
    costWeight: number;
    latencyWeight: number;
  }

  export interface ProviderScore {
    providerId: string;
    costScore: number;
    latencyScore: number;
    compositeScore: number;
    latencyEma: number;
  }

  export class ProviderScorer {
    updateLatency(providerId: string, latencyMs: number): void;
    score(providers: Provider[], pricing: Map<string, number>, weights: ScoreWeights): ProviderScore[];
  }

  export interface RoutingEngineScorerOptions {
    scorer: ProviderScorer;
    pricing: Map<string, number>;
    weights: ScoreWeights;
  }

  export class RoutingEngine {
    constructor(providers: Provider[], options?: RoutingEngineScorerOptions);
    route(ctx: ProxyRequestContext): RoutingDecision | RouterError;
    reportSuccess(providerId: string, responseId?: string, sessionId?: string, headers?: Headers, latencyMs?: number): void;
    reportFailure(providerId: string, status: number, headers: Headers, body: unknown): void;
    getActiveProvider(): string;
    getCooldownStates(): CooldownInfo[];
    resetState(): void;
  }
}

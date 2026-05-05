import type {
  HarnessConfig,
  HarnessProviderMode,
  HarnessProviderState,
  HarnessProviderType,
  HarnessRateLimitHeaders,
  HarnessState,
} from '../types.js';

const DEFAULT_RATE_LIMIT: HarnessRateLimitHeaders = {
  remainingRequests: 99,
  requestLimit: 100,
  remainingTokens: 99_000,
  tokenLimit: 100_000,
};

const PROVIDERS: Array<{ id: string; type: HarnessProviderType }> = [
  { id: 'openai', type: 'mock-openai' },
  { id: 'azure', type: 'mock-azure' },
  { id: 'compatible', type: 'mock-compatible' },
];

export const DEFAULT_HARNESS_CONFIG: HarnessConfig = {
  openaiPort: 8781,
  azurePort: 8782,
  compatiblePort: 8783,
  harnessApiPort: 8788,
};

export class StateManager {
  private state: HarnessState;

  constructor() {
    this.state = this.createInitialState();
  }

  get snapshot(): HarnessState {
    return {
      providers: Object.fromEntries(
        Object.entries(this.state.providers).map(([id, provider]) => [id, { ...provider, responseIds: { ...provider.responseIds } }]),
      ),
    };
  }

  getProvider(id: string): HarnessProviderState | undefined {
    return this.state.providers[id];
  }

  requireProvider(id: string): HarnessProviderState {
    const provider = this.getProvider(id);
    if (!provider) {
      throw new Error(`Unknown harness provider: ${id}`);
    }
    return provider;
  }

  reset(): HarnessState {
    this.state = this.createInitialState();
    return this.snapshot;
  }

  setMode(id: string, mode: HarnessProviderMode): HarnessProviderState {
    return this.updateProvider(id, (provider) => {
      provider.mode = mode;
      if (mode !== 'recover-after-ms') {
        delete provider.recoverAt;
      }
    });
  }

  failNext(id: string, count: number): HarnessProviderState {
    return this.updateProvider(id, (provider) => {
      provider.failNextCount = Math.max(0, Math.floor(count));
    });
  }

  recoverAfter(id: string, ms: number): HarnessProviderState {
    return this.updateProvider(id, (provider) => {
      provider.mode = 'recover-after-ms';
      provider.recoverAt = Date.now() + Math.max(0, Math.floor(ms));
    });
  }

  setLatency(id: string, latencyMs: number): HarnessProviderState {
    return this.updateProvider(id, (provider) => {
      provider.latencyMs = Math.max(0, Math.floor(latencyMs));
    });
  }

  setRateLimit(id: string, rateLimitHeaders: HarnessRateLimitHeaders): HarnessProviderState {
    return this.updateProvider(id, (provider) => {
      provider.rateLimitHeaders = { ...rateLimitHeaders };
    });
  }

  trackResponse(id: string, responseId: string): void {
    this.updateProvider(id, (provider) => {
      provider.responseIds[responseId] = provider.id;
    });
  }

  updateProvider(id: string, updater: (provider: HarnessProviderState) => void): HarnessProviderState {
    const provider = this.requireProvider(id);
    updater(provider);
    return { ...provider, responseIds: { ...provider.responseIds } };
  }

  private createInitialState(): HarnessState {
    return {
      providers: Object.fromEntries(PROVIDERS.map(({ id, type }) => [id, this.createProviderState(id, type)])),
    };
  }

  private createProviderState(id: string, type: HarnessProviderType): HarnessProviderState {
    return {
      id,
      type,
      mode: 'success',
      requestCount: 0,
      responseIds: {},
      failNextCount: 0,
      latencyMs: 0,
      rateLimitHeaders: { ...DEFAULT_RATE_LIMIT },
    };
  }
}

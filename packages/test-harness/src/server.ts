import { serve } from '@hono/node-server';

import { createHarnessApi } from './handlers/harness-api.js';
import { MockAzureProvider } from './providers/mock-azure.js';
import { MockCompatibleProvider } from './providers/mock-compatible.js';
import { MockOpenAIProvider } from './providers/mock-openai.js';
import type { HarnessConfig, HarnessInstance } from './types.js';
import { DEFAULT_HARNESS_CONFIG, StateManager } from './utils/state-manager.js';

type ServerHandle = ReturnType<typeof serve>;

export interface CreateHarnessOptions {
  config?: Partial<HarnessConfig>;
  stateManager?: StateManager;
}

export class TestHarness implements HarnessInstance {
  readonly config: HarnessConfig;
  readonly stateManager: StateManager;
  private servers: ServerHandle[] = [];

  constructor(options: CreateHarnessOptions = {}) {
    this.config = { ...DEFAULT_HARNESS_CONFIG, ...options.config };
    this.stateManager = options.stateManager ?? new StateManager();
  }

  get state() {
    return this.stateManager.snapshot;
  }

  async start(): Promise<void> {
    if (this.servers.length > 0) {
      return;
    }

    const openai = new MockOpenAIProvider(this.stateManager);
    const azure = new MockAzureProvider(this.stateManager);
    const compatible = new MockCompatibleProvider(this.stateManager);
    const harnessApi = createHarnessApi(this.stateManager);

    this.servers = [
      serve({ fetch: openai.app.fetch, port: this.config.openaiPort }),
      serve({ fetch: azure.app.fetch, port: this.config.azurePort }),
      serve({ fetch: compatible.app.fetch, port: this.config.compatiblePort }),
      serve({ fetch: harnessApi.fetch, port: this.config.harnessApiPort }),
    ];
  }

  async stop(): Promise<void> {
    const servers = this.servers;
    this.servers = [];
    await Promise.all(
      servers.map(
        (server) =>
          new Promise<void>((resolve, reject) => {
            server.close((error?: Error) => {
              if (error) {
                reject(error);
                return;
              }
              resolve();
            });
          }),
      ),
    );
  }
}

export function createHarness(options: CreateHarnessOptions = {}): TestHarness {
  return new TestHarness(options);
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): HarnessConfig {
  return {
    openaiPort: portFromEnv(env.HARNESS_OPENAI_PORT, DEFAULT_HARNESS_CONFIG.openaiPort),
    azurePort: portFromEnv(env.HARNESS_AZURE_PORT, DEFAULT_HARNESS_CONFIG.azurePort),
    compatiblePort: portFromEnv(env.HARNESS_COMPATIBLE_PORT, DEFAULT_HARNESS_CONFIG.compatiblePort),
    harnessApiPort: portFromEnv(env.HARNESS_API_PORT ?? env.HARNESS_PORT, DEFAULT_HARNESS_CONFIG.harnessApiPort),
  };
}

function portFromEnv(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const port = Number(value);
  return Number.isInteger(port) && port > 0 ? port : fallback;
}

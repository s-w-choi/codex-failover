import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CredentialStore } from '@codex-failover/credential-store';
import { DEFAULTS } from '@codex-failover/shared';
import { JsonFilePricingProvider, PricingScraper, RateLimitTracker, UsageRecorder, UsageStore } from '@codex-failover/usage-tracker';
import { serve } from '@hono/node-server';

import { createApp } from './app.js';
import { CodexSessionUsageService } from './services/codex-session-usage.js';
import { loadProvidersFromFile } from './utils/config-loader.js';
import { ensureUserDataDir } from './utils/user-data.js';

interface ServerRuntimeConfig {
  port: number;
  hostname: string;
  providersCount: number;
}

let _app: Awaited<ReturnType<typeof createServerApp>> | null = null;

export async function getApp(): Promise<Awaited<ReturnType<typeof createServerApp>>> {
  if (!_app) {
    _app = await createServerApp();
  }
  return _app;
}

export function getServerRuntimeConfig(providersCount = 0): ServerRuntimeConfig {
  return {
    port: Number(process.env.PORT ?? DEFAULTS.PORT),
    hostname: process.env.HOST ?? DEFAULTS.BIND_ADDRESS,
    providersCount,
  };
}

export async function startServer(): Promise<ServerRuntimeConfig> {
  const runtime = await getApp();
  const config = getServerRuntimeConfig(runtime.providersCount);

  const server = serve({
    fetch: runtime.app.fetch,
    port: config.port,
    hostname: config.hostname,
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\nPort ${config.port} is already in use.`);
      console.error('Another codex-failover instance is likely running.');
      console.error(`\nTo stop it: kill $(lsof -ti:${config.port})`);
      console.error('Then try again: codex-failover start\n');
      process.exit(1);
    }
    throw err;
  });

  runtime.healthScheduler.start();
  runtime.usagePoller?.start();
  runtime.codexSessionUsageService.start();
  runtime.codexProviderUsageAccumulator?.start();

  return config;
}

async function createServerApp() {
  const providers = process.env.CODEX_FAILOVER_PROVIDERS_FILE ? await loadProvidersFromFile(process.env.CODEX_FAILOVER_PROVIDERS_FILE) : [];
  const userDataDir = await ensureUserDataDir();
  const usageStore = new UsageStore(join(userDataDir, 'usage.db'));
  const rateLimitTracker = new RateLimitTracker();
  const pricingPath = join(userDataDir, 'pricing.json');
  const pricingScraper = new PricingScraper({ cachePath: pricingPath });
  const pricingProvider = new JsonFilePricingProvider(pricingPath);
  const usageRecorder = new UsageRecorder(usageStore, pricingProvider);
  const codexSessionUsageService = new CodexSessionUsageService();

  const { app, healthScheduler, usagePoller, codexProviderUsageAccumulator } = createApp({
    providers,
    credentialStore: new CredentialStore(),
    dashboard: {
      usageStore,
      rateLimitTracker,
      pricingScraper,
      pricingProvider,
      usageRecorder,
      codexSessionUsageService,
      codexProviderUsageStatePath: join(userDataDir, 'codex-provider-usage.json'),
    },
    persistencePath: join(userDataDir, 'providers.json'),
  });

  return {
    app,
    healthScheduler,
    usagePoller,
    codexProviderUsageAccumulator,
    codexSessionUsageService,
    providersCount: providers.filter((provider) => provider.enabled).length,
  };
}

if (process.env.NODE_ENV !== 'test' && isDirectExecution()) {
  startServer().then((config) => {
    console.log(`codex-failover listening on http://${config.hostname}:${config.port}`);
  }).catch((err) => {
    console.error('Failed to start server:', err.message);
    process.exit(1);
  });
}

function isDirectExecution(): boolean {
  return process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

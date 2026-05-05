export { createHarness, TestHarness, configFromEnv } from './server.js';
export { StateManager, DEFAULT_HARNESS_CONFIG } from './utils/state-manager.js';
export type {
  HarnessAuthorizationType,
  HarnessConfig,
  HarnessInstance,
  HarnessProviderMode,
  HarnessProviderState,
  HarnessProviderType,
  HarnessRateLimitHeaders,
  HarnessState,
} from './types.js';

import { configFromEnv, createHarness } from './server.js';

async function main(): Promise<void> {
  if (process.argv.includes('--reset')) {
    await resetRunningHarness();
    return;
  }

  const harness = createHarness({ config: configFromEnv() });
  await harness.start();

  const shutdown = async () => {
    await harness.stop();
    process.exit(0);
  };

  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
}

async function resetRunningHarness(): Promise<void> {
  const config = configFromEnv();
  try {
    await fetch(`http://127.0.0.1:${config.harnessApiPort}/harness/reset`, { method: 'POST' });
  } catch {
    // Reset is best-effort when the long-running harness is not started.
  }
}

if (process.env.NODE_ENV !== 'test') {
  void main();
}

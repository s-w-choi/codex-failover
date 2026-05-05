import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@codex-failover/shared': new URL('../../packages/shared/src/index.ts', import.meta.url).pathname,
      '@codex-failover/provider-core': new URL('../../packages/provider-core/src/index.ts', import.meta.url).pathname,
      '@codex-failover/credential-store': new URL('../../packages/credential-store/src/index.ts', import.meta.url).pathname,
      '@codex-failover/test-harness': new URL('../../packages/test-harness/src/index.ts', import.meta.url).pathname,
    },
  },
  test: {
    environment: 'node',
    fileParallelism: false,
    sequence: {
      concurrent: false,
    },
  },
});

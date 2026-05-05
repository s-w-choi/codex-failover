import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@codex-failover/shared': new URL('../shared/src/index.ts', import.meta.url).pathname,
    },
  },
  test: {
    environment: 'node',
  },
});

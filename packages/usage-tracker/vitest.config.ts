import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    server: {
      deps: {
        external: ['better-sqlite3', 'sqlite'],
      },
    },
    environment: 'node',
  },
});

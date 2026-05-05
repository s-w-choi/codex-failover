import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const providerModulePath = join(process.cwd(), 'src/types/provider.ts');

function compileTypeSnippet(source: string): void {
  const tempDir = mkdtempSync(join(tmpdir(), 'provider-schema-'));
  const sourcePath = join(tempDir, 'snippet.ts');

  try {
    writeFileSync(sourcePath, source);
    try {
      execFileSync(
        'pnpm',
        [
          'exec',
          'tsc',
          '--strict',
          '--module',
          'ESNext',
          '--moduleResolution',
          'bundler',
          '--target',
          'ES2022',
          '--noEmit',
          '--allowImportingTsExtensions',
          '--skipLibCheck',
          sourcePath,
        ],
        { stdio: 'pipe' },
      );
    } catch (error) {
      const output =
        error instanceof Error && 'stdout' in error && 'stderr' in error
          ? `${String(error.stdout)}${String(error.stderr)}`
          : String(error);
      throw new Error(output);
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

describe('Provider schema types', () => {
  it('parses a provider with limits correctly', () => {
    compileTypeSnippet(`
      import type { Provider, ProviderLimits } from '${providerModulePath}';

      const limits: ProviderLimits = {
        maxRequestsPerMinute: 60,
        maxTokensPerMinute: 120000,
        maxBudgetPerDay: 25,
      };

      const provider: Provider = {
        id: 'openai-primary',
        type: 'openai-api-key',
        priority: 1,
        baseUrl: 'https://api.openai.com/v1',
        credentialMode: 'stored-api-key',
        enabled: true,
        modelAlias: {},
        limits,
      };

      provider.limits?.maxRequestsPerMinute;
    `);

    expect(true).toBe(true);
  });

  it('parses a provider without limits for backward compatibility', () => {
    compileTypeSnippet(`
      import type { Provider } from '${providerModulePath}';

      const provider: Provider = {
        id: 'openai-secondary',
        type: 'openai-api-key',
        priority: 2,
        baseUrl: 'https://api.openai.com/v1',
        credentialMode: 'stored-api-key',
        enabled: true,
        modelAlias: {},
      };

      provider.id;
    `);

    expect(true).toBe(true);
  });
});

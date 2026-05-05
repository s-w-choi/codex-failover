import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { JsonFilePricingProvider } from '../src/pricing-provider';

describe('JsonFilePricingProvider', () => {
  let tempDir: string;
  let pricingPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'pricing-provider-'));
    pricingPath = join(tempDir, 'pricing.json');
  });

  afterEach(() => {
    rmSync(tempDir, { force: true, recursive: true });
  });

  it('reads provider-specific pricing from JSON cache', () => {
    writeFileSync(
      pricingPath,
      JSON.stringify({
        azure: {
          'gpt-4o': {
            inputPricePer1kTokens: 0.02,
            outputPricePer1kTokens: 0.04,
          },
        },
      }),
      'utf8',
    );

    const provider = new JsonFilePricingProvider(pricingPath);

    expect(provider.getPricing('azure', 'gpt-4o')).toEqual({
      model: 'gpt-4o',
      inputPricePer1kTokens: 0.02,
      outputPricePer1kTokens: 0.04,
    });
  });

  it('falls back to empty cache for malformed JSON', () => {
    writeFileSync(pricingPath, '{malformed', 'utf8');

    const provider = new JsonFilePricingProvider(pricingPath);

    expect(provider.getPricing('azure', 'gpt-4o')).toBeUndefined();
  });
});

import { describe, expect, it } from 'vitest';
import { ErrorCodes } from '@codex-failover/shared';
import { resolveModel } from '../src/model-mapper';
import { provider } from './test-helpers';

describe('resolveModel', () => {
  it('resolves incoming model via provider modelAlias map', () => {
    const result = resolveModel(
      provider({ id: 'primary', modelAlias: { 'gpt-5': 'gpt-4.1' } }),
      'gpt-5',
    );

    expect(result).toBe('gpt-4.1');
  });

  it('falls back to default key when exact match is not found', () => {
    const result = resolveModel(
      provider({ id: 'primary', modelAlias: { default: 'gpt-4o' } }),
      'unknown-model',
    );

    expect(result).toBe('gpt-4o');
  });

  it('uses Azure deploymentName when present', () => {
    const result = resolveModel(
      provider({
        id: 'azure',
        type: 'azure-openai-api-key',
        deploymentName: 'prod-gpt-4.1',
        modelAlias: { 'gpt-5': 'ignored-alias' },
      }),
      'gpt-5',
    );

    expect(result).toBe('prod-gpt-4.1');
  });

  it('returns MODEL_ALIAS_MISSING when no mapping exists', () => {
    const result = resolveModel(provider({ id: 'primary', modelAlias: {} }), 'gpt-5');

    expect(result).toMatchObject({
      code: ErrorCodes.MODEL_ALIAS_MISSING,
      providerId: 'primary',
    });
    expect(result).toBeInstanceOf(Error);
  });

  it('passes through incoming model when modelAlias value is passthrough', () => {
    const result = resolveModel(
      provider({
        id: 'oauth',
        type: 'openai-oauth-pass-through',
        credentialMode: 'inbound-authorization',
        modelAlias: { default: 'passthrough' },
      }),
      'gpt-5-codex',
    );

    expect(result).toBe('gpt-5-codex');
  });
});

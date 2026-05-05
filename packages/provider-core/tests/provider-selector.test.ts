import { describe, expect, it } from 'vitest';
import { ErrorCodes } from '@codex-failover/shared';
import { CooldownManager } from '../src/cooldown-manager';
import { selectNextProvider, selectProviders } from '../src/provider-selector';
import { provider } from './test-helpers';

describe('provider selector', () => {
  it('sorts providers by priority ascending', () => {
    const selected = selectProviders(
      [provider({ id: 'third', priority: 30 }), provider({ id: 'first', priority: 10 })],
      new CooldownManager(),
    );

    expect(selected.map((candidate) => candidate.id)).toEqual(['first', 'third']);
  });

  it('excludes disabled providers and respects enabled flag', () => {
    const selected = selectProviders(
      [provider({ id: 'disabled', enabled: false }), provider({ id: 'enabled', enabled: true })],
      new CooldownManager(),
    );

    expect(selected.map((candidate) => candidate.id)).toEqual(['enabled']);
  });

  it('excludes providers in active cooldown', () => {
    const manager = new CooldownManager();
    manager.setCooldown('primary', {
      providerId: 'primary',
      reason: 'rate_limit',
      cooldownUntil: Date.now() + 1000,
      source: 'manual',
    });

    const selected = selectProviders([provider({ id: 'primary' }), provider({ id: 'secondary' })], manager);

    expect(selected.map((candidate) => candidate.id)).toEqual(['secondary']);
  });

  it('includes providers whose cooldown has expired', () => {
    const manager = new CooldownManager();
    manager.setCooldown('primary', {
      providerId: 'primary',
      reason: 'rate_limit',
      cooldownUntil: Date.now() - 1,
      source: 'manual',
    });

    expect(selectProviders([provider({ id: 'primary' })], manager).map((candidate) => candidate.id)).toEqual([
      'primary',
    ]);
  });

  it('returns NO_AVAILABLE_PROVIDER error when all providers are excluded', () => {
    const selected = selectProviders([provider({ id: 'disabled', enabled: false })], new CooldownManager());

    expect(selected).toMatchObject({ code: ErrorCodes.NO_AVAILABLE_PROVIDER });
    expect(selected).toBeInstanceOf(Error);
  });

  it('selects next provider while excluding explicit ids', () => {
    const next = selectNextProvider(
      [provider({ id: 'primary', priority: 1 }), provider({ id: 'secondary', priority: 2 })],
      new CooldownManager(),
      ['primary'],
    );

    expect(next?.id).toBe('secondary');
  });
});

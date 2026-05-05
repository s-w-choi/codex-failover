import { describe, expect, it } from 'vitest';
import { DEFAULTS, type CooldownInfo } from '@codex-failover/shared';
import { CooldownManager } from '../src/cooldown-manager';
import { provider } from './test-helpers';

describe('CooldownManager', () => {
  it('sets cooldown with reason, until timestamp, and source', () => {
    const manager = new CooldownManager();
    const info: CooldownInfo = {
      providerId: 'primary',
      reason: 'rate_limit',
      cooldownUntil: Date.now() + 1000,
      source: 'manual',
    };

    manager.setCooldown('primary', info);

    expect(manager.getCooldown('primary')).toEqual(info);
  });

  it('returns true when provider is in active cooldown', () => {
    const manager = new CooldownManager();
    manager.setCooldown('primary', {
      providerId: 'primary',
      reason: 'rate_limit',
      cooldownUntil: Date.now() + 1000,
      source: 'manual',
    });

    expect(manager.isCoolingDown('primary')).toBe(true);
  });

  it('returns false when cooldown has expired', () => {
    const manager = new CooldownManager();
    manager.setCooldown('primary', {
      providerId: 'primary',
      reason: 'rate_limit',
      cooldownUntil: Date.now() - 1,
      source: 'manual',
    });

    expect(manager.isCoolingDown('primary')).toBe(false);
    expect(manager.getCooldown('primary')).toBeUndefined();
  });

  it('returns false when no cooldown exists', () => {
    expect(new CooldownManager().isCoolingDown('primary')).toBe(false);
  });

  it('resets cooldown on explicit clear', () => {
    const manager = new CooldownManager();
    manager.setCooldown('primary', {
      providerId: 'primary',
      reason: 'manual',
      cooldownUntil: Date.now() + 1000,
      source: 'manual',
    });

    manager.clearCooldown('primary');

    expect(manager.getCooldown('primary')).toBeUndefined();
  });

  it('calculates TTL from retry-after response header', () => {
    const ttl = new CooldownManager().calculateTtl(
      provider({ id: 'primary' }),
      new Headers({ 'retry-after': '3' }),
    );

    expect(ttl).toBe(3000);
  });

  it('calculates TTL from x-ratelimit-reset response header', () => {
    const resetAt = Date.now() + 5000;
    const ttl = new CooldownManager().calculateTtl(
      provider({ id: 'primary' }),
      new Headers({ 'x-ratelimit-reset': String(resetAt) }),
    );

    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(5000);
  });

  it('falls back to primary cooldown TTL for OAuth/OpenAI providers', () => {
    const manager = new CooldownManager();

    expect(manager.calculateTtl(provider({ id: 'oauth', type: 'openai-oauth-pass-through' }))).toBe(
      DEFAULTS.PRIMARY_COOLDOWN_TTL_MS,
    );
    expect(manager.calculateTtl(provider({ id: 'openai', type: 'openai-api-key' }))).toBe(
      DEFAULTS.PRIMARY_COOLDOWN_TTL_MS,
    );
  });

  it('falls back to provider cooldownTtlMs or Azure default for Azure', () => {
    const manager = new CooldownManager();

    expect(
      manager.calculateTtl(provider({ id: 'azure', type: 'azure-openai-api-key', cooldownTtlMs: 1234 })),
    ).toBe(1234);
    expect(manager.calculateTtl(provider({ id: 'azure', type: 'azure-openai-api-key' }))).toBe(
      DEFAULTS.AZURE_COOLDOWN_TTL_MS,
    );
  });

  it('keeps cooldown state ephemeral in an in-memory Map', () => {
    const manager = new CooldownManager();
    manager.setCooldown('primary', {
      providerId: 'primary',
      reason: 'manual',
      cooldownUntil: Date.now() + 1000,
      source: 'manual',
    });

    manager.resetAll();

    expect(manager.getCooldown('primary')).toBeUndefined();
  });
});

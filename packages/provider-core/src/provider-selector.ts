import { ErrorCodes, type Provider, type RouterError } from '@codex-failover/shared';
import type { CooldownManager } from './cooldown-manager.js';

function noAvailableProviderError(): RouterError {
  return Object.assign(new Error('No available provider candidates'), { code: ErrorCodes.NO_AVAILABLE_PROVIDER });
}

function enabledAndReady(providers: Provider[], cooldownManager: CooldownManager): Provider[] {
  return providers
    .filter((candidate) => candidate.enabled)
    .filter((candidate) => !cooldownManager.isCoolingDown(candidate.id))
    .sort((left, right) => left.priority - right.priority);
}

export function selectProviders(providers: Provider[], cooldownManager: CooldownManager): Provider[] | RouterError {
  const candidates = enabledAndReady(providers, cooldownManager);
  return candidates.length > 0 ? candidates : noAvailableProviderError();
}

export function selectNextProvider(
  providers: Provider[],
  cooldownManager: CooldownManager,
  excludeIds: string[],
): Provider | null {
  const excluded = new Set(excludeIds);
  return enabledAndReady(providers, cooldownManager).find((candidate) => !excluded.has(candidate.id)) ?? null;
}

import { DEFAULTS, type CooldownInfo, type Provider } from '@codex-failover/shared';
import { parseRateLimit } from './rate-limit-parser.js';

function ttlFromResetHeader(headers: Headers): number | undefined {
  const value = headers.get('x-ratelimit-reset') ?? headers.get('x-ratelimit-reset-requests');
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }

  const resetTime = parsed < 10_000_000_000 ? parsed * 1000 : parsed;
  return Math.max(0, resetTime - Date.now());
}

export class CooldownManager {
  private readonly cooldowns = new Map<string, CooldownInfo>();

  setCooldown(providerId: string, info: CooldownInfo): void {
    this.cooldowns.set(providerId, info);
  }

  isCoolingDown(providerId: string): boolean {
    return this.getCooldown(providerId) !== undefined;
  }

  getCooldown(providerId: string): CooldownInfo | undefined {
    const cooldown = this.cooldowns.get(providerId);
    if (!cooldown) {
      return undefined;
    }

    if (cooldown.cooldownUntil <= Date.now()) {
      this.cooldowns.delete(providerId);
      return undefined;
    }

    return cooldown;
  }

  clearCooldown(providerId: string): void {
    this.cooldowns.delete(providerId);
  }

  calculateTtl(provider: Provider, headers = new Headers(), errorBody?: unknown): number {
    const retryAfter = parseRateLimit(429, headers, errorBody).rateLimitInfo?.retryAfterMs;
    if (retryAfter !== undefined) {
      return retryAfter;
    }

    const resetTtl = ttlFromResetHeader(headers);
    if (resetTtl !== undefined) {
      return resetTtl;
    }

    if (provider.type === 'azure-openai-api-key') {
      return provider.cooldownTtlMs ?? DEFAULTS.AZURE_COOLDOWN_TTL_MS;
    }

    return provider.cooldownTtlMs ?? DEFAULTS.PRIMARY_COOLDOWN_TTL_MS;
  }

  resetAll(): void {
    this.cooldowns.clear();
  }

  getActiveCooldowns(): CooldownInfo[] {
    return Array.from(this.cooldowns.keys())
      .map((providerId) => this.getCooldown(providerId))
      .filter((cooldown): cooldown is CooldownInfo => cooldown !== undefined);
  }
}

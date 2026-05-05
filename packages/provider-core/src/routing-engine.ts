import {
  DEFAULTS,
  ErrorCodes,
  type CooldownInfo,
  type FallbackTrigger,
  type Provider,
  type ProxyRequestContext,
  type RouterError,
  type RoutingDecision,
} from '@codex-failover/shared';
import { CooldownManager } from './cooldown-manager.js';
import { resolveModel } from './model-mapper.js';
import { parseRateLimitInfo } from './rate-limit-parser.js';
import { parseRateLimit } from './rate-limit-parser.js';
import { type ProviderScorer, type ScoreWeights } from './provider-scorer.js';
import { selectProviders } from './provider-selector.js';
import { StickySessionManager } from './sticky-session-manager.js';

function routerError(code: RouterError['code'], message: string, providerId?: string): RouterError {
  return Object.assign(new Error(message), { code, ...(providerId ? { providerId } : {}) });
}

function isRouterError(value: unknown): value is RouterError {
  return value instanceof Error && 'code' in value;
}

function fallbackTrigger(status: number, body: unknown): FallbackTrigger {
  const parsed = parseRateLimit(status, new Headers(), body);
  if (status === 429) {
    return 'http_429';
  }
  if (parsed.reason === 'insufficient_quota') {
    return 'insufficient_quota';
  }
  if (parsed.isRateLimited) {
    return 'rate_limit_error';
  }
  return 'provider_error';
}

export interface RoutingEngineScorerOptions {
  scorer: ProviderScorer;
  pricing: Map<string, number>;
  weights: ScoreWeights;
}

export class RoutingEngine {
  private readonly providers: Provider[];
  private readonly cooldownManager = new CooldownManager();
  private readonly sessionManager = new StickySessionManager();
  private readonly providerRatios = new Map<string, number>();
  private readonly scorer?: ProviderScorer;
  private readonly pricing: Map<string, number>;
  private readonly weights: ScoreWeights;
  private activeProviderId: string;
  private latestFallbackTrigger: FallbackTrigger | undefined;

  constructor(providers: Provider[], options?: RoutingEngineScorerOptions) {
    this.providers = [...providers].sort((left, right) => left.priority - right.priority);
    this.activeProviderId = this.providers.find((p) => p.enabled)?.id ?? '';
    this.scorer = options?.scorer;
    this.pricing = options?.pricing ?? new Map();
    this.weights = options?.weights ?? { costWeight: 0, latencyWeight: 0 };
  }

  route(ctx: ProxyRequestContext): RoutingDecision | RouterError {
    const stickySession = ctx.sessionKey ? this.sessionManager.findSessionByKey(ctx.sessionKey) : undefined;
    const stickyProvider = stickySession
      ? this.providers.find((candidate) => candidate.id === stickySession.providerId && candidate.enabled)
      : undefined;
    const selected = stickyProvider ?? this.selectFirstAvailableProvider();

    if (isRouterError(selected)) {
      return selected;
    }

    if (!this.sessionManager.canFallback(ctx.previousResponseId, selected.id)) {
      return routerError(
        ErrorCodes.BLIND_FALLBACK_BLOCKED,
        `Cannot route previous response ${ctx.previousResponseId} to provider ${selected.id}`,
        selected.id,
      );
    }

    const outgoingModel = resolveModel(selected, ctx.incomingModel);
    if (isRouterError(outgoingModel)) {
      return outgoingModel;
    }

    if (ctx.sessionKey && !stickySession) {
      this.sessionManager.createSession(ctx.sessionKey, selected.id, true);
    }

    this.activeProviderId = selected.id;

    return {
      providerId: selected.id,
      sessionSticky: stickyProvider !== undefined,
      ...(this.latestFallbackTrigger && selected.id !== this.providers[0]?.id
        ? { fallbackTrigger: this.latestFallbackTrigger }
        : {}),
      modelRewrite: {
        incoming: ctx.incomingModel,
        outgoing: outgoingModel,
      },
    };
  }

  reportSuccess(providerId: string, responseId?: string, sessionId?: string, headers?: Headers, latencyMs?: number): void {
    this.activeProviderId = providerId;
    this.cooldownManager.clearCooldown(providerId);
    if (headers) {
      const info = parseRateLimitInfo(headers);
      if (info?.remainingRatio !== undefined) {
        this.providerRatios.set(providerId, info.remainingRatio);
      } else {
        this.providerRatios.delete(providerId);
      }
    }
    if (latencyMs !== undefined && this.scorer) {
      this.scorer.updateLatency(providerId, latencyMs);
    }
    if (responseId) {
      this.sessionManager.trackResponseOwnership(responseId, providerId, sessionId);
    }
  }

  reportFailure(providerId: string, status: number, headers: Headers, body: unknown): void {
    const provider = this.providers.find((candidate) => candidate.id === providerId);
    if (!provider) {
      return;
    }

    const parsed = parseRateLimit(status, headers, body);
    const shouldCooldown = parsed.isRateLimited || status >= 500;
    this.latestFallbackTrigger = fallbackTrigger(status, body);

    if (!shouldCooldown) {
      return;
    }

    const ttl = this.cooldownManager.calculateTtl(provider, headers, body);
    this.cooldownManager.setCooldown(providerId, {
      providerId,
      reason: parsed.reason,
      cooldownUntil: Date.now() + ttl,
      source: parsed.source === 'response-header' ? 'response-header' : 'default-ttl',
    });
  }

  getActiveProvider(): string {
    return this.activeProviderId;
  }

  getCooldownStates(): CooldownInfo[] {
    return this.cooldownManager.getActiveCooldowns();
  }

  resetState(): void {
    this.cooldownManager.resetAll();
    this.sessionManager.resetAll();
    this.providerRatios.clear();
    this.latestFallbackTrigger = undefined;
    this.activeProviderId = this.providers.find((p) => p.enabled)?.id ?? '';
  }

  private selectFirstAvailableProvider(): Provider | RouterError {
    const candidates = selectProviders(this.providers, this.cooldownManager);
    if (isRouterError(candidates)) {
      return candidates;
    }

    let ordered = this.applyRegionGroupOrder(candidates);

    if (this.scorer && (this.weights.costWeight + this.weights.latencyWeight > 0)) {
      ordered = this.applyScoreOrder(ordered);
    }

    const viable = ordered.filter((p) => {
      const ratio = this.providerRatios.get(p.id);
      return ratio === undefined || ratio >= DEFAULTS.REMAINING_RATIO_THRESHOLD;
    });

    if (viable.length === 0) {
      return ordered[0] ?? routerError(ErrorCodes.NO_AVAILABLE_PROVIDER, 'No available provider candidates');
    }

    if (viable[0].id !== ordered[0].id) {
      this.latestFallbackTrigger = 'proactive_ratio';
    }

    return viable[0];
  }

  private applyScoreOrder(candidates: Provider[]): Provider[] {
    if (!this.scorer) return candidates;

    const scores = this.scorer.score(candidates, this.pricing, this.weights);
    const scoreMap = new Map(scores.map((s) => [s.providerId, s.compositeScore]));

    const groups = new Map<number, Provider[]>();
    for (const p of candidates) {
      const group = groups.get(p.priority) ?? [];
      group.push(p);
      groups.set(p.priority, group);
    }

    const result: Provider[] = [];
    const sortedPriorities = Array.from(groups.keys()).sort((a, b) => a - b);
    for (const priority of sortedPriorities) {
      const group = groups.get(priority)!;
      group.sort((left, right) => {
        const leftScore = scoreMap.get(left.id) ?? Infinity;
        const rightScore = scoreMap.get(right.id) ?? Infinity;
        return leftScore - rightScore;
      });
      result.push(...group);
    }

    return result;
  }

  private applyRegionGroupOrder(candidates: Provider[]): Provider[] {
    const azureWithDeployment = this.providers.filter(
      (p) => p.type === 'azure-openai-api-key' && p.deploymentName,
    );
    if (azureWithDeployment.length < 2) {
      return candidates;
    }

    const deploymentGroups = new Map<string, Provider[]>();
    for (const p of azureWithDeployment) {
      const key = p.deploymentName!;
      const group = deploymentGroups.get(key);
      if (group) {
        group.push(p);
      } else {
        deploymentGroups.set(key, [p]);
      }
    }

    const groupBasePriority = new Map<string, number>();
    for (const [, group] of deploymentGroups) {
      if (group.length > 1) {
        const basePriority = Math.min(...group.map((p) => p.priority));
        for (const p of group) {
          groupBasePriority.set(p.id, basePriority);
        }
      }
    }

    if (groupBasePriority.size === 0) {
      return candidates;
    }

    return [...candidates].sort((left, right) => {
      const leftPos = groupBasePriority.get(left.id) ?? left.priority;
      const rightPos = groupBasePriority.get(right.id) ?? right.priority;
      if (leftPos !== rightPos) {
        return leftPos - rightPos;
      }
      return left.priority - right.priority;
    });
  }
}

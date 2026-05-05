import type { Provider } from '@codex-failover/shared';

export interface ScoreWeights {
  costWeight: number;
  latencyWeight: number;
}

export interface ProviderScore {
  providerId: string;
  costScore: number;
  latencyScore: number;
  compositeScore: number;
  latencyEma: number;
}

export class ProviderScorer {
  private readonly latencyEma = new Map<string, number>();
  private readonly emaAlpha = 0.3;

  updateLatency(providerId: string, latencyMs: number): void {
    const current = this.latencyEma.get(providerId) ?? latencyMs;
    this.latencyEma.set(providerId, this.emaAlpha * latencyMs + (1 - this.emaAlpha) * current);
  }

  score(providers: Provider[], pricing: Map<string, number>, weights: ScoreWeights): ProviderScore[] {
    if (weights.costWeight + weights.latencyWeight === 0) {
      return providers.map((p) => ({
        providerId: p.id,
        costScore: 0,
        latencyScore: 0,
        compositeScore: 0,
        latencyEma: this.latencyEma.get(p.id) ?? 0,
      }));
    }

    const maxCost = Math.max(...providers.map((p) => pricing.get(p.id) ?? Number.MAX_VALUE));
    const maxLatency = Math.max(...providers.map((p) => this.latencyEma.get(p.id) ?? 1));

    return providers.map((p) => {
      const cost = pricing.get(p.id);
      const costScore = cost === undefined ? 1 : cost / maxCost;
      const latency = this.latencyEma.get(p.id) ?? maxLatency;
      const latencyScore = latency / maxLatency;

      const totalWeight = weights.costWeight + weights.latencyWeight;
      const compositeScore =
        (weights.costWeight * costScore + weights.latencyWeight * latencyScore) / totalWeight;

      return {
        providerId: p.id,
        costScore,
        latencyScore,
        compositeScore,
        latencyEma: latency,
      };
    });
  }
}

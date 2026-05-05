import { describe, expect, it } from 'vitest';
import { RoutingEngine } from '../src/routing-engine';
import { ProviderScorer, type ScoreWeights } from '../src/provider-scorer';
import { provider } from './test-helpers';

describe('ProviderScorer', () => {
  const providers = [
    provider({ id: 'cheap-slow', priority: 1 }),
    provider({ id: 'expensive-fast', priority: 1 }),
  ];

  it('selects provider with better composite score when weights are equal', () => {
    const scorer = new ProviderScorer();
    scorer.updateLatency('cheap-slow', 500);
    scorer.updateLatency('expensive-fast', 100);

    const pricing = new Map<string, number>([
      ['cheap-slow', 0.01],
      ['expensive-fast', 0.02],
    ]);
    const weights: ScoreWeights = { costWeight: 0.5, latencyWeight: 0.5 };

    const engine = new RoutingEngine(providers, { scorer, pricing, weights });

    expect(engine.route({ incomingModel: 'gpt-5', isStream: false, requestBody: {} }).providerId).toBe('expensive-fast');
  });

  it('selects cheapest provider when cost weight is 1', () => {
    const scorer = new ProviderScorer();
    scorer.updateLatency('cheap-slow', 500);
    scorer.updateLatency('expensive-fast', 100);

    const pricing = new Map<string, number>([
      ['cheap-slow', 0.01],
      ['expensive-fast', 0.02],
    ]);
    const weights: ScoreWeights = { costWeight: 1.0, latencyWeight: 0 };

    const engine = new RoutingEngine(providers, { scorer, pricing, weights });

    expect(engine.route({ incomingModel: 'gpt-5', isStream: false, requestBody: {} }).providerId).toBe('cheap-slow');
  });

  it('preserves priority order when weights sum to 0', () => {
    const scorer = new ProviderScorer();
    scorer.updateLatency('cheap-slow', 500);
    scorer.updateLatency('expensive-fast', 100);

    const pricing = new Map<string, number>([
      ['cheap-slow', 0.01],
      ['expensive-fast', 0.02],
    ]);
    const weights: ScoreWeights = { costWeight: 0, latencyWeight: 0 };

    const engine = new RoutingEngine(providers, { scorer, pricing, weights });

    expect(engine.route({ incomingModel: 'gpt-5', isStream: false, requestBody: {} }).providerId).toBe('cheap-slow');
  });

  it('computes EMA latency correctly', () => {
    const scorer = new ProviderScorer();
    scorer.updateLatency('p1', 100);
    scorer.updateLatency('p1', 200);

    const expected = 0.3 * 200 + 0.7 * 100;
    const pricing = new Map<string, number>([
      ['p1', 1],
      ['p2', 2],
    ]);

    const scores = scorer.score(
      [provider({ id: 'p1', priority: 1 }), provider({ id: 'p2', priority: 1 })],
      pricing,
      { costWeight: 0.5, latencyWeight: 0.5 },
    );

    const p1Score = scores.find((s) => s.providerId === 'p1')!;
    expect(p1Score.latencyEma).toBeCloseTo(expected, 2);
  });

  it('treats missing pricing as worst cost', () => {
    const scorer = new ProviderScorer();
    scorer.updateLatency('has-price', 100);
    scorer.updateLatency('no-price', 100);

    const pricing = new Map<string, number>([
      ['has-price', 0.01],
    ]);
    const weights: ScoreWeights = { costWeight: 1.0, latencyWeight: 0 };

    const engine = new RoutingEngine(
      [provider({ id: 'no-price', priority: 1 }), provider({ id: 'has-price', priority: 1 })],
      { scorer, pricing, weights },
    );

    expect(engine.route({ incomingModel: 'gpt-5', isStream: false, requestBody: {} }).providerId).toBe('has-price');
  });

  it('reportSuccess updates scorer latency', () => {
    const scorer = new ProviderScorer();
    const engine = new RoutingEngine(
      [provider({ id: 'primary', priority: 1 })],
      { scorer, pricing: new Map(), weights: { costWeight: 0.5, latencyWeight: 0.5 } },
    );

    engine.reportSuccess('primary', undefined, undefined, undefined, 200);

    const scores = scorer.score(
      [provider({ id: 'primary', priority: 1 })],
      new Map(),
      { costWeight: 0.5, latencyWeight: 0.5 },
    );

    expect(scores[0].latencyEma).toBe(200);
  });

  it('preserves existing behavior when no scorer is provided', () => {
    const engine = new RoutingEngine([
      provider({ id: 'primary', priority: 1 }),
      provider({ id: 'secondary', priority: 2 }),
    ]);

    expect(engine.route({ incomingModel: 'gpt-5', isStream: false, requestBody: {} }).providerId).toBe('primary');
  });
});

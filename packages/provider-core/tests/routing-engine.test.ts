import { describe, expect, it } from 'vitest';
import { ErrorCodes } from '@codex-failover/shared';
import { RoutingEngine } from '../src/routing-engine';
import { context, provider } from './test-helpers';

describe('RoutingEngine', () => {
  const providers = [
    provider({ id: 'primary', priority: 1, modelAlias: { 'gpt-5': 'primary-model' } }),
    provider({ id: 'secondary', priority: 2, modelAlias: { 'gpt-5': 'secondary-model' } }),
    provider({ id: 'tertiary', priority: 3, modelAlias: { 'gpt-5': 'tertiary-model' } }),
  ];

  it('routes to primary provider when healthy', () => {
    const decision = new RoutingEngine(providers).route(context());

    expect(decision).toMatchObject({ providerId: 'primary', sessionSticky: false });
  });

  it('falls back to secondary when primary is rate limited', () => {
    const engine = new RoutingEngine(providers);
    engine.reportFailure('primary', 429, new Headers({ 'retry-after': '60' }), {});

    expect(engine.route(context())).toMatchObject({ providerId: 'secondary', fallbackTrigger: 'http_429' });
  });

  it('falls back to tertiary when primary and secondary are rate limited', () => {
    const engine = new RoutingEngine(providers);
    engine.reportFailure('primary', 429, new Headers({ 'retry-after': '60' }), {});
    engine.reportFailure('secondary', 429, new Headers({ 'retry-after': '60' }), {});

    expect(engine.route(context())).toMatchObject({ providerId: 'tertiary', fallbackTrigger: 'http_429' });
  });

  it('returns error when all providers are exhausted', () => {
    const engine = new RoutingEngine(providers);
    for (const candidate of providers) {
      engine.reportFailure(candidate.id, 429, new Headers({ 'retry-after': '60' }), {});
    }

    const decision = engine.route(context());

    expect(decision).toMatchObject({ code: ErrorCodes.NO_AVAILABLE_PROVIDER });
  });

  it('applies model mapping for each provider', () => {
    const engine = new RoutingEngine(providers);
    engine.reportFailure('primary', 429, new Headers({ 'retry-after': '60' }), {});

    expect(engine.route(context({ incomingModel: 'gpt-5' }))).toMatchObject({
      providerId: 'secondary',
      modelRewrite: { incoming: 'gpt-5', outgoing: 'secondary-model' },
    });
  });

  it('respects sticky sessions', () => {
    const engine = new RoutingEngine(providers);
    engine.route(context({ sessionKey: { sessionId: 's1' } }));
    engine.reportSuccess('primary', 'resp_1', 's1');
    engine.reportFailure('primary', 429, new Headers({ 'retry-after': '60' }), {});

    const decision = engine.route(context({ sessionKey: { sessionId: 's1' } }));

    expect(decision).toMatchObject({ providerId: 'primary', sessionSticky: true });
  });

  it('blocks blind fallback for stateful requests', () => {
    const engine = new RoutingEngine(providers);
    engine.reportSuccess('primary', 'resp_1', 's1');
    engine.reportFailure('primary', 429, new Headers({ 'retry-after': '60' }), {});

    const decision = engine.route(context({ previousResponseId: 'resp_1' }));

    expect(decision).toMatchObject({ code: ErrorCodes.BLIND_FALLBACK_BLOCKED });
  });

  it('allows fallback for stateless requests', () => {
    const engine = new RoutingEngine(providers);
    engine.reportFailure('primary', 429, new Headers({ 'retry-after': '60' }), {});

    expect(engine.route(context())).toMatchObject({ providerId: 'secondary' });
  });

  it('resets all cooldown and session state on restart', () => {
    const engine = new RoutingEngine(providers);
    engine.reportSuccess('primary', 'resp_1', 's1');
    engine.reportFailure('primary', 429, new Headers({ 'retry-after': '60' }), {});

    engine.resetState();

    expect(engine.getCooldownStates()).toEqual([]);
    expect(engine.route(context({ previousResponseId: 'resp_1' }))).toMatchObject({ providerId: 'primary' });
  });

  it('retries primary after cooldown expires', () => {
    const engine = new RoutingEngine(providers);
    engine.reportFailure('primary', 429, new Headers({ 'retry-after': '0' }), {});

    expect(engine.route(context())).toMatchObject({ providerId: 'primary' });
  });

  it('resumes using primary after primary recovery', () => {
    const engine = new RoutingEngine(providers);
    engine.reportFailure('primary', 429, new Headers({ 'retry-after': '0' }), {});
    engine.reportSuccess('primary');

    expect(engine.getActiveProvider()).toBe('primary');
    expect(engine.route(context())).toMatchObject({ providerId: 'primary' });
  });
});

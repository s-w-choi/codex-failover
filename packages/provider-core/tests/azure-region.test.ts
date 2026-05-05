import { describe, expect, it } from 'vitest';
import { RoutingEngine } from '../src/routing-engine';
import { context, provider } from './test-helpers';

function azureProvider(overrides: Parameters<typeof provider>[0] & { region?: string; deploymentName?: string }) {
  return provider({
    type: 'azure-openai-api-key',
    baseUrl: `https://${overrides.id}.openai.azure.com`,
    deploymentName: overrides.deploymentName ?? 'gpt-5',
    ...overrides,
  });
}

describe('Azure region failover', () => {
  it('falls back to secondary region in same deployment group before other providers', () => {
    const providers = [
      azureProvider({ id: 'azure-eastus', priority: 1, region: 'eastus', deploymentName: 'my-deploy' }),
      provider({ id: 'openai-primary', priority: 2, type: 'openai-api-key', modelAlias: { default: 'gpt-4.1' } }),
      azureProvider({ id: 'azure-westus', priority: 3, region: 'westus', deploymentName: 'my-deploy' }),
    ];

    const engine = new RoutingEngine(providers);
    expect(engine.route(context())).toMatchObject({ providerId: 'azure-eastus' });

    engine.reportFailure('azure-eastus', 429, new Headers({ 'retry-after': '60' }), {});

    expect(engine.route(context())).toMatchObject({ providerId: 'azure-westus', fallbackTrigger: 'http_429' });
  });

  it('falls back to next provider group when all regions in a deployment group are on cooldown', () => {
    const providers = [
      azureProvider({ id: 'azure-eastus', priority: 1, region: 'eastus', deploymentName: 'deploy-a' }),
      azureProvider({ id: 'azure-westus', priority: 2, region: 'westus', deploymentName: 'deploy-a' }),
      provider({ id: 'openai-fallback', priority: 3, type: 'openai-api-key', modelAlias: { default: 'gpt-4.1' } }),
    ];

    const engine = new RoutingEngine(providers);
    engine.reportFailure('azure-eastus', 429, new Headers({ 'retry-after': '60' }), {});
    engine.reportFailure('azure-westus', 429, new Headers({ 'retry-after': '60' }), {});

    expect(engine.route(context())).toMatchObject({ providerId: 'openai-fallback' });
  });

  it('works as before for single Azure provider without region', () => {
    const providers = [
      azureProvider({ id: 'azure-single', priority: 1 }),
      provider({ id: 'openai-backup', priority: 2, type: 'openai-api-key', modelAlias: { default: 'gpt-4.1' } }),
    ];

    const engine = new RoutingEngine(providers);
    expect(engine.route(context())).toMatchObject({ providerId: 'azure-single' });

    engine.reportFailure('azure-single', 429, new Headers({ 'retry-after': '60' }), {});
    expect(engine.route(context())).toMatchObject({ providerId: 'openai-backup' });
  });

  it('does not group non-Azure providers by deployment name', () => {
    const providers = [
      provider({ id: 'openai-a', priority: 1, type: 'openai-api-key', modelAlias: { default: 'gpt-4.1' }, deploymentName: 'shared' }),
      provider({ id: 'openai-b', priority: 2, type: 'openai-api-key', modelAlias: { default: 'gpt-4.1' }, deploymentName: 'shared' }),
    ];

    const engine = new RoutingEngine(providers);
    expect(engine.route(context())).toMatchObject({ providerId: 'openai-a' });

    engine.reportFailure('openai-a', 429, new Headers({ 'retry-after': '60' }), {});
    expect(engine.route(context())).toMatchObject({ providerId: 'openai-b' });
  });

  it('returns error when all providers including all region groups are on cooldown', () => {
    const providers = [
      azureProvider({ id: 'azure-eastus', priority: 1, region: 'eastus', deploymentName: 'deploy-a' }),
      azureProvider({ id: 'azure-westus', priority: 2, region: 'westus', deploymentName: 'deploy-a' }),
    ];

    const engine = new RoutingEngine(providers);
    engine.reportFailure('azure-eastus', 429, new Headers({ 'retry-after': '60' }), {});
    engine.reportFailure('azure-westus', 429, new Headers({ 'retry-after': '60' }), {});

    const decision = engine.route(context());
    expect(decision).toMatchObject({ code: 'NO_AVAILABLE_PROVIDER' });
  });

  it('orders providers within a region group by priority', () => {
    const providers = [
      azureProvider({ id: 'azure-westus', priority: 2, region: 'westus', deploymentName: 'deploy-a' }),
      azureProvider({ id: 'azure-eastus', priority: 1, region: 'eastus', deploymentName: 'deploy-a' }),
    ];

    const engine = new RoutingEngine(providers);
    expect(engine.route(context())).toMatchObject({ providerId: 'azure-eastus' });
  });
});

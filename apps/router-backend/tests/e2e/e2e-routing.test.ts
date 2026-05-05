import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  TEST_PROVIDERS,
  parseJson,
  readCodexConfig,
  request,
  resetE2EContext,
  sleep,
  startE2EContext,
  stopE2EContext,
  type E2EContext,
} from './helpers.js';
import { codexModelProviderNameForProvider } from '../../src/services/config-switcher.js';

describe('E2E routing: config-file based provider switching', () => {
  let context: E2EContext;

  beforeAll(async () => {
    context = await startE2EContext();
  });

  beforeEach(async () => {
    context = await resetE2EContext(context);
  });

  afterAll(async () => {
    await stopE2EContext(context);
  });

  it('does not expose the removed proxy route', async () => {
    const response = await request(context.app, 'POST', '/v1/responses', { body: { model: 'gpt-5.5' } });

    expect(response.status).toBe(404);
  });

  it('updates config.toml to the highest-priority healthy direct provider', async () => {
    const reorder = await request(context.app, 'POST', '/api/providers/reorder', {
      body: { providerIds: ['custom-api', 'oauth-primary', 'openai-api', 'azure-api'] },
    });
    expect(reorder.status).toBe(200);

    context.healthScheduler.start();
    await sleep(40);

    const status = await request(context.app, 'GET', '/api/status');
    expect(await parseJson<{ activeProviderId: string }>(status)).toMatchObject({ activeProviderId: 'custom-api' });
    const config = await readCodexConfig(context);
    const customProviderName = codexModelProviderNameForProvider(TEST_PROVIDERS.find((provider) => provider.id === 'custom-api')!);
    expect(config).toContain(`model_provider = "${customProviderName}"`);
    expect(config).toContain(`[model_providers.${customProviderName}]`);
    expect(config).toContain('base_url = "http://127.0.0.1:8783/v1"');
  });
});

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  readCodexConfig,
  resetE2EContext,
  setProviderMode,
  sleep,
  startE2EContext,
  stopE2EContext,
  type E2EContext,
} from './helpers.js';

describe('E2E OAuth config switching', () => {
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

  it('removes model provider config when OAuth pass-through is active', async () => {
    await context.codexConfigService.writeConfigForTest('model_provider = "azure"\nopenai_base_url = "http://127.0.0.1:8782/openai/v1"\n\n[model_providers.azure]\nname = "Azure OpenAI"\nbase_url = "http://127.0.0.1:8782/openai/v1"\n');
    await setProviderMode('openai', 'success');

    context.healthScheduler.start();
    await sleep(200);

    const config = await readCodexConfig(context);
    expect(config).not.toContain('model_provider');
    expect(config).not.toContain('[model_providers.azure]');
    expect(config).not.toContain('openai_base_url');
    expect(await context.credentialStore.retrieve('keychain://oauth-primary')).toMatchObject({ success: false });
  });
});

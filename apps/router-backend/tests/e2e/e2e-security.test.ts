import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  TEST_PROVIDERS,
  expectNoSecretLogs,
  request,
  resetE2EContext,
  startE2EContext,
  stopE2EContext,
  type E2EContext,
} from './helpers.js';

describe('E2E security', () => {
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

  it('keeps secrets out of provider config and admin logs', async () => {
    const serializedConfig = JSON.stringify(TEST_PROVIDERS);
    expect(serializedConfig).not.toContain('test-key-123');
    expect(serializedConfig).not.toContain('azure-test-key-123');
    expect(serializedConfig).not.toContain('custom-test-key-123');

    const reorder = await request(context.app, 'POST', '/api/providers/reorder', {
      body: { providerIds: ['custom-api', 'oauth-primary', 'openai-api', 'azure-api'] },
    });
    expect(reorder.status).toBe(200);

    expectNoSecretLogs(context.logs, ['test-key-123', 'azure-test-key-123', 'custom-test-key-123']);
  });
});

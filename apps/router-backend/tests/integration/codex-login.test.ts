import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestContext, stopTestContext, type TestContext } from '../helpers/test-setup.js';

import { CodexLoginService } from '../../src/services/codex-login-service.js';

function createMockExecAsync(responses: Array<{ stdout?: string; stderr?: string; error?: Error }>) {
  let callIndex = 0;
  return vi.fn(async (_command: string, _options?: { timeout?: number }) => { // eslint-disable-line @typescript-eslint/no-unused-vars
    const response = responses[callIndex++];
    if (callIndex > responses.length) {
      throw new Error('Unexpected extra exec call');
    }
    if (response.error) {
      throw response.error;
    }
    return { stdout: response.stdout ?? '', stderr: response.stderr ?? '' };
  });
}

describe('CodexLoginService', () => {
  let context: TestContext;

  beforeEach(async () => {
    context = await createTestContext();
  });

  afterEach(async () => {
    await stopTestContext(context);
  });

  it('execute() returns success on codex login', async () => {
    const mockExec = createMockExecAsync([{ stdout: 'Login successful.' }]);
    const service = new CodexLoginService(mockExec);

    const result = await service.execute();
    expect(result).toEqual({ success: true, output: 'Login successful.' });
    expect(mockExec).toHaveBeenCalledWith('codex login', { timeout: 120_000 });
  });

  it('execute(deviceAuth: true) uses --device-auth flag', async () => {
    const mockExec = createMockExecAsync([{ stdout: 'Device auth login initiated.' }]);
    const service = new CodexLoginService(mockExec);

    const result = await service.execute(true);
    expect(result).toEqual({ success: true, output: 'Device auth login initiated.' });
    expect(mockExec).toHaveBeenCalledWith('codex login --device-auth', { timeout: 120_000 });
  });

  it('execute() returns failure on command error', async () => {
    const mockExec = createMockExecAsync([{ error: new Error('Command timed out') }]);
    const service = new CodexLoginService(mockExec);

    const result = await service.execute();
    expect(result).toEqual({ success: false, output: 'Command timed out' });
  });

  it('execute() uses stderr when stdout is empty', async () => {
    const mockExec = createMockExecAsync([{ stderr: 'Login flow started' }]);
    const service = new CodexLoginService(mockExec);

    const result = await service.execute();
    expect(result).toEqual({ success: true, output: 'Login flow started' });
  });

  it('POST /api/providers/:id/login returns 404 for unknown provider', async () => {
    const response = await context.app.request('/api/providers/nonexistent/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:8787' },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(404);
  });
});

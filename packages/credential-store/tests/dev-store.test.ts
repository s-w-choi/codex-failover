import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ErrorCodes } from '@codex-failover/shared';

import { DevCredentialStore } from '../src/dev-store';

describe('DevCredentialStore', () => {
  let basePath: string;

  beforeEach(async () => {
    basePath = await mkdtemp(join(tmpdir(), 'codex-failover-credentials-'));
  });

  afterEach(async () => {
    await rm(basePath, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('stores credential in encrypted local file', async () => {
    const store = new DevCredentialStore(basePath);

    const result = await store.store('file://openai', 'test-credential');
    const rawFile = await readFile(store.filePathForRef('file://openai'), 'utf8');

    expect(result).toEqual({ success: true });
    expect(rawFile).not.toContain('test-credential');
  });

  it('retrieves credential from encrypted local file', async () => {
    const store = new DevCredentialStore(basePath);

    await store.store('file://openai', 'test-credential');

    await expect(store.retrieve('file://openai')).resolves.toEqual({
      success: true,
      credential: 'test-credential',
    });
  });

  it('uses simple encryption that avoids plaintext storage', async () => {
    const store = new DevCredentialStore(basePath);

    await store.store('file://anthropic', 'another-test-credential');
    const rawFile = await readFile(store.filePathForRef('file://anthropic'), 'utf8');

    expect(JSON.parse(rawFile)).toHaveProperty('ciphertext');
    expect(rawFile).not.toContain('another-test-credential');
  });

  it('derives file path from credentialRef', () => {
    const store = new DevCredentialStore(basePath);

    expect(store.filePathForRef('file://provider/openai')).toBe(join(basePath, 'provider%2Fopenai.json'));
  });

  it('returns error when file is not found', async () => {
    const store = new DevCredentialStore(basePath);

    await expect(store.retrieve('file://missing')).resolves.toEqual({
      success: false,
      error: ErrorCodes.CREDENTIAL_NOT_FOUND,
    });
  });

  it('warns when used', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const store = new DevCredentialStore(basePath);

    await store.store('file://openai', 'test-credential');

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('development-only credential store'));
  });
});

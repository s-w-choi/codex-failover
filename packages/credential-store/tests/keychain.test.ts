import { describe, expect, it } from 'vitest';

import { MemoryKeychainBackend, parseCredentialRef, SystemKeychainBackend } from '../src/keychain';

describe('keychain abstraction', () => {
  it('stores a credential with a service name and account name', async () => {
    const backend = new MemoryKeychainBackend();

    await expect(backend.setPassword('codex-failover', 'openai', 'test-credential')).resolves.toBeUndefined();
  });

  it('retrieves a stored credential', async () => {
    const backend = new MemoryKeychainBackend();

    await backend.setPassword('codex-failover', 'openai', 'test-credential');

    await expect(backend.getPassword('codex-failover', 'openai')).resolves.toBe('test-credential');
  });

  it('returns null when credential is not found', async () => {
    const backend = new MemoryKeychainBackend();

    await expect(backend.getPassword('codex-failover', 'missing')).resolves.toBeNull();
  });

  it('deletes a stored credential', async () => {
    const backend = new MemoryKeychainBackend();

    await backend.setPassword('codex-failover', 'openai', 'test-credential');

    await expect(backend.deletePassword('codex-failover', 'openai')).resolves.toBe(true);
    await expect(backend.getPassword('codex-failover', 'openai')).resolves.toBeNull();
  });

  it('handles keychain not available gracefully', async () => {
    const backend = new SystemKeychainBackend({ commandRunner: () => null, platform: 'darwin' });

    await expect(backend.getPassword('codex-failover', 'openai')).resolves.toBeNull();
    await expect(backend.setPassword('codex-failover', 'openai', 'test-credential')).resolves.toBeUndefined();
    await expect(backend.deletePassword('codex-failover', 'openai')).resolves.toBe(false);
  });

  it('parses keychain credential refs correctly', () => {
    expect(parseCredentialRef('keychain://service-name')).toEqual({
      protocol: 'keychain',
      path: 'service-name',
    });
  });
});

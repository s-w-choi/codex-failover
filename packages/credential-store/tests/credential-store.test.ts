import { describe, expect, it } from 'vitest';

import { ErrorCodes, type CredentialRef } from '@codex-failover/shared';

import { CredentialStore } from '../src/credential-store';
import { MemoryKeychainBackend, type KeychainBackend } from '../src/keychain';

class FailingKeychainBackend implements KeychainBackend {
  async getPassword(): Promise<string | null> {
    throw new Error('backend unavailable');
  }

  async setPassword(): Promise<void> {
    throw new Error('backend unavailable');
  }

  async deletePassword(): Promise<boolean> {
    throw new Error('backend unavailable');
  }
}

describe('CredentialStore', () => {
  it('stores credential via keychain credentialRef', async () => {
    const store = new CredentialStore(new MemoryKeychainBackend());

    await expect(store.store('keychain://openai', 'test-credential')).resolves.toEqual({ success: true });
  });

  it('retrieves credential via credentialRef', async () => {
    const store = new CredentialStore(new MemoryKeychainBackend());

    await store.store('keychain://openai', 'test-credential');

    await expect(store.retrieve('keychain://openai')).resolves.toEqual({
      success: true,
      credential: 'test-credential',
    });
  });

  it('returns CREDENTIAL_NOT_FOUND error when ref is not found', async () => {
    const store = new CredentialStore(new MemoryKeychainBackend());

    await expect(store.retrieve('keychain://missing')).resolves.toEqual({
      success: false,
      error: ErrorCodes.CREDENTIAL_NOT_FOUND,
    });
  });

  it('returns CREDENTIAL_REF_INVALID error for malformed refs', async () => {
    const store = new CredentialStore(new MemoryKeychainBackend());
    const malformedRef = 'env://OPENAI_API_KEY' as CredentialRef;

    await expect(store.retrieve(malformedRef)).resolves.toEqual({
      success: false,
      error: ErrorCodes.CREDENTIAL_REF_INVALID,
    });
  });

  it('returns CREDENTIAL_STORE_ERROR on storage failure', async () => {
    const store = new CredentialStore(new FailingKeychainBackend());

    await expect(store.store('keychain://openai', 'test-credential')).resolves.toEqual({
      success: false,
      error: ErrorCodes.CREDENTIAL_STORE_ERROR,
    });
  });

  it('validates that plain API keys are never stored in config', () => {
    expect(CredentialStore.isConfigSafe({ apiKey: 'sk-abcdefghijklmnopqrstuvwxyz' })).toBe(false);
    expect(CredentialStore.isConfigSafe({ providers: [{ key: 'abcdefghijklmnopqrstuvwxyz1234567890' }] })).toBe(
      false,
    );
    expect(CredentialStore.isConfigSafe({ credentialRef: 'keychain://openai' })).toBe(true);
  });

  it('validates credentialRef format before operations', () => {
    const store = new CredentialStore(new MemoryKeychainBackend());

    expect(store.validateCredentialRef('keychain://openai')).toBe(true);
    expect(store.validateCredentialRef('file://local-dev')).toBe(true);
    expect(store.validateCredentialRef('keychain://')).toBe(false);
    expect(store.validateCredentialRef('https://example.com')).toBe(false);
  });
});

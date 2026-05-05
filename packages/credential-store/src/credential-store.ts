import { ErrorCodes, type CredentialRef, type CredentialStoreResult } from '@codex-failover/shared';

import { createDefaultKeychainBackend, parseCredentialRef, type KeychainBackend } from './keychain.js';
import { containsCredential } from './redaction.js';

const KEYCHAIN_SERVICE_NAME = 'codex-failover';

export class CredentialStore {
  private readonly backend: KeychainBackend;

  constructor(backend: KeychainBackend = createDefaultKeychainBackend()) {
    this.backend = backend;
  }

  async store(ref: CredentialRef, credential: string): Promise<CredentialStoreResult> {
    const account = this.accountForRef(ref);

    if (account === null) {
      return { success: false, error: ErrorCodes.CREDENTIAL_REF_INVALID };
    }

    try {
      await this.backend.setPassword(KEYCHAIN_SERVICE_NAME, account, credential);
      return { success: true };
    } catch {
      return { success: false, error: ErrorCodes.CREDENTIAL_STORE_ERROR };
    }
  }

  async retrieve(ref: CredentialRef): Promise<CredentialStoreResult> {
    const account = this.accountForRef(ref);

    if (account === null) {
      return { success: false, error: ErrorCodes.CREDENTIAL_REF_INVALID };
    }

    try {
      const credential = await this.backend.getPassword(KEYCHAIN_SERVICE_NAME, account);

      if (credential === null) {
        return { success: false, error: ErrorCodes.CREDENTIAL_NOT_FOUND };
      }

      return { success: true, credential };
    } catch {
      return { success: false, error: ErrorCodes.CREDENTIAL_STORE_ERROR };
    }
  }

  async delete(ref: CredentialRef): Promise<CredentialStoreResult> {
    const account = this.accountForRef(ref);

    if (account === null) {
      return { success: false, error: ErrorCodes.CREDENTIAL_REF_INVALID };
    }

    try {
      const deleted = await this.backend.deletePassword(KEYCHAIN_SERVICE_NAME, account);
      return deleted ? { success: true } : { success: false, error: ErrorCodes.CREDENTIAL_NOT_FOUND };
    } catch {
      return { success: false, error: ErrorCodes.CREDENTIAL_STORE_ERROR };
    }
  }

  validateCredentialRef(ref: string): ref is CredentialRef {
    return /^(keychain|file):\/\/.+/.test(ref);
  }

  static isConfigSafe(config: Record<string, unknown>): boolean {
    return isConfigValueSafe(config);
  }

  private accountForRef(ref: CredentialRef): string | null {
    if (!this.validateCredentialRef(ref)) {
      return null;
    }

    const parsed = parseCredentialRef(ref);

    if (parsed.protocol !== 'keychain' || parsed.path.length === 0) {
      return null;
    }

    return parsed.path;
  }
}

function isConfigValueSafe(value: unknown, keyName = ''): boolean {
  if (typeof value === 'string') {
    return isStringConfigValueSafe(value, keyName);
  }

  if (Array.isArray(value)) {
    return value.every((item) => isConfigValueSafe(item));
  }

  if (isRecord(value)) {
    return Object.entries(value).every(([nestedKey, nestedValue]) => isConfigValueSafe(nestedValue, nestedKey));
  }

  return true;
}

function isStringConfigValueSafe(value: string, keyName: string): boolean {
  if (/^(keychain|file):\/\/.+/.test(value)) {
    return true;
  }

  if (containsCredential(value)) {
    return false;
  }

  return !isSensitiveConfigKey(keyName) || value.trim().length === 0;
}

function isSensitiveConfigKey(keyName: string): boolean {
  return /(api[-_]?key|credential|secret|token|password|\bkey\b)/i.test(keyName);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

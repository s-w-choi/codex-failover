import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, hostname, userInfo } from 'node:os';
import { join } from 'node:path';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

import { ErrorCodes, type CredentialRef, type CredentialStoreResult } from '@codex-failover/shared';

import { parseCredentialRef } from './keychain.js';

interface EncryptedCredentialFile {
  version: 1;
  algorithm: 'aes-256-gcm';
  iv: string;
  authTag: string;
  ciphertext: string;
}

export class DevCredentialStore {
  private readonly basePath: string;
  private readonly key: Buffer;

  constructor(basePath = join(homedir(), '.codex-failover', 'credentials')) {
    this.basePath = basePath;
    this.key = createHash('sha256').update(`${hostname()}:${userInfo().username}`).digest();
  }

  async store(ref: CredentialRef, credential: string): Promise<CredentialStoreResult> {
    this.warn();

    const filePath = this.safeFilePathForRef(ref);

    if (filePath === null) {
      return { success: false, error: ErrorCodes.CREDENTIAL_REF_INVALID };
    }

    try {
      await mkdir(this.basePath, { recursive: true, mode: 0o700 });
      await writeFile(filePath, JSON.stringify(this.encrypt(credential)), { encoding: 'utf8', mode: 0o600 });
      return { success: true };
    } catch {
      return { success: false, error: ErrorCodes.CREDENTIAL_STORE_ERROR };
    }
  }

  async retrieve(ref: CredentialRef): Promise<CredentialStoreResult> {
    this.warn();

    const filePath = this.safeFilePathForRef(ref);

    if (filePath === null) {
      return { success: false, error: ErrorCodes.CREDENTIAL_REF_INVALID };
    }

    try {
      const fileContent = await readFile(filePath, 'utf8');
      return { success: true, credential: this.decrypt(parseEncryptedCredentialFile(fileContent)) };
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        return { success: false, error: ErrorCodes.CREDENTIAL_NOT_FOUND };
      }

      return { success: false, error: ErrorCodes.CREDENTIAL_STORE_ERROR };
    }
  }

  async delete(ref: CredentialRef): Promise<CredentialStoreResult> {
    this.warn();

    const filePath = this.safeFilePathForRef(ref);
    if (filePath === null) {
      return { success: false, error: ErrorCodes.CREDENTIAL_REF_INVALID };
    }

    try {
      await rm(filePath, { force: false });
      return { success: true };
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        return { success: false, error: ErrorCodes.CREDENTIAL_NOT_FOUND };
      }

      return { success: false, error: ErrorCodes.CREDENTIAL_STORE_ERROR };
    }
  }

  filePathForRef(ref: CredentialRef): string {
    const parsed = parseCredentialRef(ref);
    return join(this.basePath, `${encodeURIComponent(parsed.path)}.json`);
  }

  private safeFilePathForRef(ref: CredentialRef): string | null {
    const parsed = parseCredentialRef(ref);

    if (parsed.protocol !== 'file' || parsed.path.length === 0) {
      return null;
    }

    return this.filePathForRef(ref);
  }

  private encrypt(credential: string): EncryptedCredentialFile {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(credential, 'utf8'), cipher.final()]);

    return {
      version: 1,
      algorithm: 'aes-256-gcm',
      iv: iv.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    };
  }

  private decrypt(encrypted: EncryptedCredentialFile): string {
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(encrypted.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(encrypted.authTag, 'base64'));

    return Buffer.concat([
      decipher.update(Buffer.from(encrypted.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }

  private warn(): void {
    console.warn('Using development-only credential store; do not use for production credentials.');
  }
}

function parseEncryptedCredentialFile(fileContent: string): EncryptedCredentialFile {
  const parsed: unknown = JSON.parse(fileContent);

  if (!isEncryptedCredentialFile(parsed)) {
    throw new Error('Invalid encrypted credential file');
  }

  return parsed;
}

function isEncryptedCredentialFile(value: unknown): value is EncryptedCredentialFile {
  if (!isRecord(value)) {
    return false;
  }

  return (
    value.version === 1 &&
    value.algorithm === 'aes-256-gcm' &&
    typeof value.iv === 'string' &&
    typeof value.authTag === 'string' &&
    typeof value.ciphertext === 'string'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

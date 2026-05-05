import { execSync } from 'node:child_process';

import type { CredentialRef } from '@codex-failover/shared';

export interface KeychainBackend {
  getPassword(service: string, account: string): Promise<string | null>;
  setPassword(service: string, account: string, password: string): Promise<void>;
  deletePassword(service: string, account: string): Promise<boolean>;
}

type CommandRunner = (command: string) => string | null;

interface SystemKeychainBackendOptions {
  commandRunner?: CommandRunner;
  platform?: NodeJS.Platform;
}

export class MemoryKeychainBackend implements KeychainBackend {
  private readonly credentials = new Map<string, string>();

  async getPassword(service: string, account: string): Promise<string | null> {
    return this.credentials.get(this.keyFor(service, account)) ?? null;
  }

  async setPassword(service: string, account: string, password: string): Promise<void> {
    this.credentials.set(this.keyFor(service, account), password);
  }

  async deletePassword(service: string, account: string): Promise<boolean> {
    return this.credentials.delete(this.keyFor(service, account));
  }

  private keyFor(service: string, account: string): string {
    return `${service}\0${account}`;
  }
}

export class SystemKeychainBackend implements KeychainBackend {
  private readonly commandRunner: CommandRunner;
  private readonly platform: NodeJS.Platform;

  constructor(options: SystemKeychainBackendOptions = {}) {
    this.commandRunner = options.commandRunner ?? runCommand;
    this.platform = options.platform ?? process.platform;
  }

  async getPassword(service: string, account: string): Promise<string | null> {
    if (this.platform !== 'darwin') {
      return null;
    }

    const output = this.commandRunner(
      `security find-generic-password -s ${shellQuote(service)} -a ${shellQuote(account)} -w`,
    );

    return output === null ? null : output.replace(/\n$/, '');
  }

  async setPassword(service: string, account: string, password: string): Promise<void> {
    if (this.platform !== 'darwin') {
      return;
    }

    this.commandRunner(
      `security add-generic-password -U -s ${shellQuote(service)} -a ${shellQuote(account)} -w ${shellQuote(password)}`,
    );
  }

  async deletePassword(service: string, account: string): Promise<boolean> {
    if (this.platform !== 'darwin') {
      return false;
    }

    return (
      this.commandRunner(`security delete-generic-password -s ${shellQuote(service)} -a ${shellQuote(account)}`) !== null
    );
  }
}

export function parseCredentialRef(ref: CredentialRef): { protocol: string; path: string } {
  const separatorIndex = ref.indexOf('://');

  if (separatorIndex === -1) {
    return { protocol: '', path: '' };
  }

  return {
    protocol: ref.slice(0, separatorIndex),
    path: ref.slice(separatorIndex + 3),
  };
}

export function createDefaultKeychainBackend(): KeychainBackend {
  const systemBackend = new SystemKeychainBackend();

  return process.platform === 'darwin' ? systemBackend : new MemoryKeychainBackend();
}

function runCommand(command: string): string | null {
  try {
    return execSync(command, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

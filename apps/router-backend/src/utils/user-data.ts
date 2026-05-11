import { mkdir, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export function getUserDataDir(): string {
  return process.env.CODEX_FAILOVER_DATA_DIR ?? join(homedir(), '.codex-failover');
}

export async function ensureUserDataDir(): Promise<string> {
  const dir = getUserDataDir();
  await mkdir(dir, { recursive: true });
  return dir;
}

export async function removeUserDataDir(): Promise<void> {
  const dir = getUserDataDir();
  await rm(dir, { recursive: true, force: true });
}

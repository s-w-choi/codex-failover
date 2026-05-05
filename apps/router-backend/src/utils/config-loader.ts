import { readFile } from 'node:fs/promises';

import type { Provider } from '@codex-failover/shared';

export async function loadProvidersFromFile(path: string): Promise<Provider[]> {
  const content = await readFile(path, 'utf8');
  const parsed = JSON.parse(content) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error('Provider config must be an array.');
  }
  return parsed.map((entry) => toProvider(entry));
}

function toProvider(entry: unknown): Provider {
  if (!entry || typeof entry !== 'object') {
    throw new Error('Provider config entry must be an object.');
  }
  const provider = entry as Partial<Provider>;
  if (!provider.id || !provider.type || !provider.baseUrl || !provider.credentialMode || !provider.modelAlias) {
    throw new Error('Provider config entry is missing required fields.');
  }
  return {
    id: provider.id,
    type: provider.type,
    priority: provider.priority ?? 1,
    baseUrl: provider.baseUrl,
    credentialMode: provider.credentialMode,
    credentialRef: provider.credentialRef,
    enabled: provider.enabled ?? true,
    modelAlias: provider.modelAlias,
    deploymentName: provider.deploymentName,
    cooldownTtlMs: provider.cooldownTtlMs,
    authHeaderStyle: provider.authHeaderStyle,
  };
}

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { CredentialStore } from '@codex-failover/credential-store';
import type { CooldownInfo, CredentialRef, Provider, ProviderState } from '@codex-failover/shared';

import { safeProviderBaseUrl } from '../utils/security.js';

export interface ProviderRegistryCreateInput extends Partial<Provider> {
  apiKey?: string;
}

export class ProviderRegistry {
  private readonly providers = new Map<string, Provider>();

  constructor(
    initialProviders: Provider[],
    private readonly credentialStore: CredentialStore,
    private readonly persistencePath?: string,
  ) {
    for (const provider of initialProviders) {
      this.providers.set(provider.id, { ...provider, accountId: provider.accountId ?? 'default' });
    }
    this.ensureAtLeastOneEnabled();
  }

  list(): Provider[] {
    return [...this.providers.values()].sort((left, right) => left.priority - right.priority).map((provider) => ({ ...provider }));
  }

  listStates(cooldownStates: CooldownInfo[]): ProviderState[] {
    return this.list().map((provider) => {
      const cooldown = cooldownStates.find((entry) => entry.providerId === provider.id);
      return {
        ...provider,
        status: provider.enabled ? (cooldown ? 'cooldown' : 'active') : 'disabled',
        ...(cooldown ? { cooldown } : {}),
      };
    });
  }

  get(id: string): Provider | undefined {
    const provider = this.providers.get(id);
    return provider ? { ...provider } : undefined;
  }

  async create(input: ProviderRegistryCreateInput): Promise<Provider> {
    const priority = input.priority ?? this.nextEnabledPriority();
    const provider = this.providerFromInput({ ...input, priority });
    if (this.providers.has(provider.id)) {
      throw new Error(`Provider ${provider.id} already exists.`);
    }
    await this.storeCredentialIfPresent(provider, input.apiKey);
    this.providers.set(provider.id, provider);
    this.ensureAtLeastOneEnabled();
    await this.persist();
    return { ...(this.providers.get(provider.id) ?? provider) };
  }

  async update(id: string, patch: ProviderRegistryCreateInput): Promise<Provider> {
    const current = this.providers.get(id);
    if (!current) {
      throw new Error(`Provider ${id} not found.`);
    }
    const disablingLastEnabled = patch.enabled === false && current.enabled && this.enabledProviderCount() === 1;
    const normalizedEnabled = disablingLastEnabled ? true : (patch.enabled ?? current.enabled);
    const enabling = normalizedEnabled === true && !current.enabled;
    const priority = enabling ? this.nextEnabledPriority() : (patch.priority ?? current.priority);
    const updated = this.providerFromInput({ ...current, ...patch, id, priority, enabled: normalizedEnabled });
    await this.storeCredentialIfPresent(updated, patch.apiKey);
    this.providers.set(id, updated);
    this.ensureAtLeastOneEnabled();
    await this.persist();
    return { ...(this.providers.get(id) ?? updated) };
  }

  async delete(id: string): Promise<boolean> {
    const deleted = this.providers.delete(id);
    if (deleted) {
      this.ensureAtLeastOneEnabled();
      await this.persist();
    }
    return deleted;
  }

  async reorder(providerIds: string[]): Promise<Provider[]> {
    const knownIds = new Set(this.providers.keys());
    for (const id of providerIds) {
      if (!knownIds.has(id)) {
        throw new Error(`Provider ${id} not found.`);
      }
    }
    providerIds.forEach((id, index) => {
      const provider = this.providers.get(id);
      if (provider) {
        this.providers.set(id, { ...provider, priority: index + 1 });
      }
    });
    await this.persist();
    return this.list();
  }

  async loadPersisted(): Promise<void> {
    if (!this.persistencePath) {
      return;
    }
    try {
      const parsed = JSON.parse(await readFile(this.persistencePath, 'utf8')) as Provider[];
      this.providers.clear();
      for (const provider of parsed) {
        this.providers.set(provider.id, provider);
      }
      this.ensureAtLeastOneEnabled();
    } catch {
      return;
    }
  }

  async autoProvisionOAuthProvider(accountId?: string): Promise<Provider | undefined> {
    const oauthId = accountId ? `openai-oauth-${accountId}` : 'openai-oauth';
    if (this.providers.has(oauthId)) {
      return undefined;
    }
    const provider: Provider = {
      id: oauthId,
      type: 'openai-oauth-pass-through',
      priority: 1,
      baseUrl: 'https://api.openai.com/v1',
      credentialMode: 'inbound-authorization',
      enabled: true,
      modelAlias: { default: 'gpt-4.1' },
      accountId: accountId ?? 'default',
    };
    this.providers.set(oauthId, provider);
    await this.persist();
    return { ...provider };
  }

  private providerFromInput(input: ProviderRegistryCreateInput): Provider {
    if (!input.id || !input.type || !input.baseUrl || !input.credentialMode || !input.modelAlias) {
      throw new Error('Provider is missing required fields.');
    }
    if (!safeProviderBaseUrl(input.baseUrl)) {
      throw new Error('Provider baseUrl must be valid and cannot bind to 0.0.0.0.');
    }
    return {
      id: input.id,
      type: input.type,
      priority: input.priority ?? this.providers.size + 1,
      baseUrl: input.baseUrl,
      credentialMode: input.credentialMode,
      credentialRef: input.credentialRef ?? (input.credentialMode === 'stored-api-key' ? `keychain://providers/${input.id}` : undefined),
      enabled: input.enabled ?? true,
      modelAlias: input.modelAlias,
      deploymentName: input.deploymentName,
      region: input.region,
      cooldownTtlMs: input.cooldownTtlMs,
      authHeaderStyle: input.authHeaderStyle,
      limits: input.limits,
      accountId: input.accountId ?? 'default',
      alias: input.alias,
    };
  }

  private async storeCredentialIfPresent(provider: Provider, apiKey: string | undefined): Promise<void> {
    if (!apiKey) {
      return;
    }
    if (!provider.credentialRef) {
      throw new Error('Credential ref is required to store API key.');
    }
    const result = await this.credentialStore.store(provider.credentialRef as CredentialRef, apiKey);
    if (!result.success) {
      throw new Error(result.error ?? 'Credential store failed.');
    }
  }

  private async persist(): Promise<void> {
    if (!this.persistencePath) {
      return;
    }
    await mkdir(dirname(this.persistencePath), { recursive: true });
    await writeFile(this.persistencePath, JSON.stringify(this.list(), null, 2));
  }

  private nextEnabledPriority(): number {
    let maxPriority = 0;
    for (const provider of this.providers.values()) {
      if (provider.enabled && provider.priority > maxPriority) {
        maxPriority = provider.priority;
      }
    }
    return maxPriority + 1;
  }

  private enabledProviderCount(): number {
    let count = 0;
    for (const provider of this.providers.values()) {
      if (provider.enabled) {
        count += 1;
      }
    }
    return count;
  }

  private ensureAtLeastOneEnabled(): void {
    if (this.providers.size === 0 || this.enabledProviderCount() > 0) {
      return;
    }
    const firstByPriority = [...this.providers.values()].sort((left, right) => left.priority - right.priority)[0];
    if (!firstByPriority) {
      return;
    }
    this.providers.set(firstByPriority.id, { ...firstByPriority, enabled: true });
  }
}

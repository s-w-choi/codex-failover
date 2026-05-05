import { createHash } from 'node:crypto';

import type { CredentialStore } from '@codex-failover/credential-store';
import type { CredentialRef, Provider } from '@codex-failover/shared';

import type { CodexConfigService } from './codex-config.js';

const MODEL_PROVIDER_PREFIX = 'codex-failover-';

export class ConfigSwitcher {
  private currentProviderId?: string;

  constructor(
    private readonly codexConfigService: CodexConfigService,
    private readonly credentialStore: CredentialStore,
  ) {}

  async switchToProvider(provider: Provider): Promise<void> {
    if (this.currentProviderId === provider.id) {
      return;
    }

    if (this.currentProviderId !== undefined) {
      const currentModel = await this.codexConfigService.readModel();
      if (currentModel) {
        await this.codexConfigService.saveProviderModel(this.currentProviderId, currentModel);
      }
    }

    await this.codexConfigService.removeModelProvider();
    await this.codexConfigService.removeAllModelProviderSections();
    await this.codexConfigService.cleanupLegacyProxySettings();

    if (provider.credentialMode !== 'inbound-authorization') {
      const apiKey = await this.readApiKey(provider);
      if (!apiKey) {
        throw new Error(`Cannot switch to ${provider.id}: API key not available.`);
      }

      const providerConfig = this.buildProviderConfig(provider, apiKey);
      await this.codexConfigService.setModelProvider(providerConfig.providerName);
      await this.codexConfigService.setModelProviderSection(providerConfig.providerName, providerConfig.fields);
      const model = providerConfig.modelName ?? (await this.resolveModel(provider.id));
      if (model) {
        await this.codexConfigService.setModel(model);
      }
    } else {
      const model = await this.resolveModel(provider.id);
      if (model) {
        await this.codexConfigService.setModel(model);
      }
    }

    this.currentProviderId = provider.id;
  }

  getCurrentProviderId(): string | undefined {
    return this.currentProviderId;
  }

  resetCurrentProvider(): void {
    this.currentProviderId = undefined;
  }

  private async readApiKey(provider: Provider): Promise<string | undefined> {
    if (!provider.credentialRef) {
      return undefined;
    }
    const result = await this.credentialStore.retrieve(provider.credentialRef as CredentialRef);
    return result.success ? result.credential : undefined;
  }

  private buildProviderConfig(provider: Provider, apiKey: string): {
    providerName: string;
    fields: Record<string, string>;
    modelName?: string;
  } {
    const providerName = codexModelProviderNameForProvider(provider);
    switch (provider.type) {
      case 'azure-openai-api-key': {
        const baseUrl = this.normalizeAzureUrl(provider.baseUrl);
        return {
          providerName,
          fields: {
            name: 'Azure OpenAI',
            base_url: baseUrl,
            experimental_bearer_token: apiKey,
            wire_api: 'responses',
          },
          modelName: provider.deploymentName,
        };
      }
      case 'openai-api-key':
        return {
          providerName,
          fields: {
            name: 'OpenAI API Key',
            base_url: 'https://api.openai.com/v1',
            experimental_bearer_token: apiKey,
            wire_api: 'responses',
          },
        };
      case 'openai-compatible-api-key':
        return {
          providerName,
          fields: {
            name: 'Custom Provider',
            base_url: provider.baseUrl,
            experimental_bearer_token: apiKey,
            wire_api: 'responses',
          },
        };
      default:
        throw new Error(`Unsupported provider type: ${provider.type}`);
    }
  }

  private normalizeAzureUrl(baseUrl: string): string {
    let url = baseUrl.split('?')[0].replace(/\/$/, '');

    if (url.endsWith('/responses')) {
      url = url.replace(/\/responses$/, '');
    }

    if (!url.endsWith('/openai/v1')) {
      if (url.endsWith('/openai')) {
        url += '/v1';
      } else {
        url += '/openai/v1';
      }
    }

    return url;
  }

  private async resolveModel(providerId: string): Promise<string | undefined> {
    const saved = await this.codexConfigService.readProviderModel(providerId);
    if (saved) {
      return saved;
    }
    return this.codexConfigService.readBackupModel();
  }
}

export function codexModelProviderNameForProvider(provider: Pick<Provider, 'id'>): string {
  const slug = provider.id
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'provider';
  const hash = createHash('sha256').update(provider.id).digest('hex').slice(0, 8);
  return `${MODEL_PROVIDER_PREFIX}${slug}-${hash}`;
}

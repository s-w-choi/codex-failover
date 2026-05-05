import type { CredentialStore } from '@codex-failover/credential-store';
import { type CredentialRef, type Provider } from '@codex-failover/shared';

export interface ConnectionTestResult {
  success: boolean;
  message: string;
  latencyMs: number;
  model?: string;
}

export class ProviderHealthChecker {
  constructor(private readonly credentialStore: CredentialStore) {}

  async testConnection(provider: Provider | undefined, model?: string): Promise<ConnectionTestResult> {
    if (!provider) {
      return { success: false, message: 'Provider not found.', latencyMs: 0 };
    }

    const testModel = model ?? provider.modelAlias.default ?? 'gpt-4';
    const startedAt = Date.now();

    try {
      const url = buildProviderUrl(provider, responsesPath(provider));
      const headers = await this.buildHeaders(provider);
      const body = JSON.stringify({
        model: testModel,
        input: [{ role: 'user', content: 'test' }],
        max_tokens: 1,
      });

      const response = await fetch(url, { method: 'POST', headers, body });
      const latencyMs = Date.now() - startedAt;

      if (response.ok) {
        return { success: true, message: 'Connection successful.', latencyMs, model: testModel };
      }

      if (response.status === 401) {
        return { success: true, message: 'Endpoint reachable (authentication required).', latencyMs, model: testModel };
      }

      if (response.status === 404) {
        return { success: false, message: 'Endpoint not found. Provider may not support /v1/responses.', latencyMs, model: testModel };
      }

      return { success: false, message: `Connection failed: HTTP ${response.status}.`, latencyMs, model: testModel };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Connection failed.',
        latencyMs: Date.now() - startedAt,
        model: testModel,
      };
    }
  }

  private async buildHeaders(provider: Provider): Promise<Headers> {
    const headers = new Headers({ 'content-type': 'application/json', accept: 'application/json' });

    if (provider.credentialMode === 'inbound-authorization') {
      return headers;
    }

    if (!provider.credentialRef) {
      return headers;
    }

    const credential = await this.credentialStore.retrieve(provider.credentialRef as CredentialRef);
    if (!credential.success || !credential.credential) {
      return headers;
    }

    switch (provider.authHeaderStyle ?? defaultAuthStyle(provider)) {
      case 'api-key':
        headers.set('api-key', credential.credential);
        break;
      case 'x-api-key':
        headers.set('x-api-key', credential.credential);
        break;
      case 'bearer':
        headers.set('authorization', `Bearer ${credential.credential}`);
        break;
    }

    return headers;
  }
}

function buildProviderUrl(provider: Provider, path: string): string {
  return `${provider.baseUrl.replace(/\/$/, '')}${path}`;
}

function responsesPath(provider: Provider): string {
  const baseUrl = provider.baseUrl.replace(/\/$/, '');
  if (provider.type === 'azure-openai-api-key') {
    return baseUrl.endsWith('/openai/v1') ? '/responses' : '/openai/v1/responses';
  }
  return baseUrl.endsWith('/v1') ? '/responses' : '/v1/responses';
}

function defaultAuthStyle(provider: Provider): 'bearer' | 'api-key' | 'x-api-key' {
  if (provider.type === 'azure-openai-api-key') {
    return 'api-key';
  }
  if (provider.type === 'openai-compatible-api-key') {
    return 'x-api-key';
  }
  return 'bearer';
}

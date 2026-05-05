import type { CredentialStore } from '@codex-failover/credential-store';
import { RoutingEngine, type RoutingEngineScorerOptions } from '@codex-failover/provider-core';
import { ErrorCodes, type CredentialRef, type Provider } from '@codex-failover/shared';

import type { NotificationService } from './notification-service.js';

export interface RoutingServiceOptions {
  notificationService?: NotificationService;
  scorerOptions?: RoutingEngineScorerOptions;
}

export class RoutingService {
  private engine: RoutingEngine;
  private providers: Provider[];

  constructor(
    providers: Provider[],
    private readonly credentialStore: CredentialStore,
    private readonly options: RoutingServiceOptions = {},
  ) {
    this.providers = [...providers].sort((left, right) => left.priority - right.priority);
    this.engine = new RoutingEngine(this.providers, options.scorerOptions);
  }

  updateProviders(providers: Provider[]): void {
    this.providers = [...providers].sort((left, right) => left.priority - right.priority);
    this.engine = new RoutingEngine(this.providers, this.options.scorerOptions);
  }

  getActiveProvider(): string {
    return this.engine.getActiveProvider();
  }

  getCooldownStates() {
    return this.engine.getCooldownStates();
  }

  resetState(): void {
    this.engine.resetState();
  }

  clearProviderCooldown(providerId: string): void {
    this.engine.reportSuccess(providerId);
  }

  reportSuccess(providerId: string, latencyMs?: number): void {
    this.engine.reportSuccess(providerId, undefined, undefined, undefined, latencyMs);
  }

  reportFailure(providerId: string, status: number, headers: Headers, body: unknown): void {
    this.engine.reportFailure(providerId, status, headers, body);
  }

  async testProvider(providerId: string, model: string | undefined): Promise<{ success: boolean; latencyMs: number; model?: string; error?: string }> {
    const provider = this.providers.find((candidate) => candidate.id === providerId);
    const startedAt = Date.now();
    if (!provider) {
      return { success: false, latencyMs: 0, error: `Provider ${providerId} not found.` };
    }
    try {
      const url = providerUrl(provider, responsesPath(provider));
      const headers = await this.headersForProvider(provider, undefined);
      const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ model: model ?? provider.modelAlias.default ?? 'default' }) });
      return { success: response.ok, latencyMs: Date.now() - startedAt, model, ...(response.ok ? {} : { error: `HTTP ${response.status}` }) };
    } catch (error) {
      return { success: false, latencyMs: Date.now() - startedAt, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  private async headersForProvider(provider: Provider, inboundAuthorization: string | undefined): Promise<Headers> {
    const headers = new Headers({ 'content-type': 'application/json', accept: 'application/json' });
    if (provider.credentialMode === 'inbound-authorization') {
      if (inboundAuthorization) {
        headers.set('authorization', inboundAuthorization);
      }
      return headers;
    }

    if (!provider.credentialRef) {
      throw new Error(`${ErrorCodes.CREDENTIAL_NOT_FOUND}: Provider ${provider.id} has no credentialRef.`);
    }
    const credential = await this.credentialStore.retrieve(provider.credentialRef as CredentialRef);
    if (!credential.success || !credential.credential) {
      throw new Error(`${ErrorCodes.CREDENTIAL_NOT_FOUND}: Credential not found for provider ${provider.id}.`);
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

function providerUrl(provider: Provider, path: string): string {
  const baseUrl = provider.baseUrl.replace(/\/$/, '');
  const queryIndex = baseUrl.indexOf('?');
  if (queryIndex === -1) {
    return `${baseUrl}${path}`;
  }
  const base = baseUrl.substring(0, queryIndex);
  const query = baseUrl.substring(queryIndex);
  return `${base}${path}${query}`;
}

function responsesPath(provider: Provider): string {
  const baseUrl = provider.baseUrl.replace(/\/$/, '').split('?')[0];
  if (baseUrl.endsWith('/responses')) {
    return '';
  }
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

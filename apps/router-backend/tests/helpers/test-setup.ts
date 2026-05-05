import { CredentialStore, MemoryKeychainBackend } from '@codex-failover/credential-store';
import type { CredentialRef, Provider } from '@codex-failover/shared';
import { createHarness, type TestHarness } from '@codex-failover/test-harness';
import type { Hono } from 'hono';

import { createApp } from '../../src/app.js';
import type { HealthScheduler } from '../../src/services/health-scheduler.js';

export interface TestContext {
  app: Hono;
  credentialStore: CredentialStore;
  harness: TestHarness;
  healthScheduler: HealthScheduler;
  logs: string[];
  providers: Provider[];
}

export interface CreateTestContextOptions {
  defaultLocalOrigin?: boolean;
}

export function createTestHarness(): TestHarness {
  return createHarness({
    config: {
      openaiPort: 9101,
      azurePort: 9102,
      compatiblePort: 9103,
      harnessApiPort: 9104,
    },
  });
}

export function createMockCredentialStore(): CredentialStore {
  return new CredentialStore(new MemoryKeychainBackend());
}

export function providerFixtures(harness: TestHarness): Provider[] {
  return [
    {
      id: 'openai',
      type: 'openai-oauth-pass-through',
      priority: 1,
      baseUrl: `http://127.0.0.1:${harness.config.openaiPort}`,
      credentialMode: 'inbound-authorization',
      enabled: true,
      modelAlias: { default: 'passthrough', 'gpt-5': 'gpt-4.1-mini' },
      cooldownTtlMs: 80,
    },
    {
      id: 'azure',
      type: 'azure-openai-api-key',
      priority: 2,
      baseUrl: `http://127.0.0.1:${harness.config.azurePort}`,
      credentialMode: 'stored-api-key',
      credentialRef: 'keychain://providers/azure',
      enabled: true,
      modelAlias: { default: 'unused' },
      deploymentName: 'gpt-4o-deployment',
      authHeaderStyle: 'api-key',
      cooldownTtlMs: 80,
    },
    {
      id: 'compatible',
      type: 'openai-compatible-api-key',
      priority: 3,
      baseUrl: `http://127.0.0.1:${harness.config.compatiblePort}`,
      credentialMode: 'stored-api-key',
      credentialRef: 'keychain://providers/compatible',
      enabled: true,
      modelAlias: { default: 'compatible-model', 'gpt-5': 'compatible-model' },
      authHeaderStyle: 'x-api-key',
      cooldownTtlMs: 80,
    },
  ];
}

export async function createTestContext(options: CreateTestContextOptions = {}): Promise<TestContext> {
  const harness = createTestHarness();
  await harness.start();
  await waitForHarness(harness);
  const credentialStore = new CredentialStore(new MemoryKeychainBackend());
  await credentialStore.store('keychain://providers/azure', 'azure-secret-key');
  await credentialStore.store('keychain://providers/compatible', 'compatible-secret-key');
  const providers = providerFixtures(harness);
  const logs: string[] = [];
  const { app, healthScheduler } = createApp({ providers, credentialStore, logger: (line) => logs.push(line) });
  return { app: options.defaultLocalOrigin === false ? app : withDefaultLocalOrigin(app), credentialStore, harness, healthScheduler, logs, providers };
}

function withDefaultLocalOrigin(app: Hono): Hono {
  const originalRequest = app.request.bind(app);

  app.request = ((...args: Parameters<typeof app.request>) => {
    const [input, requestInit] = args;
    if (!needsDefaultLocalOrigin(input, requestInit)) {
      return originalRequest(...args);
    }

    return originalRequest(input, withLocalOriginHeader(requestInit), args[2], args[3]);
  }) as typeof app.request;

  return app;
}

function needsDefaultLocalOrigin(input: Parameters<Hono['request']>[0], requestInit: RequestInit | undefined): boolean {
  const path = requestPath(input);
  const method = requestMethod(input, requestInit);

  return path.startsWith('/api/') && ['POST', 'PATCH', 'DELETE'].includes(method) && !hasHeader(input, requestInit, 'origin') && !hasHeader(input, requestInit, 'referer');
}

function requestPath(input: Parameters<Hono['request']>[0]): string {
  if (typeof input === 'string') {
    return input;
  }

  if (input instanceof URL) {
    return input.pathname;
  }

  return new URL(input.url).pathname;
}

function requestMethod(input: Parameters<Hono['request']>[0], requestInit: RequestInit | undefined): string {
  return (requestInit?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
}

function hasHeader(input: Parameters<Hono['request']>[0], requestInit: RequestInit | undefined, name: string): boolean {
  return new Headers(requestInit?.headers ?? (input instanceof Request ? input.headers : undefined)).has(name);
}

function withLocalOriginHeader(requestInit: RequestInit | undefined): RequestInit {
  const headers = new Headers(requestInit?.headers);
  headers.set('origin', 'http://127.0.0.1:8787');

  return { ...requestInit, headers };
}

async function waitForHarness(harness: TestHarness): Promise<void> {
  const urls = [
    `http://127.0.0.1:${harness.config.openaiPort}/healthz`,
    `http://127.0.0.1:${harness.config.azurePort}/healthz`,
    `http://127.0.0.1:${harness.config.compatiblePort}/healthz`,
    `http://127.0.0.1:${harness.config.harnessApiPort}/healthz`,
  ];
  for (const url of urls) {
    await waitForUrl(url);
  }
}

async function waitForUrl(url: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw new Error(`Harness endpoint did not become ready: ${url}`);
}

export async function stopTestContext(context: TestContext): Promise<void> {
  context.healthScheduler.stop();
  await context.harness.stop();
}

export function jsonRequest(body: unknown, headers: Record<string, string> = {}): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  };
}

export function credentialRef(value: string): CredentialRef {
  return value as CredentialRef;
}

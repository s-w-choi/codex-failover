import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CredentialStore, MemoryKeychainBackend } from '@codex-failover/credential-store';
import type { Provider } from '@codex-failover/shared';
import { type HarnessProviderMode, type HarnessState, TestHarness } from '@codex-failover/test-harness';
import type { Hono } from 'hono';
import { expect } from 'vitest';

import { createApp } from '../../src/app.js';
import { CodexConfigService } from '../../src/services/codex-config.js';
import type { HealthScheduler } from '../../src/services/health-scheduler.js';

export const USER_OAUTH_TOKEN = 'user-oauth-token-e2e';

export const TEST_PROVIDERS: Provider[] = [
  {
    id: 'oauth-primary',
    type: 'openai-oauth-pass-through',
    priority: 1,
    baseUrl: 'http://127.0.0.1:8781/v1',
    credentialMode: 'inbound-authorization',
    enabled: true,
    modelAlias: { default: 'passthrough', 'gpt-5.5': 'passthrough' },
    cooldownTtlMs: 80,
  },
  {
    id: 'openai-api',
    type: 'openai-api-key',
    priority: 2,
    baseUrl: 'http://127.0.0.1:8781/v1',
    credentialMode: 'stored-api-key',
    credentialRef: 'keychain://openai-api-main',
    enabled: true,
    modelAlias: { default: 'gpt-4o', 'gpt-5.5': 'gpt-4o' },
    cooldownTtlMs: 80,
  },
  {
    id: 'azure-api',
    type: 'azure-openai-api-key',
    priority: 3,
    baseUrl: 'http://127.0.0.1:8782/openai/v1',
    credentialMode: 'stored-api-key',
    credentialRef: 'keychain://azure-codex',
    enabled: true,
    deploymentName: 'codex-deployment',
    modelAlias: { default: 'codex-deployment', 'gpt-5.5': 'codex-deployment' },
    cooldownTtlMs: 80,
  },
  {
    id: 'custom-api',
    type: 'openai-compatible-api-key',
    priority: 4,
    baseUrl: 'http://127.0.0.1:8783/v1',
    credentialMode: 'stored-api-key',
    credentialRef: 'keychain://custom-compatible',
    enabled: true,
    modelAlias: { default: 'custom-model', 'gpt-5.5': 'custom-model' },
    authHeaderStyle: 'bearer',
    cooldownTtlMs: 80,
  },
];

export interface E2EContext {
  app: Hono;
  credentialStore: CredentialStore;
  codexConfigService: CodexConfigService;
  harness: HarnessHandle;
  healthScheduler: HealthScheduler;
  logs: string[];
  tempDir: string;
}

interface HarnessHandle {
  stop(): Promise<void>;
}

export async function startE2EContext(): Promise<E2EContext> {
  if (process.env.CODEX_FAILOVER_EXTERNAL_HARNESS === '1') {
    await waitForHarness();
    return createE2EContext({ stop: async () => {} });
  }

  const harness = new TestHarness();
  await harness.start();
  await waitForHarness();
  return createE2EContext(harness);
}

export async function resetE2EContext(context: E2EContext): Promise<E2EContext> {
  context.healthScheduler.stop();
  await rm(context.tempDir, { recursive: true, force: true });
  await harnessControl('/harness/reset');
  return createE2EContext(context.harness);
}

async function createE2EContext(harness: HarnessHandle): Promise<E2EContext> {
  const tempDir = await mkdtemp(join(tmpdir(), 'codex-failover-e2e-'));
  const codexConfigService = new CodexConfigService({ homeDir: join(tempDir, 'home'), projectDir: join(tempDir, 'project') });
  const credentialStore = new CredentialStore(new MemoryKeychainBackend());
  await credentialStore.store('keychain://openai-api-main', 'test-key-123');
  await credentialStore.store('keychain://azure-codex', 'azure-test-key-123');
  await credentialStore.store('keychain://custom-compatible', 'custom-test-key-123');

  const logs: string[] = [];
  const { app, healthScheduler } = createApp({
    providers: TEST_PROVIDERS,
    credentialStore,
    codexConfigService,
    healthCheckIntervalMs: 10,
    logger: (line) => logs.push(line),
  });

  return { app, codexConfigService, credentialStore, harness, healthScheduler, logs, tempDir };
}

export async function stopE2EContext(context: E2EContext): Promise<void> {
  context.healthScheduler.stop();
  await context.harness.stop();
  await rm(context.tempDir, { recursive: true, force: true });
}

export async function readCodexConfig(context: E2EContext): Promise<string> {
  return readFile(context.codexConfigService.configPath, 'utf8').catch(() => '');
}

export function request(
  app: Hono,
  method: string,
  path: string,
  options: { headers?: Record<string, string>; body?: unknown } = {},
): Promise<Response> {
  const headers = new Headers(options.headers);
  if (needsLocalOrigin(method, path, headers)) {
    headers.set('origin', 'http://127.0.0.1:8787');
  }
  const init: RequestInit = { method, headers };
  if (options.body !== undefined) {
    headers.set('content-type', headers.get('content-type') ?? 'application/json');
    init.body = JSON.stringify(options.body);
  }
  return app.fetch(new Request(`http://router.test${path}`, init));
}

function needsLocalOrigin(method: string, path: string, headers: Headers): boolean {
  return (
    path.startsWith('/api/') &&
    ['POST', 'PATCH', 'DELETE'].includes(method.toUpperCase()) &&
    !headers.has('origin') &&
    !headers.has('referer')
  );
}

export function userHeaders(): Record<string, string> {
  return { authorization: `Bearer ${USER_OAUTH_TOKEN}` };
}

export async function setProviderMode(providerId: 'openai' | 'azure' | 'compatible', mode: HarnessProviderMode): Promise<void> {
  await harnessControl(`/harness/providers/${providerId}/mode`, { mode });
}

export async function setStreamMode(providerId: 'openai' | 'azure' | 'compatible', mode: HarnessProviderMode): Promise<void> {
  await harnessControl(`/harness/providers/${providerId}/stream-mode`, { mode });
}

export async function resetHarness(): Promise<void> {
  await harnessControl('/harness/reset');
}

export async function harnessState(): Promise<HarnessState> {
  const response = await fetch('http://127.0.0.1:8788/harness/state');
  return parseJson<HarnessState>(response);
}

export async function readText(response: Response): Promise<string> {
  const body = await parseJson<Record<string, unknown>>(response);
  const output = body.output;
  if (!Array.isArray(output)) {
    return '';
  }
  const first = output[0];
  if (!isRecord(first)) {
    return '';
  }
  const content = first.content;
  if (!Array.isArray(content)) {
    return '';
  }
  const firstContent = content[0];
  if (!isRecord(firstContent)) {
    return '';
  }
  return typeof firstContent.text === 'string' ? firstContent.text : '';
}

export async function readId(response: Response): Promise<string> {
  const body = await parseJson<Record<string, unknown>>(response);
  return typeof body.id === 'string' ? body.id : '';
}

export async function parseJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

export function responseBody(model = 'gpt-5.5', extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { model, messages: [{ role: 'user', content: 'hello from e2e' }], ...extra };
}

export async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export function expectNoSecretLogs(logs: string[], secrets: string[]): void {
  const joined = logs.join('\n');
  for (const secret of secrets) {
    expect(joined).not.toContain(secret);
  }
}

async function harnessControl(path: string, body?: unknown): Promise<Response> {
  const response = await fetch(`http://127.0.0.1:8788${path}`, {
    method: 'POST',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Harness control failed: ${path} ${response.status}`);
  }
  return response;
}

async function waitForHarness(): Promise<void> {
  const urls = [
    'http://127.0.0.1:8781/healthz',
    'http://127.0.0.1:8782/healthz',
    'http://127.0.0.1:8783/healthz',
    'http://127.0.0.1:8788/healthz',
  ];
  for (const url of urls) {
    await waitForUrl(url);
  }
}

async function waitForUrl(url: string): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // Retry below.
    }

    await sleep(10);
  }
  throw new Error(`Harness endpoint did not become ready: ${url}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

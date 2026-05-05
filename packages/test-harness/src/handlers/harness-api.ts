import { Hono } from 'hono';

import type { HarnessProviderMode, HarnessRateLimitHeaders } from '../types.js';
import type { StateManager } from '../utils/state-manager.js';

const providerModes = new Set<HarnessProviderMode>([
  'success',
  'always-rate-limited',
  'insufficient-quota',
  'fail-next-request',
  'recover-after-ms',
  'delayed-response',
  'malformed-json',
  'missing-rate-limit-headers',
  'stream-success',
  'stream-fail-before-first-byte',
  'stream-fail-after-first-byte',
  'stateful-response',
]);

export function createHarnessApi(stateManager: StateManager): Hono {
  const app = new Hono();

  app.get('/healthz', (context) => context.json({ ok: true, service: 'harness-api' }));
  app.get('/harness/state', (context) => context.json(stateManager.snapshot));
  app.post('/harness/reset', (context) => context.json(stateManager.reset()));

  app.post('/harness/providers/:id/mode', async (context) => {
    const body = await readBody(context.req.json.bind(context.req));
    const mode = typeof body.mode === 'string' ? body.mode : undefined;
    if (!mode || !providerModes.has(mode as HarnessProviderMode)) {
      return context.json({ error: 'Invalid provider mode.' }, 400);
    }
    return context.json(stateManager.setMode(context.req.param('id'), mode as HarnessProviderMode));
  });

  app.post('/harness/providers/:id/fail-next', async (context) => {
    const body = await readBody(context.req.json.bind(context.req));
    return context.json(stateManager.failNext(context.req.param('id'), numberValue(body.count, 1)));
  });

  app.post('/harness/providers/:id/recover-after', async (context) => {
    const body = await readBody(context.req.json.bind(context.req));
    return context.json(stateManager.recoverAfter(context.req.param('id'), numberValue(body.ms, 0)));
  });

  app.post('/harness/providers/:id/latency', async (context) => {
    const body = await readBody(context.req.json.bind(context.req));
    return context.json(stateManager.setLatency(context.req.param('id'), numberValue(body.latencyMs ?? body.ms, 0)));
  });

  app.post('/harness/providers/:id/rate-limit', async (context) => {
    const body = await readBody(context.req.json.bind(context.req));
    const rateLimitHeaders: HarnessRateLimitHeaders = {
      remainingRequests: numberValue(body.remainingRequests, 99),
      requestLimit: numberValue(body.requestLimit, 100),
      remainingTokens: numberValue(body.remainingTokens, 99_000),
      tokenLimit: numberValue(body.tokenLimit, 100_000),
      resetTime: body.resetTime === undefined ? undefined : numberValue(body.resetTime, Date.now() + 60_000),
    };
    return context.json(stateManager.setRateLimit(context.req.param('id'), rateLimitHeaders));
  });

  app.post('/harness/providers/:id/stream-mode', async (context) => {
    const body = await readBody(context.req.json.bind(context.req));
    const mode = typeof body.mode === 'string' ? body.mode : 'stream-success';
    if (!providerModes.has(mode as HarnessProviderMode) || !mode.startsWith('stream-')) {
      return context.json({ error: 'Invalid stream mode.' }, 400);
    }
    return context.json(stateManager.setMode(context.req.param('id'), mode as HarnessProviderMode));
  });

  app.onError((error, context) => {
    if (error.message.startsWith('Unknown harness provider')) {
      return context.json({ error: error.message }, 404);
    }
    return context.json({ error: error.message }, 500);
  });

  return app;
}

async function readBody(reader: () => Promise<unknown>): Promise<Record<string, unknown>> {
  try {
    const body = await reader();
    return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

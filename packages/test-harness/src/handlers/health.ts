import type { Hono } from 'hono';

export function registerHealthHandler(app: Hono, service: string): void {
  app.get('/healthz', (context) => context.json({ ok: true, service }));
  app.get('/health', (context) => context.json({ ok: true, service }));
}

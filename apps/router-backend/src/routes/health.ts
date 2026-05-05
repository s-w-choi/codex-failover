import { Hono } from 'hono';

export function createHealthRoutes(): Hono {
  const app = new Hono();
  app.get('/healthz', (context) => context.json({ ok: true, service: 'router-backend' }));
  app.get('/readyz', (context) => context.json({ ok: true, service: 'router-backend' }));
  return app;
}

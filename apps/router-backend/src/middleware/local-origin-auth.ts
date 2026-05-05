import type { MiddlewareHandler } from 'hono';

const allowedLocalOrigins = ['http://127.0.0.1:8787', 'http://localhost:8787'];
const protectedMethods = new Set(['POST', 'PATCH', 'DELETE']);

export function localOriginAuth(): MiddlewareHandler {
  return async (context, next) => {
    if (!protectedMethods.has(context.req.method)) {
      await next();
      return;
    }

    if (!isLocalRequest(context.req.raw)) {
      return context.json({ error: 'Forbidden: local origin required' }, 403);
    }

    await next();
  };
}

export function isLocalRequest(request: Request): boolean {
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');

  // Allow requests with no origin at all (curl, native clients)
  if (origin === null && referer === null) return true;

  // Allow file:// protocol (Electron popup loaded from local HTML)
  if (origin !== null && origin.startsWith('file://')) return true;
  if (referer !== null && referer.startsWith('file://')) return true;

  return [origin, referer].some(
    (header) => header !== null && allowedLocalOrigins.some((localOrigin) => header.startsWith(localOrigin)),
  );
}

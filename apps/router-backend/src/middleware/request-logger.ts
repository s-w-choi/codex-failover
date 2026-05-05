import type { MiddlewareHandler } from 'hono';

import { sanitizeLogLine } from '../utils/security.js';

export type RequestLogSink = (line: string) => void;

export function requestLogger(logger: RequestLogSink = console.info): MiddlewareHandler {
  return async (context, next) => {
    const startedAt = Date.now();
    await next();
    const durationMs = Date.now() - startedAt;
    logger(sanitizeLogLine(`${context.req.method} ${context.req.path} ${context.res.status} ${durationMs}ms`));
  };
}

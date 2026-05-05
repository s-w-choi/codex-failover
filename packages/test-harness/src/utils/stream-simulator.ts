import { streamText } from 'hono/streaming';
import type { Context } from 'hono';

import { createResponseId } from './response-factory.js';

export type StreamFailureMode = 'none' | 'before-first-byte' | 'after-first-byte';

export function createSseChunk(data: unknown): string {
  return `data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`;
}

export function streamResponse(context: Context, providerId: string, model: string, failureMode: StreamFailureMode) {
  if (failureMode === 'before-first-byte') {
    return context.json(
      { error: { type: 'server_error', code: 'stream_failed', message: 'Stream failed before first byte.' } },
      500,
    );
  }

  const id = createResponseId();
  context.header('content-type', 'text/event-stream; charset=utf-8');
  context.header('cache-control', 'no-cache');
  context.header('connection', 'keep-alive');

  return streamText(context, async (stream) => {
    await stream.write(createSseChunk({ id, object: 'response.created', model, provider: providerId }));
    if (failureMode === 'after-first-byte') {
      await stream.write(createSseChunk({ error: { type: 'server_error', code: 'stream_interrupted' } }));
      return;
    }
    await stream.write(createSseChunk({ id, object: 'response.output_text.delta', delta: 'Hello' }));
    await stream.write(createSseChunk({ id, object: 'response.output_text.delta', delta: ` from ${providerId}` }));
    await stream.write(createSseChunk('[DONE]'));
  });
}

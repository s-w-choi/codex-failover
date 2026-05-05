import { Hono } from 'hono';
import type { Context } from 'hono';

import { createOpenAIError, createResponse } from '../utils/response-factory.js';
import { streamResponse, type StreamFailureMode } from '../utils/stream-simulator.js';
import type { StateManager } from '../utils/state-manager.js';
import type {
  HarnessAuthorizationType,
  HarnessProviderMode,
  HarnessProviderRequest,
  HarnessProviderState,
  MockProviderOptions,
} from '../types.js';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export abstract class BaseMockProvider {
  readonly app = new Hono();
  protected readonly models: string[];

  protected constructor(
    protected readonly stateManager: StateManager,
    protected readonly options: MockProviderOptions,
  ) {
    this.models = [options.defaultModel, `${options.defaultModel}-mini`];
  }

  get id(): string {
    return this.options.id;
  }

  get state(): HarnessProviderState {
    return this.stateManager.requireProvider(this.id);
  }

  abstract registerRoutes(): void;

  getRateLimitHeaders(): Record<string, string> {
    if (this.state.mode === 'missing-rate-limit-headers') {
      return {};
    }
    const limits = this.state.rateLimitHeaders;
    if (!limits) {
      return {};
    }
    const headers: Record<string, string> = {
      'x-ratelimit-remaining-requests': String(limits.remainingRequests),
      'x-ratelimit-limit-requests': String(limits.requestLimit),
      'x-ratelimit-remaining-tokens': String(limits.remainingTokens),
      'x-ratelimit-limit-tokens': String(limits.tokenLimit),
    };
    if (limits.resetTime !== undefined) {
      headers['x-ratelimit-reset-requests'] = String(limits.resetTime);
      headers['x-ratelimit-reset-tokens'] = String(limits.resetTime);
    }
    return headers;
  }

  createErrorResponse(context: Context, status: 400 | 429 | 500 | 503, code: string, message: string): Response {
    return context.json(createOpenAIError(status === 429 ? 'rate_limit' : 'server_error', code, message), status, {
      ...this.getRateLimitHeaders(),
    });
  }

  async handleResponses(context: Context) {
    const body = await this.readJsonBody(context);
    const model = this.extractModel(body);
    this.trackRequest(context, model);

    await this.applyLatency();

    const failure = this.consumeFailure();
    if (failure) {
      return this.createErrorResponse(context, 500, 'provider_error', 'Configured fail-next request fault was triggered.');
    }

    const unavailable = this.getUnavailableMode();
    if (unavailable) {
      return this.createErrorResponse(context, unavailable.status, unavailable.code, unavailable.message);
    }

    if (this.state.mode === 'malformed-json') {
      return context.text('{"id":"resp_malformed", "object":', 200, {
        'content-type': 'application/json',
        ...this.getRateLimitHeaders(),
      });
    }

    const streamMode = this.getStreamMode(body);
    if (streamMode !== undefined) {
      return streamResponse(context, this.id, model, streamMode);
    }

    const previousResponseId = typeof body?.previous_response_id === 'string' ? body.previous_response_id : undefined;
    const response = createResponse({
      providerId: this.id,
      model,
      previousResponseId,
      stateful: this.state.mode === 'stateful-response',
    });
    this.stateManager.trackResponse(this.id, response.id);

    return context.json(response, 200, {
      ...this.getRateLimitHeaders(),
    });
  }

  protected trackRequest(context: Context, model: string): void {
    this.stateManager.updateProvider(this.id, (provider) => {
      provider.requestCount += 1;
      provider.lastAuthorizationType = this.getAuthorizationType(context);
      provider.lastModelSeen = model;
    });
  }

  protected getAuthorizationType(context: Context): HarnessAuthorizationType {
    const authorization = context.req.header('authorization');
    if (authorization?.toLowerCase().startsWith('bearer ')) {
      return 'bearer';
    }
    if (authorization || context.req.header('x-api-key') || context.req.header('api-key')) {
      return 'api-key';
    }
    return 'none';
  }

  protected extractModel(body: HarnessProviderRequest | undefined): string {
    return typeof body?.model === 'string' ? body.model : this.options.defaultModel;
  }

  protected async readJsonBody(context: Context): Promise<HarnessProviderRequest | undefined> {
    try {
      return (await context.req.json()) as HarnessProviderRequest;
    } catch {
      return undefined;
    }
  }

  protected async applyLatency(): Promise<void> {
    const latency = this.state.mode === 'delayed-response' && this.state.latencyMs === 0 ? 1_000 : this.state.latencyMs;
    if (latency > 0) {
      await sleep(latency);
    }
  }

  protected consumeFailure(): boolean {
    if (this.state.failNextCount > 0) {
      this.stateManager.updateProvider(this.id, (provider) => {
        provider.failNextCount -= 1;
      });
      return true;
    }
    if (this.state.mode === 'fail-next-request') {
      this.stateManager.setMode(this.id, 'success');
      return true;
    }
    return false;
  }

  protected getUnavailableMode(): { status: 429 | 503; code: string; message: string } | undefined {
    switch (this.state.mode) {
      case 'always-rate-limited':
        return { status: 429, code: 'rate_limit_exceeded', message: 'Rate limit exceeded by harness configuration.' };
      case 'insufficient-quota':
        return { status: 429, code: 'insufficient_quota', message: 'Insufficient quota in harness configuration.' };
      case 'recover-after-ms':
        if (this.state.recoverAt && Date.now() < this.state.recoverAt) {
          return { status: 503, code: 'temporarily_unavailable', message: 'Provider is recovering.' };
        }
        this.stateManager.setMode(this.id, 'success');
        return undefined;
      default:
        return undefined;
    }
  }

  protected getStreamMode(body: HarnessProviderRequest | undefined): StreamFailureMode | undefined {
    const mode: HarnessProviderMode = this.state.mode;
    if (mode === 'stream-fail-before-first-byte') {
      return 'before-first-byte';
    }
    if (mode === 'stream-fail-after-first-byte') {
      return 'after-first-byte';
    }
    if (mode === 'stream-success' || body?.stream === true) {
      return 'none';
    }
    return undefined;
  }
}

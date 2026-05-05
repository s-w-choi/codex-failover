import type { Context } from 'hono';

import { registerHealthHandler } from '../handlers/health.js';
import { registerModelsHandler } from '../handlers/models.js';
import { registerResponsesHandler } from '../handlers/responses.js';
import { createCompatibleError } from '../utils/response-factory.js';
import type { StateManager } from '../utils/state-manager.js';
import type { HarnessAuthorizationType } from '../types.js';
import { BaseMockProvider } from './base-provider.js';

export class MockCompatibleProvider extends BaseMockProvider {
  constructor(stateManager: StateManager) {
    super(stateManager, {
      id: 'compatible',
      type: 'mock-compatible',
      responsesPath: '/v1/responses',
      modelsPath: '/v1/models',
      defaultModel: 'compatible-model',
      serviceName: 'mock-openai-compatible',
    });
    this.registerRoutes();
  }

  registerRoutes(): void {
    registerHealthHandler(this.app, this.options.serviceName);
    registerResponsesHandler(this, this.options.responsesPath);
    registerModelsHandler(this, this.options.modelsPath, this.models);
  }

  protected override getAuthorizationType(context: Context): HarnessAuthorizationType {
    if (context.req.header('x-provider-key') || context.req.header('x-api-key') || context.req.header('api-key')) {
      return 'api-key';
    }
    return super.getAuthorizationType(context);
  }

  override createErrorResponse(context: Context, status: 400 | 429 | 500 | 503, code: string, message: string): Response {
    if (this.state.mode === 'insufficient-quota') {
      return context.json(createCompatibleError(code, message), status, this.getRateLimitHeaders());
    }
    return super.createErrorResponse(context, status, code, message);
  }
}

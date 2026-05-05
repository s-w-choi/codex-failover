import type { Context } from 'hono';

import { registerHealthHandler } from '../handlers/health.js';
import { registerModelsHandler } from '../handlers/models.js';
import { registerResponsesHandler } from '../handlers/responses.js';
import { createAzureError } from '../utils/response-factory.js';
import type { StateManager } from '../utils/state-manager.js';
import { BaseMockProvider } from './base-provider.js';

export class MockAzureProvider extends BaseMockProvider {
  constructor(stateManager: StateManager) {
    super(stateManager, {
      id: 'azure',
      type: 'mock-azure',
      responsesPath: '/openai/v1/responses',
      modelsPath: '/openai/v1/models',
      defaultModel: 'gpt-4o-deployment',
      serviceName: 'mock-azure-openai',
    });
    this.registerRoutes();
  }

  registerRoutes(): void {
    registerHealthHandler(this.app, this.options.serviceName);
    registerResponsesHandler(this, this.options.responsesPath);
    registerModelsHandler(this, this.options.modelsPath, this.models);
  }

  override getRateLimitHeaders(): Record<string, string> {
    const base = super.getRateLimitHeaders();
    if (Object.keys(base).length === 0) {
      return base;
    }
    return {
      ...base,
      'x-ms-ratelimit-remaining-requests': base['x-ratelimit-remaining-requests'] ?? '0',
      'x-ms-ratelimit-remaining-tokens': base['x-ratelimit-remaining-tokens'] ?? '0',
    };
  }

  override createErrorResponse(context: Context, status: 400 | 429 | 500 | 503, code: string, message: string): Response {
    return context.json(createAzureError(code, message), status, this.getRateLimitHeaders());
  }
}

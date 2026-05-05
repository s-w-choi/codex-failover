import { registerHealthHandler } from '../handlers/health.js';
import { registerModelsHandler } from '../handlers/models.js';
import { registerResponsesHandler } from '../handlers/responses.js';
import type { StateManager } from '../utils/state-manager.js';
import { BaseMockProvider } from './base-provider.js';

export class MockOpenAIProvider extends BaseMockProvider {
  constructor(stateManager: StateManager) {
    super(stateManager, {
      id: 'openai',
      type: 'mock-openai',
      responsesPath: '/v1/responses',
      modelsPath: '/v1/models',
      defaultModel: 'gpt-4.1-mini',
      serviceName: 'mock-openai',
    });
    this.registerRoutes();
  }

  registerRoutes(): void {
    registerHealthHandler(this.app, this.options.serviceName);
    registerResponsesHandler(this, this.options.responsesPath);
    registerModelsHandler(this, this.options.modelsPath, this.models);
  }
}

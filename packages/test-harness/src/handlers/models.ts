import type { BaseMockProvider } from '../providers/base-provider.js';
import { createModels } from '../utils/response-factory.js';

export function registerModelsHandler(provider: BaseMockProvider, path: string, models: string[]): void {
  provider.app.get(path, (context) => context.json(createModels(provider.id, models), 200, provider.getRateLimitHeaders()));
}

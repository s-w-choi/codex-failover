import type { BaseMockProvider } from '../providers/base-provider.js';

export function registerResponsesHandler(provider: BaseMockProvider, path: string): void {
  provider.app.post(path, (context) => provider.handleResponses(context));
}

import { ErrorCodes, type Provider, type RouterError } from '@codex-failover/shared';

function routerError(code: RouterError['code'], message: string, providerId: string): RouterError {
  return Object.assign(new Error(message), { code, providerId });
}

export function resolveModel(provider: Provider, incomingModel: string): string | RouterError {
  if (provider.type === 'azure-openai-api-key' && provider.deploymentName) {
    return provider.deploymentName;
  }

  const mappedModel = provider.modelAlias[incomingModel] ?? provider.modelAlias.default;

  if (!mappedModel) {
    return routerError(
      ErrorCodes.MODEL_ALIAS_MISSING,
      `No model alias configured for ${incomingModel} on provider ${provider.id}`,
      provider.id,
    );
  }

  return mappedModel === 'passthrough' ? incomingModel : mappedModel;
}

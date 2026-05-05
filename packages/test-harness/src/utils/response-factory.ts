export interface ResponseFactoryOptions {
  providerId: string;
  model: string;
  previousResponseId?: string;
  stateful: boolean;
}

export interface ProviderModel {
  id: string;
  object: 'model';
  created: number;
  owned_by: string;
}

const randomId = () => Math.random().toString(36).slice(2, 10);

export const createResponseId = (): string => `resp_${randomId()}`;

export function createResponse(options: ResponseFactoryOptions) {
  const id = createResponseId();
  const text = options.stateful && options.previousResponseId
    ? `Stateful response from ${options.providerId} after ${options.previousResponseId}.`
    : `Hello from ${options.providerId}.`;

  return {
    id,
    object: 'response',
    created_at: Math.floor(Date.now() / 1000),
    status: 'completed',
    model: options.model,
    output: [
      {
        id: `msg_${randomId()}`,
        type: 'message',
        status: 'completed',
        role: 'assistant',
        content: [
          {
            type: 'output_text',
            text,
          },
        ],
      },
    ],
    usage: {
      input_tokens: 8,
      output_tokens: 8,
      total_tokens: 16,
    },
  };
}

export function createModels(providerId: string, models: string[]) {
  const created = Math.floor(Date.now() / 1000);
  return {
    object: 'list',
    data: models.map<ProviderModel>((model) => ({
      id: model,
      object: 'model',
      created,
      owned_by: providerId,
    })),
  };
}

export function createOpenAIError(type: string, code: string, message: string) {
  return {
    error: {
      type,
      code,
      message,
    },
  };
}

export function createAzureError(code: string, message: string) {
  return {
    error: {
      code,
      message,
    },
  };
}

export function createCompatibleError(code: string, message: string) {
  return {
    message,
    error_code: code,
  };
}

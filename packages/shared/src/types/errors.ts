import { ErrorCodes } from '../constants/error-codes';

export { ErrorCodes };

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export interface RouterError extends Error {
  code: ErrorCode;
  providerId?: string;
  statusCode?: number;
  details?: Record<string, unknown>;
}

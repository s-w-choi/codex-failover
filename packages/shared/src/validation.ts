export interface ValidationIssue {
  path: string;
  message: string;
}

export type ValidationResult<T> =
  | { success: true; data: T; issues?: never }
  | { success: false; data?: never; issues: ValidationIssue[] };

export type Validator<T> = (value: unknown) => ValidationResult<T>;

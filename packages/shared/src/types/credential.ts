export type CredentialRef = `keychain://${string}` | `file://${string}`;

export interface CredentialStoreResult {
  success: boolean;
  credential?: string;
  error?: string;
}

export interface RedactedLog {
  original: string;
  redacted: string;
  hadSensitiveData: boolean;
}

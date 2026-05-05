export interface CodexConfig {
  model_provider: string;
  openai_base_url?: string;
  cli_auth_credentials_store?: string;
  [key: string]: unknown;
}

export interface CodexConfigInstallResult {
  success: boolean;
  backupPath?: string;
  changes: string[];
  warnings: string[];
}

export interface ProjectConfigDiagnosis {
  hasProjectConfig: boolean;
  projectConfigPath?: string;
  overridesBaseUrl: boolean;
  warnings: string[];
}

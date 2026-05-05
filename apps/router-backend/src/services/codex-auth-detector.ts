import { readFile } from 'node:fs/promises';

export interface CodexAuthInfo {
  detected: boolean;
  authMode?: string;
  accountId?: string;
  email?: string;
  expiresAt?: number;
  isExpired?: boolean;
  hasApiKey?: boolean;
}

function parseJwtPayload(token: string): Record<string, unknown> | undefined {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return undefined;
  }
  try {
    const payload = Buffer.from(parts[1], 'base64url').toString('utf8');
    return JSON.parse(payload) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function checkExpired(exp: unknown): boolean {
  if (typeof exp !== 'number') {
    return false;
  }
  return Date.now() >= exp * 1000;
}

export class CodexAuthDetector {
  constructor(private readonly authJsonPath = '~/.codex/auth.json') {}

  private resolvePath(): string {
    if (this.authJsonPath.startsWith('~/')) {
      const home = process.env.HOME ?? process.env.USERPROFILE;
      if (!home) {
        throw new Error('Unable to determine home directory.');
      }
      return `${home}${this.authJsonPath.slice(1)}`;
    }
    return this.authJsonPath;
  }

  async detect(): Promise<CodexAuthInfo> {
    let raw: string;
    try {
      raw = await readFile(this.resolvePath(), 'utf8');
    } catch {
      return { detected: false };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { detected: false };
    }

    if (!parsed || typeof parsed !== 'object') {
      return { detected: false };
    }

    const data = parsed as Record<string, unknown>;
    const tokens = data.tokens && typeof data.tokens === 'object' ? (data.tokens as Record<string, unknown>) : undefined;
    const accessToken = tokens?.access_token;
    const idToken = tokens?.id_token;
    const accountId = typeof tokens?.account_id === 'string' ? tokens.account_id : undefined;
    const authMode = typeof data.auth_mode === 'string' ? data.auth_mode : undefined;
    const hasApiKey = typeof data.OPENAI_API_KEY === 'string' && data.OPENAI_API_KEY.length > 0;

    let email: string | undefined;
    let expiresAt: number | undefined;
    let isExpired = false;

    const payload = typeof accessToken === 'string' ? parseJwtPayload(accessToken) : undefined;
    if (payload) {
      if (typeof payload['https://api.openai.com/profile'] === 'object' && payload['https://api.openai.com/profile'] !== null) {
        const profile = payload['https://api.openai.com/profile'] as Record<string, unknown>;
        email = typeof profile.email === 'string' ? profile.email : undefined;
      }
      if (typeof payload.exp === 'number') {
        expiresAt = payload.exp;
        isExpired = checkExpired(payload.exp);
      }
    }

    if (!email && typeof idToken === 'string') {
      const idPayload = parseJwtPayload(idToken);
      if (idPayload && typeof idPayload.email === 'string') {
        email = idPayload.email;
      }
    }

    return {
      detected: true,
      authMode,
      accountId,
      email,
      expiresAt,
      isExpired,
      hasApiKey,
    };
  }

  async isAuthenticated(): Promise<boolean> {
    const info = await this.detect();
    return info.detected && !info.isExpired;
  }
}

import type { ResponseOwnership, SessionKey, StickySession } from '@codex-failover/shared';

function stableKey(key: SessionKey): string {
  return JSON.stringify({
    authorizationIdentity: key.authorizationIdentity ?? '',
    cwd: key.cwd ?? '',
    processId: key.processId ?? '',
    sessionId: key.sessionId ?? '',
  });
}

function sessionIdFromKey(key: SessionKey): string {
  return key.sessionId ?? stableKey(key);
}

export class StickySessionManager {
  private readonly sessions = new Map<string, StickySession>();
  private readonly sessionsByKey = new Map<string, string>();
  private readonly responseOwnership = new Map<string, ResponseOwnership>();

  createSession(key: SessionKey, providerId: string, stateful: boolean): StickySession {
    const now = Date.now();
    const sessionId = sessionIdFromKey(key);
    const session: StickySession = {
      sessionId,
      providerId,
      createdAt: now,
      lastSeenAt: now,
      stateful,
    };

    this.sessions.set(sessionId, session);
    this.sessionsByKey.set(stableKey(key), sessionId);
    return session;
  }

  getSession(sessionId: string): StickySession | undefined {
    const session = this.sessions.get(sessionId);
    if (session) {
      this.updateSession(sessionId);
    }

    return this.sessions.get(sessionId);
  }

  findSessionByKey(key: SessionKey): StickySession | undefined {
    const sessionId = this.sessionsByKey.get(stableKey(key));
    return sessionId ? this.getSession(sessionId) : undefined;
  }

  updateSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    this.sessions.set(sessionId, { ...session, lastSeenAt: Date.now() });
  }

  trackResponseOwnership(responseId: string, providerId: string, sessionId?: string): void {
    this.responseOwnership.set(responseId, {
      responseId,
      providerId,
      ...(sessionId ? { sessionId } : {}),
      createdAt: Date.now(),
    });
  }

  getProviderForResponse(responseId: string): string | undefined {
    return this.responseOwnership.get(responseId)?.providerId;
  }

  canFallback(responseId: string | undefined, targetProviderId: string): boolean {
    if (!responseId) {
      return true;
    }

    const ownerProviderId = this.getProviderForResponse(responseId);
    return ownerProviderId === undefined || ownerProviderId === targetProviderId;
  }

  resetAll(): void {
    this.sessions.clear();
    this.sessionsByKey.clear();
    this.responseOwnership.clear();
  }
}

export interface StickySession {
  sessionId: string;
  providerId: string;
  createdAt: number;
  lastSeenAt: number;
  stateful: boolean;
}

export interface ResponseOwnership {
  responseId: string;
  providerId: string;
  sessionId?: string;
  createdAt: number;
}

export interface SessionKey {
  authorizationIdentity?: string;
  cwd?: string;
  processId?: string;
  sessionId?: string;
}

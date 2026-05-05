import { describe, expect, it } from 'vitest';
import { StickySessionManager } from '../src/sticky-session-manager';

describe('StickySessionManager', () => {
  it('creates session with provider binding', () => {
    const session = new StickySessionManager().createSession({ sessionId: 's1' }, 'primary', true);

    expect(session).toMatchObject({ sessionId: 's1', providerId: 'primary', stateful: true });
  });

  it('looks up session by sessionId', () => {
    const manager = new StickySessionManager();
    manager.createSession({ sessionId: 's1' }, 'primary', true);

    expect(manager.getSession('s1')).toMatchObject({ sessionId: 's1', providerId: 'primary', stateful: true });
  });

  it('finds session by composite session key', () => {
    const manager = new StickySessionManager();
    const session = manager.createSession({ authorizationIdentity: 'user', cwd: '/repo', processId: '42' }, 'p1', true);

    expect(manager.findSessionByKey({ authorizationIdentity: 'user', cwd: '/repo', processId: '42' })).toMatchObject({
      sessionId: session.sessionId,
      providerId: 'p1',
      stateful: true,
    });
  });

  it('updates lastSeenAt on access', () => {
    const manager = new StickySessionManager();
    const session = manager.createSession({ sessionId: 's1' }, 'primary', true);
    const originalLastSeenAt = session.lastSeenAt;

    manager.updateSession('s1');

    expect(manager.getSession('s1')?.lastSeenAt).toBeGreaterThanOrEqual(originalLastSeenAt);
  });

  it('tracks response ownership and looks up provider by responseId', () => {
    const manager = new StickySessionManager();
    manager.trackResponseOwnership('resp_1', 'primary', 's1');

    expect(manager.getProviderForResponse('resp_1')).toBe('primary');
  });

  it('blocks fallback when previous response has different provider ownership', () => {
    const manager = new StickySessionManager();
    manager.trackResponseOwnership('resp_1', 'primary');

    expect(manager.canFallback('resp_1', 'secondary')).toBe(false);
  });

  it('allows fallback when previous response is from same provider', () => {
    const manager = new StickySessionManager();
    manager.trackResponseOwnership('resp_1', 'primary');

    expect(manager.canFallback('resp_1', 'primary')).toBe(true);
  });

  it('allows fallback when no previous_response_id is present', () => {
    expect(new StickySessionManager().canFallback(undefined, 'secondary')).toBe(true);
  });

  it('allows fallback when responseId is unknown', () => {
    expect(new StickySessionManager().canFallback('unknown', 'secondary')).toBe(true);
  });

  it('keeps all state ephemeral and resetAll clears everything', () => {
    const manager = new StickySessionManager();
    manager.createSession({ sessionId: 's1' }, 'primary', true);
    manager.trackResponseOwnership('resp_1', 'primary', 's1');

    manager.resetAll();

    expect(manager.getSession('s1')).toBeUndefined();
    expect(manager.getProviderForResponse('resp_1')).toBeUndefined();
  });
});

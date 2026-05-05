import { describe, expect, it } from 'vitest';
import { StreamSafetyManager } from '../src/stream-safety';

describe('StreamSafetyManager', () => {
  it('allows fallback before first byte received', () => {
    expect(new StreamSafetyManager().canFallback('req_1')).toBe(true);
  });

  it('blocks fallback after first byte received', () => {
    const manager = new StreamSafetyManager();
    manager.markFirstByteReceived('req_1');

    expect(manager.canFallback('req_1')).toBe(false);
  });

  it('blocks fallback when stream has started', () => {
    const manager = new StreamSafetyManager();
    manager.markStreamStarted('req_1');

    expect(manager.canFallback('req_1')).toBe(false);
  });

  it('allows next request to use fallback after stream failure', () => {
    const manager = new StreamSafetyManager();
    manager.markStreamStarted('req_1');
    manager.markRequestComplete('req_1');

    expect(manager.canFallback('req_2')).toBe(true);
  });

  it('tracks stream state per request', () => {
    const manager = new StreamSafetyManager();
    manager.markStreamStarted('req_1');

    expect(manager.canFallback('req_1')).toBe(false);
    expect(manager.canFallback('req_2')).toBe(true);
  });
});

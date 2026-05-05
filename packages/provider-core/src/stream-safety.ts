interface StreamState {
  started: boolean;
  firstByteReceived: boolean;
}

export class StreamSafetyManager {
  private readonly streams = new Map<string, StreamState>();

  markStreamStarted(requestId: string): void {
    const current = this.streams.get(requestId) ?? { started: false, firstByteReceived: false };
    this.streams.set(requestId, { ...current, started: true });
  }

  markFirstByteReceived(requestId: string): void {
    const current = this.streams.get(requestId) ?? { started: false, firstByteReceived: false };
    this.streams.set(requestId, { ...current, firstByteReceived: true });
  }

  canFallback(requestId: string): boolean {
    const current = this.streams.get(requestId);
    return current === undefined || (!current.started && !current.firstByteReceived);
  }

  markRequestComplete(requestId: string): void {
    this.streams.delete(requestId);
  }
}

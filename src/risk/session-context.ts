export interface SessionAction {
  toolName: string;
  params: Record<string, unknown>;
  riskScore: number;
  timestamp: string;
}

export class SessionContext {
  private sessions: Map<string, SessionAction[]> = new Map();

  record(sessionKey: string, action: SessionAction): void {
    let actions = this.sessions.get(sessionKey);
    if (!actions) {
      actions = [];
      this.sessions.set(sessionKey, actions);
    }
    actions.push(action);
  }

  getRecent(sessionKey: string, count: number): SessionAction[] {
    const actions = this.sessions.get(sessionKey);
    if (!actions) return [];
    return actions.slice(-count);
  }

  cleanup(sessionKey: string): void {
    this.sessions.delete(sessionKey);
  }

  /** Number of tracked sessions — useful for testing. */
  get size(): number {
    return this.sessions.size;
  }
}

export class SessionContext {
    sessions = new Map();
    record(sessionKey, action) {
        let actions = this.sessions.get(sessionKey);
        if (!actions) {
            actions = [];
            this.sessions.set(sessionKey, actions);
        }
        actions.push(action);
    }
    getRecent(sessionKey, count) {
        const actions = this.sessions.get(sessionKey);
        if (!actions)
            return [];
        return actions.slice(-count);
    }
    cleanup(sessionKey) {
        this.sessions.delete(sessionKey);
    }
    /** Number of tracked sessions — useful for testing. */
    get size() {
        return this.sessions.size;
    }
}
//# sourceMappingURL=session-context.js.map
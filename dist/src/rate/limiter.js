import * as fs from "node:fs";
import * as path from "node:path";
export class RateLimiter {
    counters = new Map();
    statePath;
    restored = false;
    constructor(statePath) {
        this.statePath = statePath;
    }
    /** Restore rate limit state from disk (idempotent). */
    restore() {
        if (this.restored)
            return;
        this.restored = true;
        try {
            if (fs.existsSync(this.statePath)) {
                const data = JSON.parse(fs.readFileSync(this.statePath, "utf-8"));
                this.counters = new Map(Object.entries(data));
            }
        }
        catch {
            // Start fresh if state is corrupted
            this.counters = new Map();
        }
    }
    /** Persist rate limit state to disk. */
    persist() {
        const dir = path.dirname(this.statePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        const data = {};
        for (const [key, timestamps] of this.counters) {
            data[key] = timestamps;
        }
        fs.writeFileSync(this.statePath, JSON.stringify(data));
    }
    /** Record a tool call for rate limiting. */
    record(toolName, ruleName) {
        this.restore();
        const key = ruleName ? `${toolName}:${ruleName}` : toolName;
        const timestamps = this.counters.get(key) || [];
        timestamps.push(Date.now());
        this.counters.set(key, timestamps);
    }
    /** Get the count of actions within a sliding window. */
    getCount(toolName, ruleName, windowSec) {
        this.restore();
        const key = `${toolName}:${ruleName}`;
        const timestamps = this.counters.get(key);
        if (!timestamps)
            return 0;
        const cutoff = Date.now() - windowSec * 1000;
        const valid = timestamps.filter((t) => t > cutoff);
        // Replace with only valid entries
        this.counters.set(key, valid);
        return valid.length;
    }
    /** Remove expired entries older than 24 hours. */
    cleanup() {
        const cutoff = Date.now() - 24 * 60 * 60 * 1000;
        for (const [key, timestamps] of this.counters) {
            const valid = timestamps.filter((t) => t > cutoff);
            if (valid.length === 0) {
                this.counters.delete(key);
            }
            else {
                this.counters.set(key, valid);
            }
        }
    }
}
//# sourceMappingURL=limiter.js.map
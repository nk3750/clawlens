import * as fs from "node:fs";
import * as yaml from "js-yaml";
export class PolicyLoader {
    engine;
    watcher = null;
    policyPath;
    logger;
    debounceTimer = null;
    constructor(engine, policyPath, logger) {
        this.engine = engine;
        this.policyPath = policyPath;
        this.logger = logger;
    }
    /** Load policy from disk. Throws on first load failure (plugin won't start). */
    load() {
        const content = fs.readFileSync(this.policyPath, "utf-8");
        const policy = this.parse(content);
        this.engine.load(policy);
        this.logger.info(`ClawLens: Policy loaded from ${this.policyPath} (${policy.rules.length} rules)`);
    }
    /** Start watching the policy file for changes. */
    startWatching() {
        if (this.watcher)
            return;
        this.watcher = fs.watch(this.policyPath, (eventType) => {
            if (eventType === "change") {
                // Debounce rapid file change events
                if (this.debounceTimer)
                    clearTimeout(this.debounceTimer);
                this.debounceTimer = setTimeout(() => this.reload(), 100);
            }
        });
        this.logger.info("ClawLens: Watching policy file for changes");
    }
    /** Stop watching the policy file. */
    stopWatching() {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = null;
        }
        if (this.watcher) {
            this.watcher.close();
            this.watcher = null;
        }
    }
    reload() {
        try {
            this.load();
            this.logger.info("ClawLens: Policy reloaded successfully");
        }
        catch (err) {
            // Keep last-known-good policy on reload failure
            this.logger.error("ClawLens: Policy reload failed, keeping last-known-good policy:", err);
        }
    }
    parse(content) {
        const raw = yaml.load(content);
        return this.validate(raw);
    }
    validate(raw) {
        if (!raw || typeof raw !== "object") {
            throw new Error("Policy must be a YAML object");
        }
        const doc = raw;
        if (!doc.version) {
            throw new Error("Policy must have a 'version' field");
        }
        if (!doc.rules || !Array.isArray(doc.rules)) {
            throw new Error("Policy must have a 'rules' array");
        }
        const rawDefaults = (doc.defaults || {});
        const defaults = {
            unknown_actions: validateAction(rawDefaults.unknown_actions, "approval_required", "defaults.unknown_actions"),
            approval_timeout: typeof rawDefaults.approval_timeout === "number" ? rawDefaults.approval_timeout : 300,
            timeout_action: validateTimeoutAction(rawDefaults.timeout_action, "deny"),
            digest: rawDefaults.digest || "daily",
        };
        const rules = doc.rules.map((r, i) => {
            if (!r || typeof r !== "object") {
                throw new Error(`Rule at index ${i} must be an object`);
            }
            const rule = r;
            if (!rule.name || typeof rule.name !== "string") {
                throw new Error(`Rule at index ${i} must have a 'name' string`);
            }
            if (!rule.action || typeof rule.action !== "string") {
                throw new Error(`Rule "${rule.name}" must have an 'action'`);
            }
            const action = validateAction(rule.action, undefined, `rule "${rule.name}"`);
            const match = (rule.match || {});
            const parsedMatch = {};
            if (match.tool !== undefined) {
                parsedMatch.tool = match.tool;
            }
            if (match.params !== undefined) {
                parsedMatch.params = match.params;
            }
            const parsed = {
                name: rule.name,
                match: parsedMatch,
                action,
            };
            if (rule.reason)
                parsed.reason = rule.reason;
            if (rule.severity)
                parsed.severity = rule.severity;
            if (rule.timeout)
                parsed.timeout = rule.timeout;
            if (rule.timeout_action)
                parsed.timeout_action = validateTimeoutAction(rule.timeout_action, undefined);
            if (rule.rate_limit && typeof rule.rate_limit === "object") {
                const rl = rule.rate_limit;
                parsed.rate_limit = {
                    max: rl.max,
                    window: rl.window,
                    on_exceed: validateAction(rl.on_exceed, "block", `rate_limit in rule "${rule.name}"`),
                    on_exceed_reason: rl.on_exceed_reason,
                };
            }
            return parsed;
        });
        return {
            version: String(doc.version),
            defaults,
            rules,
        };
    }
}
const VALID_ACTIONS = new Set(["allow", "block", "approval_required"]);
function validateAction(value, fallback, context) {
    if (!value) {
        if (fallback !== undefined)
            return fallback;
        throw new Error(`Missing action in ${context}`);
    }
    if (!VALID_ACTIONS.has(value)) {
        throw new Error(`Invalid action "${value}" in ${context}. Must be: allow, block, or approval_required`);
    }
    return value;
}
function validateTimeoutAction(value, fallback) {
    if (!value)
        return fallback || "deny";
    if (value !== "allow" && value !== "deny") {
        throw new Error(`Invalid timeout_action "${value}". Must be: allow or deny`);
    }
    return value;
}
//# sourceMappingURL=loader.js.map
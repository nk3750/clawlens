import * as fs from "node:fs";
import * as yaml from "js-yaml";
import type { Policy, PolicyAction, PolicyRule, Severity, TimeoutAction } from "./types";
import type { PolicyEngine } from "./engine";
import type { PluginLogger } from "../types";

export class PolicyLoader {
  private engine: PolicyEngine;
  private watcher: fs.FSWatcher | null = null;
  private policyPath: string;
  private logger: PluginLogger;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(engine: PolicyEngine, policyPath: string, logger: PluginLogger) {
    this.engine = engine;
    this.policyPath = policyPath;
    this.logger = logger;
  }

  /** Load policy from disk. Throws on first load failure (plugin won't start). */
  load(): void {
    const content = fs.readFileSync(this.policyPath, "utf-8");
    const policy = this.parse(content);
    this.engine.load(policy);
    this.logger.info(
      `ClawLens: Policy loaded from ${this.policyPath} (${policy.rules.length} rules)`,
    );
  }

  /** Start watching the policy file for changes. */
  startWatching(): void {
    if (this.watcher) return;
    this.watcher = fs.watch(this.policyPath, (eventType) => {
      if (eventType === "change") {
        // Debounce rapid file change events
        if (this.debounceTimer) clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => this.reload(), 100);
      }
    });
    this.logger.info("ClawLens: Watching policy file for changes");
  }

  /** Stop watching the policy file. */
  stopWatching(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }

  private reload(): void {
    try {
      this.load();
      this.logger.info("ClawLens: Policy reloaded successfully");
    } catch (err) {
      // Keep last-known-good policy on reload failure
      this.logger.error(
        "ClawLens: Policy reload failed, keeping last-known-good policy:",
        err,
      );
    }
  }

  private parse(content: string): Policy {
    const raw = yaml.load(content);
    return this.validate(raw);
  }

  private validate(raw: unknown): Policy {
    if (!raw || typeof raw !== "object") {
      throw new Error("Policy must be a YAML object");
    }

    const doc = raw as Record<string, unknown>;

    if (!doc.version) {
      throw new Error("Policy must have a 'version' field");
    }

    if (!doc.rules || !Array.isArray(doc.rules)) {
      throw new Error("Policy must have a 'rules' array");
    }

    const rawDefaults = (doc.defaults || {}) as Record<string, unknown>;
    const defaults = {
      unknown_actions: validateAction(
        rawDefaults.unknown_actions as string | undefined,
        "approval_required",
        "defaults.unknown_actions",
      ),
      approval_timeout:
        typeof rawDefaults.approval_timeout === "number"
          ? rawDefaults.approval_timeout
          : 300,
      timeout_action: validateTimeoutAction(
        rawDefaults.timeout_action as string | undefined,
        "deny",
      ),
      digest: (rawDefaults.digest as string) || "daily",
    };

    const rules: PolicyRule[] = doc.rules.map(
      (r: unknown, i: number) => {
        if (!r || typeof r !== "object") {
          throw new Error(`Rule at index ${i} must be an object`);
        }
        const rule = r as Record<string, unknown>;

        if (!rule.name || typeof rule.name !== "string") {
          throw new Error(`Rule at index ${i} must have a 'name' string`);
        }
        if (!rule.action || typeof rule.action !== "string") {
          throw new Error(`Rule "${rule.name}" must have an 'action'`);
        }

        const action = validateAction(
          rule.action as string,
          undefined,
          `rule "${rule.name}"`,
        );

        const match = (rule.match || {}) as Record<string, unknown>;
        const parsedMatch: PolicyRule["match"] = {};

        if (match.tool !== undefined) {
          parsedMatch.tool = match.tool as string | string[];
        }
        if (match.params !== undefined) {
          parsedMatch.params = match.params as Record<string, string>;
        }

        const parsed: PolicyRule = {
          name: rule.name as string,
          match: parsedMatch,
          action,
        };

        if (rule.reason) parsed.reason = rule.reason as string;
        if (rule.severity)
          parsed.severity = rule.severity as Severity;
        if (rule.timeout)
          parsed.timeout = rule.timeout as number;
        if (rule.timeout_action)
          parsed.timeout_action = validateTimeoutAction(
            rule.timeout_action as string,
            undefined,
          );

        if (rule.rate_limit && typeof rule.rate_limit === "object") {
          const rl = rule.rate_limit as Record<string, unknown>;
          parsed.rate_limit = {
            max: rl.max as number,
            window: rl.window as number,
            on_exceed: validateAction(
              rl.on_exceed as string,
              "block",
              `rate_limit in rule "${rule.name}"`,
            ),
            on_exceed_reason: rl.on_exceed_reason as string | undefined,
          };
        }

        return parsed;
      },
    );

    return {
      version: String(doc.version),
      defaults,
      rules,
    };
  }
}

const VALID_ACTIONS = new Set(["allow", "block", "approval_required"]);

function validateAction(
  value: string | undefined,
  fallback: PolicyAction | undefined,
  context: string,
): PolicyAction {
  if (!value) {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing action in ${context}`);
  }
  if (!VALID_ACTIONS.has(value)) {
    throw new Error(
      `Invalid action "${value}" in ${context}. Must be: allow, block, or approval_required`,
    );
  }
  return value as PolicyAction;
}

function validateTimeoutAction(
  value: string | undefined,
  fallback: TimeoutAction | undefined,
): TimeoutAction {
  if (!value) return fallback || "deny";
  if (value !== "allow" && value !== "deny") {
    throw new Error(
      `Invalid timeout_action "${value}". Must be: allow or deny`,
    );
  }
  return value;
}

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { minimatch } from "minimatch";
import { getCategory } from "../dashboard/categories.js";
import { parseExecCommand } from "../risk/exec-parser.js";
import {
  extractCommandForGuardrail,
  extractIdentityKey,
  extractPathsForGuardrail,
  extractUrlsForGuardrail,
} from "./identity.js";
import {
  type Guardrail,
  type GuardrailFile,
  isValidGuardrail,
  type NewGuardrail,
  type Selector,
  type Target,
} from "./types.js";

// ── Glob predicates ─────────────────────────────────────────
// A literal pattern (no glob metacharacters) is a per-rule fast-path
// candidate for identity-glob targets — direct string equality vs the
// memoized identity key, no minimatch. Cached on the rule at add/load time
// so the matcher doesn't rescan per call. Spec §5.3.

const GLOB_META_RE = /[*?[\]{}!]/;

function isLiteralPattern(pattern: string): boolean {
  return !GLOB_META_RE.test(pattern);
}

interface IndexedRule {
  rule: Guardrail;
  /** True iff target.kind === "identity-glob" AND pattern has no glob metachars. */
  literalIdentity: boolean;
}

function toIndexed(rule: Guardrail): IndexedRule {
  return {
    rule,
    literalIdentity: rule.target.kind === "identity-glob" && isLiteralPattern(rule.target.pattern),
  };
}

export class GuardrailStore {
  private rules: IndexedRule[] = [];
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  /**
   * Load guardrails from disk. Drops invalid entries (validated end-to-end
   * via isValidGuardrail) with a warning, then re-saves to clean up the
   * file. No version field, no migration logic — single coherent shape.
   */
  load(): void {
    this.rules = [];

    if (!fs.existsSync(this.filePath)) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(this.filePath, "utf-8"));
    } catch {
      console.warn(`[clawlens] guardrails: file ${this.filePath} is not valid JSON; ignoring`);
      return;
    }

    if (
      !parsed ||
      typeof parsed !== "object" ||
      !Array.isArray((parsed as GuardrailFile).guardrails)
    ) {
      console.warn(
        `[clawlens] guardrails: file ${this.filePath} missing 'guardrails' array; ignoring`,
      );
      return;
    }

    const all = (parsed as GuardrailFile).guardrails;
    const valid: Guardrail[] = [];
    let dropped = 0;
    for (const candidate of all) {
      if (isValidGuardrail(candidate)) {
        valid.push(candidate);
      } else {
        dropped++;
      }
    }
    if (dropped > 0) {
      console.warn(
        `[clawlens] guardrails: dropped ${dropped} invalid entr${dropped === 1 ? "y" : "ies"} from ${this.filePath}`,
      );
    }
    this.rules = valid.map(toIndexed);
    if (dropped > 0) {
      try {
        this.save();
      } catch (err) {
        console.warn(`[clawlens] guardrails: failed to clean file: ${String(err)}`);
      }
    }
  }

  /** Atomic save: write tmp + rename. */
  save(): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const data: GuardrailFile = { guardrails: this.rules.map((r) => r.rule) };
    const tmpPath = `${this.filePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
    fs.renameSync(tmpPath, this.filePath);
  }

  /**
   * Add a rule, persist, and (on save failure) roll back. For a security-
   * boundary store, in-memory state must never diverge from disk — a phantom
   * guardrail could match live tool calls until the next gateway restart.
   * Pattern mirrors src/risk/saved-searches-store.ts.
   */
  add(guardrail: Guardrail): void {
    this.rules.push(toIndexed(guardrail));
    try {
      this.save();
    } catch (err) {
      this.rules.pop();
      throw err;
    }
  }

  /** Remove by id, persist, rollback on save failure. */
  remove(id: string): boolean {
    const idx = this.rules.findIndex((r) => r.rule.id === id);
    if (idx === -1) return false;
    const [removed] = this.rules.splice(idx, 1);
    try {
      this.save();
    } catch (err) {
      this.rules.splice(idx, 0, removed);
      throw err;
    }
    return true;
  }

  /**
   * Patch action / note / selector.agent / selector.tools.values / target.pattern.
   * (selector.tools.mode, target.kind) remain immutable — they define rule
   * identity for idempotency, so mutating them silently is equivalent to
   * creating a different rule. Caller (the route handler) is responsible for
   * validating that toolsValues is only supplied for `mode === "names"` rules
   * and that targetPattern is a non-empty string. Rollback on save failure
   * restores every mutated field plus the cached `literalIdentity` flag.
   */
  update(
    id: string,
    patch: {
      action?: Guardrail["action"];
      note?: string;
      agent?: Guardrail["selector"]["agent"];
      toolsValues?: string[];
      targetPattern?: string;
    },
  ): Guardrail | null {
    const indexed = this.rules.find((r) => r.rule.id === id);
    if (!indexed) return null;
    const before = {
      action: indexed.rule.action,
      note: indexed.rule.note,
      selector: indexed.rule.selector,
      target: indexed.rule.target,
      literalIdentity: indexed.literalIdentity,
    };
    if (patch.action !== undefined) indexed.rule.action = patch.action;
    if (patch.note !== undefined) indexed.rule.note = patch.note;
    if (patch.agent !== undefined) {
      indexed.rule.selector = { ...indexed.rule.selector, agent: patch.agent };
    }
    if (patch.toolsValues !== undefined) {
      // Caller has validated existing tools.mode === "names"; reconstruct the
      // tool selector to preserve the discriminator narrowly.
      indexed.rule.selector = {
        ...indexed.rule.selector,
        tools: { mode: "names", values: patch.toolsValues },
      };
    }
    if (patch.targetPattern !== undefined) {
      // Spread distributes across the discriminated union — every variant
      // has `pattern: string`, so kind is preserved without an explicit switch.
      indexed.rule.target = { ...indexed.rule.target, pattern: patch.targetPattern };
      indexed.literalIdentity =
        indexed.rule.target.kind === "identity-glob" && isLiteralPattern(patch.targetPattern);
    }
    try {
      this.save();
    } catch (err) {
      indexed.rule.action = before.action;
      indexed.rule.note = before.note;
      indexed.rule.selector = before.selector;
      indexed.rule.target = before.target;
      indexed.literalIdentity = before.literalIdentity;
      throw err;
    }
    return indexed.rule;
  }

  /**
   * Match a tool call against the rule list. Single-pass scan in operator-
   * visible insertion order (first-match-wins, no severity precedence, no
   * agent-specific precedence, no fast-path bucket). Memoizes
   * extractIdentityKey across rules — invoked at most once per match() call.
   * Spec §5.
   */
  match(agentId: string, toolName: string, params: Record<string, unknown>): Guardrail | null {
    let cachedIdentityKey: string | undefined;
    const getIdentityKey = (): string => {
      if (cachedIdentityKey === undefined) {
        cachedIdentityKey = extractIdentityKey(toolName, params);
      }
      return cachedIdentityKey;
    };

    for (const indexed of this.rules) {
      if (!matchesSelector(indexed.rule.selector, agentId, toolName, params)) continue;
      if (!matchesTarget(indexed, toolName, params, getIdentityKey)) continue;
      return indexed.rule;
    }
    return null;
  }

  /** Read-only mirror of match() — kept as a separate method for clarity at
   *  call sites that want to express "I'm only inspecting, not gating." */
  peek(agentId: string, toolName: string, params: Record<string, unknown>): Guardrail | null {
    return this.match(agentId, toolName, params);
  }

  /**
   * Find a rule with the same canonical (selector, target). Idempotency
   * primitive — a POST whose canonical-form rule already exists returns the
   * existing rule. action/note differences do NOT make rules distinct;
   * names-mode value arrays are compared in canonical-sorted order. Spec §7.4.
   */
  findEquivalent(input: Pick<NewGuardrail, "selector" | "target">): Guardrail | null {
    for (const { rule } of this.rules) {
      if (
        selectorEquals(rule.selector, input.selector) &&
        targetEquals(rule.target, input.target)
      ) {
        return rule;
      }
    }
    return null;
  }

  /** List rules, optionally narrowed to one agent. Global rules (selector.agent
   *  null) are always included in agent-filtered results. */
  list(filters?: { agentId?: string }): Guardrail[] {
    if (!filters?.agentId) return this.rules.map((r) => r.rule);
    return this.rules
      .map((r) => r.rule)
      .filter((g) => g.selector.agent === filters.agentId || g.selector.agent === null);
  }

  static generateId(): string {
    return `gr_${crypto.randomBytes(6).toString("hex")}`;
  }
}

// ── Predicate helpers (module-private) ──────────────────────

function matchesSelector(
  s: Selector,
  agentId: string,
  toolName: string,
  params: Record<string, unknown>,
): boolean {
  if (s.agent !== null && s.agent !== agentId) return false;
  switch (s.tools.mode) {
    case "any":
      return true;
    case "names":
      return s.tools.values.includes(toolName);
    case "category": {
      const execCategory =
        toolName === "exec" && typeof params.command === "string"
          ? parseExecCommand(params.command).category
          : undefined;
      return getCategory(toolName, execCategory) === s.tools.value;
    }
  }
}

function matchesTarget(
  indexed: IndexedRule,
  toolName: string,
  params: Record<string, unknown>,
  getIdentityKey: () => string,
): boolean {
  const t = indexed.rule.target;
  switch (t.kind) {
    case "path-glob": {
      const paths = extractPathsForGuardrail(toolName, params);
      return paths.some((p) => safeMinimatch(p, t.pattern));
    }
    case "url-glob": {
      const urls = extractUrlsForGuardrail(toolName, params);
      return urls.some((u) => safeMinimatch(u, t.pattern));
    }
    case "command-glob": {
      const cmd = extractCommandForGuardrail(toolName, params);
      if (!cmd) return false;
      return safeMinimatch(cmd, t.pattern);
    }
    case "identity-glob": {
      const key = getIdentityKey();
      // Per-rule literal-pattern shortcut: direct string equality vs the
      // memoized identity key, no minimatch. Invisible to operators —
      // ordering is unchanged (first-match-wins, insertion order).
      if (indexed.literalIdentity) return key === t.pattern;
      return safeMinimatch(key, t.pattern);
    }
  }
}

function safeMinimatch(value: string, pattern: string): boolean {
  try {
    return minimatch(value, pattern);
  } catch {
    // Malformed glob — treat as no-match so the rule stays queryable for
    // edit/delete (spec §11). Don't crash the matcher on operator typo.
    return false;
  }
}

function selectorEquals(a: Selector, b: Selector): boolean {
  if (a.agent !== b.agent) return false;
  if (a.tools.mode !== b.tools.mode) return false;
  switch (a.tools.mode) {
    case "any":
      return true;
    case "names": {
      if (b.tools.mode !== "names") return false;
      const av = [...a.tools.values].sort();
      const bv = [...b.tools.values].sort();
      if (av.length !== bv.length) return false;
      return av.every((v, i) => v === bv[i]);
    }
    case "category":
      return b.tools.mode === "category" && a.tools.value === b.tools.value;
  }
}

function targetEquals(a: Target, b: Target): boolean {
  return a.kind === b.kind && a.pattern === b.pattern;
}

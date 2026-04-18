import * as crypto from "node:crypto";
import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import * as path from "node:path";
import { dedupeAuditEntries } from "./reader";

export interface AuditEntry {
  timestamp: string;
  toolName: string;
  toolCallId?: string;
  params: Record<string, unknown>;
  policyRule?: string;
  decision?: "allow" | "block" | "approval_required";
  severity?: string;
  userResponse?: "approved" | "denied" | "timeout";
  executionResult?: "success" | "failure";
  durationMs?: number;
  riskScore?: number;
  riskTier?: "low" | "medium" | "high" | "critical";
  riskTags?: string[];
  llmEvaluation?: {
    adjustedScore: number;
    reasoning: string;
    tags: string[];
    confidence: string;
    patterns: string[];
  };
  /** When present, this entry is an async evaluation appended for a prior tool call. */
  refToolCallId?: string;
  agentId?: string;
  sessionKey?: string;
  prevHash: string;
  hash: string;
}

export type AuditDecisionData = {
  timestamp: string;
  toolName: string;
  toolCallId?: string;
  params: Record<string, unknown>;
  policyRule?: string;
  decision: "allow" | "block" | "approval_required";
  severity?: string;
  riskScore?: number;
  riskTier?: "low" | "medium" | "high" | "critical";
  riskTags?: string[];
  agentId?: string;
  sessionKey?: string;
};

/** Window for detecting near-simultaneous double-writes of the same entry kind. */
const DOUBLE_WRITE_WINDOW_MS = 100;

export class AuditLogger extends EventEmitter {
  private filePath: string;
  private lastHash: string = "0";
  private writeStream: fs.WriteStream | null = null;
  /** Map of `toolCallId:kind` → last write epoch-ms. Used to flag suspected double-writes. */
  private recentWrites = new Map<string, number>();

  constructor(filePath: string) {
    super();
    this.filePath = filePath;
  }

  async init(): Promise<void> {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Read existing file to recover last hash for chain continuity
    if (fs.existsSync(this.filePath)) {
      const content = fs.readFileSync(this.filePath, "utf-8").trim();
      if (content) {
        const lines = content.split("\n");
        const lastLine = lines[lines.length - 1];
        try {
          const lastEntry = JSON.parse(lastLine) as AuditEntry;
          this.lastHash = lastEntry.hash;
        } catch {
          this.lastHash = "0";
        }
      }
    }

    this.writeStream = fs.createWriteStream(this.filePath, { flags: "a" });
  }

  private computeHash(entryWithoutHash: Omit<AuditEntry, "hash">): string {
    return crypto.createHash("sha256").update(JSON.stringify(entryWithoutHash)).digest("hex");
  }

  /** Ensure write stream is open. Called lazily on first write. */
  private ensureStream(): void {
    if (!this.writeStream) {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      // Recover last hash from existing file
      if (this.lastHash === "0" && fs.existsSync(this.filePath)) {
        const content = fs.readFileSync(this.filePath, "utf-8").trim();
        if (content) {
          const lines = content.split("\n");
          try {
            const lastEntry = JSON.parse(lines[lines.length - 1]) as AuditEntry;
            this.lastHash = lastEntry.hash;
          } catch {
            // ignore
          }
        }
      }
      this.writeStream = fs.createWriteStream(this.filePath, { flags: "a" });
    }
  }

  /**
   * Warn if the same (toolCallId, kind) was just appended within 100ms.
   * Helps diagnose duplicate hook firings or redundant writer callers —
   * production logs show 7× identical-timestamp decision bursts that
   * dedupe masks at read time; this instrumentation finds the source.
   */
  private maybeWarnDoubleWrite(data: Omit<AuditEntry, "prevHash" | "hash">): void {
    if (!data.toolCallId) return;
    const kind = data.decision
      ? "dec"
      : data.executionResult
        ? "res"
        : data.llmEvaluation
          ? "eval"
          : "other";
    const key = `${data.toolCallId}:${kind}`;
    const now = Date.now();
    const last = this.recentWrites.get(key);
    if (last !== undefined && now - last < DOUBLE_WRITE_WINDOW_MS) {
      const stack = new Error("audit double-write").stack?.split("\n").slice(2, 6).join("\n") ?? "";
      console.warn(
        `[clawlens] audit double-write: toolCallId=${data.toolCallId} kind=${kind} delta=${now - last}ms\n${stack}`,
      );
    }
    this.recentWrites.set(key, now);
    // Prune stale tracker entries so the map doesn't grow unbounded.
    if (this.recentWrites.size > 500) {
      for (const [k, t] of this.recentWrites) {
        if (now - t > 10_000) this.recentWrites.delete(k);
      }
    }
  }

  private append(data: Omit<AuditEntry, "prevHash" | "hash">): void {
    this.ensureStream();
    this.maybeWarnDoubleWrite(data);

    const entryWithPrev: Omit<AuditEntry, "hash"> = {
      ...data,
      prevHash: this.lastHash,
    };
    const hash = this.computeHash(entryWithPrev);
    const entry: AuditEntry = { ...entryWithPrev, hash };

    this.lastHash = hash;
    this.writeStream!.write(`${JSON.stringify(entry)}\n`);
    this.emit("entry", entry);
  }

  /** Log a policy decision (from before_tool_call). */
  logDecision(data: AuditDecisionData): void {
    this.append(data);
  }

  /** Log an approval resolution callback. */
  logApprovalResolution(data: {
    toolCallId?: string;
    toolName: string;
    approved: boolean;
    resolvedBy?: string;
    note?: string;
    agentId?: string;
  }): void {
    const params: Record<string, unknown> = { resolvedBy: data.resolvedBy };
    if (data.note !== undefined) params.note = data.note;
    this.append({
      timestamp: new Date().toISOString(),
      toolName: data.toolName,
      toolCallId: data.toolCallId,
      params,
      decision: data.approved ? "allow" : "block",
      userResponse: data.approved ? "approved" : "denied",
      agentId: data.agentId,
    });
  }

  /** Log a tool call result (from after_tool_call). */
  logResult(data: {
    timestamp: string;
    toolName: string;
    toolCallId?: string;
    executionResult: "success" | "failure";
    durationMs?: number;
    agentId?: string;
    sessionKey?: string;
  }): void {
    this.append({
      ...data,
      params: {},
    });
  }

  /**
   * Append an LLM evaluation entry that references the original tool call.
   * This preserves the hash chain (no in-place mutation) by adding a new
   * entry with refToolCallId pointing to the original.
   */
  appendEvaluation(data: {
    refToolCallId: string;
    toolName: string;
    llmEvaluation: NonNullable<AuditEntry["llmEvaluation"]>;
    riskScore: number;
    riskTier: NonNullable<AuditEntry["riskTier"]>;
    riskTags: string[];
    agentId?: string;
    sessionKey?: string;
  }): void {
    this.append({
      timestamp: new Date().toISOString(),
      toolName: data.toolName,
      toolCallId: data.refToolCallId,
      refToolCallId: data.refToolCallId,
      params: {},
      riskScore: data.riskScore,
      riskTier: data.riskTier,
      riskTags: data.riskTags,
      llmEvaluation: data.llmEvaluation,
      agentId: data.agentId,
      sessionKey: data.sessionKey,
    });
  }

  /** Log a guardrail match event. */
  logGuardrailMatch(data: {
    timestamp: string;
    toolCallId?: string;
    toolName: string;
    guardrailId: string;
    action: { type: string };
    identityKey: string;
    agentId: string;
    sessionKey?: string;
  }): void {
    this.append({
      timestamp: data.timestamp,
      toolName: data.toolName,
      toolCallId: data.toolCallId,
      params: {
        guardrailId: data.guardrailId,
        guardrailAction: data.action.type,
        identityKey: data.identityKey,
      },
      decision:
        data.action.type === "block"
          ? "block"
          : data.action.type === "require_approval"
            ? "approval_required"
            : "allow",
      agentId: data.agentId,
      sessionKey: data.sessionKey,
    });
  }

  /** Log a guardrail approval resolution. */
  logGuardrailResolution(data: {
    guardrailId: string;
    toolCallId?: string;
    toolName: string;
    approved: boolean;
    decision: string;
    storeAction?: "removed" | "unchanged";
    agentId?: string;
    sessionKey?: string;
  }): void {
    this.append({
      timestamp: new Date().toISOString(),
      toolName: data.toolName,
      toolCallId: data.toolCallId,
      params: {
        guardrailId: data.guardrailId,
        resolution: data.decision,
        storeAction: data.storeAction,
      },
      decision: data.approved ? "allow" : "block",
      userResponse: data.approved ? "approved" : "denied",
      agentId: data.agentId,
      sessionKey: data.sessionKey,
    });
  }

  /** Flush the write stream. */
  async flush(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (this.writeStream) {
        this.writeStream.end((err: Error | null) => {
          if (err) reject(err);
          else resolve();
        });
        this.writeStream = null;
      } else {
        resolve();
      }
    });
  }

  /**
   * Read all entries from the audit log file, with duplicate entries removed.
   * Wrapping at this level means every route.ts read path gets dedupe for free
   * without needing to change 10 call sites.
   */
  readEntries(): AuditEntry[] {
    return dedupeAuditEntries(this.readEntriesRaw());
  }

  /** Read entries with no post-processing. Used for hash-chain verification. */
  readEntriesRaw(): AuditEntry[] {
    if (!fs.existsSync(this.filePath)) return [];
    const content = fs.readFileSync(this.filePath, "utf-8").trim();
    if (!content) return [];
    return content.split("\n").map((line) => JSON.parse(line) as AuditEntry);
  }

  /** Verify the hash chain integrity of audit entries. */
  static verifyChain(entries: AuditEntry[]): { valid: boolean; brokenAt?: number } {
    let prevHash = "0";
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];

      // Check prevHash link
      if (entry.prevHash !== prevHash) {
        return { valid: false, brokenAt: i };
      }

      // Recompute and verify hash
      const { hash: _hash, ...rest } = entry;
      const computed = crypto.createHash("sha256").update(JSON.stringify(rest)).digest("hex");

      if (computed !== entry.hash) {
        return { valid: false, brokenAt: i };
      }

      prevHash = entry.hash;
    }
    return { valid: true };
  }
}

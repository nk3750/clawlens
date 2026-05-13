import * as crypto from "node:crypto";
import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import * as path from "node:path";
import { dedupeAuditEntries } from "./reader.js";
/** Window for detecting near-simultaneous double-writes of the same entry kind. */
const DOUBLE_WRITE_WINDOW_MS = 100;
const GLOBAL_AUDIT_LOGGER_CACHE = Symbol.for("clawlens.AuditLogger.instances");
/**
 * Return a process-singleton AuditLogger for the given file path.
 *
 * A globalThis-keyed cache (not a module-scoped Map) is required because
 * OpenClaw's sandboxed-agent path may fall back to the embedded runner, which
 * re-imports the plugin module fresh. Each module load gets its own module
 * scope, so a module-local Map gives one cache per load — back to the original
 * race. Symbol.for + globalThis is true process-singleton.
 */
export function getAuditLogger(filePath) {
    const g = globalThis;
    let cache = g[GLOBAL_AUDIT_LOGGER_CACHE];
    if (!cache) {
        cache = new Map();
        g[GLOBAL_AUDIT_LOGGER_CACHE] = cache;
    }
    let existing = cache.get(filePath);
    if (!existing) {
        existing = new AuditLogger(filePath);
        cache.set(filePath, existing);
    }
    return existing;
}
export class AuditLogger extends EventEmitter {
    filePath;
    lastHash = "0";
    writeStream = null;
    /** Map of `toolCallId:kind` → last write epoch-ms. Used to flag suspected double-writes. */
    recentWrites = new Map();
    _initialized = false;
    constructor(filePath) {
        super();
        this.filePath = filePath;
    }
    async init() {
        if (this._initialized) {
            return;
        }
        this._initialized = true;
        const dir = path.dirname(this.filePath);
        if (!fs.existsSync(dir)) {
            // POSIX: owner-only directory. On Windows the mode arg is a no-op and
            // ACLs inherit from the parent — README documents this caveat.
            fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
        }
        else {
            // Best-effort tighten of a pre-existing directory. chmod is a no-op on
            // Windows; swallow EPERM/EACCES on restricted filesystems instead of
            // failing plugin init.
            try {
                fs.chmodSync(dir, 0o700);
            }
            catch {
                // non-POSIX or non-writable — fall through
            }
        }
        // Read existing file to recover last hash for chain continuity
        if (fs.existsSync(this.filePath)) {
            const content = fs.readFileSync(this.filePath, "utf-8").trim();
            if (content) {
                const lines = content.split("\n");
                const lastLine = lines[lines.length - 1];
                try {
                    const lastEntry = JSON.parse(lastLine);
                    this.lastHash = lastEntry.hash;
                }
                catch {
                    this.lastHash = "0";
                }
            }
            // Best-effort tighten of a pre-existing file.
            try {
                fs.chmodSync(this.filePath, 0o600);
            }
            catch {
                // non-POSIX or non-writable — fall through
            }
        }
        this.writeStream = fs.createWriteStream(this.filePath, { flags: "a", mode: 0o600 });
    }
    computeHash(entryWithoutHash) {
        return crypto.createHash("sha256").update(JSON.stringify(entryWithoutHash)).digest("hex");
    }
    /** Ensure write stream is open. Called lazily on first write. */
    ensureStream() {
        if (!this.writeStream) {
            const dir = path.dirname(this.filePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
            }
            // Recover last hash from existing file
            if (this.lastHash === "0" && fs.existsSync(this.filePath)) {
                const content = fs.readFileSync(this.filePath, "utf-8").trim();
                if (content) {
                    const lines = content.split("\n");
                    try {
                        const lastEntry = JSON.parse(lines[lines.length - 1]);
                        this.lastHash = lastEntry.hash;
                    }
                    catch {
                        // ignore
                    }
                }
            }
            this.writeStream = fs.createWriteStream(this.filePath, { flags: "a", mode: 0o600 });
        }
    }
    /**
     * Warn if the same (toolCallId, kind) was just appended within 100ms.
     * Helps diagnose duplicate hook firings or redundant writer callers —
     * production logs show 7× identical-timestamp decision bursts that
     * dedupe masks at read time; this instrumentation finds the source.
     */
    maybeWarnDoubleWrite(data) {
        if (!data.toolCallId)
            return;
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
            console.warn(`[clawlens] audit double-write: toolCallId=${data.toolCallId} kind=${kind} delta=${now - last}ms\n${stack}`);
        }
        this.recentWrites.set(key, now);
        // Prune stale tracker entries so the map doesn't grow unbounded.
        if (this.recentWrites.size > 500) {
            for (const [k, t] of this.recentWrites) {
                if (now - t > 10_000)
                    this.recentWrites.delete(k);
            }
        }
    }
    append(data) {
        this.ensureStream();
        this.maybeWarnDoubleWrite(data);
        const entryWithPrev = {
            ...data,
            prevHash: this.lastHash,
        };
        const hash = this.computeHash(entryWithPrev);
        const entry = { ...entryWithPrev, hash };
        this.lastHash = hash;
        this.writeStream.write(`${JSON.stringify(entry)}\n`);
        this.emit("entry", entry);
    }
    /** Log a policy decision (from before_tool_call). */
    logDecision(data) {
        this.append(data);
    }
    /** Log an approval resolution callback. */
    logApprovalResolution(data) {
        const params = { resolvedBy: data.resolvedBy };
        if (data.note !== undefined)
            params.note = data.note;
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
    logResult(data) {
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
    appendEvaluation(data) {
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
    logGuardrailMatch(data) {
        this.append({
            timestamp: data.timestamp,
            toolName: data.toolName,
            toolCallId: data.toolCallId,
            params: {
                guardrailId: data.guardrailId,
                guardrailAction: data.action,
                identityKey: data.identityKey,
                targetSummary: data.targetSummary,
            },
            decision: data.action === "block"
                ? "block"
                : data.action === "require_approval"
                    ? "approval_required"
                    : "allow",
            riskScore: data.riskScore,
            riskTier: data.riskTier,
            riskTags: data.riskTags,
            agentId: data.agentId,
            sessionKey: data.sessionKey,
        });
    }
    /** Log a guardrail approval resolution. */
    logGuardrailResolution(data) {
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
    async flush() {
        return new Promise((resolve, reject) => {
            if (this.writeStream) {
                this.writeStream.end((err) => {
                    if (err)
                        reject(err);
                    else
                        resolve();
                });
                this.writeStream = null;
            }
            else {
                resolve();
            }
        });
    }
    /**
     * Read all entries from the audit log file, with duplicate entries removed.
     * Wrapping at this level means every route.ts read path gets dedupe for free
     * without needing to change 10 call sites.
     */
    readEntries() {
        return dedupeAuditEntries(this.readEntriesRaw());
    }
    /** Read entries with no post-processing. Used for hash-chain verification. */
    readEntriesRaw() {
        if (!fs.existsSync(this.filePath))
            return [];
        const content = fs.readFileSync(this.filePath, "utf-8").trim();
        if (!content)
            return [];
        return content.split("\n").map((line) => JSON.parse(line));
    }
    /** Verify the hash chain integrity of audit entries. */
    static verifyChain(entries) {
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
//# sourceMappingURL=logger.js.map
import * as crypto from "node:crypto";
import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import * as path from "node:path";
export class AuditLogger extends EventEmitter {
    filePath;
    lastHash = "0";
    writeStream = null;
    constructor(filePath) {
        super();
        this.filePath = filePath;
    }
    async init() {
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
                    const lastEntry = JSON.parse(lastLine);
                    this.lastHash = lastEntry.hash;
                }
                catch {
                    this.lastHash = "0";
                }
            }
        }
        this.writeStream = fs.createWriteStream(this.filePath, { flags: "a" });
    }
    computeHash(entryWithoutHash) {
        return crypto.createHash("sha256").update(JSON.stringify(entryWithoutHash)).digest("hex");
    }
    /** Ensure write stream is open. Called lazily on first write. */
    ensureStream() {
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
                        const lastEntry = JSON.parse(lines[lines.length - 1]);
                        this.lastHash = lastEntry.hash;
                    }
                    catch {
                        // ignore
                    }
                }
            }
            this.writeStream = fs.createWriteStream(this.filePath, { flags: "a" });
        }
    }
    append(data) {
        this.ensureStream();
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
        this.append({
            timestamp: new Date().toISOString(),
            toolName: data.toolName,
            toolCallId: data.toolCallId,
            params: { resolvedBy: data.resolvedBy },
            decision: data.approved ? "allow" : "block",
            userResponse: data.approved ? "approved" : "denied",
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
    /** Read all entries from the audit log file. */
    readEntries() {
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
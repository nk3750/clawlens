import * as fs from "node:fs";
import * as crypto from "node:crypto";
import * as path from "node:path";

export interface AuditEntry {
  timestamp: string;
  toolName: string;
  toolCallId?: string;
  params: Record<string, unknown>;
  policyRule?: string;
  decision: "allow" | "block" | "approval_required";
  severity?: string;
  userResponse?: "approved" | "denied" | "timeout";
  executionResult?: "success" | "failure";
  durationMs?: number;
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
};

export class AuditLogger {
  private filePath: string;
  private lastHash: string = "0";
  private writeStream: fs.WriteStream | null = null;

  constructor(filePath: string) {
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
    return crypto
      .createHash("sha256")
      .update(JSON.stringify(entryWithoutHash))
      .digest("hex");
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

  private append(data: Omit<AuditEntry, "prevHash" | "hash">): void {
    this.ensureStream();

    const entryWithPrev: Omit<AuditEntry, "hash"> = {
      ...data,
      prevHash: this.lastHash,
    };
    const hash = this.computeHash(entryWithPrev);
    const entry: AuditEntry = { ...entryWithPrev, hash };

    this.lastHash = hash;
    this.writeStream!.write(JSON.stringify(entry) + "\n");
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
  }): void {
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
  logResult(data: {
    timestamp: string;
    toolName: string;
    toolCallId?: string;
    executionResult: "success" | "failure";
    durationMs?: number;
  }): void {
    this.append({
      ...data,
      params: {},
      decision: "allow",
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

  /** Read all entries from the audit log file. */
  readEntries(): AuditEntry[] {
    if (!fs.existsSync(this.filePath)) return [];
    const content = fs.readFileSync(this.filePath, "utf-8").trim();
    if (!content) return [];
    return content.split("\n").map((line) => JSON.parse(line) as AuditEntry);
  }

  /** Verify the hash chain integrity of audit entries. */
  static verifyChain(
    entries: AuditEntry[],
  ): { valid: boolean; brokenAt?: number } {
    let prevHash = "0";
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];

      // Check prevHash link
      if (entry.prevHash !== prevHash) {
        return { valid: false, brokenAt: i };
      }

      // Recompute and verify hash
      const { hash: _hash, ...rest } = entry;
      const computed = crypto
        .createHash("sha256")
        .update(JSON.stringify(rest))
        .digest("hex");

      if (computed !== entry.hash) {
        return { valid: false, brokenAt: i };
      }

      prevHash = entry.hash;
    }
    return { valid: true };
  }
}

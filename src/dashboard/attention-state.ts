import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Attention acknowledgment state — append-only JSONL side-file. Not part of
 * the audit hash chain: these are user actions (review / dismiss), not
 * security-relevant events. Kept separate so the audit log stays canonical.
 *
 * Single-writer assumption: the gateway is single-process. If we ever go
 * multi-process, swap this for SQLite.
 */

export type AckScope =
  | { kind: "entry"; toolCallId: string }
  | { kind: "agent"; agentId: string; upToIso: string };

export interface AckRecord {
  id: string;
  scope: AckScope;
  ackedAt: string;
  ackedBy?: string;
  action: "ack" | "dismiss";
  note?: string;
}

/** True when `scope` is a structurally valid AckScope. Used for route body validation. */
export function isValidAckScope(scope: unknown): scope is AckScope {
  if (!scope || typeof scope !== "object") return false;
  const s = scope as Record<string, unknown>;
  if (s.kind === "entry") {
    return typeof s.toolCallId === "string" && s.toolCallId.length > 0;
  }
  if (s.kind === "agent") {
    return (
      typeof s.agentId === "string" &&
      s.agentId.length > 0 &&
      typeof s.upToIso === "string" &&
      !Number.isNaN(Date.parse(s.upToIso))
    );
  }
  return false;
}

export class AttentionStore {
  private cache: AckRecord[] | null = null;
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  /**
   * Append a record synchronously. The gateway needs read-your-own-writes —
   * an ack received over HTTP must be visible to the next GET /api/attention
   * in the same event loop. appendFileSync guarantees that; async fire-and-
   * forget does not.
   */
  append(record: AckRecord): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.appendFileSync(this.filePath, `${JSON.stringify(record)}\n`);
    // Invalidate cache so the next read reloads from disk. Cheaper than
    // mutating in place — loadAll() is O(n) on a small file.
    this.cache = null;
  }

  /** Load all records, caching on first read. */
  loadAll(): AckRecord[] {
    if (this.cache !== null) return this.cache;
    if (!fs.existsSync(this.filePath)) {
      this.cache = [];
      return this.cache;
    }
    const content = fs.readFileSync(this.filePath, "utf-8").trim();
    if (!content) {
      this.cache = [];
      return this.cache;
    }
    const records: AckRecord[] = [];
    for (const line of content.split("\n")) {
      if (!line) continue;
      try {
        records.push(JSON.parse(line) as AckRecord);
      } catch {
        // Skip malformed lines rather than abort — a single bad line must not
        // hide every other ack on disk.
      }
    }
    this.cache = records;
    return records;
  }

  /** Return the most-recent record for the given toolCallId, if any. */
  isAckedEntry(toolCallId: string): AckRecord | null {
    const records = this.loadAll();
    let match: AckRecord | null = null;
    for (const r of records) {
      if (r.scope.kind === "entry" && r.scope.toolCallId === toolCallId) {
        if (!match || r.ackedAt > match.ackedAt) match = r;
      }
    }
    return match;
  }

  /**
   * Agent-level ack/dismiss: covered only when an ack exists whose `upToIso`
   * is >= the event timestamp. A newer triggering event past that upToIso
   * re-raises the agent in the inbox.
   */
  isAckedAgent(agentId: string, eventIso: string): AckRecord | null {
    const records = this.loadAll();
    let match: AckRecord | null = null;
    for (const r of records) {
      if (r.scope.kind !== "agent") continue;
      if (r.scope.agentId !== agentId) continue;
      if (r.scope.upToIso < eventIso) continue;
      if (!match || r.ackedAt > match.ackedAt) match = r;
    }
    return match;
  }

  /** Generate a new ack record ID. */
  static generateId(): string {
    return `ack_${crypto.randomBytes(6).toString("hex")}`;
  }
}

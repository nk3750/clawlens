import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type AckRecord, AttentionStore, isValidAckScope } from "../src/dashboard/attention-state";

/** Build a temp dir per test so the JSONL file is isolated. */
function tmpStorePath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clawlens-attention-"));
  return path.join(dir, "attention.jsonl");
}

function record(overrides: Partial<AckRecord> = {}): AckRecord {
  return {
    id: AttentionStore.generateId(),
    scope: { kind: "entry", toolCallId: "tc_1" },
    ackedAt: new Date().toISOString(),
    action: "ack",
    ...overrides,
  };
}

describe("AttentionStore — append + loadAll", () => {
  let filePath: string;

  beforeEach(() => {
    filePath = tmpStorePath();
  });

  afterEach(() => {
    // mktempSync directory cleanup
    const dir = path.dirname(filePath);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  });

  it("creates the parent directory on first append", () => {
    const nested = path.join(path.dirname(filePath), "subdir", "attention.jsonl");
    const store = new AttentionStore(nested);
    store.append(record());
    expect(fs.existsSync(nested)).toBe(true);
  });

  it("persists records as JSONL (one record per line)", () => {
    const store = new AttentionStore(filePath);
    const r1 = record({ scope: { kind: "entry", toolCallId: "tc_a" } });
    const r2 = record({ scope: { kind: "entry", toolCallId: "tc_b" } });
    store.append(r1);
    store.append(r2);
    const lines = fs.readFileSync(filePath, "utf-8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toEqual(r1);
    expect(JSON.parse(lines[1])).toEqual(r2);
  });

  it("returns an empty array when the file does not exist", () => {
    const store = new AttentionStore(filePath);
    expect(store.loadAll()).toEqual([]);
  });

  it("returns an empty array when the file is empty", () => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, "");
    const store = new AttentionStore(filePath);
    expect(store.loadAll()).toEqual([]);
  });

  it("tolerates malformed lines by skipping them", () => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const valid = record({ id: "ack_good" });
    fs.writeFileSync(filePath, `${JSON.stringify(valid)}\n{not-json}\n`);
    const store = new AttentionStore(filePath);
    const all = store.loadAll();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe("ack_good");
  });

  it("caches loadAll() results, invalidating cache after append", () => {
    const store = new AttentionStore(filePath);
    store.append(record({ id: "ack_1" }));
    expect(store.loadAll()).toHaveLength(1);
    store.append(record({ id: "ack_2" }));
    expect(store.loadAll()).toHaveLength(2);
  });

  it("supports read-your-own-writes within the same event loop (sync append)", () => {
    const store = new AttentionStore(filePath);
    const r = record({ scope: { kind: "entry", toolCallId: "tc_now" } });
    store.append(r);
    // Immediate read must see it — no awaits, no delays.
    expect(store.isAckedEntry("tc_now")).not.toBeNull();
  });
});

describe("AttentionStore — isAckedEntry", () => {
  let filePath: string;

  beforeEach(() => {
    filePath = tmpStorePath();
  });

  afterEach(() => {
    fs.rmSync(path.dirname(filePath), { recursive: true, force: true });
  });

  it("returns null when no record exists for the tool call", () => {
    const store = new AttentionStore(filePath);
    expect(store.isAckedEntry("tc_missing")).toBeNull();
  });

  it("returns the record after appending an entry-scoped ack", () => {
    const store = new AttentionStore(filePath);
    const r = record({ scope: { kind: "entry", toolCallId: "tc_42" } });
    store.append(r);
    const got = store.isAckedEntry("tc_42");
    expect(got?.id).toBe(r.id);
  });

  it("prefers the most-recent record when multiple acks exist for the same tool call", () => {
    const store = new AttentionStore(filePath);
    store.append(
      record({
        id: "ack_old",
        scope: { kind: "entry", toolCallId: "tc_x" },
        ackedAt: "2026-04-17T10:00:00.000Z",
        action: "ack",
      }),
    );
    store.append(
      record({
        id: "ack_new",
        scope: { kind: "entry", toolCallId: "tc_x" },
        ackedAt: "2026-04-17T11:00:00.000Z",
        action: "dismiss",
      }),
    );
    expect(store.isAckedEntry("tc_x")?.id).toBe("ack_new");
  });

  it("ignores agent-scoped records when looking up an entry", () => {
    const store = new AttentionStore(filePath);
    store.append(
      record({
        scope: { kind: "agent", agentId: "alpha", upToIso: "2026-04-17T12:00:00.000Z" },
      }),
    );
    expect(store.isAckedEntry("tc_any")).toBeNull();
  });
});

describe("AttentionStore — isAckedAgent", () => {
  let filePath: string;

  beforeEach(() => {
    filePath = tmpStorePath();
  });

  afterEach(() => {
    fs.rmSync(path.dirname(filePath), { recursive: true, force: true });
  });

  it("returns the record when upToIso >= eventIso (ack covers the event)", () => {
    const store = new AttentionStore(filePath);
    store.append(
      record({
        scope: { kind: "agent", agentId: "alpha", upToIso: "2026-04-17T12:00:00.000Z" },
      }),
    );
    expect(store.isAckedAgent("alpha", "2026-04-17T11:00:00.000Z")).not.toBeNull();
    expect(store.isAckedAgent("alpha", "2026-04-17T12:00:00.000Z")).not.toBeNull();
  });

  it("returns null when upToIso < eventIso (a newer event re-raises the flag)", () => {
    const store = new AttentionStore(filePath);
    store.append(
      record({
        scope: { kind: "agent", agentId: "alpha", upToIso: "2026-04-17T12:00:00.000Z" },
      }),
    );
    // Event happened after the ack — not covered.
    expect(store.isAckedAgent("alpha", "2026-04-17T12:30:00.000Z")).toBeNull();
  });

  it("only matches the scoped agentId", () => {
    const store = new AttentionStore(filePath);
    store.append(
      record({
        scope: { kind: "agent", agentId: "alpha", upToIso: "2026-04-17T12:00:00.000Z" },
      }),
    );
    expect(store.isAckedAgent("beta", "2026-04-17T11:00:00.000Z")).toBeNull();
  });

  it("ignores entry-scoped records when looking up an agent", () => {
    const store = new AttentionStore(filePath);
    store.append(record({ scope: { kind: "entry", toolCallId: "tc_1" } }));
    expect(store.isAckedAgent("alpha", "2026-04-17T11:00:00.000Z")).toBeNull();
  });

  it("returns the latest covering record when there are multiple", () => {
    const store = new AttentionStore(filePath);
    store.append(
      record({
        id: "ack_A",
        scope: { kind: "agent", agentId: "alpha", upToIso: "2026-04-17T12:00:00.000Z" },
        ackedAt: "2026-04-17T12:00:00.500Z",
      }),
    );
    store.append(
      record({
        id: "ack_B",
        scope: { kind: "agent", agentId: "alpha", upToIso: "2026-04-17T13:00:00.000Z" },
        ackedAt: "2026-04-17T13:00:00.500Z",
      }),
    );
    expect(store.isAckedAgent("alpha", "2026-04-17T12:30:00.000Z")?.id).toBe("ack_B");
  });
});

describe("isValidAckScope", () => {
  it("accepts a well-formed entry scope", () => {
    expect(isValidAckScope({ kind: "entry", toolCallId: "tc_abc" })).toBe(true);
  });

  it("accepts a well-formed agent scope", () => {
    expect(
      isValidAckScope({
        kind: "agent",
        agentId: "alpha",
        upToIso: "2026-04-17T12:00:00.000Z",
      }),
    ).toBe(true);
  });

  it("rejects an entry scope with an empty toolCallId", () => {
    expect(isValidAckScope({ kind: "entry", toolCallId: "" })).toBe(false);
  });

  it("rejects an entry scope with a non-string toolCallId", () => {
    expect(isValidAckScope({ kind: "entry", toolCallId: 42 })).toBe(false);
  });

  it("rejects an agent scope missing upToIso", () => {
    expect(isValidAckScope({ kind: "agent", agentId: "alpha" })).toBe(false);
  });

  it("rejects an agent scope with an unparseable upToIso", () => {
    expect(isValidAckScope({ kind: "agent", agentId: "alpha", upToIso: "not-a-date" })).toBe(false);
  });

  it("rejects an unknown kind", () => {
    expect(isValidAckScope({ kind: "other", foo: "bar" })).toBe(false);
  });

  it("rejects primitives and null", () => {
    expect(isValidAckScope(null)).toBe(false);
    expect(isValidAckScope(undefined)).toBe(false);
    expect(isValidAckScope("entry")).toBe(false);
    expect(isValidAckScope(0)).toBe(false);
  });
});

describe("AttentionStore.generateId", () => {
  it("returns a unique ack_-prefixed id", () => {
    const a = AttentionStore.generateId();
    const b = AttentionStore.generateId();
    expect(a).toMatch(/^ack_[0-9a-f]{12}$/);
    expect(b).toMatch(/^ack_[0-9a-f]{12}$/);
    expect(a).not.toBe(b);
  });
});

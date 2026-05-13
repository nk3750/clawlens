import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type AuditEntry, AuditLogger, getAuditLogger } from "../src/audit/logger";

describe("AuditLogger", () => {
  let tmpDir: string;
  let logPath: string;
  let logger: AuditLogger;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "clawlens-test-"));
    logPath = path.join(tmpDir, "audit.jsonl");
    logger = new AuditLogger(logPath);
    await logger.init();
  });

  afterEach(async () => {
    await logger.flush();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes entries to JSONL file", async () => {
    logger.logDecision({
      timestamp: "2026-03-29T10:00:00Z",
      toolName: "exec",
      params: { command: "ls" },
      decision: "allow",
      policyRule: "Allow exec",
    });

    await logger.flush();

    const content = fs.readFileSync(logPath, "utf-8").trim();
    const entry = JSON.parse(content);
    expect(entry.toolName).toBe("exec");
    expect(entry.decision).toBe("allow");
    expect(entry.policyRule).toBe("Allow exec");
  });

  it("creates a valid SHA-256 hash chain", async () => {
    logger.logDecision({
      timestamp: "2026-03-29T10:00:00Z",
      toolName: "read",
      params: { path: "/tmp/a" },
      decision: "allow",
    });
    logger.logDecision({
      timestamp: "2026-03-29T10:01:00Z",
      toolName: "exec",
      params: { command: "ls" },
      decision: "approval_required",
    });
    logger.logDecision({
      timestamp: "2026-03-29T10:02:00Z",
      toolName: "exec",
      params: { command: "rm -rf /" },
      decision: "block",
    });

    await logger.flush();

    const entries = new AuditLogger(logPath).readEntries();
    expect(entries).toHaveLength(3);

    // First entry should have prevHash "0"
    expect(entries[0].prevHash).toBe("0");

    // Each entry's prevHash should match previous entry's hash
    expect(entries[1].prevHash).toBe(entries[0].hash);
    expect(entries[2].prevHash).toBe(entries[1].hash);

    // Verify chain
    const result = AuditLogger.verifyChain(entries);
    expect(result.valid).toBe(true);
  });

  it("detects tampering when an entry is modified", async () => {
    logger.logDecision({
      timestamp: "2026-03-29T10:00:00Z",
      toolName: "read",
      params: {},
      decision: "allow",
    });
    logger.logDecision({
      timestamp: "2026-03-29T10:01:00Z",
      toolName: "exec",
      params: { command: "ls" },
      decision: "allow",
    });
    logger.logDecision({
      timestamp: "2026-03-29T10:02:00Z",
      toolName: "write",
      params: { path: "/tmp/out" },
      decision: "approval_required",
    });

    await logger.flush();

    // Tamper with the second entry
    const entries = new AuditLogger(logPath).readEntries();
    entries[1].decision = "block"; // tamper!

    const result = AuditLogger.verifyChain(entries);
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(1);
  });

  it("detects broken chain when an entry is deleted", async () => {
    logger.logDecision({
      timestamp: "2026-03-29T10:00:00Z",
      toolName: "read",
      params: {},
      decision: "allow",
    });
    logger.logDecision({
      timestamp: "2026-03-29T10:01:00Z",
      toolName: "exec",
      params: {},
      decision: "allow",
    });
    logger.logDecision({
      timestamp: "2026-03-29T10:02:00Z",
      toolName: "write",
      params: {},
      decision: "allow",
    });

    await logger.flush();

    const entries = new AuditLogger(logPath).readEntries();
    // Delete entry 1 (keep 0 and 2)
    const tampered = [entries[0], entries[2]];

    const result = AuditLogger.verifyChain(tampered);
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(1);
  });

  it("resumes chain after reopening file", async () => {
    logger.logDecision({
      timestamp: "2026-03-29T10:00:00Z",
      toolName: "read",
      params: {},
      decision: "allow",
    });
    await logger.flush();

    // Create a new logger on the same file
    const logger2 = new AuditLogger(logPath);
    await logger2.init();

    logger2.logDecision({
      timestamp: "2026-03-29T10:01:00Z",
      toolName: "exec",
      params: {},
      decision: "allow",
    });
    await logger2.flush();

    const entries = new AuditLogger(logPath).readEntries();
    expect(entries).toHaveLength(2);

    const result = AuditLogger.verifyChain(entries);
    expect(result.valid).toBe(true);
  });

  it("logs approval resolutions", async () => {
    logger.logApprovalResolution({
      toolCallId: "tc_123",
      toolName: "exec",
      approved: true,
      resolvedBy: "user",
    });

    await logger.flush();

    const entries = new AuditLogger(logPath).readEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].userResponse).toBe("approved");
    expect(entries[0].toolName).toBe("exec");
  });

  it("logs tool results", async () => {
    logger.logResult({
      timestamp: "2026-03-29T10:00:00Z",
      toolName: "exec",
      toolCallId: "tc_456",
      executionResult: "success",
      durationMs: 150,
    });

    await logger.flush();

    const entries = new AuditLogger(logPath).readEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].executionResult).toBe("success");
    expect(entries[0].durationMs).toBe(150);
  });

  // ── agentId / sessionKey propagation (spec: audit-agent-id-propagation) ──

  it("logResult records agentId and sessionKey when provided", async () => {
    logger.logResult({
      timestamp: "2026-04-18T10:00:00Z",
      toolName: "exec",
      toolCallId: "tc_ag_1",
      executionResult: "success",
      durationMs: 42,
      agentId: "main",
      sessionKey: "session-abc",
    });

    await logger.flush();

    const entries = new AuditLogger(logPath).readEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].agentId).toBe("main");
    expect(entries[0].sessionKey).toBe("session-abc");
  });

  it("logResult still writes a valid entry when agentId and sessionKey are omitted (back-compat)", async () => {
    logger.logResult({
      timestamp: "2026-04-18T10:00:00Z",
      toolName: "exec",
      toolCallId: "tc_ag_2",
      executionResult: "failure",
    });

    await logger.flush();

    const entries = new AuditLogger(logPath).readEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].executionResult).toBe("failure");
    expect(entries[0].agentId).toBeUndefined();
    expect(entries[0].sessionKey).toBeUndefined();
    expect(AuditLogger.verifyChain(entries).valid).toBe(true);
  });

  it("appendEvaluation records agentId and sessionKey when provided", async () => {
    logger.appendEvaluation({
      refToolCallId: "tc_eval_1",
      toolName: "web_fetch",
      llmEvaluation: {
        adjustedScore: 42,
        reasoning: "Routine",
        tags: ["network"],
        confidence: "high",
        patterns: [],
      },
      riskScore: 42,
      riskTier: "medium",
      riskTags: ["network"],
      agentId: "worker-7",
      sessionKey: "session-xyz",
    });

    await logger.flush();

    const entries = new AuditLogger(logPath).readEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].agentId).toBe("worker-7");
    expect(entries[0].sessionKey).toBe("session-xyz");
    expect(entries[0].refToolCallId).toBe("tc_eval_1");
  });

  it("appendEvaluation still writes a valid entry when agentId and sessionKey are omitted (back-compat)", async () => {
    logger.appendEvaluation({
      refToolCallId: "tc_eval_2",
      toolName: "web_fetch",
      llmEvaluation: {
        adjustedScore: 42,
        reasoning: "Routine",
        tags: ["network"],
        confidence: "high",
        patterns: [],
      },
      riskScore: 42,
      riskTier: "medium",
      riskTags: ["network"],
    });

    await logger.flush();

    const entries = new AuditLogger(logPath).readEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].agentId).toBeUndefined();
    expect(entries[0].sessionKey).toBeUndefined();
    expect(entries[0].refToolCallId).toBe("tc_eval_2");
    expect(AuditLogger.verifyChain(entries).valid).toBe(true);
  });

  it("logGuardrailResolution records agentId and sessionKey when provided", async () => {
    logger.logGuardrailResolution({
      guardrailId: "gr_1",
      toolCallId: "tc_gr_1",
      toolName: "exec",
      approved: true,
      decision: "allow-once",
      agentId: "main",
      sessionKey: "session-abc",
    });

    await logger.flush();

    const entries = new AuditLogger(logPath).readEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].agentId).toBe("main");
    expect(entries[0].sessionKey).toBe("session-abc");
    expect(entries[0].userResponse).toBe("approved");
  });

  it("logGuardrailResolution still writes a valid entry when agentId and sessionKey are omitted (back-compat)", async () => {
    logger.logGuardrailResolution({
      guardrailId: "gr_2",
      toolCallId: "tc_gr_2",
      toolName: "exec",
      approved: false,
      decision: "deny",
    });

    await logger.flush();

    const entries = new AuditLogger(logPath).readEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].agentId).toBeUndefined();
    expect(entries[0].sessionKey).toBeUndefined();
    expect(entries[0].userResponse).toBe("denied");
    expect(AuditLogger.verifyChain(entries).valid).toBe(true);
  });

  it("logGuardrailMatch persists riskScore + riskTier + riskTags when supplied (closes the dashboard mix-bar gap)", async () => {
    // Before the fix the guardrail-match row carried no risk fields, so the
    // per-agent risk-mix bar in the dashboard couldn't bucket guardrail-blocked
    // entries (counted in todayToolCalls but absent from todayRiskMix). Pass
    // the upstream-computed score through so the row buckets naturally.
    logger.logGuardrailMatch({
      timestamp: "2026-04-25T10:00:00Z",
      toolCallId: "tc_gm_1",
      toolName: "exec",
      guardrailId: "gr_block",
      action: "block",
      identityKey: "exec:rm -rf /",
      agentId: "baddie",
      sessionKey: "session-xyz",
      riskScore: 90,
      riskTier: "critical",
      riskTags: ["destructive"],
    });

    await logger.flush();

    const entries = new AuditLogger(logPath).readEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].decision).toBe("block");
    expect(entries[0].riskScore).toBe(90);
    expect(entries[0].riskTier).toBe("critical");
    expect(entries[0].riskTags).toEqual(["destructive"]);
    expect(AuditLogger.verifyChain(entries).valid).toBe(true);
  });

  it("logGuardrailMatch still writes a valid entry without risk fields (back-compat for callers that don't supply them)", async () => {
    logger.logGuardrailMatch({
      timestamp: "2026-04-25T10:00:00Z",
      toolCallId: "tc_gm_2",
      toolName: "exec",
      guardrailId: "gr_appr",
      action: "require_approval",
      identityKey: "exec:curl https://example.com",
      agentId: "baddie",
    });

    await logger.flush();

    const entries = new AuditLogger(logPath).readEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].decision).toBe("approval_required");
    expect(entries[0].riskScore).toBeUndefined();
    expect(entries[0].riskTier).toBeUndefined();
    expect(entries[0].riskTags).toBeUndefined();
    expect(AuditLogger.verifyChain(entries).valid).toBe(true);
  });
});

describe("AuditLogger — POSIX permissions (v1.0.1)", () => {
  // POSIX-only: chmod is a best-effort no-op on Windows. Skip rather than
  // silently degrade the assertion.
  const isPosix = process.platform !== "win32";

  it("creates the audit directory with 0o700 mode", { skip: !isPosix }, async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "clawlens-perms-"));
    const dir = path.join(root, "nested-clawlens-dir");
    const logPath = path.join(dir, "audit.jsonl");
    try {
      const logger = new AuditLogger(logPath);
      await logger.init();
      const mode = fs.statSync(dir).mode & 0o777;
      expect(mode).toBe(0o700);
      await logger.flush();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("creates the audit file with 0o600 mode", { skip: !isPosix }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clawlens-perms-"));
    const logPath = path.join(dir, "audit.jsonl");
    try {
      const logger = new AuditLogger(logPath);
      await logger.init();
      // Write at least one entry so the file is actually created on disk.
      logger.logDecision({
        timestamp: "2026-05-12T00:00:00Z",
        toolName: "exec",
        params: {},
        decision: "allow",
      });
      await logger.flush();
      const mode = fs.statSync(logPath).mode & 0o777;
      expect(mode).toBe(0o600);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("chmods an existing directory to 0o700 on init", { skip: !isPosix }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clawlens-perms-"));
    const logPath = path.join(dir, "audit.jsonl");
    try {
      // Pre-create with overly permissive mode; init() should tighten it.
      fs.chmodSync(dir, 0o755);
      const logger = new AuditLogger(logPath);
      await logger.init();
      const mode = fs.statSync(dir).mode & 0o777;
      expect(mode).toBe(0o700);
      await logger.flush();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("chmods an existing audit file to 0o600 on init", { skip: !isPosix }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clawlens-perms-"));
    const logPath = path.join(dir, "audit.jsonl");
    try {
      // Pre-create file with overly permissive mode; init() should tighten it.
      fs.writeFileSync(logPath, "", { mode: 0o644 });
      fs.chmodSync(logPath, 0o644);
      const logger = new AuditLogger(logPath);
      await logger.init();
      const mode = fs.statSync(logPath).mode & 0o777;
      expect(mode).toBe(0o600);
      await logger.flush();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("AuditLogger — race regression lock", () => {
  it("preserves chain integrity when two callers race writes to the same file", async () => {
    const tmpPath = path.join(os.tmpdir(), `audit-race-${Date.now()}.jsonl`);
    try {
      // Without the singleton fix, two AuditLoggers constructed against the
      // same file each cache their own `lastHash` — concurrent appends produce
      // chain breaks. The fix routes both through getAuditLogger, returning
      // the SAME instance from globalThis cache.
      const a = getAuditLogger(tmpPath);
      const b = getAuditLogger(tmpPath);
      expect(a).toBe(b);

      await a.init();
      await b.init(); // must be idempotent

      for (let i = 0; i < 50; i++) {
        a.logDecision({
          timestamp: new Date().toISOString(),
          toolName: "exec",
          toolCallId: `race-a-${i}`,
          params: { command: `echo a-${i}` },
          decision: "allow",
        });
        b.logDecision({
          timestamp: new Date().toISOString(),
          toolName: "exec",
          toolCallId: `race-b-${i}`,
          params: { command: `echo b-${i}` },
          decision: "allow",
        });
      }

      await a.flush();

      const lines = fs.readFileSync(tmpPath, "utf-8").trim().split("\n");
      let expectedPrev = "0";
      for (const line of lines) {
        const entry = JSON.parse(line) as AuditEntry;
        expect(entry.prevHash).toBe(expectedPrev);
        expectedPrev = entry.hash;
      }
      expect(lines.length).toBe(100);
    } finally {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
      const cache = (globalThis as Record<symbol, unknown>)[
        Symbol.for("clawlens.AuditLogger.instances")
      ] as Map<string, AuditLogger> | undefined;
      cache?.delete(tmpPath);
    }
  });

  it("init() is idempotent — second call is a no-op", async () => {
    const tmpPath = path.join(os.tmpdir(), `audit-idem-${Date.now()}.jsonl`);
    try {
      const logger = getAuditLogger(tmpPath);
      await logger.init();
      logger.logDecision({
        timestamp: new Date().toISOString(),
        toolName: "exec",
        toolCallId: "idem-1",
        params: {},
        decision: "allow",
      });
      // Second init must be a no-op. If it re-opens the write stream the
      // first entry — still buffered in the now-orphaned stream — can race
      // against entries from the new stream, and re-reading the (still empty
      // on disk) file resets lastHash to "0" and breaks the chain for the
      // next append.
      await logger.init();
      logger.logDecision({
        timestamp: new Date().toISOString(),
        toolName: "exec",
        toolCallId: "idem-2",
        params: {},
        decision: "allow",
      });
      await logger.flush();
      const lines = fs.readFileSync(tmpPath, "utf-8").trim().split("\n");
      expect(lines.length).toBe(2);
      const [first, second] = lines.map((l) => JSON.parse(l) as AuditEntry);
      expect(second.prevHash).toBe(first.hash);
      expect(AuditLogger.verifyChain([first, second]).valid).toBe(true);
    } finally {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
      const cache = (globalThis as Record<symbol, unknown>)[
        Symbol.for("clawlens.AuditLogger.instances")
      ] as Map<string, AuditLogger> | undefined;
      cache?.delete(tmpPath);
    }
  });
});

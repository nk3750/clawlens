import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuditLogger } from "../src/audit/logger";

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
      action: { type: "block" },
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
      action: { type: "require_approval" },
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

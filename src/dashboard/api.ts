import { AuditLogger } from "../audit/logger";
import type { AuditEntry } from "../audit/logger";

// ── Response types ──────────────────────────────────────

export interface StatsResponse {
  total: number;
  allowed: number;
  approved: number;
  blocked: number;
  timedOut: number;
  pending: number;
}

export interface EnhancedStatsResponse extends StatsResponse {
  riskBreakdown: {
    low: number;
    medium: number;
    high: number;
    critical: number;
  };
  avgRiskScore: number;
  peakRiskScore: number;
  activeAgents: number;
  activeSessions: number;
}

export interface EntryResponse {
  timestamp: string;
  toolName: string;
  toolCallId?: string;
  params: Record<string, unknown>;
  policyRule?: string;
  decision?: string;
  effectiveDecision: string;
  severity?: string;
  userResponse?: string;
  executionResult?: string;
  durationMs?: number;
  riskScore?: number;
  riskTier?: string;
  riskTags?: string[];
  llmEvaluation?: {
    adjustedScore: number;
    reasoning: string;
    tags: string[];
    confidence: string;
    patterns: string[];
  };
  agentId?: string;
  sessionKey?: string;
}

export interface HealthResponse {
  valid: boolean;
  brokenAt?: number;
  totalEntries: number;
}

export interface AgentInfo {
  id: string;
  name: string;
  status: "active" | "idle";
  todayToolCalls: number;
  avgRiskScore: number;
  peakRiskScore: number;
  lastActiveTimestamp: string | null;
  currentSession?: {
    sessionKey: string;
    startTime: string;
    toolCallCount: number;
  };
}

export interface SessionInfo {
  sessionKey: string;
  agentId: string;
  startTime: string;
  endTime: string | null;
  duration: number | null;
  toolCallCount: number;
  avgRisk: number;
  peakRisk: number;
}

export interface AgentDetailResponse {
  agent: AgentInfo;
  recentActivity: EntryResponse[];
  sessions: SessionInfo[];
  totalSessions: number;
}

export interface SessionDetailResponse {
  session: SessionInfo;
  entries: EntryResponse[];
}

// ── Internal helpers ────────────────────────────────────

const ACTIVE_THRESHOLD_MS = 5 * 60 * 1000;

/** Filter entries to today (since midnight UTC). */
function getTodayEntries(entries: AuditEntry[]): AuditEntry[] {
  const now = new Date();
  const cutoff = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  ).toISOString();
  return entries.filter((e) => e.timestamp >= cutoff);
}

/** Compute the effective user-facing decision for an entry. */
export function getEffectiveDecision(entry: AuditEntry): string {
  if (entry.userResponse === "approved") return "approved";
  if (entry.userResponse === "denied") return "denied";
  if (entry.userResponse === "timeout") return "timeout";
  if (entry.decision === "allow") return "allow";
  if (entry.decision === "block") return "block";
  if (entry.decision === "approval_required") {
    // In observe mode, approval_required is logged but never enforced —
    // the action goes through. Only show "pending" if there's no result yet
    // AND no indication it was allowed through.
    return entry.executionResult ? entry.executionResult : "allow";
  }
  if (entry.executionResult) return entry.executionResult;
  return "unknown";
}

/** True if the entry represents a policy decision (not a result log). */
function isDecisionEntry(entry: AuditEntry): boolean {
  return entry.decision !== undefined;
}

function mapEntry(entry: AuditEntry, evalIndex?: Map<string, AuditEntry>): EntryResponse {
  // If there's an LLM eval for this tool call, use its adjusted score/tier/tags
  const evalEntry = entry.toolCallId ? evalIndex?.get(entry.toolCallId) : undefined;
  const llmEval = evalEntry?.llmEvaluation ?? entry.llmEvaluation;

  return {
    timestamp: entry.timestamp,
    toolName: entry.toolName,
    toolCallId: entry.toolCallId,
    params: entry.params,
    policyRule: entry.policyRule,
    decision: entry.decision,
    effectiveDecision: getEffectiveDecision(entry),
    severity: entry.severity,
    userResponse: entry.userResponse,
    executionResult: entry.executionResult,
    durationMs: entry.durationMs,
    riskScore: llmEval ? llmEval.adjustedScore : entry.riskScore,
    riskTier: evalEntry?.riskTier ?? entry.riskTier,
    riskTags: evalEntry?.riskTags ?? entry.riskTags,
    llmEvaluation: llmEval,
    agentId: entry.agentId,
    sessionKey: entry.sessionKey,
  };
}

/** Build an index of LLM evaluation entries keyed by the toolCallId they reference. */
function buildEvalIndex(entries: AuditEntry[]): Map<string, AuditEntry> {
  const index = new Map<string, AuditEntry>();
  for (const e of entries) {
    if (e.refToolCallId && e.llmEvaluation) {
      index.set(e.refToolCallId, e);
    }
  }
  return index;
}

function groupBySessions(entries: AuditEntry[]): Map<string, AuditEntry[]> {
  const sessions = new Map<string, AuditEntry[]>();
  for (const e of entries) {
    if (!e.sessionKey) continue;
    const existing = sessions.get(e.sessionKey);
    if (existing) {
      existing.push(e);
    } else {
      sessions.set(e.sessionKey, [e]);
    }
  }
  return sessions;
}

function buildSessionInfo(
  sessionKey: string,
  entries: AuditEntry[],
): SessionInfo {
  const sorted = [...entries].sort((a, b) =>
    a.timestamp.localeCompare(b.timestamp),
  );
  const startTime = sorted[0].timestamp;
  const endTime = sorted[sorted.length - 1].timestamp;
  const startMs = new Date(startTime).getTime();
  const endMs = new Date(endTime).getTime();

  const decisions = entries.filter(isDecisionEntry);
  let riskSum = 0;
  let riskCount = 0;
  let peakRisk = 0;
  for (const e of entries) {
    if (e.riskScore !== undefined) {
      riskSum += e.riskScore;
      riskCount++;
      if (e.riskScore > peakRisk) peakRisk = e.riskScore;
    }
  }

  return {
    sessionKey,
    agentId: entries.find((e) => e.agentId)?.agentId || "default",
    startTime,
    endTime,
    duration: endMs > startMs ? endMs - startMs : null,
    toolCallCount: decisions.length,
    avgRisk: riskCount > 0 ? Math.round(riskSum / riskCount) : 0,
    peakRisk,
  };
}

// ── Existing functions (unchanged signatures) ───────────

/** Compute today's decision counts. */
export function computeStats(entries: AuditEntry[]): StatsResponse {
  const todayDecisions = getTodayEntries(entries).filter(isDecisionEntry);

  let allowed = 0;
  let approved = 0;
  let blocked = 0;
  let timedOut = 0;
  let pending = 0;

  for (const entry of todayDecisions) {
    const eff = getEffectiveDecision(entry);
    switch (eff) {
      case "allow":
        allowed++;
        break;
      case "approved":
        approved++;
        break;
      case "block":
      case "denied":
        blocked++;
        break;
      case "timeout":
        timedOut++;
        break;
      case "pending":
        pending++;
        break;
    }
  }

  return {
    total: allowed + approved + blocked + timedOut,
    allowed,
    approved,
    blocked,
    timedOut,
    pending,
  };
}

/** Return paginated decision entries in reverse chronological order. */
export function getRecentEntries(
  entries: AuditEntry[],
  limit: number,
  offset: number,
): EntryResponse[] {
  const evalIdx = buildEvalIndex(entries);
  const decisions = entries.filter(isDecisionEntry).reverse();
  return decisions.slice(offset, offset + limit).map((e) => mapEntry(e, evalIdx));
}

/** Verify the hash chain integrity of all entries. */
export function checkHealth(entries: AuditEntry[]): HealthResponse {
  const result = AuditLogger.verifyChain(entries);
  return {
    valid: result.valid,
    brokenAt: result.brokenAt,
    totalEntries: entries.length,
  };
}

// ── New v2 functions ────────────────────────────────────

/** Enhanced stats with risk breakdown and active counts. */
export function computeEnhancedStats(
  entries: AuditEntry[],
): EnhancedStatsResponse {
  const base = computeStats(entries);
  const evalIdx = buildEvalIndex(entries);
  const todayDecisions = getTodayEntries(entries).filter(isDecisionEntry);

  let low = 0;
  let medium = 0;
  let high = 0;
  let critical = 0;
  let riskSum = 0;
  let riskCount = 0;
  let peakRisk = 0;

  for (const e of todayDecisions) {
    // Use LLM-adjusted score/tier when available
    const evalEntry = e.toolCallId ? evalIdx.get(e.toolCallId) : undefined;
    const effectiveScore = evalEntry?.llmEvaluation?.adjustedScore ?? e.riskScore;
    const effectiveTier = evalEntry?.riskTier ?? e.riskTier;

    if (effectiveTier === "low") low++;
    else if (effectiveTier === "medium") medium++;
    else if (effectiveTier === "high") high++;
    else if (effectiveTier === "critical") critical++;

    if (effectiveScore !== undefined) {
      riskSum += effectiveScore;
      riskCount++;
      if (effectiveScore > peakRisk) peakRisk = effectiveScore;
    }
  }

  const now = Date.now();
  const activeAgentIds = new Set<string>();
  const activeSessionKeys = new Set<string>();
  for (const e of entries) {
    if (now - new Date(e.timestamp).getTime() <= ACTIVE_THRESHOLD_MS) {
      if (e.agentId) activeAgentIds.add(e.agentId);
      if (e.sessionKey) activeSessionKeys.add(e.sessionKey);
    }
  }

  return {
    ...base,
    riskBreakdown: { low, medium, high, critical },
    avgRiskScore: riskCount > 0 ? Math.round(riskSum / riskCount) : 0,
    peakRiskScore: peakRisk,
    activeAgents: activeAgentIds.size,
    activeSessions: activeSessionKeys.size,
  };
}

/** Get aggregated agent list from audit entries. */
export function getAgents(entries: AuditEntry[]): AgentInfo[] {
  const agentMap = new Map<string, AuditEntry[]>();

  for (const e of entries) {
    const id = e.agentId || "default";
    const existing = agentMap.get(id);
    if (existing) {
      existing.push(e);
    } else {
      agentMap.set(id, [e]);
    }
  }

  const now = Date.now();
  const todayCutoff = new Date(
    Date.UTC(
      new Date().getUTCFullYear(),
      new Date().getUTCMonth(),
      new Date().getUTCDate(),
    ),
  ).toISOString();

  const agents: AgentInfo[] = [];

  for (const [id, agentEntries] of agentMap) {
    let lastTimestamp: string | null = null;
    for (const e of agentEntries) {
      if (!lastTimestamp || e.timestamp > lastTimestamp) {
        lastTimestamp = e.timestamp;
      }
    }

    const isActive = lastTimestamp
      ? now - new Date(lastTimestamp).getTime() <= ACTIVE_THRESHOLD_MS
      : false;

    const todayDecisions = agentEntries.filter(
      (e) => e.timestamp >= todayCutoff && isDecisionEntry(e),
    );

    let riskSum = 0;
    let riskCount = 0;
    let peakRisk = 0;
    for (const e of agentEntries) {
      if (e.riskScore !== undefined) {
        riskSum += e.riskScore;
        riskCount++;
        if (e.riskScore > peakRisk) peakRisk = e.riskScore;
      }
    }

    let currentSession: AgentInfo["currentSession"];
    if (isActive) {
      const withSession = agentEntries
        .filter((e) => e.sessionKey)
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp));

      if (withSession.length > 0) {
        const sessionKey = withSession[0].sessionKey!;
        const sessionEntries = agentEntries.filter(
          (e) => e.sessionKey === sessionKey,
        );
        const startTime = sessionEntries.reduce(
          (min, e) => (e.timestamp < min ? e.timestamp : min),
          sessionEntries[0].timestamp,
        );
        currentSession = {
          sessionKey,
          startTime,
          toolCallCount: sessionEntries.filter(isDecisionEntry).length,
        };
      }
    }

    agents.push({
      id,
      name: id,
      status: isActive ? "active" : "idle",
      todayToolCalls: todayDecisions.length,
      avgRiskScore: riskCount > 0 ? Math.round(riskSum / riskCount) : 0,
      peakRiskScore: peakRisk,
      lastActiveTimestamp: lastTimestamp,
      currentSession,
    });
  }

  agents.sort((a, b) => {
    if (a.status !== b.status) return a.status === "active" ? -1 : 1;
    return (b.lastActiveTimestamp || "").localeCompare(
      a.lastActiveTimestamp || "",
    );
  });

  return agents;
}

/** Get detailed info for a single agent. */
export function getAgentDetail(
  entries: AuditEntry[],
  agentId: string,
): AgentDetailResponse | null {
  const agentEntries = entries.filter(
    (e) => (e.agentId || "default") === agentId,
  );
  if (agentEntries.length === 0) return null;

  const agents = getAgents(entries);
  const agent = agents.find((a) => a.id === agentId);
  if (!agent) return null;

  const evalIdx = buildEvalIndex(entries);
  const recentActivity = agentEntries
    .filter(isDecisionEntry)
    .reverse()
    .slice(0, 20)
    .map((e) => mapEntry(e, evalIdx));

  const sessionMap = groupBySessions(agentEntries);
  const allSessions: SessionInfo[] = [];
  for (const [key, sEntries] of sessionMap) {
    allSessions.push(buildSessionInfo(key, sEntries));
  }
  allSessions.sort((a, b) => b.startTime.localeCompare(a.startTime));

  return {
    agent,
    recentActivity,
    sessions: allSessions.slice(0, 10),
    totalSessions: allSessions.length,
  };
}

/** Get paginated session list, optionally filtered by agent. */
export function getSessions(
  entries: AuditEntry[],
  agentId?: string,
  limit: number = 10,
  offset: number = 0,
): { sessions: SessionInfo[]; total: number } {
  let filtered = entries;
  if (agentId) {
    filtered = entries.filter((e) => (e.agentId || "default") === agentId);
  }

  const sessionMap = groupBySessions(filtered);
  const allSessions: SessionInfo[] = [];
  for (const [key, sEntries] of sessionMap) {
    allSessions.push(buildSessionInfo(key, sEntries));
  }
  allSessions.sort((a, b) => b.startTime.localeCompare(a.startTime));

  return {
    sessions: allSessions.slice(offset, offset + limit),
    total: allSessions.length,
  };
}

/** Get full detail for a single session. */
export function getSessionDetail(
  entries: AuditEntry[],
  sessionKey: string,
): SessionDetailResponse | null {
  const sessionEntries = entries.filter((e) => e.sessionKey === sessionKey);
  if (sessionEntries.length === 0) return null;

  const evalIdx = buildEvalIndex(entries);
  const session = buildSessionInfo(sessionKey, sessionEntries);
  const mappedEntries = sessionEntries
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    .map((e) => mapEntry(e, evalIdx));

  return { session, entries: mappedEntries };
}

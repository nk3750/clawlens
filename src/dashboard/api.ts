import type { AuditEntry } from "../audit/logger";
import { AuditLogger } from "../audit/logger";
import { parseExecCommand } from "../risk/exec-parser";
import {
  type ActivityCategory,
  computeBreakdown,
  describeAction,
  getCategory,
  parseSessionContext,
  type RiskPosture,
  riskPosture,
} from "./categories";

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
  riskPosture: RiskPosture;
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
  /** Original Tier 1 scorer output, before LLM adjustment. Only set when LLM eval exists. */
  originalRiskScore?: number;
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
  category: ActivityCategory;
  /** Exec sub-category from parseExecCommand (only set for exec tool calls). */
  execCategory?: string;
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
  mode: "interactive" | "scheduled";
  schedule?: string;
  currentContext?: string;
  riskPosture: RiskPosture;
  activityBreakdown: Record<ActivityCategory, number>;
  todayActivityBreakdown: Record<ActivityCategory, number>;
  latestAction?: string;
  latestActionTime?: string;
  needsAttention: boolean;
  attentionReason?: string;
}

export interface ToolSummaryItem {
  toolName: string;
  category: ActivityCategory;
  count: number;
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
  activityBreakdown: Record<ActivityCategory, number>;
  blockedCount: number;
  context?: string;
  toolSummary: ToolSummaryItem[];
  riskSparkline: number[];
}

export interface AgentDetailResponse {
  agent: AgentInfo;
  currentSessionActivity: EntryResponse[];
  recentActivity: EntryResponse[];
  sessions: SessionInfo[];
  totalSessions: number;
  riskTrend: Array<{
    timestamp: string;
    score: number;
    toolName: string;
  }>;
}

// ── Entry filters ──────────────────────────────────────

export interface EntryFilters {
  agent?: string;
  category?: ActivityCategory;
  riskTier?: "low" | "medium" | "high" | "critical";
  decision?: string;
  since?: "1h" | "6h" | "24h" | "7d" | "all";
}

export interface SessionDetailResponse {
  session: SessionInfo;
  entries: EntryResponse[];
}

// ── Internal helpers ────────────────────────────────────

const ACTIVE_THRESHOLD_MS = 5 * 60 * 1000;

/** Filter entries to the last 24 hours (rolling window, timezone-agnostic). */
function getTodayEntries(entries: AuditEntry[]): AuditEntry[] {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
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

/** Get the final effective risk score for an entry, using LLM-adjusted score when available. */
function getEffectiveScore(
  entry: AuditEntry,
  evalIdx?: Map<string, AuditEntry>,
): number | undefined {
  if (evalIdx && entry.toolCallId) {
    const evalEntry = evalIdx.get(entry.toolCallId);
    if (evalEntry?.llmEvaluation) {
      return evalEntry.llmEvaluation.adjustedScore;
    }
  }
  return entry.riskScore;
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
    originalRiskScore: llmEval ? entry.riskScore : undefined,
    riskTier: evalEntry?.riskTier ?? entry.riskTier,
    riskTags: evalEntry?.riskTags ?? entry.riskTags,
    llmEvaluation: llmEval,
    agentId: entry.agentId,
    sessionKey: entry.sessionKey,
    category: getCategory(entry.toolName),
    execCategory:
      entry.toolName === "exec" && typeof entry.params.command === "string"
        ? parseExecCommand(entry.params.command).category
        : undefined,
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

/**
 * Group entries into sessions. When a session key is reused across cron runs
 * with a gap > SESSION_GAP_MS between consecutive entries, split into separate
 * logical sessions (appending #2, #3 etc. to the key).
 */
const SESSION_GAP_MS = 30 * 60 * 1000; // 30 minutes

function groupBySessions(entries: AuditEntry[]): Map<string, AuditEntry[]> {
  // First pass: group by raw session key
  const raw = new Map<string, AuditEntry[]>();
  for (const e of entries) {
    if (!e.sessionKey) continue;
    const existing = raw.get(e.sessionKey);
    if (existing) {
      existing.push(e);
    } else {
      raw.set(e.sessionKey, [e]);
    }
  }

  // Second pass: split sessions with time gaps
  const sessions = new Map<string, AuditEntry[]>();
  for (const [key, group] of raw) {
    const sorted = group.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    let runIndex = 1;
    let current: AuditEntry[] = [sorted[0]];

    for (let i = 1; i < sorted.length; i++) {
      const gap =
        new Date(sorted[i].timestamp).getTime() - new Date(sorted[i - 1].timestamp).getTime();
      if (gap > SESSION_GAP_MS) {
        // Store current run
        const runKey = runIndex === 1 ? key : `${key}#${runIndex}`;
        sessions.set(runKey, current);
        runIndex++;
        current = [sorted[i]];
      } else {
        current.push(sorted[i]);
      }
    }
    // Store last run
    const runKey = runIndex === 1 ? key : `${key}#${runIndex}`;
    sessions.set(runKey, current);
  }

  return sessions;
}

/**
 * Resolve a session key (possibly with #N suffix from splitting) to its entries.
 * Handles both raw keys (exact match) and split keys (re-runs groupBySessions).
 */
function resolveSessionEntries(entries: AuditEntry[], sessionKey: string): AuditEntry[] {
  // Try direct match first (works for non-split sessions)
  const direct = entries.filter((e) => e.sessionKey === sessionKey);
  if (direct.length > 0) return direct;

  // If key has #N suffix, resolve through groupBySessions
  const hashIdx = sessionKey.lastIndexOf("#");
  if (hashIdx === -1) return [];

  const baseKey = sessionKey.slice(0, hashIdx);
  const baseEntries = entries.filter((e) => e.sessionKey === baseKey);
  if (baseEntries.length === 0) return [];

  const grouped = groupBySessions(baseEntries);
  return grouped.get(sessionKey) ?? [];
}

function buildSessionInfo(
  sessionKey: string,
  entries: AuditEntry[],
  evalIdx?: Map<string, AuditEntry>,
): SessionInfo {
  const sorted = [...entries].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const startTime = sorted[0].timestamp;
  const endTime = sorted[sorted.length - 1].timestamp;
  const startMs = new Date(startTime).getTime();
  const endMs = new Date(endTime).getTime();

  const decisions = entries.filter(isDecisionEntry);
  let riskSum = 0;
  let riskCount = 0;
  let peakRisk = 0;
  for (const e of entries) {
    const score = getEffectiveScore(e, evalIdx);
    if (score !== undefined) {
      riskSum += score;
      riskCount++;
      if (score > peakRisk) peakRisk = score;
    }
  }

  let blockedCount = 0;
  for (const e of decisions) {
    const eff = getEffectiveDecision(e);
    if (eff === "block" || eff === "denied") blockedCount++;
  }

  // Tool summary: count by toolName, top 5
  const toolCounts = new Map<string, number>();
  for (const e of decisions) {
    toolCounts.set(e.toolName, (toolCounts.get(e.toolName) || 0) + 1);
  }
  const toolSummary = [...toolCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([toolName, count]) => ({
      toolName,
      category: getCategory(toolName),
      count,
    }));

  // Risk sparkline: chronological risk scores (using LLM-adjusted when available), max 20 points
  const chronoScores = sorted
    .map((e) => getEffectiveScore(e, evalIdx))
    .filter((s): s is number => s !== undefined);
  let riskSparkline: number[];
  if (chronoScores.length <= 20) {
    riskSparkline = chronoScores;
  } else {
    riskSparkline = [];
    for (let i = 0; i < 20; i++) {
      const idx = Math.round((i * (chronoScores.length - 1)) / 19);
      riskSparkline.push(chronoScores[idx]);
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
    activityBreakdown: computeBreakdown(decisions),
    blockedCount,
    context: parseSessionContext(sessionKey),
    toolSummary,
    riskSparkline,
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

/** Return paginated decision entries in reverse chronological order, with optional filtering. */
export function getRecentEntries(
  entries: AuditEntry[],
  limit: number,
  offset: number,
  filters?: EntryFilters,
): EntryResponse[] {
  const evalIdx = buildEvalIndex(entries);
  let filtered = entries.filter(isDecisionEntry);

  if (filters) {
    if (filters.agent) {
      const agentId = filters.agent;
      filtered = filtered.filter((e) => (e.agentId || "default") === agentId);
    }
    if (filters.category) {
      const cat = filters.category;
      filtered = filtered.filter((e) => getCategory(e.toolName) === cat);
    }
    if (filters.riskTier) {
      const tier = filters.riskTier;
      filtered = filtered.filter((e) => e.riskTier === tier);
    }
    if (filters.decision) {
      const decision = filters.decision;
      filtered = filtered.filter((e) => getEffectiveDecision(e) === decision);
    }
    if (filters.since && filters.since !== "all") {
      const ms: Record<string, number> = {
        "1h": 3_600_000,
        "6h": 21_600_000,
        "24h": 86_400_000,
        "7d": 604_800_000,
      };
      const cutoff = new Date(Date.now() - ms[filters.since]).toISOString();
      filtered = filtered.filter((e) => e.timestamp >= cutoff);
    }
  }

  const reversed = filtered.reverse();
  return reversed.slice(offset, offset + limit).map((e) => mapEntry(e, evalIdx));
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
export function computeEnhancedStats(entries: AuditEntry[]): EnhancedStatsResponse {
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

  const avgScore = riskCount > 0 ? Math.round(riskSum / riskCount) : 0;
  let posture = riskPosture(avgScore);

  // Override: "high" if any entry in last hour has riskScore > 75
  const oneHourAgo = new Date(Date.now() - 3_600_000).toISOString();
  for (const e of todayDecisions) {
    const evalEntry = e.toolCallId ? evalIdx.get(e.toolCallId) : undefined;
    const score = evalEntry?.llmEvaluation?.adjustedScore ?? e.riskScore;
    if (e.timestamp >= oneHourAgo && score !== undefined && score > 75) {
      if (posture === "calm" || posture === "elevated") posture = "high";
      break;
    }
  }

  // Override: "critical" if any action was blocked in last 30 min
  const thirtyMinAgo = new Date(Date.now() - 1_800_000).toISOString();
  for (const e of todayDecisions) {
    if (e.timestamp >= thirtyMinAgo) {
      const eff = getEffectiveDecision(e);
      if (eff === "block" || eff === "denied") {
        posture = "critical";
        break;
      }
    }
  }

  return {
    ...base,
    riskBreakdown: { low, medium, high, critical },
    avgRiskScore: avgScore,
    peakRiskScore: peakRisk,
    activeAgents: activeAgentIds.size,
    activeSessions: activeSessionKeys.size,
    riskPosture: posture,
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
  const todayCutoff = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const thirtyMinAgo = new Date(now - 1_800_000).toISOString();
  const evalIdx = buildEvalIndex(entries);

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
      const score = getEffectiveScore(e, evalIdx);
      if (score !== undefined) {
        riskSum += score;
        riskCount++;
        if (score > peakRisk) peakRisk = score;
      }
    }

    let currentSession: AgentInfo["currentSession"];
    let currentSessionKey: string | undefined;
    // Find the most recent session (for both active and idle agents)
    const withSession = agentEntries
      .filter((e) => e.sessionKey)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    if (withSession.length > 0) {
      currentSessionKey = withSession[0].sessionKey!;
      if (isActive) {
        const sessionEntries = agentEntries.filter((e) => e.sessionKey === currentSessionKey);
        const startTime = sessionEntries.reduce(
          (min, e) => (e.timestamp < min ? e.timestamp : min),
          sessionEntries[0].timestamp,
        );
        currentSession = {
          sessionKey: currentSessionKey,
          startTime,
          toolCallCount: sessionEntries.filter(isDecisionEntry).length,
        };
      }
    }

    // Determine mode from session keys — exact match on ":cron:" segment
    const hasCronSession = agentEntries.some((e) => {
      if (!e.sessionKey) return false;
      const parts = e.sessionKey.split(":");
      return parts.length >= 3 && parts[2] === "cron";
    });
    const mode: "interactive" | "scheduled" = hasCronSession ? "scheduled" : "interactive";

    // Context from current/latest session
    const currentContext = currentSessionKey ? parseSessionContext(currentSessionKey) : undefined;

    // Activity breakdown from current session (or latest session if idle)
    const breakdownEntries = currentSessionKey
      ? agentEntries.filter((e) => e.sessionKey === currentSessionKey && isDecisionEntry(e))
      : todayDecisions;
    const activityBreakdown = computeBreakdown(breakdownEntries);

    // Today's activity breakdown (full day, for agent detail page)
    const todayActivityBreakdown = computeBreakdown(todayDecisions);

    // Latest action
    const latestDecision = agentEntries
      .filter(isDecisionEntry)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0];
    const latestAction = latestDecision ? describeAction(latestDecision) : undefined;
    const latestActionTime = latestDecision?.timestamp;

    // Risk posture from current/latest session (using LLM-adjusted scores)
    const sessionRiskEntries = currentSessionKey
      ? agentEntries.filter(
          (e) => e.sessionKey === currentSessionKey && getEffectiveScore(e, evalIdx) !== undefined,
        )
      : agentEntries.filter((e) => getEffectiveScore(e, evalIdx) !== undefined);
    let sessionRiskSum = 0;
    for (const e of sessionRiskEntries) {
      sessionRiskSum += getEffectiveScore(e, evalIdx)!;
    }
    const sessionAvg =
      sessionRiskEntries.length > 0 ? Math.round(sessionRiskSum / sessionRiskEntries.length) : 0;
    const agentPosture = riskPosture(sessionAvg);

    // Needs attention: pending approval, blocked in last 30 min, or session peak >= 75
    let needsAttention = false;
    let attentionReason: string | undefined;

    // Check for blocked actions in last 30 min
    for (const e of agentEntries) {
      if (e.timestamp >= thirtyMinAgo && isDecisionEntry(e)) {
        const eff = getEffectiveDecision(e);
        if (eff === "block" || eff === "denied") {
          needsAttention = true;
          attentionReason = `Blocked: ${e.toolName}`;
          break;
        }
      }
    }

    // Check for high peak risk in current session
    if (!needsAttention && peakRisk >= 75) {
      needsAttention = true;
      attentionReason = "High risk activity detected";
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
      mode,
      currentContext,
      riskPosture: agentPosture,
      activityBreakdown,
      todayActivityBreakdown,
      latestAction,
      latestActionTime,
      needsAttention,
      attentionReason,
    });
  }

  agents.sort((a, b) => {
    if (a.status !== b.status) return a.status === "active" ? -1 : 1;
    return (b.lastActiveTimestamp || "").localeCompare(a.lastActiveTimestamp || "");
  });

  return agents;
}

/** Get detailed info for a single agent. */
const RANGE_MS: Record<string, number> = {
  "3h": 3 * 3600000,
  "6h": 6 * 3600000,
  "12h": 12 * 3600000,
  "24h": 24 * 3600000,
};

export function getAgentDetail(
  entries: AuditEntry[],
  agentId: string,
  range?: string,
): AgentDetailResponse | null {
  const agentEntries = entries.filter((e) => (e.agentId || "default") === agentId);
  if (agentEntries.length === 0) return null;

  const agents = getAgents(entries);
  const agent = agents.find((a) => a.id === agentId);
  if (!agent) return null;

  const rangeMs = RANGE_MS[range ?? ""] ?? RANGE_MS["24h"];
  const windowCutoff = new Date(Date.now() - rangeMs).toISOString();

  const evalIdx = buildEvalIndex(entries);
  const recentActivity = agentEntries
    .filter((e) => isDecisionEntry(e) && e.timestamp >= windowCutoff)
    .reverse()
    .slice(0, 200)
    .map((e) => mapEntry(e, evalIdx));

  // Current session activity: entries filtered to current session only
  const currentSessionKey = agent.currentSession?.sessionKey;
  const currentSessionActivity = currentSessionKey
    ? agentEntries
        .filter((e) => e.sessionKey === currentSessionKey && isDecisionEntry(e))
        .reverse()
        .map((e) => mapEntry(e, evalIdx))
    : [];

  const sessionMap = groupBySessions(agentEntries);
  const allSessions: SessionInfo[] = [];
  for (const [key, sEntries] of sessionMap) {
    allSessions.push(buildSessionInfo(key, sEntries, evalIdx));
  }
  allSessions.sort((a, b) => (b.endTime ?? b.startTime).localeCompare(a.endTime ?? a.startTime));

  // Build reverse lookup: entry timestamp → split session key
  // so riskTrend points navigate to the correct sub-session (#2, #3, etc.)
  const splitSessionIndex = new Map<string, string>();
  for (const [splitKey, sEntries] of sessionMap) {
    for (const e of sEntries) {
      const entryKey = e.toolCallId ?? e.timestamp;
      splitSessionIndex.set(entryKey, splitKey);
    }
  }

  // Risk trend: decision entries within range window with scores, chronological
  const riskTrend = agentEntries
    .filter((e) => isDecisionEntry(e) && e.timestamp >= windowCutoff && e.riskScore !== undefined)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    .slice(0, 200)
    .map((e) => {
      const evalEntry = e.toolCallId ? evalIdx.get(e.toolCallId) : undefined;
      const score = evalEntry?.llmEvaluation?.adjustedScore ?? e.riskScore ?? 0;
      const entryKey = e.toolCallId ?? e.timestamp;
      return {
        timestamp: e.timestamp,
        score,
        toolName: e.toolName,
        sessionKey: splitSessionIndex.get(entryKey) ?? e.sessionKey,
        toolCallId: e.toolCallId,
      };
    });

  return {
    agent,
    currentSessionActivity,
    recentActivity,
    sessions: allSessions.slice(0, 10),
    totalSessions: allSessions.length,
    riskTrend,
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

  const evalIdx = buildEvalIndex(entries);
  const sessionMap = groupBySessions(filtered);
  const allSessions: SessionInfo[] = [];
  for (const [key, sEntries] of sessionMap) {
    allSessions.push(buildSessionInfo(key, sEntries, evalIdx));
  }
  allSessions.sort((a, b) => (b.endTime ?? b.startTime).localeCompare(a.endTime ?? a.startTime));

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
  const sessionEntries = resolveSessionEntries(entries, sessionKey);
  if (sessionEntries.length === 0) return null;

  const evalIdx = buildEvalIndex(entries);
  const session = buildSessionInfo(sessionKey, sessionEntries, evalIdx);
  const mappedEntries = sessionEntries
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    .map((e) => mapEntry(e, evalIdx));

  return { session, entries: mappedEntries };
}

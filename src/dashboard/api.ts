import type { AuditEntry } from "../audit/logger";
import { AuditLogger } from "../audit/logger";
import { extractIdentityKey } from "../guardrails/identity";
import type { GuardrailStore } from "../guardrails/store";
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

/** Fallback agent ID when audit entries have no agentId. */
export const DEFAULT_AGENT_ID = "default";

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
  historicDailyMax: number;
  yesterdayTotal: number;
}

export interface InterventionEntry {
  timestamp: string;
  agentId: string;
  agentName: string;
  toolName: string;
  description: string;
  riskScore: number;
  riskTier: string;
  decision: string;
  effectiveDecision: string;
  sessionKey?: string;
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
  /** Present when an active guardrail matches this entry's tool + identity key. */
  guardrailMatch?: {
    id: string;
    action: { type: string };
  };
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
  blockedCount: number;
  riskProfile: Record<string, number>;
  topRisk?: {
    description: string;
    score: number;
    tier: string;
  };
  hourlyActivity: number[];
  lastSessionKey?: string;
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

/** Today's date in local time as YYYY-MM-DD. */
export function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Extract the local-date portion (YYYY-MM-DD) of a UTC ISO timestamp. */
export function localDateOf(isoTimestamp: string): string {
  const d = new Date(isoTimestamp);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Local midnight for a YYYY-MM-DD date string, as epoch ms.
 *  The key trick: `new Date("2026-04-12T00:00:00")` without "Z" is parsed as local time. */
function localMidnightMs(dateStr: string): number {
  return new Date(`${dateStr}T00:00:00`).getTime();
}

/** Filter entries to today (local calendar day). */
function getTodayEntries(entries: AuditEntry[]): AuditEntry[] {
  const today = localToday();
  return entries.filter((e) => localDateOf(e.timestamp) === today);
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

function mapEntry(
  entry: AuditEntry,
  evalIndex?: Map<string, AuditEntry>,
  guardrailStore?: GuardrailStore,
): EntryResponse {
  // If there's an LLM eval for this tool call, use its adjusted score/tier/tags
  const evalEntry = entry.toolCallId ? evalIndex?.get(entry.toolCallId) : undefined;
  const llmEval = evalEntry?.llmEvaluation ?? entry.llmEvaluation;

  // Check if an active guardrail matches this entry
  let guardrailMatch: EntryResponse["guardrailMatch"];
  if (guardrailStore && entry.decision) {
    const key = extractIdentityKey(entry.toolName, entry.params);
    const matched = guardrailStore.peek(entry.agentId || "unknown", entry.toolName, key);
    if (matched) {
      guardrailMatch = { id: matched.id, action: matched.action };
    }
  }

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
    guardrailMatch,
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

// ── Date-filtered helpers ──────────────────────────────

/** Filter entries to a specific calendar day (YYYY-MM-DD, local time). */
function getDayEntries(entries: AuditEntry[], date: string): AuditEntry[] {
  return entries.filter((e) => localDateOf(e.timestamp) === date);
}

/** Max single-day action count across all history. Returns 100 as fallback for fresh installs. */
export function computeHistoricDailyMax(entries: AuditEntry[]): number {
  const byDay = new Map<string, number>();
  for (const entry of entries) {
    if (!entry.decision) continue;
    const day = localDateOf(entry.timestamp);
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
  }
  if (byDay.size === 0) return 100;
  return Math.max(...byDay.values());
}

/** Blocked + approval_required entries for a day, most recent first. Optionally includes high-risk allowed entries (Tier 3). */
export function getInterventions(
  entries: AuditEntry[],
  date?: string,
  guardrailStore?: GuardrailStore,
): InterventionEntry[] {
  const dayEntries = date ? getDayEntries(entries, date) : getTodayEntries(entries);
  const evalIdx = buildEvalIndex(entries);

  const blockAndApproval: InterventionEntry[] = dayEntries
    .filter((e) => e.decision === "block" || e.decision === "approval_required")
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, 20)
    .map((e) => {
      const score = getEffectiveScore(e, evalIdx) ?? e.riskScore ?? 0;
      return {
        timestamp: e.timestamp,
        agentId: e.agentId ?? DEFAULT_AGENT_ID,
        agentName: e.agentId ?? DEFAULT_AGENT_ID,
        toolName: e.toolName,
        description: describeAction(e),
        riskScore: score,
        riskTier: score > 75 ? "critical" : score > 50 ? "high" : score > 25 ? "medium" : "low",
        decision: e.decision!,
        effectiveDecision: getEffectiveDecision(e),
        sessionKey: e.sessionKey,
      };
    });

  // Tier 3: high-risk allowed entries with no guardrail match (last 30 minutes)
  const thirtyMinAgo = new Date(Date.now() - 30 * 60_000).toISOString();
  const highRisk: InterventionEntry[] = dayEntries
    .filter((e) => {
      if (e.decision !== "allow") return false;
      if (e.timestamp < thirtyMinAgo) return false;
      const score = getEffectiveScore(e, evalIdx);
      if (score === undefined || score < 65) return false;
      // Exclude entries that have a matching guardrail
      if (guardrailStore) {
        const key = extractIdentityKey(e.toolName, e.params);
        if (guardrailStore.peek(e.agentId || DEFAULT_AGENT_ID, e.toolName, key)) return false;
      }
      return true;
    })
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, 10)
    .map((e) => {
      const score = getEffectiveScore(e, evalIdx) ?? e.riskScore ?? 0;
      return {
        timestamp: e.timestamp,
        agentId: e.agentId ?? DEFAULT_AGENT_ID,
        agentName: e.agentId ?? DEFAULT_AGENT_ID,
        toolName: e.toolName,
        description: describeAction(e),
        riskScore: score,
        riskTier: score > 75 ? "critical" : score > 50 ? "high" : score > 25 ? "medium" : "low",
        decision: e.decision!,
        effectiveDecision: "high_risk",
        sessionKey: e.sessionKey,
      };
    });

  return [...blockAndApproval, ...highRisk];
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
  guardrailStore?: GuardrailStore,
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

  // Build split session index so entries get correct sub-session keys (#2, #3, etc.)
  const sessionMap = groupBySessions(entries.filter((e) => e.sessionKey));
  const splitSessionIndex = new Map<string, string>();
  for (const [splitKey, sEntries] of sessionMap) {
    for (const e of sEntries) {
      const entryKey = e.toolCallId ?? e.timestamp;
      splitSessionIndex.set(entryKey, splitKey);
    }
  }

  const reversed = filtered.reverse();
  return reversed.slice(offset, offset + limit).map((e) => {
    const mapped = mapEntry(e, evalIdx, guardrailStore);
    const entryKey = e.toolCallId ?? e.timestamp;
    mapped.sessionKey = splitSessionIndex.get(entryKey) ?? mapped.sessionKey;
    return mapped;
  });
}

/**
 * Resolve the split session key for a single entry.
 * Used by the SSE handler to emit entries with correct sub-session keys.
 */
export function resolveSplitKeyForEntry(
  allEntries: AuditEntry[],
  entry: AuditEntry,
): string | undefined {
  if (!entry.sessionKey) return undefined;
  const sessionEntries = allEntries.filter((e) => e.sessionKey === entry.sessionKey);
  if (sessionEntries.length <= 1) return entry.sessionKey;

  const grouped = groupBySessions(sessionEntries);
  const entryKey = entry.toolCallId ?? entry.timestamp;
  for (const [splitKey, splitEntries] of grouped) {
    if (splitEntries.some((e) => (e.toolCallId ?? e.timestamp) === entryKey)) {
      return splitKey;
    }
  }
  return entry.sessionKey;
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

/** Enhanced stats with risk breakdown and active counts. Accepts optional date for past-day view. */
export function computeEnhancedStats(entries: AuditEntry[], date?: string): EnhancedStatsResponse {
  const isPastDay = date !== undefined;
  const windowEntries = isPastDay ? getDayEntries(entries, date) : getTodayEntries(entries);
  const windowDecisions = windowEntries.filter(isDecisionEntry);

  // Recompute base stats from window
  let allowed = 0;
  let approved = 0;
  let blocked = 0;
  let timedOut = 0;
  let pending = 0;
  for (const e of windowDecisions) {
    const eff = getEffectiveDecision(e);
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
  const total = allowed + approved + blocked + timedOut;

  const evalIdx = buildEvalIndex(entries);

  let low = 0;
  let medium = 0;
  let high = 0;
  let critical = 0;
  let riskSum = 0;
  let riskCount = 0;
  let peakRisk = 0;

  for (const e of windowDecisions) {
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

  // Active agents/sessions: for past days, count distinct IDs; for today, use recency
  let activeAgents: number;
  let activeSessions: number;
  if (isPastDay) {
    const agentIds = new Set(windowDecisions.map((e) => e.agentId ?? "default"));
    const sessionKeys = new Set(
      windowDecisions.filter((e) => e.sessionKey).map((e) => e.sessionKey!),
    );
    activeAgents = agentIds.size;
    activeSessions = sessionKeys.size;
  } else {
    const now = Date.now();
    const activeAgentIds = new Set<string>();
    const activeSessionKeys = new Set<string>();
    for (const e of entries) {
      if (now - new Date(e.timestamp).getTime() <= ACTIVE_THRESHOLD_MS) {
        if (e.agentId) activeAgentIds.add(e.agentId);
        if (e.sessionKey) activeSessionKeys.add(e.sessionKey);
      }
    }
    activeAgents = activeAgentIds.size;
    activeSessions = activeSessionKeys.size;
  }

  const avgScore = riskCount > 0 ? Math.round(riskSum / riskCount) : 0;
  let posture = riskPosture(avgScore);

  // Posture overrides — only for today (past days are frozen snapshots)
  if (!isPastDay) {
    const oneHourAgo = new Date(Date.now() - 3_600_000).toISOString();
    for (const e of windowDecisions) {
      const evalEntry = e.toolCallId ? evalIdx.get(e.toolCallId) : undefined;
      const score = evalEntry?.llmEvaluation?.adjustedScore ?? e.riskScore;
      if (e.timestamp >= oneHourAgo && score !== undefined && score > 75) {
        if (posture === "calm" || posture === "elevated") posture = "high";
        break;
      }
    }

    const thirtyMinAgo = new Date(Date.now() - 1_800_000).toISOString();
    for (const e of windowDecisions) {
      if (e.timestamp >= thirtyMinAgo) {
        const eff = getEffectiveDecision(e);
        if (eff === "block" || eff === "denied") {
          posture = "critical";
          break;
        }
      }
    }
  }

  // Yesterday's total: count decision entries from the day before the viewing date
  const viewingDate = isPastDay ? date : localToday();
  const yesterdayMs = localMidnightMs(viewingDate) - 86_400_000;
  const yd = new Date(yesterdayMs);
  const yesterdayStr = `${yd.getFullYear()}-${String(yd.getMonth() + 1).padStart(2, "0")}-${String(yd.getDate()).padStart(2, "0")}`;
  const yesterdayTotal = getDayEntries(entries, yesterdayStr).filter(isDecisionEntry).length;

  return {
    total,
    allowed,
    approved,
    blocked,
    timedOut,
    pending,
    riskBreakdown: { low, medium, high, critical },
    avgRiskScore: avgScore,
    peakRiskScore: peakRisk,
    activeAgents,
    activeSessions,
    riskPosture: posture,
    historicDailyMax: computeHistoricDailyMax(entries),
    yesterdayTotal,
  };
}

/** Get aggregated agent list from audit entries. Accepts optional date for past-day view. */
export function getAgents(entries: AuditEntry[], date?: string): AgentInfo[] {
  const isPastDay = date !== undefined;

  // When viewing a past day, pre-filter all entries to that day
  const scopedEntries = isPastDay ? getDayEntries(entries, date) : entries;

  // Only group decision entries — result/eval entries without agentId must not
  // create phantom agents (e.g. "default"). Eval data is still accessible via
  // the buildEvalIndex() lookup, which indexes ALL entries by toolCallId.
  const agentMap = new Map<string, AuditEntry[]>();
  for (const e of scopedEntries) {
    if (!isDecisionEntry(e)) continue;
    const id = e.agentId || DEFAULT_AGENT_ID;
    const existing = agentMap.get(id);
    if (existing) {
      existing.push(e);
    } else {
      agentMap.set(id, [e]);
    }
  }

  // For past days, only include agents that had decision entries
  if (isPastDay) {
    for (const [id, agentEntries] of agentMap) {
      if (!agentEntries.some(isDecisionEntry)) {
        agentMap.delete(id);
      }
    }
  }

  const now = Date.now();
  const todayStr = isPastDay ? date : localToday();
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

    // Past days: always idle. Today: active if activity in last 5 min.
    const isActive = isPastDay
      ? false
      : lastTimestamp
        ? now - new Date(lastTimestamp).getTime() <= ACTIVE_THRESHOLD_MS
        : false;

    const todayDecisions = isPastDay
      ? agentEntries.filter(isDecisionEntry)
      : agentEntries.filter((e) => localDateOf(e.timestamp) === todayStr && isDecisionEntry(e));

    let riskSum = 0;
    let riskCount = 0;
    let peakRisk = 0;
    const riskProfile: Record<string, number> = { low: 0, medium: 0, high: 0, critical: 0 };
    for (const e of agentEntries) {
      const score = getEffectiveScore(e, evalIdx);
      if (score !== undefined) {
        riskSum += score;
        riskCount++;
        if (score > peakRisk) peakRisk = score;
        if (score > 75) riskProfile.critical++;
        else if (score > 50) riskProfile.high++;
        else if (score > 25) riskProfile.medium++;
        else riskProfile.low++;
      }
    }

    let currentSession: AgentInfo["currentSession"];
    let currentSessionKey: string | undefined;
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

    const hasCronSession = agentEntries.some((e) => {
      if (!e.sessionKey) return false;
      const parts = e.sessionKey.split(":");
      return parts.length >= 3 && parts[2] === "cron";
    });
    const mode: "interactive" | "scheduled" = hasCronSession ? "scheduled" : "interactive";

    const currentContext = currentSessionKey ? parseSessionContext(currentSessionKey) : undefined;

    const breakdownEntries = currentSessionKey
      ? agentEntries.filter((e) => e.sessionKey === currentSessionKey && isDecisionEntry(e))
      : todayDecisions;
    const activityBreakdown = computeBreakdown(breakdownEntries);

    const todayActivityBreakdown = computeBreakdown(todayDecisions);

    const latestDecision = agentEntries
      .filter(isDecisionEntry)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0];
    const latestAction = latestDecision ? describeAction(latestDecision) : undefined;
    const latestActionTime = latestDecision?.timestamp;

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

    let needsAttention = false;
    let attentionReason: string | undefined;

    if (isPastDay) {
      // Past day: flag if any blocked entries occurred that day
      for (const e of agentEntries) {
        if (isDecisionEntry(e)) {
          const eff = getEffectiveDecision(e);
          if (eff === "block" || eff === "denied") {
            needsAttention = true;
            attentionReason = `Blocked: ${e.toolName}`;
            break;
          }
        }
      }
    } else {
      // Today: blocked in last 30 min
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
    }

    if (!needsAttention && peakRisk >= 75) {
      needsAttention = true;
      attentionReason = "High risk activity detected";
    }

    let blockedCount = 0;
    for (const e of todayDecisions) {
      const eff = getEffectiveDecision(e);
      if (eff === "block" || eff === "denied") blockedCount++;
    }

    let topRisk: AgentInfo["topRisk"];
    const topRiskEntry = agentEntries
      .filter(
        (e) =>
          isDecisionEntry(e) &&
          getEffectiveScore(e, evalIdx) !== undefined &&
          getEffectiveScore(e, evalIdx)! >= 25,
      )
      .sort(
        (a, b) => (getEffectiveScore(b, evalIdx) ?? 0) - (getEffectiveScore(a, evalIdx) ?? 0),
      )[0];
    if (topRiskEntry) {
      const score = getEffectiveScore(topRiskEntry, evalIdx)!;
      topRisk = {
        description: describeAction(topRiskEntry),
        score,
        tier: score > 75 ? "critical" : score > 50 ? "high" : score > 25 ? "medium" : "low",
      };
    }

    const hourlyActivity = new Array<number>(24).fill(0);
    for (const e of todayDecisions) {
      const hour = new Date(e.timestamp).getHours();
      hourlyActivity[hour]++;
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
      blockedCount,
      riskProfile,
      topRisk,
      hourlyActivity,
      lastSessionKey: currentSessionKey,
    });
  }

  agents.sort((a, b) => {
    if (a.status !== b.status) return a.status === "active" ? -1 : 1;
    if (b.todayToolCalls !== a.todayToolCalls) return b.todayToolCalls - a.todayToolCalls;
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

  const sessionMap = groupBySessions(agentEntries);
  const allSessions: SessionInfo[] = [];
  for (const [key, sEntries] of sessionMap) {
    allSessions.push(buildSessionInfo(key, sEntries, evalIdx));
  }
  allSessions.sort((a, b) => (b.endTime ?? b.startTime).localeCompare(a.endTime ?? a.startTime));

  // Build reverse lookup: entry key → split session key
  // so entries and riskTrend points use the correct sub-session (#2, #3, etc.)
  const splitSessionIndex = new Map<string, string>();
  for (const [splitKey, sEntries] of sessionMap) {
    for (const e of sEntries) {
      const entryKey = e.toolCallId ?? e.timestamp;
      splitSessionIndex.set(entryKey, splitKey);
    }
  }

  const mapAndPatchSession = (e: AuditEntry): EntryResponse => {
    const mapped = mapEntry(e, evalIdx);
    const entryKey = e.toolCallId ?? e.timestamp;
    mapped.sessionKey = splitSessionIndex.get(entryKey) ?? mapped.sessionKey;
    return mapped;
  };

  const recentActivity = agentEntries
    .filter((e) => isDecisionEntry(e) && e.timestamp >= windowCutoff)
    .reverse()
    .slice(0, 200)
    .map(mapAndPatchSession);

  // Current session activity: entries from the latest split sub-session only
  // For cron agents, the raw sessionKey spans many runs — use the most recent split
  const currentSessionKey = agent.currentSession?.sessionKey;
  const latestSplitKey = currentSessionKey
    ? allSessions.find(
        (s) =>
          s.sessionKey === currentSessionKey || s.sessionKey.startsWith(`${currentSessionKey}#`),
      )?.sessionKey
    : undefined;
  const currentSessionActivity = latestSplitKey
    ? recentActivity.filter((e) => e.sessionKey === latestSplitKey)
    : [];

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

// ── Activity Timeline ─────────────────────────────────

export interface ActivityTimelineBucket {
  start: string;
  agentId: string;
  counts: Record<ActivityCategory, number>;
  total: number;
  peakRisk: number;
  sessions: { key: string; count: number }[];
  topTools: { name: string; count: number }[];
  tags: string[];
}

export interface ActivityTimelineResponse {
  agents: string[];
  buckets: ActivityTimelineBucket[];
  startTime: string;
  endTime: string;
  totalActions: number;
  bucketMinutes: number;
}

const AUTO_BUCKET: Record<string, number> = {
  "1h": 5,
  "3h": 5,
  "6h": 15,
  "12h": 15,
  "24h": 30,
};

function parseRangeMs(range: string): number | undefined {
  const match = range.match(/^(\d+)h$/);
  if (!match) return undefined;
  return Number(match[1]) * 3_600_000;
}

export function getActivityTimeline(
  entries: AuditEntry[],
  bucketMinutes?: number,
  dateStr?: string,
  range?: string,
): ActivityTimelineResponse {
  const effectiveBucket = bucketMinutes ?? AUTO_BUCKET[range ?? ""] ?? 15;
  const emptyResponse: ActivityTimelineResponse = {
    agents: [],
    buckets: [],
    startTime: "",
    endTime: "",
    totalActions: 0,
    bucketMinutes: effectiveBucket,
  };

  const dayEntries = dateStr ? getDayEntries(entries, dateStr) : getTodayEntries(entries);
  let decisions = dayEntries.filter(isDecisionEntry);

  // Apply range filtering
  if (range) {
    const rangeMs = parseRangeMs(range);
    if (rangeMs) {
      const isToday = !dateStr;
      let rangeStart: number;
      let rangeEnd: number;
      if (isToday) {
        rangeEnd = Date.now();
        rangeStart = rangeEnd - rangeMs;
      } else {
        rangeStart = localMidnightMs(dateStr);
        rangeEnd = rangeStart + rangeMs;
      }
      decisions = decisions.filter((e) => {
        const ts = new Date(e.timestamp).getTime();
        return ts >= rangeStart && ts <= rangeEnd;
      });
    }
  }

  if (decisions.length === 0) {
    return emptyResponse;
  }

  const bucketMs = effectiveBucket * 60_000;
  const bucketMap = new Map<string, ActivityTimelineBucket>();
  const agentTotals = new Map<string, number>();

  // Build split session index from ALL entries (not day/range-filtered) so #N
  // numbering matches resolveSessionEntries, which also operates on the full log
  const sessionMap = groupBySessions(entries);
  const splitSessionIndex = new Map<string, string>();
  for (const [splitKey, sEntries] of sessionMap) {
    for (const e of sEntries) {
      const entryKey = e.toolCallId ?? e.timestamp;
      splitSessionIndex.set(entryKey, splitKey);
    }
  }

  // Per-bucket tracking maps
  const sessionMaps = new Map<string, Map<string, number>>();
  const toolMaps = new Map<string, Map<string, number>>();
  const tagSets = new Map<string, Set<string>>();

  for (const entry of decisions) {
    const agentId = entry.agentId ?? DEFAULT_AGENT_ID;
    const ts = new Date(entry.timestamp).getTime();
    const bucketStart = Math.floor(ts / bucketMs) * bucketMs;
    const key = `${agentId}:${bucketStart}`;
    const category = getCategory(entry.toolName);
    const risk = entry.riskScore ?? 0;

    let bucket = bucketMap.get(key);
    if (!bucket) {
      bucket = {
        start: new Date(bucketStart).toISOString(),
        agentId,
        counts: { exploring: 0, changes: 0, commands: 0, web: 0, comms: 0, data: 0 },
        total: 0,
        peakRisk: 0,
        sessions: [],
        topTools: [],
        tags: [],
      };
      bucketMap.set(key, bucket);
      sessionMaps.set(key, new Map());
      toolMaps.set(key, new Map());
      tagSets.set(key, new Set());
    }

    bucket.counts[category]++;
    bucket.total++;
    if (risk > bucket.peakRisk) bucket.peakRisk = risk;
    agentTotals.set(agentId, (agentTotals.get(agentId) ?? 0) + 1);

    // Track sessions — use split key so cron runs resolve to sub-sessions
    const entryKey = entry.toolCallId ?? entry.timestamp;
    const sessionKey = splitSessionIndex.get(entryKey) ?? entry.sessionKey ?? "unknown";
    const sm = sessionMaps.get(key)!;
    sm.set(sessionKey, (sm.get(sessionKey) ?? 0) + 1);

    // Track tools
    const tm = toolMaps.get(key)!;
    tm.set(entry.toolName, (tm.get(entry.toolName) ?? 0) + 1);

    // Track tags
    if (entry.riskTags) {
      const ts = tagSets.get(key)!;
      for (const tag of entry.riskTags) ts.add(tag);
    }
  }

  // Convert tracking maps to sorted arrays on each bucket
  for (const [key, bucket] of bucketMap) {
    const sm = sessionMaps.get(key)!;
    bucket.sessions = [...sm.entries()]
      .map(([k, count]) => ({ key: k, count }))
      .sort((a, b) => b.count - a.count);

    const tm = toolMaps.get(key)!;
    bucket.topTools = [...tm.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);

    bucket.tags = [...(tagSets.get(key) ?? [])];
  }

  const agents = [...agentTotals.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);

  const buckets = [...bucketMap.values()];
  const timestamps = buckets.map((b) => new Date(b.start).getTime());
  const minTs = Math.min(...timestamps);
  const maxTs = Math.max(...timestamps) + bucketMs;

  return {
    agents,
    buckets,
    startTime: new Date(minTs).toISOString(),
    endTime: new Date(maxTs).toISOString(),
    totalActions: decisions.length,
    bucketMinutes: effectiveBucket,
  };
}

// ── Session-based timeline ─────────────────────────────

export interface SessionSegment {
  category: ActivityCategory;
  startTime: string;
  endTime: string;
  actionCount: number;
}

export interface TimelineSession {
  sessionKey: string;
  agentId: string;
  startTime: string;
  endTime: string;
  segments: SessionSegment[];
  actionCount: number;
  avgRisk: number;
  peakRisk: number;
  blockedCount: number;
  isActive: boolean;
}

export interface SessionTimelineResponse {
  agents: string[];
  sessions: TimelineSession[];
  startTime: string;
  endTime: string;
  totalActions: number;
}

export function buildSessionSegments(entries: AuditEntry[]): SessionSegment[] {
  const sorted = [...entries]
    .filter(isDecisionEntry)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  if (sorted.length === 0) return [];

  const segments: SessionSegment[] = [];
  let currentCat = getCategory(sorted[0].toolName);
  let segStart = sorted[0].timestamp;
  let segEnd = sorted[0].timestamp;
  let segCount = 1;

  for (let i = 1; i < sorted.length; i++) {
    const cat = getCategory(sorted[i].toolName);
    if (cat === currentCat) {
      segEnd = sorted[i].timestamp;
      segCount++;
    } else {
      segments.push({
        category: currentCat,
        startTime: segStart,
        endTime: segEnd,
        actionCount: segCount,
      });
      currentCat = cat;
      segStart = sorted[i].timestamp;
      segEnd = sorted[i].timestamp;
      segCount = 1;
    }
  }
  segments.push({
    category: currentCat,
    startTime: segStart,
    endTime: segEnd,
    actionCount: segCount,
  });

  return segments;
}

export function getSessionTimeline(
  entries: AuditEntry[],
  dateStr?: string,
  range?: string,
): SessionTimelineResponse {
  const emptyResponse: SessionTimelineResponse = {
    agents: [],
    sessions: [],
    startTime: "",
    endTime: "",
    totalActions: 0,
  };

  const dayEntries = dateStr ? getDayEntries(entries, dateStr) : getTodayEntries(entries);
  let decisions = dayEntries.filter(isDecisionEntry);

  // Apply range filtering
  let rangeStart: number | undefined;
  let rangeEnd: number | undefined;
  if (range) {
    const rangeMs = parseRangeMs(range);
    if (rangeMs) {
      const isToday = !dateStr;
      if (isToday) {
        rangeEnd = Date.now();
        rangeStart = rangeEnd - rangeMs;
      } else {
        rangeStart = localMidnightMs(dateStr);
        rangeEnd = rangeStart + rangeMs;
      }
      decisions = decisions.filter((e) => {
        const ts = new Date(e.timestamp).getTime();
        return ts >= rangeStart! && ts <= rangeEnd!;
      });
    }
  }

  if (decisions.length === 0) return emptyResponse;

  // Build session index from ALL entries so #N numbering is consistent
  const sessionMap = groupBySessions(entries);
  const splitSessionIndex = new Map<string, string>();
  for (const [splitKey, sEntries] of sessionMap) {
    for (const e of sEntries) {
      const entryKey = e.toolCallId ?? e.timestamp;
      splitSessionIndex.set(entryKey, splitKey);
    }
  }

  const evalIdx = buildEvalIndex(entries);
  const now = Date.now();

  // Group filtered decisions by split session key
  const sessionEntries = new Map<string, AuditEntry[]>();
  for (const e of decisions) {
    const entryKey = e.toolCallId ?? e.timestamp;
    const sKey = splitSessionIndex.get(entryKey) ?? e.sessionKey ?? "unknown";
    const existing = sessionEntries.get(sKey);
    if (existing) {
      existing.push(e);
    } else {
      sessionEntries.set(sKey, [e]);
    }
  }

  // Determine view window for overlap filtering
  const viewStart =
    rangeStart ?? Math.min(...decisions.map((e) => new Date(e.timestamp).getTime()));
  const viewEnd = rangeEnd ?? (dateStr ? localMidnightMs(dateStr) + 86_400_000 : now);

  const agentTotals = new Map<string, number>();
  const sessions: TimelineSession[] = [];

  for (const [sKey, sEntries] of sessionEntries) {
    const sorted = [...sEntries].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    const startTime = sorted[0].timestamp;
    const endTime = sorted[sorted.length - 1].timestamp;
    const startMs = new Date(startTime).getTime();
    const endMs = new Date(endTime).getTime();

    // Overlap filter: session must intersect the view window
    if (startMs > viewEnd || endMs < viewStart) continue;

    const agentId = sorted.find((e) => e.agentId)?.agentId ?? DEFAULT_AGENT_ID;
    const segments = buildSessionSegments(sorted);

    let riskSum = 0;
    let riskCount = 0;
    let peakRisk = 0;
    let blockedCount = 0;
    for (const e of sorted) {
      const score = getEffectiveScore(e, evalIdx);
      if (score !== undefined) {
        riskSum += score;
        riskCount++;
        if (score > peakRisk) peakRisk = score;
      }
      const eff = getEffectiveDecision(e);
      if (eff === "block" || eff === "denied") blockedCount++;
    }

    const isActive = now - endMs <= ACTIVE_THRESHOLD_MS;

    sessions.push({
      sessionKey: sKey,
      agentId,
      startTime,
      endTime,
      segments,
      actionCount: sorted.length,
      avgRisk: riskCount > 0 ? Math.round(riskSum / riskCount) : 0,
      peakRisk,
      blockedCount,
      isActive,
    });

    agentTotals.set(agentId, (agentTotals.get(agentId) ?? 0) + sorted.length);
  }

  const agents = [...agentTotals.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);

  const allTimestamps = sessions.flatMap((s) => [
    new Date(s.startTime).getTime(),
    new Date(s.endTime).getTime(),
  ]);
  const minTs = Math.min(...allTimestamps);
  const maxTs = Math.max(...allTimestamps);

  return {
    agents,
    sessions,
    startTime: new Date(minTs).toISOString(),
    endTime: new Date(maxTs).toISOString(),
    totalActions: decisions.length,
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

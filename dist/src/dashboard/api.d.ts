import { type LlmHealthSnapshot } from "../audit/llm-health";
import type { AuditEntry } from "../audit/logger";
import type { GuardrailStore } from "../guardrails/store";
import type { AttentionStore } from "./attention-state";
import { type ActivityCategory, type RiskPosture } from "./categories";
/** Fallback agent ID when audit entries have no agentId. */
export declare const DEFAULT_AGENT_ID = "default";
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
    /** Mean decision count across the 7 calendar days before the viewing date. */
    weekAverage: number;
    /** Max timestamp across all audit entries (decision or result). undefined when log is empty. */
    lastEntryTimestamp?: string;
    llmHealth: LlmHealthSnapshot;
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
export type RiskTierLabel = "low" | "medium" | "high" | "critical";
export type AckScope = {
    kind: "entry";
    toolCallId: string;
} | {
    kind: "agent";
    agentId: string;
    upToIso: string;
};
export interface AttentionItem {
    kind: "pending" | "blocked" | "timeout" | "high_risk";
    toolCallId: string;
    timestamp: string;
    agentId: string;
    agentName: string;
    toolName: string;
    description: string;
    riskScore: number;
    riskTier: RiskTierLabel;
    sessionKey?: string;
    /** T1 only — milliseconds remaining until approval times out. */
    timeoutMs?: number;
    /** T3 only — explains why this is surfaced without a matching guardrail. */
    guardrailHint?: string;
    /** T3 only — identity key derived from tool + params, pre-filled into GuardrailModal. */
    identityKey?: string;
    /** T1 only — present when a user-defined guardrail matches the pending entry's tool + identity key. */
    guardrailMatch?: {
        id: string;
        identityKey: string;
    };
}
export interface AttentionAgent {
    agentId: string;
    agentName: string;
    /** ISO of the most recent entry that contributed to the trigger. Use as `upToIso` for agent acks. */
    triggerAt: string;
    reason: "block_cluster" | "high_risk_cluster" | "sustained_elevation";
    description: string;
    triggerCount: number;
    peakTier: RiskTierLabel;
    lastSessionKey?: string;
}
export interface AttentionResponse {
    pending: AttentionItem[];
    blocked: AttentionItem[];
    agentAttention: AttentionAgent[];
    highRisk: AttentionItem[];
    generatedAt: string;
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
        action: {
            type: string;
        };
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
/** Today's date in local time as YYYY-MM-DD. */
export declare function localToday(): string;
/** Extract the local-date portion (YYYY-MM-DD) of a UTC ISO timestamp. */
export declare function localDateOf(isoTimestamp: string): string;
/** Compute the effective user-facing decision for an entry. */
export declare function getEffectiveDecision(entry: AuditEntry): string;
export declare function mapEntry(entry: AuditEntry, evalIndex?: Map<string, AuditEntry>, guardrailStore?: GuardrailStore): EntryResponse;
/** Build an index of LLM evaluation entries keyed by the toolCallId they reference. */
export declare function buildEvalIndex(entries: AuditEntry[]): Map<string, AuditEntry>;
/** Max single-day action count across all history. Returns 100 as fallback for fresh installs. */
export declare function computeHistoricDailyMax(entries: AuditEntry[]): number;
/** Blocked + approval_required entries for a day, most recent first. Optionally includes high-risk allowed entries (Tier 3). */
export declare function getInterventions(entries: AuditEntry[], date?: string, guardrailStore?: GuardrailStore): InterventionEntry[];
declare function tierRank(t: RiskTierLabel): number;
/**
 * Derive "needs attention" agents from recent audit entries. Three rules, each
 * inside a rolling 24h window:
 *   1. block_cluster         — 2+ blocks within 10 min
 *   2. high_risk_cluster     — 3+ unguarded high-risk actions within 20 min
 *   3. sustained_elevation   — session avg risk > 50 and 10+ actions
 *
 * Results are filtered against the AttentionStore: any agent whose `triggerAt`
 * is covered by an existing ack (scope=agent, upToIso >= triggerAt) is hidden.
 * The on-disk `action` field ("ack" | "dismiss") is ignored on the read path —
 * any record removes the row. Legacy "dismiss" records keep working without
 * migration; new writes always use "ack". See #6.
 */
export declare function deriveAgentAttention(entries: AuditEntry[], guardrailStore?: GuardrailStore, attentionStore?: AttentionStore, now?: number): AttentionAgent[];
/**
 * Single consolidated attention response. Replaces `/api/interventions` on the
 * homepage. Items the user has already acknowledged (legacy "dismiss" records
 * included) are hidden entirely — there is no longer a reviewed-but-visible
 * state.
 */
export declare function getAttention(entries: AuditEntry[], guardrailStore?: GuardrailStore, attentionStore?: AttentionStore, now?: number): AttentionResponse;
export { tierRank as _tierRankForTests };
/** Compute today's decision counts. */
export declare function computeStats(entries: AuditEntry[]): StatsResponse;
/** Return paginated decision entries in reverse chronological order, with optional filtering. */
export declare function getRecentEntries(entries: AuditEntry[], limit: number, offset: number, filters?: EntryFilters, guardrailStore?: GuardrailStore): EntryResponse[];
/**
 * Build a Map from `(entry.toolCallId ?? entry.timestamp)` → split session key
 * (e.g. `agent:main:telegram:direct:7928586762#2`). Bulk-optimized partner of
 * `resolveSplitKeyForEntry`: build once, look up per-entry in O(1).
 *
 * Use this when iterating many entries that each need split-key mapping.
 * Use `resolveSplitKeyForEntry` when you have a single entry.
 */
export declare function buildSplitSessionIndex(entries: AuditEntry[]): Map<string, string>;
/**
 * Resolve the split session key for a single entry.
 * Used by the SSE handler to emit entries with correct sub-session keys.
 */
export declare function resolveSplitKeyForEntry(allEntries: AuditEntry[], entry: AuditEntry): string | undefined;
/** Verify the hash chain integrity of all entries. */
export declare function checkHealth(entries: AuditEntry[]): HealthResponse;
/** Enhanced stats with risk breakdown and active counts. Accepts optional date for past-day view. */
export declare function computeEnhancedStats(entries: AuditEntry[], date?: string): EnhancedStatsResponse;
/** Get aggregated agent list from audit entries. Accepts optional date for past-day view. */
export declare function getAgents(entries: AuditEntry[], date?: string): AgentInfo[];
export declare function getAgentDetail(entries: AuditEntry[], agentId: string, range?: string): AgentDetailResponse | null;
/** Get paginated session list, optionally filtered by agent. */
export declare function getSessions(entries: AuditEntry[], agentId?: string, limit?: number, offset?: number): {
    sessions: SessionInfo[];
    total: number;
};
export interface ActivityTimelineBucket {
    start: string;
    agentId: string;
    counts: Record<ActivityCategory, number>;
    total: number;
    peakRisk: number;
    sessions: {
        key: string;
        count: number;
    }[];
    topTools: {
        name: string;
        count: number;
    }[];
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
export declare function getActivityTimeline(entries: AuditEntry[], bucketMinutes?: number, dateStr?: string, range?: string): ActivityTimelineResponse;
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
export declare function buildSessionSegments(entries: AuditEntry[]): SessionSegment[];
export declare function getSessionTimeline(entries: AuditEntry[], dateStr?: string, range?: string): SessionTimelineResponse;
/** Get full detail for a single session. */
export declare function getSessionDetail(entries: AuditEntry[], sessionKey: string): SessionDetailResponse | null;

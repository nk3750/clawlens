import type { AuditEntry } from "../audit/logger";
import type { GuardrailStore } from "../guardrails/store";
import { type ActivityCategory, type RiskPosture } from "./categories";
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
        action: {
            type: string;
            hours?: number;
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
/** Compute the effective user-facing decision for an entry. */
export declare function getEffectiveDecision(entry: AuditEntry): string;
/** Max single-day action count across all history. Returns 100 as fallback for fresh installs. */
export declare function computeHistoricDailyMax(entries: AuditEntry[]): number;
/** Blocked + approval_required entries for a day, most recent first. */
export declare function getInterventions(entries: AuditEntry[], date?: string): InterventionEntry[];
/** Compute today's decision counts. */
export declare function computeStats(entries: AuditEntry[]): StatsResponse;
/** Return paginated decision entries in reverse chronological order, with optional filtering. */
export declare function getRecentEntries(entries: AuditEntry[], limit: number, offset: number, filters?: EntryFilters, guardrailStore?: GuardrailStore): EntryResponse[];
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
/** Get full detail for a single session. */
export declare function getSessionDetail(entries: AuditEntry[], sessionKey: string): SessionDetailResponse | null;

export type ActivityCategory =
  | "exploring"
  | "changes"
  | "commands"
  | "web"
  | "comms"
  | "data";

export type RiskTier = "low" | "medium" | "high" | "critical";
export type RiskPosture = "calm" | "elevated" | "high" | "critical";

// Mirror of src/audit/llm-health.ts. Keep in sync.
export type LlmFailureReason = "billing" | "rate_limit" | "provider" | "other";
export type LlmHealthStatus = "ok" | "degraded" | "down";

export interface LlmHealthSnapshot {
  recentAttempts: number;
  recentFailures: number;
  lastFailureIso?: string;
  lastFailureReason?: LlmFailureReason;
  status: LlmHealthStatus;
}

export interface StatsResponse {
  total: number;
  allowed: number;
  approved: number;
  blocked: number;
  timedOut: number;
  pending: number;
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
  /** Max timestamp across all audit entries. undefined when log is empty. */
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
  riskTier: RiskTier;
  decision: string;
  effectiveDecision: string;
  sessionKey?: string;
}

// ── Attention Inbox (homepage-v3-attention-inbox-spec) ────────────

export type AckScope =
  | { kind: "entry"; toolCallId: string }
  | { kind: "agent"; agentId: string; upToIso: string };

export interface AttentionItem {
  kind: "pending" | "blocked" | "timeout" | "high_risk";
  toolCallId: string;
  timestamp: string;
  agentId: string;
  agentName: string;
  toolName: string;
  description: string;
  riskScore: number;
  riskTier: RiskTier;
  sessionKey?: string;
  /** T1 only — milliseconds remaining on the approval countdown. */
  timeoutMs?: number;
  /** T3 only — why this is surfaced (e.g. "no matching guardrail"). */
  guardrailHint?: string;
  /** T3 only — identity key (tool + normalized params) used to pre-fill the guardrail modal. */
  identityKey?: string;
}

export interface AttentionAgent {
  agentId: string;
  agentName: string;
  triggerAt: string;
  reason: "block_cluster" | "high_risk_cluster" | "sustained_elevation";
  description: string;
  triggerCount: number;
  peakTier: RiskTier;
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
  /** Exec sub-category (only set for exec tool calls). */
  execCategory?: string;
  /** Present when an active guardrail matches this entry. */
  guardrailMatch?: {
    id: string;
    action: GuardrailAction;
  };
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
  riskProfile: Record<RiskTier, number>;
  topRisk?: {
    description: string;
    score: number;
    tier: RiskTier;
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

export interface RiskTrendPoint {
  timestamp: string;
  score: number;
  toolName: string;
  sessionKey?: string;
  toolCallId?: string;
}

export interface AgentDetailResponse {
  agent: AgentInfo;
  currentSessionActivity: EntryResponse[];
  recentActivity: EntryResponse[];
  sessions: SessionInfo[];
  totalSessions: number;
  riskTrend: RiskTrendPoint[];
}

export interface SessionDetailResponse {
  session: SessionInfo;
  entries: EntryResponse[];
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

// ── Session Timeline ─────────────────────────────────

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

// ── Guardrails ────────────────────────────────────────

export type GuardrailAction =
  | { type: "block" }
  | { type: "require_approval" };

export interface Guardrail {
  id: string;
  tool: string;
  identityKey: string;
  matchMode: "exact";
  action: GuardrailAction;
  agentId: string | null;
  createdAt: string;
  source: {
    toolCallId: string;
    sessionKey: string;
    agentId: string;
  };
  description: string;
  riskScore: number;
}

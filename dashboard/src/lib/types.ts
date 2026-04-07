export type ActivityCategory =
  | "exploring"
  | "changes"
  | "commands"
  | "web"
  | "comms"
  | "data";

export type RiskTier = "low" | "medium" | "high" | "critical";
export type RiskPosture = "calm" | "elevated" | "high" | "critical";

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

export interface RiskTrendPoint {
  timestamp: string;
  score: number;
  toolName: string;
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

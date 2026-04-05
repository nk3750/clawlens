export interface RiskScore {
  score: number; // 0-100
  tier: "low" | "medium" | "high" | "critical";
  tags: string[];
  breakdown: {
    base: number;
    modifiers: Array<{ reason: string; delta: number }>;
  };
  needsLlmEval: boolean; // true if score >= llmEvalThreshold (default 50)
}

export interface LlmRiskEvaluation {
  adjustedScore: number;
  reasoning: string;
  tags: string[];
  confidence: "high" | "medium" | "low";
  patterns: string[];
}

export interface AlertConfig {
  enabled: boolean;
  threshold: number; // default: 80
  quietHoursStart?: string; // e.g. "23:00"
  quietHoursEnd?: string; // e.g. "07:00"
}

export type RiskTier = RiskScore["tier"];

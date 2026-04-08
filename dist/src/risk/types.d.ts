export interface RiskScore {
    score: number;
    tier: "low" | "medium" | "high" | "critical";
    tags: string[];
    breakdown: {
        base: number;
        modifiers: Array<{
            reason: string;
            delta: number;
        }>;
    };
    needsLlmEval: boolean;
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
    threshold: number;
    quietHoursStart?: string;
    quietHoursEnd?: string;
}
export type RiskTier = RiskScore["tier"];

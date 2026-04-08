import type { RiskScore } from "./types";
export declare function computeRiskScore(toolName: string, params: Record<string, unknown>, llmEvalThreshold?: number): RiskScore;

import * as os from "node:os";
import * as path from "node:path";

export interface ClawLensConfig {
  auditLogPath: string;
  guardrailsPath: string;
  attentionStatePath: string;
  retention: string;
  digest: {
    schedule: string;
    channel?: string;
  };
  risk: {
    llmEvalThreshold: number;
    llmEnabled: boolean;
    llmModel: string;
    llmApiKeyEnv: string;
    /** Optional override — auto-detected from OpenClaw auth config if not set */
    llmProvider: string;
  };
  alerts: {
    enabled: boolean;
    threshold: number;
    quietHoursStart?: string;
    quietHoursEnd?: string;
  };
  dashboardUrl?: string;
}

const DEFAULT_DIR = path.join(os.homedir(), ".openclaw", "clawlens");

export const DEFAULT_CONFIG: ClawLensConfig = {
  auditLogPath: path.join(DEFAULT_DIR, "audit.jsonl"),
  guardrailsPath: path.join(DEFAULT_DIR, "guardrails.json"),
  attentionStatePath: path.join(DEFAULT_DIR, "attention.jsonl"),
  retention: "30d",
  digest: {
    schedule: "daily",
  },
  risk: {
    llmEvalThreshold: 50,
    llmEnabled: true,
    llmModel: "",
    llmApiKeyEnv: "ANTHROPIC_API_KEY",
    llmProvider: "anthropic",
  },
  alerts: {
    enabled: true,
    threshold: 80,
  },
};

export function resolveConfig(
  pluginConfig?: Record<string, unknown>,
  resolvePath?: (input: string) => string,
): ClawLensConfig {
  const resolve = resolvePath || ((p: string) => p.replace(/^~/, os.homedir()));

  if (!pluginConfig) return { ...DEFAULT_CONFIG };

  const riskCfg = pluginConfig.risk as Record<string, unknown> | undefined;
  const alertsCfg = pluginConfig.alerts as Record<string, unknown> | undefined;

  return {
    auditLogPath: resolve((pluginConfig.auditLogPath as string) || DEFAULT_CONFIG.auditLogPath),
    guardrailsPath: resolve(
      (pluginConfig.guardrailsPath as string) || DEFAULT_CONFIG.guardrailsPath,
    ),
    attentionStatePath: resolve(
      (pluginConfig.attentionStatePath as string) || DEFAULT_CONFIG.attentionStatePath,
    ),
    retention: (pluginConfig.retention as string) || DEFAULT_CONFIG.retention,
    digest: {
      schedule:
        ((pluginConfig.digest as Record<string, unknown>)?.schedule as string) ||
        DEFAULT_CONFIG.digest.schedule,
      channel: (pluginConfig.digest as Record<string, unknown>)?.channel as string,
    },
    risk: {
      llmEvalThreshold:
        typeof riskCfg?.llmEvalThreshold === "number"
          ? riskCfg.llmEvalThreshold
          : DEFAULT_CONFIG.risk.llmEvalThreshold,
      llmEnabled:
        typeof riskCfg?.llmEnabled === "boolean"
          ? riskCfg.llmEnabled
          : DEFAULT_CONFIG.risk.llmEnabled,
      llmModel:
        typeof riskCfg?.llmModel === "string" ? riskCfg.llmModel : DEFAULT_CONFIG.risk.llmModel,
      llmApiKeyEnv:
        typeof riskCfg?.llmApiKeyEnv === "string"
          ? riskCfg.llmApiKeyEnv
          : DEFAULT_CONFIG.risk.llmApiKeyEnv,
      llmProvider:
        typeof riskCfg?.llmProvider === "string"
          ? riskCfg.llmProvider
          : DEFAULT_CONFIG.risk.llmProvider,
    },
    alerts: {
      enabled:
        typeof alertsCfg?.enabled === "boolean" ? alertsCfg.enabled : DEFAULT_CONFIG.alerts.enabled,
      threshold:
        typeof alertsCfg?.threshold === "number"
          ? alertsCfg.threshold
          : DEFAULT_CONFIG.alerts.threshold,
      quietHoursStart: alertsCfg?.quietHoursStart as string | undefined,
      quietHoursEnd: alertsCfg?.quietHoursEnd as string | undefined,
    },
    dashboardUrl: pluginConfig.dashboardUrl as string | undefined,
  };
}

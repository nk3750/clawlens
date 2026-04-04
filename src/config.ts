import * as path from "node:path";
import * as os from "node:os";

export interface ClawLensConfig {
  policiesPath: string;
  auditLogPath: string;
  rateStatePath: string;
  retention: string;
  digest: {
    schedule: string;
    channel?: string;
  };
  risk: {
    llmEvalThreshold: number;
    llmEnabled: boolean;
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
  policiesPath: path.join(DEFAULT_DIR, "policies.yaml"),
  auditLogPath: path.join(DEFAULT_DIR, "audit.jsonl"),
  rateStatePath: path.join(DEFAULT_DIR, "rate-state.json"),
  retention: "30d",
  digest: {
    schedule: "daily",
  },
  risk: {
    llmEvalThreshold: 50,
    llmEnabled: true,
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
  const resolve =
    resolvePath || ((p: string) => p.replace(/^~/, os.homedir()));

  if (!pluginConfig) return { ...DEFAULT_CONFIG };

  const riskCfg = pluginConfig.risk as Record<string, unknown> | undefined;
  const alertsCfg = pluginConfig.alerts as Record<string, unknown> | undefined;

  return {
    policiesPath: resolve(
      (pluginConfig.policiesPath as string) || DEFAULT_CONFIG.policiesPath,
    ),
    auditLogPath: resolve(
      (pluginConfig.auditLogPath as string) || DEFAULT_CONFIG.auditLogPath,
    ),
    rateStatePath: resolve(
      (pluginConfig.rateStatePath as string) || DEFAULT_CONFIG.rateStatePath,
    ),
    retention: (pluginConfig.retention as string) || DEFAULT_CONFIG.retention,
    digest: {
      schedule:
        (pluginConfig.digest as Record<string, unknown>)?.schedule as string ||
        DEFAULT_CONFIG.digest.schedule,
      channel: (pluginConfig.digest as Record<string, unknown>)
        ?.channel as string,
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
    },
    alerts: {
      enabled:
        typeof alertsCfg?.enabled === "boolean"
          ? alertsCfg.enabled
          : DEFAULT_CONFIG.alerts.enabled,
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

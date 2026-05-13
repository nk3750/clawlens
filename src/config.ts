import * as os from "node:os";
import * as path from "node:path";

export interface ClawLensConfig {
  auditLogPath: string;
  guardrailsPath: string;
  attentionStatePath: string;
  savedSearchesPath: string;
  retention: string;
  digest: {
    schedule: string;
    channel?: string;
  };
  risk: {
    llmEvalThreshold: number;
    /**
     * Opt-in LLM risk evaluation. Default false in v1.0.1 (local-safe
     * baseline). When true, ClawLens sends sanitized tool-call metadata to the
     * user's configured OpenClaw LLM provider via OpenClaw's existing
     * model/auth runtime. ClawLens does not read LLM API keys from env vars.
     */
    llmEnabled: boolean;
  };
  alerts: {
    enabled: boolean;
    threshold: number;
    /**
     * When false (default), alert messages omit command/url/path values and
     * carry a "redacted by default" details line. Set to true to opt into
     * including parameter detail in alert payloads; redaction of credential
     * patterns still applies upstream.
     */
    includeParamValues: boolean;
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
  savedSearchesPath: path.join(DEFAULT_DIR, "activity-saved-searches.json"),
  retention: "30d",
  digest: {
    schedule: "daily",
  },
  risk: {
    llmEvalThreshold: 50,
    llmEnabled: false,
  },
  alerts: {
    enabled: false,
    threshold: 80,
    includeParamValues: false,
  },
};

export function resolveConfig(
  pluginConfig?: Record<string, unknown>,
  resolvePath?: (input: string) => string,
): ClawLensConfig {
  const resolve = resolvePath || ((p: string) => p.replace(/^~/, os.homedir()));

  if (!pluginConfig) {
    return {
      ...DEFAULT_CONFIG,
      risk: { ...DEFAULT_CONFIG.risk },
      alerts: { ...DEFAULT_CONFIG.alerts },
      digest: { ...DEFAULT_CONFIG.digest },
    };
  }

  const riskCfg = pluginConfig.risk as Record<string, unknown> | undefined;
  const alertsCfg = pluginConfig.alerts as Record<string, unknown> | undefined;

  // Legacy risk.llmApiKeyEnv / risk.llmProvider / risk.llmModel are tolerated
  // here (not destructured into the runtime config) so existing user configs
  // continue to load. Spec §5 L483-489. They MUST NOT affect runtime behavior.
  // These fields are removed in v1.1.0; the manifest carries deprecated no-op
  // descriptions in the meantime.

  return {
    auditLogPath: resolve((pluginConfig.auditLogPath as string) || DEFAULT_CONFIG.auditLogPath),
    guardrailsPath: resolve(
      (pluginConfig.guardrailsPath as string) || DEFAULT_CONFIG.guardrailsPath,
    ),
    attentionStatePath: resolve(
      (pluginConfig.attentionStatePath as string) || DEFAULT_CONFIG.attentionStatePath,
    ),
    savedSearchesPath: resolve(
      (pluginConfig.savedSearchesPath as string) || DEFAULT_CONFIG.savedSearchesPath,
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
    },
    alerts: {
      enabled:
        typeof alertsCfg?.enabled === "boolean" ? alertsCfg.enabled : DEFAULT_CONFIG.alerts.enabled,
      threshold:
        typeof alertsCfg?.threshold === "number"
          ? alertsCfg.threshold
          : DEFAULT_CONFIG.alerts.threshold,
      includeParamValues:
        typeof alertsCfg?.includeParamValues === "boolean"
          ? alertsCfg.includeParamValues
          : DEFAULT_CONFIG.alerts.includeParamValues,
      quietHoursStart: alertsCfg?.quietHoursStart as string | undefined,
      quietHoursEnd: alertsCfg?.quietHoursEnd as string | undefined,
    },
    dashboardUrl: pluginConfig.dashboardUrl as string | undefined,
  };
}

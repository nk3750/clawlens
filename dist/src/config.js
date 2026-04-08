import * as os from "node:os";
import * as path from "node:path";
const DEFAULT_DIR = path.join(os.homedir(), ".openclaw", "clawlens");
export const DEFAULT_CONFIG = {
    mode: "observe",
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
        llmModel: "",
        llmApiKeyEnv: "ANTHROPIC_API_KEY",
        llmProvider: "anthropic",
    },
    alerts: {
        enabled: true,
        threshold: 80,
    },
};
export function resolveConfig(pluginConfig, resolvePath) {
    const resolve = resolvePath || ((p) => p.replace(/^~/, os.homedir()));
    if (!pluginConfig)
        return { ...DEFAULT_CONFIG };
    const riskCfg = pluginConfig.risk;
    const alertsCfg = pluginConfig.alerts;
    const mode = pluginConfig.mode === "enforce" ? "enforce" : "observe";
    return {
        mode,
        policiesPath: resolve(pluginConfig.policiesPath || DEFAULT_CONFIG.policiesPath),
        auditLogPath: resolve(pluginConfig.auditLogPath || DEFAULT_CONFIG.auditLogPath),
        rateStatePath: resolve(pluginConfig.rateStatePath || DEFAULT_CONFIG.rateStatePath),
        retention: pluginConfig.retention || DEFAULT_CONFIG.retention,
        digest: {
            schedule: pluginConfig.digest?.schedule ||
                DEFAULT_CONFIG.digest.schedule,
            channel: pluginConfig.digest?.channel,
        },
        risk: {
            llmEvalThreshold: typeof riskCfg?.llmEvalThreshold === "number"
                ? riskCfg.llmEvalThreshold
                : DEFAULT_CONFIG.risk.llmEvalThreshold,
            llmEnabled: typeof riskCfg?.llmEnabled === "boolean"
                ? riskCfg.llmEnabled
                : DEFAULT_CONFIG.risk.llmEnabled,
            llmModel: typeof riskCfg?.llmModel === "string" ? riskCfg.llmModel : DEFAULT_CONFIG.risk.llmModel,
            llmApiKeyEnv: typeof riskCfg?.llmApiKeyEnv === "string"
                ? riskCfg.llmApiKeyEnv
                : DEFAULT_CONFIG.risk.llmApiKeyEnv,
            llmProvider: typeof riskCfg?.llmProvider === "string"
                ? riskCfg.llmProvider
                : DEFAULT_CONFIG.risk.llmProvider,
        },
        alerts: {
            enabled: typeof alertsCfg?.enabled === "boolean" ? alertsCfg.enabled : DEFAULT_CONFIG.alerts.enabled,
            threshold: typeof alertsCfg?.threshold === "number"
                ? alertsCfg.threshold
                : DEFAULT_CONFIG.alerts.threshold,
            quietHoursStart: alertsCfg?.quietHoursStart,
            quietHoursEnd: alertsCfg?.quietHoursEnd,
        },
        dashboardUrl: pluginConfig.dashboardUrl,
    };
}
//# sourceMappingURL=config.js.map
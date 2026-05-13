import * as os from "node:os";
import * as path from "node:path";
const DEFAULT_DIR = path.join(os.homedir(), ".openclaw", "clawlens");
export const DEFAULT_CONFIG = {
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
export function resolveConfig(pluginConfig, resolvePath) {
    const resolve = resolvePath || ((p) => p.replace(/^~/, os.homedir()));
    if (!pluginConfig) {
        return {
            ...DEFAULT_CONFIG,
            risk: { ...DEFAULT_CONFIG.risk },
            alerts: { ...DEFAULT_CONFIG.alerts },
            digest: { ...DEFAULT_CONFIG.digest },
        };
    }
    const riskCfg = pluginConfig.risk;
    const alertsCfg = pluginConfig.alerts;
    // Legacy risk.llmApiKeyEnv / risk.llmProvider / risk.llmModel are tolerated
    // here (not destructured into the runtime config) so existing user configs
    // continue to load. Spec §5 L483-489. They MUST NOT affect runtime behavior.
    // These fields are removed in v1.1.0; the manifest carries deprecated no-op
    // descriptions in the meantime.
    return {
        auditLogPath: resolve(pluginConfig.auditLogPath || DEFAULT_CONFIG.auditLogPath),
        guardrailsPath: resolve(pluginConfig.guardrailsPath || DEFAULT_CONFIG.guardrailsPath),
        attentionStatePath: resolve(pluginConfig.attentionStatePath || DEFAULT_CONFIG.attentionStatePath),
        savedSearchesPath: resolve(pluginConfig.savedSearchesPath || DEFAULT_CONFIG.savedSearchesPath),
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
        },
        alerts: {
            enabled: typeof alertsCfg?.enabled === "boolean" ? alertsCfg.enabled : DEFAULT_CONFIG.alerts.enabled,
            threshold: typeof alertsCfg?.threshold === "number"
                ? alertsCfg.threshold
                : DEFAULT_CONFIG.alerts.threshold,
            includeParamValues: typeof alertsCfg?.includeParamValues === "boolean"
                ? alertsCfg.includeParamValues
                : DEFAULT_CONFIG.alerts.includeParamValues,
            quietHoursStart: alertsCfg?.quietHoursStart,
            quietHoursEnd: alertsCfg?.quietHoursEnd,
        },
        dashboardUrl: pluginConfig.dashboardUrl,
    };
}
//# sourceMappingURL=config.js.map
import * as path from "node:path";
import * as os from "node:os";

export interface ClawClipConfig {
  policiesPath: string;
  auditLogPath: string;
  rateStatePath: string;
  retention: string;
  digest: {
    schedule: string;
    channel?: string;
  };
}

const DEFAULT_DIR = path.join(os.homedir(), ".openclaw", "clawclip");

export const DEFAULT_CONFIG: ClawClipConfig = {
  policiesPath: path.join(DEFAULT_DIR, "policies.yaml"),
  auditLogPath: path.join(DEFAULT_DIR, "audit.jsonl"),
  rateStatePath: path.join(DEFAULT_DIR, "rate-state.json"),
  retention: "30d",
  digest: {
    schedule: "daily",
  },
};

export function resolveConfig(
  pluginConfig?: Record<string, unknown>,
  resolvePath?: (input: string) => string,
): ClawClipConfig {
  const resolve =
    resolvePath || ((p: string) => p.replace(/^~/, os.homedir()));

  if (!pluginConfig) return { ...DEFAULT_CONFIG };

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
  };
}

import type { AuditLogger } from "../audit/logger";
import type { ClawLensConfig } from "../config";
import type { PolicyEngine } from "../policy/engine";
import type { RateLimiter } from "../rate/limiter";
import type { EvalCache } from "../risk/eval-cache";
import type { SessionContext } from "../risk/session-context";
import type { BeforeToolCallEvent, BeforeToolCallResult, EmbeddedAgentRuntime, ModelAuth } from "../types";
export interface BeforeToolCallDeps {
    engine: PolicyEngine;
    auditLogger: AuditLogger;
    rateLimiter: RateLimiter;
    config: ClawLensConfig;
    sessionContext: SessionContext;
    evalCache?: EvalCache;
    alertSend?: (msg: string) => Promise<void> | void;
    logger?: import("../types").PluginLogger;
    runtime?: {
        agent?: EmbeddedAgentRuntime;
        modelAuth?: ModelAuth;
    };
    provider?: string;
    openClawConfig?: Record<string, unknown>;
}
export declare function createBeforeToolCallHandler(deps: BeforeToolCallDeps): (event: BeforeToolCallEvent, ctx: Record<string, unknown>) => Promise<BeforeToolCallResult | undefined>;

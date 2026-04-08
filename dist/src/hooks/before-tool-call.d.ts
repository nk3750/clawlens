import type { AuditLogger } from "../audit/logger";
import type { ClawLensConfig } from "../config";
import type { PolicyEngine } from "../policy/engine";
import type { RateLimiter } from "../rate/limiter";
import type { EvalCache } from "../risk/eval-cache";
import type { SessionContext } from "../risk/session-context";
import type { BeforeToolCallEvent, BeforeToolCallResult, ModelAuth } from "../types";
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
        subagent?: {
            run?: (opts: unknown) => Promise<unknown>;
            waitForRun?: (opts: unknown) => Promise<unknown>;
            getSessionMessages?: (opts: unknown) => Promise<unknown>;
            deleteSession?: (opts: unknown) => Promise<void>;
        };
        modelAuth?: ModelAuth;
    };
    provider?: string;
}
export declare function createBeforeToolCallHandler(deps: BeforeToolCallDeps): (event: BeforeToolCallEvent, ctx: Record<string, unknown>) => BeforeToolCallResult | undefined;

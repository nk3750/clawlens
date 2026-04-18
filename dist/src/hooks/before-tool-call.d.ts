import type { AuditLogger } from "../audit/logger";
import type { ClawLensConfig } from "../config";
import type { GuardrailStore } from "../guardrails/store";
import type { EvalCache } from "../risk/eval-cache";
import type { SessionContext } from "../risk/session-context";
import type { BeforeToolCallEvent, BeforeToolCallResult, EmbeddedAgentRuntime, ModelAuth } from "../types";
import type { PendingApprovalStore } from "./pending-approval-store";
export interface BeforeToolCallDeps {
    auditLogger: AuditLogger;
    config: ClawLensConfig;
    sessionContext: SessionContext;
    guardrailStore?: GuardrailStore;
    evalCache?: EvalCache;
    alertSend?: (msg: string) => Promise<void> | void;
    logger?: import("../types").PluginLogger;
    runtime?: {
        agent?: EmbeddedAgentRuntime;
        modelAuth?: ModelAuth;
    };
    provider?: string;
    openClawConfig?: Record<string, unknown>;
    /**
     * Optional so existing test harnesses keep compiling. Production wiring in
     * index.ts always supplies one; without it, dashboard-side approval
     * resolution is disabled and Telegram / timeouts still work.
     */
    pendingApprovalStore?: PendingApprovalStore;
}
export declare function createBeforeToolCallHandler(deps: BeforeToolCallDeps): (event: BeforeToolCallEvent, ctx: Record<string, unknown>) => Promise<BeforeToolCallResult | undefined>;

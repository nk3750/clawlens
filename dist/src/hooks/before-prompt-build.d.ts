import type { PolicyEngine } from "../policy/engine";
import type { BeforePromptBuildEvent, BeforePromptBuildResult } from "../types";
export declare function createBeforePromptBuildHandler(engine: PolicyEngine): (_event: BeforePromptBuildEvent, _ctx: unknown) => BeforePromptBuildResult | undefined;

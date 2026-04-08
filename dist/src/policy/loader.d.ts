import type { PluginLogger } from "../types";
import type { PolicyEngine } from "./engine";
export declare class PolicyLoader {
    private engine;
    private watcher;
    private policyPath;
    private logger;
    private debounceTimer;
    constructor(engine: PolicyEngine, policyPath: string, logger: PluginLogger);
    /** Load policy from disk. Throws on first load failure (plugin won't start). */
    load(): void;
    /** Start watching the policy file for changes. */
    startWatching(): void;
    /** Stop watching the policy file. */
    stopWatching(): void;
    private reload;
    private parse;
    private validate;
}

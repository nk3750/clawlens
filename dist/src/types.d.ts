import type { IncomingMessage, ServerResponse } from "node:http";
export type HttpRouteAuth = "gateway" | "plugin";
export type HttpRouteMatch = "exact" | "prefix";
export type HttpRouteHandler = (req: IncomingMessage, res: ServerResponse) => Promise<boolean | undefined> | boolean | undefined;
export interface HttpRouteParams {
    path: string;
    handler: HttpRouteHandler;
    auth: HttpRouteAuth;
    match?: HttpRouteMatch;
    replaceExisting?: boolean;
}
export interface PluginLogger {
    info(...args: unknown[]): void;
    warn(...args: unknown[]): void;
    error(...args: unknown[]): void;
}
export interface OpenClawPluginApi {
    id: string;
    name: string;
    config: Record<string, unknown>;
    pluginConfig?: Record<string, unknown>;
    logger: PluginLogger;
    on(hookName: string, handler: (...args: any[]) => any, opts?: {
        priority?: number;
    }): void;
    registerGatewayMethod(method: string, handler: (...args: unknown[]) => unknown): void;
    registerService(service: {
        id: string;
        start: () => Promise<void>;
        stop: () => Promise<void>;
    }): void;
    registerCli(registrar: (cli: CliRegistrar) => void, opts?: Record<string, unknown>): void;
    registerHttpRoute(params: HttpRouteParams): void;
    resolvePath(input: string): string;
}
export interface CliRegistrar {
    command(name: string): CliCommand;
}
export interface CliCommand {
    description(desc: string): CliCommand;
    option(flags: string, desc: string, defaultValue?: string): CliCommand;
    action(fn: (...args: any[]) => void | Promise<void>): CliCommand;
}
export interface OpenClawPluginDefinition {
    id?: string;
    name?: string;
    description?: string;
    version?: string;
    register?: (api: OpenClawPluginApi) => void | Promise<void>;
}
export interface ModelAuth {
    resolveApiKeyForProvider(provider: string): Promise<string>;
    getApiKeyForModel(model: string): Promise<string>;
}
export interface BeforeToolCallEvent {
    toolName: string;
    params: Record<string, unknown>;
    runId?: string;
    toolCallId?: string;
}
export interface BeforeToolCallResult {
    params?: Record<string, unknown>;
    block?: boolean;
    blockReason?: string;
    requireApproval?: {
        title: string;
        description: string;
        severity?: "info" | "warning" | "critical";
        timeoutMs?: number;
        timeoutBehavior?: "allow" | "deny";
        pluginId?: string;
        onResolution?: (decision: string) => Promise<void> | void;
    };
}
export interface AfterToolCallEvent {
    toolName: string;
    params: Record<string, unknown>;
    result: unknown;
    runId?: string;
    toolCallId?: string;
}
export interface SessionEvent {
    sessionKey: string;
}
export interface BeforePromptBuildEvent {
    agentId: string;
    sessionKey: string;
}
export interface BeforePromptBuildResult {
    systemPrompt?: string;
    prependContext?: string;
    appendSystemContext?: string;
}

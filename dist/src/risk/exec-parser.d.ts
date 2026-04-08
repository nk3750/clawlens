/**
 * Exec command parser for ClawLens risk scoring.
 *
 * Parses shell command strings into structured data so the scorer
 * can assign category-specific base scores and modifiers can match
 * against parsed tokens instead of raw substrings.
 */
export type ExecCategory = "read-only" | "search" | "system-info" | "echo" | "git-read" | "git-write" | "network-read" | "network-write" | "scripting" | "package-mgmt" | "destructive" | "permissions" | "persistence" | "remote" | "unknown-exec";
export interface ParsedExecCommand {
    /** The primary command name (e.g., "cat", "curl", "python3") */
    primaryCommand: string;
    /** Category for base score lookup */
    category: ExecCategory;
    /** Flags on the primary command (e.g., ["-rf", "--force"]) */
    flags: string[];
    /** URLs found in the command (for curl/wget) */
    urls: string[];
    /** Whether the command contains a heredoc */
    hasHeredoc: boolean;
    /** The full piped command chain segments */
    segments: string[];
}
/** Base scores per exec category */
export declare const EXEC_BASE_SCORES: Record<ExecCategory, number>;
export declare function parseExecCommand(rawCommand: string): ParsedExecCommand;
/**
 * Convenience: get the base score for a parsed exec command.
 */
export declare function getExecBaseScore(parsed: ParsedExecCommand): number;
/**
 * Convenience: parse and get category + base score in one call.
 */
export declare function getExecCategory(command: string): {
    category: ExecCategory;
    baseScore: number;
    parsed: ParsedExecCommand;
};

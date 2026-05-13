/**
 * Shared credential-redaction module.
 *
 * Used before tool-call params are persisted to the audit log, stored in the
 * session context, sent to the LLM evaluator, included in session summaries,
 * or routed into alerts/approval prompts. Deterministic risk scoring and
 * guardrail matching still operate on raw params before redaction so local
 * policy decisions see full context — see spec
 * docs/product/clawscan-install-security-remediation-spec.md §2A.
 *
 * The policy is best-effort: it covers the credential-pattern matrix
 * enumerated in the spec without claiming to catch every secret. Treat the
 * local audit directory as sensitive regardless.
 */
export declare const REDACTION_MARKERS: {
    readonly token: "<redacted:token>";
    readonly authorization: "<redacted:authorization>";
    readonly password: "<redacted:password>";
    readonly cookie: "<redacted:cookie>";
    readonly privateKey: "<redacted:private-key>";
    readonly urlCredential: "<redacted:url-credential>";
};
/**
 * Redact a single URL string. Preserves scheme/host/path; replaces userinfo
 * and sensitive query-param values. Returns the input unchanged if it does
 * not start with http:// or https://.
 */
export declare function redactUrl(input: string): string;
/**
 * Redact known credential patterns inside a free-form string. Runs PEM-block,
 * URL, HTTP-header, CLI-flag, env-assignment, and token-prefix scans in order.
 */
export declare function redactString(input: string): string;
/**
 * Recursively redact a params object. Returns a new object — does not mutate
 * the input. Sensitive keys are replaced with stable markers; other string
 * values are scanned for known credential patterns.
 */
export declare function redactParams(params: Record<string, unknown>): Record<string, unknown>;

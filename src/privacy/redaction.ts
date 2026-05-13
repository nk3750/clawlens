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

export const REDACTION_MARKERS = {
  token: "<redacted:token>",
  authorization: "<redacted:authorization>",
  password: "<redacted:password>",
  cookie: "<redacted:cookie>",
  privateKey: "<redacted:private-key>",
  urlCredential: "<redacted:url-credential>",
} as const;

// Object keys whose entire value is replaced with a marker, regardless of
// shape. Matched case-insensitively. Names chosen to match the credential
// shapes enumerated in spec §2A L224. Bare `auth`/`pwd`/`key` are deliberately
// excluded because they are too easily confused with non-credential fields
// (e.g. cache_key, pwd as print-working-directory).
const KEY_MARKERS: Array<[RegExp, string]> = [
  [/^(password|passwd)$/i, REDACTION_MARKERS.password],
  [/^authorization$/i, REDACTION_MARKERS.authorization],
  [/^cookies?$/i, REDACTION_MARKERS.cookie],
  [/^private[-_]?key$/i, REDACTION_MARKERS.privateKey],
  [
    /^(api[-_]?key|token|secret|access[-_]?token|refresh[-_]?token|client[-_]?secret|x[-_]?api[-_]?key|x[-_]?auth[-_]?token|x[-_]?access[-_]?token)$/i,
    REDACTION_MARKERS.token,
  ],
];

const PEM_RE = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g;

// Known credential prefixes in free-form text. Order: longer/more-specific
// patterns first so they win over generic catches like `sk-`.
const TOKEN_PREFIX_REGEXES: RegExp[] = [
  /\bgithub_pat_[A-Za-z0-9_]{22,}\b/g,
  /\bgh[opusr]_[A-Za-z0-9]{20,}\b/g,
  /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g,
  /\bsk-[A-Za-z0-9_-]{20,}\b/g,
  /\bxox[abprs]-[0-9A-Za-z-]{10,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
];

const SENSITIVE_QUERY_RE =
  /([?&])(token|api[-_]?key|access[-_]?token|refresh[-_]?token|client[-_]?secret|secret|password|passwd|key)=([^&#\s]+)/gi;

// Issue #75: must catch URL userinfo when the URL is embedded in a free-form
// command string (e.g. `curl https://user:pass@api.example.com`), not just when
// it appears at the start. Drop the `^` anchor, add the `g` flag so multiple
// embedded URLs in one string are all redacted, and add `\s` to the negated
// userinfo class so the match cannot span whitespace and mis-redact an
// email-like substring sitting after a benign URL.
const URL_USERINFO_RE = /(https?:\/\/)([^/@?#\s]+)@/gi;

const AUTHORIZATION_HEADER_RE =
  /(Authorization:\s*)(?:(Bearer|Basic|Digest|Token|API-Key|Apikey)\s+)?(\S+)/gi;

const GENERIC_TOKEN_HEADER_RE = /((?:x-api-key|x-auth-token|x-access-token):\s*)(\S+)/gi;

const COOKIE_HEADER_RE = /(Cookie:\s*)([^"\n\r]+)/gi;

// CLI flag → redaction marker. Split out so password flags get the password
// marker rather than the generic token one.
const PASSWORD_CLI_RE = /(--password(?:\s+|=))(\S+)/gi;
const SHORT_PASSWORD_CLI_RE = /((?<=\s|^)-p\s+)(\S+)/g;
const TOKEN_CLI_RE =
  /(--(?:token|api[-_]?key|secret|access[-_]?token|refresh[-_]?token|client[-_]?secret)(?:\s+|=))(\S+)/gi;

// Env-style assignments. The leading `\b` plus uppercase-only first char
// avoids matching shell variables like `node-env=production`. The suffix list
// keeps the false-positive rate down — we redact assignments whose name ends
// in KEY/TOKEN/SECRET/PASSWORD, plus a literal PASSWORD assignment.
const ENV_KEY_ASSIGN_RE = /\b([A-Z][A-Z0-9_]*_(?:KEY|TOKEN|SECRET))=(\S+)/g;
const ENV_PASSWORD_ASSIGN_RE = /\b([A-Z][A-Z0-9_]*PASSWORD|PASSWORD)=(\S+)/g;

function matchSensitiveKey(key: string): string | null {
  for (const [re, marker] of KEY_MARKERS) {
    if (re.test(key)) return marker;
  }
  return null;
}

function redactPemBlocks(input: string): string {
  return input.replace(PEM_RE, REDACTION_MARKERS.privateKey);
}

function redactHeaders(input: string): string {
  let out = input.replace(
    AUTHORIZATION_HEADER_RE,
    (_m, label: string, scheme: string | undefined) => {
      const schemePart = scheme ? `${scheme} ` : "";
      return `${label}${schemePart}${REDACTION_MARKERS.authorization}`;
    },
  );
  out = out.replace(
    GENERIC_TOKEN_HEADER_RE,
    (_m, label: string) => `${label}${REDACTION_MARKERS.token}`,
  );
  out = out.replace(COOKIE_HEADER_RE, (_m, label: string) => `${label}${REDACTION_MARKERS.cookie}`);
  return out;
}

function redactCliFlags(input: string): string {
  let out = input.replace(
    PASSWORD_CLI_RE,
    (_m, prefix: string) => `${prefix}${REDACTION_MARKERS.password}`,
  );
  out = out.replace(
    SHORT_PASSWORD_CLI_RE,
    (_m, prefix: string) => `${prefix}${REDACTION_MARKERS.password}`,
  );
  out = out.replace(TOKEN_CLI_RE, (_m, prefix: string) => `${prefix}${REDACTION_MARKERS.token}`);
  return out;
}

function redactEnvAssignments(input: string): string {
  let out = input.replace(
    ENV_PASSWORD_ASSIGN_RE,
    (_m, name: string) => `${name}=${REDACTION_MARKERS.password}`,
  );
  out = out.replace(ENV_KEY_ASSIGN_RE, (_m, name: string) => `${name}=${REDACTION_MARKERS.token}`);
  return out;
}

function redactTokenPrefixes(input: string): string {
  let out = input;
  for (const re of TOKEN_PREFIX_REGEXES) {
    out = out.replace(re, REDACTION_MARKERS.token);
  }
  return out;
}

function redactUrlContent(input: string): string {
  let out = input.replace(
    URL_USERINFO_RE,
    (_m, scheme: string) => `${scheme}${REDACTION_MARKERS.urlCredential}@`,
  );
  out = out.replace(
    SENSITIVE_QUERY_RE,
    (_m, sep: string, name: string) => `${sep}${name}=${REDACTION_MARKERS.token}`,
  );
  return out;
}

/**
 * Redact a single URL string. Preserves scheme/host/path; replaces userinfo
 * and sensitive query-param values. Returns the input unchanged if it does
 * not start with http:// or https://.
 */
export function redactUrl(input: string): string {
  if (!/^https?:\/\//i.test(input)) return input;
  return redactUrlContent(input);
}

/**
 * Redact known credential patterns inside a free-form string. Runs PEM-block,
 * URL, HTTP-header, CLI-flag, env-assignment, and token-prefix scans in order.
 */
export function redactString(input: string): string {
  let out = redactPemBlocks(input);
  out = redactUrlContent(out);
  out = redactHeaders(out);
  out = redactCliFlags(out);
  out = redactEnvAssignments(out);
  out = redactTokenPrefixes(out);
  return out;
}

function redactValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return redactString(value);
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(redactValue);

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const marker = matchSensitiveKey(k);
    if (
      marker !== null &&
      (typeof v === "string" || typeof v === "number" || typeof v === "boolean")
    ) {
      out[k] = marker;
    } else {
      out[k] = redactValue(v);
    }
  }
  return out;
}

/**
 * Recursively redact a params object. Returns a new object — does not mutate
 * the input. Sensitive keys are replaced with stable markers; other string
 * values are scanned for known credential patterns.
 */
export function redactParams(params: Record<string, unknown>): Record<string, unknown> {
  return redactValue(params) as Record<string, unknown>;
}

/**
 * Mock data for ClawLens Dashboard v2 local development.
 *
 * MOCK_SCENARIO controls agent count for testing the constellation layout:
 *   "standard" — 7 agents (heptagon: outer hex + center). Default.
 *   "stress"   — 21 agents across 3-4 concentric rings. Heterogeneous properties.
 *
 * Switch to "stress" to test the shape-from-count algorithm at scale.
 */

export const MOCK_SCENARIO: "standard" | "stress" = "standard";

import type {
  AgentInfo,
  StatsResponse,
  EntryResponse,
  SessionInfo,
  ActivityCategory,
} from "./src/lib/types";

const now = Date.now();
const min = 60_000;
const hour = 60 * min;

type RiskTierStr = "low" | "medium" | "high" | "critical";
function riskTier(score: number): RiskTierStr {
  if (score > 75) return "critical";
  if (score > 50) return "high";
  if (score > 25) return "medium";
  return "low";
}

const TOOL_TO_CATEGORY: Record<string, ActivityCategory> = {
  read: "exploring",
  search: "exploring",
  glob: "exploring",
  grep: "exploring",
  write: "changes",
  edit: "changes",
  exec: "commands",
  fetch_url: "web",
  message: "comms",
};
function getCategory(tool: string): ActivityCategory {
  return TOOL_TO_CATEGORY[tool] ?? "commands";
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

const policyRules = [
  "shell.require_approval",
  "messaging.require_approval",
  "reads.allow",
  "writes.approval_required",
  "default.approval_required",
];
const riskTagPool = [
  "destructive",
  "exfiltration",
  "persistence",
  "privilege-escalation",
  "data-mutation",
  "external-comms",
];

interface MockEntrySpec {
  toolName: string;
  params: Record<string, unknown>;
  riskScore: number;
  agentId: string;
  sessionKey: string;
  offsetMs: number;
  decision?: "allow" | "block" | "approval_required";
  userResponse?: "approved" | "denied" | "timeout";
  effectiveDecision?: string;
}

function buildEntry(spec: MockEntrySpec): EntryResponse {
  const decision = spec.decision ?? "allow";
  let effectiveDecision = spec.effectiveDecision ?? decision;
  if (decision === "approval_required" && !spec.effectiveDecision) {
    effectiveDecision = spec.userResponse ?? "allow";
  }

  const tags: string[] = [];
  if (spec.riskScore > 50) tags.push(pick(riskTagPool));
  if (spec.riskScore > 70) tags.push(pick(riskTagPool.filter((t) => !tags.includes(t))));

  const llmEval =
    spec.riskScore > 50
      ? {
          adjustedScore: spec.riskScore + Math.floor(Math.random() * 10) - 5,
          reasoning: pick([
            "Agent is executing a deployment command that modifies production infrastructure.",
            "This action sends data to an external endpoint. Combined with recent reads, this may indicate data exfiltration.",
            "The agent is modifying configuration files outside its normal scope.",
            "Multiple rapid tool calls detected in sequence. Pattern resembles automated scanning.",
          ]),
          tags,
          confidence: pick(["high", "medium", "low"]) as string,
          patterns: pick([
            ["rapid-sequence", "external-target"],
            ["config-modification", "scope-violation"],
          ]),
        }
      : undefined;

  return {
    timestamp: new Date(now - spec.offsetMs).toISOString(),
    toolName: spec.toolName,
    toolCallId: `tc_${Math.random().toString(36).slice(2, 10)}`,
    params: spec.params,
    policyRule: pick(policyRules),
    decision,
    effectiveDecision,
    riskScore: spec.riskScore,
    riskTier: riskTier(spec.riskScore),
    riskTags: tags,
    agentId: spec.agentId,
    sessionKey: spec.sessionKey,
    executionResult: decision !== "block" ? "success" : undefined,
    durationMs: Math.floor(Math.random() * 2000) + 50,
    category: getCategory(spec.toolName),
    llmEvaluation: llmEval,
    userResponse: spec.userResponse,
  };
}

export function generateMockEntries(): EntryResponse[] {
  const entries: EntryResponse[] = [];

  // ── deploy-bot: active, interactive, running CI pipeline ──
  // Target avg risk ~42 (elevated)
  const deploySpecs: MockEntrySpec[] = [
    { toolName: "read", params: { path: "package.json" }, riskScore: 18, offsetMs: 30_000 },
    { toolName: "read", params: { path: "Dockerfile" }, riskScore: 22, offsetMs: 60_000 },
    { toolName: "exec", params: { command: "npm run build" }, riskScore: 35, offsetMs: 90_000 },
    { toolName: "exec", params: { command: "docker build -t app:latest ." }, riskScore: 52, offsetMs: 2 * min },
    { toolName: "exec", params: { command: "npm test" }, riskScore: 28, offsetMs: 2.5 * min },
    { toolName: "fetch_url", params: { url: "https://registry.internal/v2/tags" }, riskScore: 35, offsetMs: 3 * min },
    { toolName: "exec", params: { command: "docker push registry.internal/app:latest" }, riskScore: 62, offsetMs: 3.5 * min },
    { toolName: "read", params: { path: "deploy/k8s-manifest.yaml" }, riskScore: 25, offsetMs: 4 * min },
    { toolName: "write", params: { path: "deploy/k8s-manifest.yaml" }, riskScore: 48, offsetMs: 4.5 * min },
    { toolName: "exec", params: { command: "kubectl apply -f deploy/" }, riskScore: 72, offsetMs: 5 * min, decision: "approval_required", userResponse: "approved", effectiveDecision: "approved" },
    { toolName: "fetch_url", params: { url: "https://api.slack.com/webhook/deploy-notify" }, riskScore: 30, offsetMs: 5.5 * min },
    { toolName: "read", params: { path: "src/config/env.ts" }, riskScore: 28, offsetMs: 6 * min },
    { toolName: "exec", params: { command: "curl https://healthcheck.internal/api/status" }, riskScore: 32, offsetMs: 6.5 * min },
    { toolName: "write", params: { path: "deploy/status.json" }, riskScore: 35, offsetMs: 7 * min },
    // Pending approval — triggers needsAttention
    { toolName: "exec", params: { command: "kubectl rollout restart deployment/app" }, riskScore: 78, offsetMs: 1 * min, decision: "approval_required", effectiveDecision: "pending" },
  ];
  for (const spec of deploySpecs) {
    entries.push(buildEntry({ ...spec, agentId: "deploy-bot", sessionKey: "agent:deploy-bot:web:ci-pipeline:run-482" }));
  }

  // ── code-reviewer: active, interactive, reviewing PR ──
  // Target avg risk ~18 (calm)
  const reviewSpecs: MockEntrySpec[] = [
    { toolName: "read", params: { path: "src/auth/middleware.ts" }, riskScore: 8, offsetMs: 1 * min },
    { toolName: "read", params: { path: "src/auth/session.ts" }, riskScore: 10, offsetMs: 1.5 * min },
    { toolName: "read", params: { path: "src/auth/types.ts" }, riskScore: 5, offsetMs: 2 * min },
    { toolName: "read", params: { path: "src/auth/index.ts" }, riskScore: 8, offsetMs: 2.5 * min },
    { toolName: "grep", params: { pattern: "validateToken", path: "src/" }, riskScore: 6, offsetMs: 3 * min },
    { toolName: "read", params: { path: "tests/auth.test.ts" }, riskScore: 10, offsetMs: 3.5 * min },
    { toolName: "exec", params: { command: "npm run typecheck" }, riskScore: 15, offsetMs: 4 * min },
    { toolName: "read", params: { path: "src/api/routes.ts" }, riskScore: 12, offsetMs: 4.5 * min },
    { toolName: "write", params: { path: "src/auth/middleware.ts" }, riskScore: 32, offsetMs: 5 * min },
    { toolName: "write", params: { path: "tests/auth.test.ts" }, riskScore: 22, offsetMs: 5.5 * min },
    { toolName: "exec", params: { command: "npm test -- --filter auth" }, riskScore: 18, offsetMs: 6 * min },
    { toolName: "read", params: { path: ".github/CODEOWNERS" }, riskScore: 8, offsetMs: 6.5 * min },
    { toolName: "exec", params: { command: "git diff --stat" }, riskScore: 12, offsetMs: 7 * min },
    { toolName: "message", params: { to: "#code-review", subject: "PR feedback ready" }, riskScore: 38, offsetMs: 7.5 * min },
  ];
  for (const spec of reviewSpecs) {
    entries.push(buildEntry({ ...spec, agentId: "code-reviewer", sessionKey: "agent:code-reviewer:telegram:pr-review:pr-247" }));
  }

  // ── nightly-scan: scheduled (every 6h), idle, ran 6h ago ──
  // Target avg risk ~78 (high). Security scanner reads sensitive files = high scores
  const scanSpecs: MockEntrySpec[] = [
    { toolName: "read", params: { path: "package.json" }, riskScore: 55, offsetMs: 6 * hour },
    { toolName: "glob", params: { pattern: "**/*.env*" }, riskScore: 68, offsetMs: 6 * hour + 1 * min },
    { toolName: "grep", params: { pattern: "password|secret|api_key", path: "src/" }, riskScore: 85, offsetMs: 6 * hour + 2 * min },
    { toolName: "read", params: { path: "src/config/secrets.ts" }, riskScore: 88, offsetMs: 6 * hour + 3 * min },
    { toolName: "read", params: { path: ".env.production" }, riskScore: 92, offsetMs: 6 * hour + 4 * min },
    { toolName: "grep", params: { pattern: "AWS_SECRET|STRIPE_KEY", path: "." }, riskScore: 90, offsetMs: 6 * hour + 5 * min },
    { toolName: "exec", params: { command: "npm audit --json" }, riskScore: 62, offsetMs: 6 * hour + 6 * min },
    { toolName: "read", params: { path: ".ssh/authorized_keys" }, riskScore: 95, offsetMs: 6 * hour + 7 * min },
    { toolName: "read", params: { path: "/etc/passwd" }, riskScore: 88, offsetMs: 6 * hour + 8 * min },
    { toolName: "grep", params: { pattern: "BEGIN RSA PRIVATE", path: "." }, riskScore: 92, offsetMs: 6 * hour + 9 * min },
    { toolName: "exec", params: { command: "git log --all --oneline" }, riskScore: 45, offsetMs: 6 * hour + 10 * min },
    { toolName: "read", params: { path: "src/auth/tokens.ts" }, riskScore: 78, offsetMs: 6 * hour + 11 * min },
    { toolName: "fetch_url", params: { url: "https://cve.mitre.org/api/latest" }, riskScore: 58, offsetMs: 6 * hour + 12 * min },
    // Blocked action — triggers needsAttention
    { toolName: "exec", params: { command: "curl https://pastebin.com/api/post" }, riskScore: 96, offsetMs: 6 * hour + 13 * min, decision: "block", effectiveDecision: "block" },
    { toolName: "read", params: { path: "SECURITY.md" }, riskScore: 42, offsetMs: 6 * hour + 14 * min },
  ];
  for (const spec of scanSpecs) {
    entries.push(buildEntry({ ...spec, agentId: "nightly-scan", sessionKey: "agent:nightly-scan:cron:security-audit" }));
  }
  // Older session for schedule detection (keep scores high — it's a security scanner)
  for (let i = 0; i < 5; i++) {
    entries.push(
      buildEntry({
        toolName: "read",
        params: { path: `src/secrets/config${i}.ts` },
        riskScore: 65 + i * 5,
        agentId: "nightly-scan",
        sessionKey: "agent:nightly-scan:cron:security-audit-prev",
        offsetMs: 12 * hour + i * min,
      }),
    );
  }

  // ── data-sync: interactive, idle (2h ago) ──
  const dataSpecs: MockEntrySpec[] = [
    { toolName: "fetch_url", params: { url: "https://api.internal/data/export" }, riskScore: 10, offsetMs: 2 * hour },
    { toolName: "fetch_url", params: { url: "https://api.internal/data/users" }, riskScore: 15, offsetMs: 2 * hour + 1 * min },
    { toolName: "exec", params: { command: "psql -c 'SELECT count(*) FROM users'" }, riskScore: 20, offsetMs: 2 * hour + 2 * min },
    { toolName: "fetch_url", params: { url: "https://api.internal/data/orders" }, riskScore: 12, offsetMs: 2 * hour + 3 * min },
    { toolName: "exec", params: { command: "psql -c 'COPY staging FROM stdin'" }, riskScore: 35, offsetMs: 2 * hour + 4 * min, decision: "approval_required", userResponse: "approved", effectiveDecision: "approved" },
    { toolName: "fetch_url", params: { url: "https://api.internal/data/inventory" }, riskScore: 8, offsetMs: 2 * hour + 5 * min },
    { toolName: "exec", params: { command: "node scripts/transform.js" }, riskScore: 18, offsetMs: 2 * hour + 6 * min },
    { toolName: "exec", params: { command: "psql -c 'INSERT INTO sync_log ...'" }, riskScore: 22, offsetMs: 2 * hour + 7 * min },
    { toolName: "fetch_url", params: { url: "https://webhook.site/sync-complete" }, riskScore: 10, offsetMs: 2 * hour + 8 * min },
    { toolName: "exec", params: { command: "node scripts/validate.js" }, riskScore: 12, offsetMs: 2 * hour + 9 * min },
    { toolName: "fetch_url", params: { url: "https://api.internal/data/metrics" }, riskScore: 5, offsetMs: 2 * hour + 10 * min },
    { toolName: "exec", params: { command: "node scripts/cleanup.js" }, riskScore: 8, offsetMs: 2 * hour + 11 * min },
  ];
  for (const spec of dataSpecs) {
    entries.push(buildEntry({ ...spec, agentId: "data-sync", sessionKey: "agent:data-sync:api:sync-run:batch-91" }));
  }

  // ── test-runner: interactive, active, running tests, low risk ──
  const testSpecs: MockEntrySpec[] = [
    { toolName: "read", params: { path: "tests/auth.test.ts" }, riskScore: 5, offsetMs: 2 * min },
    { toolName: "exec", params: { command: "npm test -- --filter auth" }, riskScore: 15, offsetMs: 2.5 * min },
    { toolName: "read", params: { path: "tests/api.test.ts" }, riskScore: 5, offsetMs: 3 * min },
    { toolName: "exec", params: { command: "npm test -- --filter api" }, riskScore: 12, offsetMs: 3.5 * min },
    { toolName: "exec", params: { command: "npm run coverage" }, riskScore: 18, offsetMs: 4 * min },
    { toolName: "read", params: { path: "coverage/lcov-report/index.html" }, riskScore: 4, offsetMs: 4.5 * min },
    { toolName: "message", params: { to: "#ci-results", subject: "Tests passed" }, riskScore: 20, offsetMs: 5 * min },
  ];
  for (const spec of testSpecs) {
    entries.push(buildEntry({ ...spec, agentId: "test-runner", sessionKey: "agent:test-runner:web:ci-tests:run-103" }));
  }

  // ── api-monitor: scheduled, idle (4h ago), monitoring endpoints ──
  const monitorSpecs: MockEntrySpec[] = [
    { toolName: "fetch_url", params: { url: "https://api.internal/health" }, riskScore: 5, offsetMs: 4 * hour },
    { toolName: "fetch_url", params: { url: "https://api.internal/v2/status" }, riskScore: 8, offsetMs: 4 * hour + 1 * min },
    { toolName: "fetch_url", params: { url: "https://api.internal/metrics" }, riskScore: 5, offsetMs: 4 * hour + 2 * min },
    { toolName: "exec", params: { command: "curl -s https://api.internal/latency" }, riskScore: 12, offsetMs: 4 * hour + 3 * min },
    { toolName: "message", params: { to: "#ops-alerts", subject: "All endpoints healthy" }, riskScore: 15, offsetMs: 4 * hour + 4 * min },
  ];
  for (const spec of monitorSpecs) {
    entries.push(buildEntry({ ...spec, agentId: "api-monitor", sessionKey: "agent:api-monitor:cron:health-check" }));
  }

  // ── log-analyzer: interactive, idle (8h ago), analyzed logs ──
  const logSpecs: MockEntrySpec[] = [
    { toolName: "read", params: { path: "/var/log/app/error.log" }, riskScore: 30, offsetMs: 8 * hour },
    { toolName: "grep", params: { pattern: "FATAL|ERROR|WARN", path: "/var/log/" }, riskScore: 25, offsetMs: 8 * hour + 1 * min },
    { toolName: "read", params: { path: "/var/log/app/access.log" }, riskScore: 18, offsetMs: 8 * hour + 2 * min },
    { toolName: "exec", params: { command: "wc -l /var/log/app/*.log" }, riskScore: 10, offsetMs: 8 * hour + 3 * min },
    { toolName: "fetch_url", params: { url: "https://grafana.internal/api/alerts" }, riskScore: 15, offsetMs: 8 * hour + 4 * min },
    { toolName: "message", params: { to: "#incidents", subject: "Log analysis: 3 new errors" }, riskScore: 35, offsetMs: 8 * hour + 5 * min },
  ];
  for (const spec of logSpecs) {
    entries.push(buildEntry({ ...spec, agentId: "log-analyzer", sessionKey: "agent:log-analyzer:telegram:on-demand:user-42" }));
  }

  // ── Stress test agents (only when MOCK_SCENARIO === "stress") ──
  if (MOCK_SCENARIO === "stress") {
    const stressAgents: Array<{
      id: string; session: string; status: "active" | "idle"; tools: string[];
      riskBase: number; riskVar: number; offsetBase: number; count: number;
    }> = [
      { id: "email-sender", session: "agent:email-sender:web:outreach:batch-7", status: "idle", tools: ["message", "read", "fetch_url"], riskBase: 55, riskVar: 15, offsetBase: 1 * hour, count: 8 },
      { id: "db-migrator", session: "agent:db-migrator:web:schema-update:v3.2", status: "active", tools: ["exec", "read", "write"], riskBase: 82, riskVar: 12, offsetBase: 3 * min, count: 10 },
      { id: "slack-notifier", session: "agent:slack-notifier:api:alerts:daily", status: "idle", tools: ["message", "fetch_url"], riskBase: 8, riskVar: 8, offsetBase: 3 * hour, count: 5 },
      { id: "doc-generator", session: "agent:doc-generator:web:api-docs:sprint-14", status: "active", tools: ["read", "write", "grep"], riskBase: 22, riskVar: 10, offsetBase: 5 * min, count: 7 },
      { id: "api-tester", session: "agent:api-tester:cron:regression:nightly", status: "active", tools: ["fetch_url", "exec", "read"], riskBase: 45, riskVar: 15, offsetBase: 2 * min, count: 9 },
      { id: "backup-agent", session: "agent:backup-agent:cron:daily-backup", status: "idle", tools: ["exec", "read"], riskBase: 5, riskVar: 5, offsetBase: 10 * hour, count: 4 },
      { id: "perf-monitor", session: "agent:perf-monitor:web:dashboard:perf-check", status: "active", tools: ["fetch_url", "exec", "read"], riskBase: 38, riskVar: 12, offsetBase: 4 * min, count: 8 },
      { id: "secret-scanner", session: "agent:secret-scanner:cron:vault-audit", status: "active", tools: ["grep", "read", "glob"], riskBase: 67, riskVar: 18, offsetBase: 1 * min, count: 10 },
      { id: "dependency-bot", session: "agent:dependency-bot:cron:dep-update", status: "idle", tools: ["read", "exec", "write"], riskBase: 15, riskVar: 10, offsetBase: 6 * hour, count: 6 },
      { id: "release-manager", session: "agent:release-manager:web:release:v4.1.0", status: "active", tools: ["exec", "write", "read", "message"], riskBase: 52, riskVar: 15, offsetBase: 2 * min, count: 10 },
      { id: "config-validator", session: "agent:config-validator:api:config-check:env-prod", status: "idle", tools: ["read", "grep"], riskBase: 10, riskVar: 8, offsetBase: 5 * hour, count: 5 },
      { id: "incident-responder", session: "agent:incident-responder:web:incident:INC-892", status: "active", tools: ["exec", "read", "fetch_url", "message"], riskBase: 88, riskVar: 8, offsetBase: 1 * min, count: 12 },
      { id: "cost-tracker", session: "agent:cost-tracker:cron:billing-check", status: "idle", tools: ["fetch_url", "read"], riskBase: 7, riskVar: 5, offsetBase: 8 * hour, count: 4 },
      { id: "compliance-checker", session: "agent:compliance-checker:web:audit:q2-2026", status: "active", tools: ["read", "grep", "exec"], riskBase: 61, riskVar: 14, offsetBase: 3 * min, count: 9 },
    ];

    // Tool-appropriate params generators
    const stressParams: Record<string, (id: string, i: number) => Record<string, unknown>> = {
      read: (id, i) => ({ path: `src/${id}/module${i}.ts` }),
      write: (id, i) => ({ path: `src/${id}/output${i}.ts` }),
      edit: (id, i) => ({ path: `src/${id}/config${i}.ts` }),
      exec: (_id, i) => ({ command: pick([
        `npm run task-${i}`, `psql -c 'SELECT * FROM jobs LIMIT 10'`,
        `docker ps --filter name=svc`, `kubectl get pods -n prod`,
        `node scripts/run-${i}.js`, `curl -s https://api.internal/health`,
      ]) }),
      fetch_url: (_id, i) => ({ url: pick([
        `https://api.internal/v2/data/${i}`, `https://registry.internal/check`,
        `https://grafana.internal/api/dashboards`, `https://webhook.site/callback-${i}`,
      ]) }),
      message: (_id, i) => ({ to: pick(["#ops-alerts", "#deploys", "#incidents", "#team-updates"]), subject: pick([
        `Status update #${i}`, "Alert resolved", "Deploy complete", "Scan results ready",
      ]) }),
      grep: (id, _i) => ({ pattern: pick(["TODO|FIXME", "password|secret", "error|fatal", "deprecated"]), path: `src/${id}/` }),
      glob: (id, _i) => ({ pattern: `src/${id}/**/*.ts` }),
    };

    for (const sa of stressAgents) {
      for (let i = 0; i < sa.count; i++) {
        const tool = sa.tools[i % sa.tools.length];
        const risk = Math.max(2, Math.min(98, sa.riskBase + Math.floor(Math.random() * sa.riskVar * 2) - sa.riskVar));
        const isBlock = risk > 85 && i === sa.count - 1;
        const paramsFn = stressParams[tool] ?? ((id: string, j: number) => ({ path: `src/${id}/file${j}.ts` }));
        entries.push(buildEntry({
          toolName: tool,
          params: paramsFn(sa.id, i),
          riskScore: risk,
          agentId: sa.id,
          sessionKey: sa.session,
          offsetMs: sa.offsetBase + i * min,
          decision: isBlock ? "block" : risk > 70 ? "approval_required" : undefined,
          userResponse: risk > 70 && !isBlock ? "approved" : undefined,
          effectiveDecision: isBlock ? "block" : undefined,
        }));
      }
    }
  }

  entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return entries;
}

// ── Aggregation helpers ─────────────────────────

function computeBreakdown(entries: EntryResponse[]): Record<ActivityCategory, number> {
  const counts: Record<ActivityCategory, number> = {
    exploring: 0, changes: 0, commands: 0, web: 0, comms: 0, data: 0,
  };
  for (const e of entries) counts[e.category]++;
  const total = entries.length || 1;
  const result: Record<ActivityCategory, number> = {
    exploring: 0, changes: 0, commands: 0, web: 0, comms: 0, data: 0,
  };
  const cats: ActivityCategory[] = ["exploring", "changes", "commands", "web", "comms", "data"];
  const sorted = cats
    .map((c) => ({ c, pct: Math.round((counts[c] / total) * 100) }))
    .sort((a, b) => b.pct - a.pct);
  let assigned = 0;
  for (let i = 0; i < sorted.length; i++) {
    if (i === sorted.length - 1) {
      result[sorted[i].c] = Math.max(0, 100 - assigned);
    } else {
      result[sorted[i].c] = sorted[i].pct;
      assigned += sorted[i].pct;
    }
  }
  return result;
}

function describeAction(e: EntryResponse): string {
  const p = e.params;
  switch (e.toolName) {
    case "read": return p.path ? `Read ${p.path}` : "Read file";
    case "write": return p.path ? `Write to ${p.path}` : "Write file";
    case "edit": return p.path ? `Edit ${p.path}` : "Edit file";
    case "exec": return p.command ? `Run \`${String(p.command).slice(0, 35)}\`` : "Execute command";
    case "message": return p.subject ? `Email "${p.subject}"` : "Send message";
    case "fetch_url": return p.url ? `Fetch ${String(p.url).slice(0, 40)}` : "Fetch URL";
    case "grep": return p.pattern ? `Grep "${p.pattern}"` : "Grep search";
    case "glob": return p.pattern ? `Glob ${p.pattern}` : "Glob search";
    case "search": return p.query ? `Search "${p.query}"` : "Search";
    default: return e.toolName;
  }
}

type PostureType = "calm" | "elevated" | "high" | "critical";
function riskPosture(avg: number): PostureType {
  if (avg >= 71) return "critical";
  if (avg >= 46) return "high";
  if (avg >= 21) return "elevated";
  return "calm";
}

export function generateMockAgents(entries: EntryResponse[]): AgentInfo[] {
  const agentMap = new Map<string, EntryResponse[]>();
  for (const e of entries) {
    const id = e.agentId ?? "default";
    const list = agentMap.get(id) ?? [];
    list.push(e);
    agentMap.set(id, list);
  }

  const agents: AgentInfo[] = [];
  for (const [id, ae] of agentMap) {
    const latest = ae[0];
    const isActive = Date.now() - new Date(latest.timestamp).getTime() < 5 * 60_000;

    const scores = ae.filter((e) => e.riskScore != null).map((e) => e.riskScore!);
    const avg = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
    const peak = scores.length ? Math.max(...scores) : 0;

    const todayCutoff = new Date();
    todayCutoff.setUTCHours(0, 0, 0, 0);
    const todayEntries = ae.filter((e) => new Date(e.timestamp) >= todayCutoff && e.decision);

    const isScheduled = ae.some((e) => e.sessionKey?.includes(":cron:"));
    const sessionKey = latest.sessionKey ?? "";

    // Activity breakdown from current session
    const currentSessionEntries = ae.filter((e) => e.sessionKey === sessionKey && e.decision);
    const activityBreakdown = computeBreakdown(currentSessionEntries.length > 0 ? currentSessionEntries : ae);

    // Needs attention
    let needsAttention = false;
    let attentionReason: string | undefined;
    for (const e of ae) {
      if (e.effectiveDecision === "pending") {
        needsAttention = true;
        attentionReason = `Pending approval: ${e.toolName}`;
        break;
      }
    }
    if (!needsAttention) {
      const thirtyMinAgo = Date.now() - 30 * 60_000;
      for (const e of ae) {
        if (new Date(e.timestamp).getTime() >= thirtyMinAgo) {
          if (e.effectiveDecision === "block" || e.effectiveDecision === "denied") {
            needsAttention = true;
            attentionReason = `Blocked: ${e.toolName}`;
            break;
          }
        }
      }
    }
    if (!needsAttention && peak >= 75) {
      needsAttention = true;
      attentionReason = "High risk activity detected";
    }

    // Parse context
    const parts = sessionKey.split(":");
    let currentContext: string | undefined;
    if (parts[2] === "cron") currentContext = parts.slice(3).join(":") || "Scheduled task";
    else if (parts[2] === "telegram") currentContext = "via Telegram";
    else if (parts[2] === "web") currentContext = parts.slice(3).join(":") || "via Web";
    else if (parts[2] === "api") currentContext = parts.slice(3).join(":") || "via API";

    // Today's activity breakdown (from today's entries, not session)
    const todayActivityBreakdown = computeBreakdown(todayEntries.length > 0 ? todayEntries : ae);

    agents.push({
      id,
      name: id,
      status: isActive ? "active" : "idle",
      todayToolCalls: todayEntries.length,
      avgRiskScore: avg,
      peakRiskScore: peak,
      lastActiveTimestamp: latest.timestamp,
      currentSession: isActive
        ? {
            sessionKey,
            startTime: ae[ae.length - 1].timestamp,
            toolCallCount: currentSessionEntries.length,
          }
        : undefined,
      mode: isScheduled ? "scheduled" : "interactive",
      schedule: isScheduled ? "every 6h" : undefined,
      currentContext,
      riskPosture: riskPosture(avg),
      activityBreakdown,
      todayActivityBreakdown,
      latestAction: describeAction(latest),
      latestActionTime: latest.timestamp,
      needsAttention,
      attentionReason,
    });
  }

  agents.sort((a, b) => {
    if (a.status !== b.status) return a.status === "active" ? -1 : 1;
    return (b.lastActiveTimestamp || "").localeCompare(a.lastActiveTimestamp || "");
  });

  return agents;
}

export function generateMockStats(entries: EntryResponse[]): StatsResponse {
  const todayCutoff = new Date();
  todayCutoff.setUTCHours(0, 0, 0, 0);
  const today = entries.filter((e) => new Date(e.timestamp) >= todayCutoff && e.decision);

  let allowed = 0, approved = 0, blocked = 0, timedOut = 0, pending = 0;
  let low = 0, medium = 0, high = 0, critical = 0;
  let riskSum = 0, riskCount = 0, peakRisk = 0;

  for (const e of today) {
    const eff = e.effectiveDecision;
    if (eff === "allow") allowed++;
    else if (eff === "approved") approved++;
    else if (eff === "block" || eff === "denied") blocked++;
    else if (eff === "timeout") timedOut++;
    else if (eff === "pending") pending++;

    if (e.riskTier === "low") low++;
    else if (e.riskTier === "medium") medium++;
    else if (e.riskTier === "high") high++;
    else if (e.riskTier === "critical") critical++;

    if (e.riskScore != null) {
      riskSum += e.riskScore;
      riskCount++;
      if (e.riskScore > peakRisk) peakRisk = e.riskScore;
    }
  }

  const avgRisk = riskCount > 0 ? Math.round(riskSum / riskCount) : 0;

  // Fleet posture with overrides
  let posture = riskPosture(avgRisk);
  const oneHourAgo = Date.now() - 60 * 60_000;
  const thirtyMinAgo = Date.now() - 30 * 60_000;
  for (const e of today) {
    if (new Date(e.timestamp).getTime() >= oneHourAgo && e.riskScore && e.riskScore > 75 && posture !== "critical") {
      posture = "high";
    }
    if (new Date(e.timestamp).getTime() >= thirtyMinAgo && (e.effectiveDecision === "block" || e.effectiveDecision === "denied")) {
      posture = "critical";
    }
  }

  const activeAgents = new Set(
    entries.filter((e) => Date.now() - new Date(e.timestamp).getTime() < 5 * 60_000).map((e) => e.agentId),
  );
  const activeSessions = new Set(
    entries.filter((e) => Date.now() - new Date(e.timestamp).getTime() < 5 * 60_000).map((e) => e.sessionKey),
  );

  return {
    total: allowed + approved + blocked + timedOut,
    allowed,
    approved,
    blocked,
    timedOut,
    pending,
    riskBreakdown: { low, medium, high, critical },
    avgRiskScore: avgRisk,
    peakRiskScore: peakRisk,
    activeAgents: activeAgents.size,
    activeSessions: activeSessions.size,
    riskPosture: posture,
  };
}

export function generateMockSessions(entries: EntryResponse[], agentId?: string): SessionInfo[] {
  let filtered = entries;
  if (agentId) filtered = entries.filter((e) => e.agentId === agentId);

  const sessionMap = new Map<string, EntryResponse[]>();
  for (const e of filtered) {
    if (!e.sessionKey) continue;
    const list = sessionMap.get(e.sessionKey) ?? [];
    list.push(e);
    sessionMap.set(e.sessionKey, list);
  }

  const sessions = Array.from(sessionMap.entries()).map(([key, sEntries]) => {
    const sorted = [...sEntries].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    const scores = sEntries.filter((e) => e.riskScore != null).map((e) => e.riskScore!);
    const startMs = new Date(sorted[0].timestamp).getTime();
    const endMs = new Date(sorted[sorted.length - 1].timestamp).getTime();

    const blockedCount = sEntries.filter(
      (e) => e.effectiveDecision === "block" || e.effectiveDecision === "denied",
    ).length;

    // Parse context from session key
    const parts = key.split(":");
    let context: string | undefined;
    if (parts[2] === "cron") context = parts.slice(3).join(" ").replace(/-/g, " ") || "Scheduled task";
    else if (parts.length >= 4) context = parts.slice(3).join(" ").replace(/-/g, " ");

    // Tool summary: top 5 tools by count
    const toolCounts = new Map<string, number>();
    for (const e of sEntries) {
      toolCounts.set(e.toolName, (toolCounts.get(e.toolName) ?? 0) + 1);
    }
    const toolSummary = [...toolCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([toolName, count]) => ({ toolName, category: getCategory(toolName), count }));

    // Risk sparkline: chronological scores (LLM-adjusted when available), max 20 points
    const allScores = sorted
      .filter((e) => e.riskScore != null)
      .map((e) => e.llmEvaluation?.adjustedScore ?? e.riskScore!);
    let riskSparkline: number[];
    if (allScores.length <= 20) {
      riskSparkline = allScores;
    } else {
      // Downsample to 20 points
      riskSparkline = Array.from({ length: 20 }, (_, i) => {
        const idx = Math.floor((i / 19) * (allScores.length - 1));
        return allScores[idx];
      });
    }

    return {
      sessionKey: key,
      agentId: sEntries[0].agentId ?? "default",
      startTime: sorted[0].timestamp,
      endTime: sorted[sorted.length - 1].timestamp,
      duration: endMs > startMs ? endMs - startMs : null,
      toolCallCount: sEntries.filter((e) => e.decision).length,
      avgRisk: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0,
      peakRisk: scores.length ? Math.max(...scores) : 0,
      activityBreakdown: computeBreakdown(sEntries),
      blockedCount,
      context,
      toolSummary,
      riskSparkline,
    };
  });

  sessions.sort((a, b) => b.startTime.localeCompare(a.startTime));
  return sessions;
}

/** Generate 24h risk trend for an agent from their entries. */
export function generateRiskTrend(
  entries: EntryResponse[],
  agentId: string,
): Array<{ timestamp: string; score: number; toolName: string }> {
  const cutoff = Date.now() - 24 * 60 * 60_000;
  return entries
    .filter(
      (e) =>
        e.agentId === agentId &&
        e.riskScore != null &&
        new Date(e.timestamp).getTime() >= cutoff,
    )
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    .slice(0, 200)
    .map((e) => ({
      timestamp: e.timestamp,
      score: e.llmEvaluation?.adjustedScore ?? e.riskScore!,
      toolName: e.toolName,
    }));
}

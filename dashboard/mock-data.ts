/**
 * Mock data for local dashboard development.
 * Run: cd dashboard && npm run dev
 */

const now = Date.now();
const min = 60_000;
const hour = 60 * min;

const tools = ["read", "write", "exec", "message", "search", "fetch_url"];
const agents = ["main", "seo-bot", "data-pipeline"];
const sessions = [
  "agent:main:telegram:direct:7928586762",
  "agent:main:web:session:a1b2c3",
  "agent:seo-bot:cron:daily-audit",
  "agent:data-pipeline:cron:etl-run",
];
const riskTags = [
  "destructive",
  "exfiltration",
  "persistence",
  "privilege-escalation",
  "data-mutation",
  "external-comms",
];
const policyRules = [
  "shell.require_approval",
  "messaging.require_approval",
  "reads.allow",
  "writes.approval_required",
  "default.approval_required",
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function riskTier(score: number): "low" | "medium" | "high" | "critical" {
  if (score > 80) return "critical";
  if (score > 60) return "high";
  if (score > 30) return "medium";
  return "low";
}

interface MockEntry {
  timestamp: string;
  toolName: string;
  toolCallId: string;
  params: Record<string, unknown>;
  policyRule: string;
  decision: "allow" | "block" | "approval_required";
  effectiveDecision: string;
  riskScore: number;
  riskTier: string;
  riskTags: string[];
  agentId: string;
  sessionKey: string;
  userResponse?: string;
  executionResult?: string;
  durationMs?: number;
  llmEvaluation?: {
    adjustedScore: number;
    reasoning: string;
    tags: string[];
    confidence: string;
    patterns: string[];
  };
}

function generateEntry(offsetMs: number): MockEntry {
  const tool = pick(tools);
  const agent = pick(agents);
  const session = pick(sessions.filter((s) => s.includes(agent))) || pick(sessions);
  const score = Math.floor(Math.random() * 100);
  const tier = riskTier(score);
  const decisions: Array<"allow" | "block" | "approval_required"> = ["allow", "allow", "allow", "block", "approval_required"];
  const decision = pick(decisions);

  let effectiveDecision = decision === "approval_required" ? "pending" : decision;
  let userResponse: string | undefined;
  if (decision === "approval_required" && Math.random() > 0.4) {
    userResponse = Math.random() > 0.3 ? "approved" : "denied";
    effectiveDecision = userResponse;
  }

  const tags: string[] = [];
  if (score > 50) tags.push(pick(riskTags));
  if (score > 70) tags.push(pick(riskTags.filter((t) => !tags.includes(t))));

  const params: Record<string, unknown> = {};
  if (tool === "exec") params.command = pick(["ls -la", "git status", "npm test", "rm -rf /tmp/cache", "curl https://api.example.com"]);
  if (tool === "write") params.path = pick(["/tmp/output.json", "config.yaml", "data/report.csv"]);
  if (tool === "message") {
    params.to = pick(["boss@company.com", "#general", "user:12345"]);
    params.subject = pick(["Status update", "Quarterly report", "Alert: anomaly detected"]);
  }
  if (tool === "read") params.path = pick(["package.json", "src/index.ts", ".env", "database.sqlite"]);
  if (tool === "fetch_url") params.url = pick(["https://api.github.com/repos", "https://internal.corp/data", "https://webhook.site/test"]);

  const entry: MockEntry = {
    timestamp: new Date(now - offsetMs).toISOString(),
    toolName: tool,
    toolCallId: `tc_${Math.random().toString(36).slice(2, 10)}`,
    params,
    policyRule: pick(policyRules),
    decision,
    effectiveDecision,
    riskScore: score,
    riskTier: tier,
    riskTags: tags,
    agentId: agent,
    sessionKey: session,
    executionResult: decision !== "block" ? pick(["success", "success", "success", "failure"]) : undefined,
    durationMs: Math.floor(Math.random() * 3000) + 50,
  };

  if (userResponse) entry.userResponse = userResponse;

  // Add LLM evaluation for high-risk entries
  if (score > 60 && Math.random() > 0.5) {
    entry.llmEvaluation = {
      adjustedScore: score + Math.floor(Math.random() * 20) - 10,
      reasoning: pick([
        "Agent is attempting to execute a shell command that could modify system files. The command pattern matches known destructive operations.",
        "This action sends data to an external endpoint. Combined with recent file reads, this may indicate data exfiltration behavior.",
        "The agent is modifying configuration files outside its normal scope. This represents a privilege escalation pattern.",
        "Multiple rapid tool calls detected in sequence. The pattern resembles an automated scanning or brute-force attempt.",
        "Email being sent to external recipient with attachment containing sensitive data fields from recent database queries.",
      ]),
      tags: tags,
      confidence: pick(["high", "medium", "low"]),
      patterns: pick([
        ["rapid-sequence", "external-target"],
        ["config-modification", "scope-violation"],
        ["data-aggregation", "outbound-transfer"],
        ["shell-execution", "destructive-pattern"],
      ]),
    };
  }

  return entry;
}

// Generate 80 entries spread over the last 24 hours
export function generateMockEntries(): MockEntry[] {
  const entries: MockEntry[] = [];
  for (let i = 0; i < 80; i++) {
    const offset = Math.floor(Math.random() * 24 * hour);
    entries.push(generateEntry(offset));
  }
  // Sort newest first
  entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return entries;
}

// Generate agent list from entries
export function generateMockAgents(entries: MockEntry[]) {
  const agentMap = new Map<string, MockEntry[]>();
  for (const e of entries) {
    const list = agentMap.get(e.agentId) || [];
    list.push(e);
    agentMap.set(e.agentId, list);
  }

  return Array.from(agentMap.entries()).map(([id, agentEntries]) => {
    const latest = agentEntries[0];
    const isActive = Date.now() - new Date(latest.timestamp).getTime() < 5 * min;
    const scores = agentEntries.filter((e) => e.riskScore != null).map((e) => e.riskScore);
    const avg = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
    const peak = scores.length ? Math.max(...scores) : 0;

    const todayCutoff = new Date();
    todayCutoff.setUTCHours(0, 0, 0, 0);
    const todayEntries = agentEntries.filter((e) => new Date(e.timestamp) >= todayCutoff);

    return {
      id,
      name: id,
      status: isActive ? "active" : "idle",
      todayToolCalls: todayEntries.filter((e) => e.decision).length,
      avgRiskScore: avg,
      peakRiskScore: peak,
      lastActiveTimestamp: latest.timestamp,
      currentSession: isActive
        ? {
            sessionKey: latest.sessionKey,
            startTime: agentEntries[agentEntries.length - 1].timestamp,
            toolCallCount: agentEntries.filter((e) => e.sessionKey === latest.sessionKey).length,
          }
        : undefined,
    };
  });
}

// Generate stats from entries
export function generateMockStats(entries: MockEntry[]) {
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

  const activeAgents = new Set(entries.filter((e) => Date.now() - new Date(e.timestamp).getTime() < 5 * min).map((e) => e.agentId));
  const activeSessions = new Set(entries.filter((e) => Date.now() - new Date(e.timestamp).getTime() < 5 * min).map((e) => e.sessionKey));

  return {
    total: allowed + approved + blocked + timedOut,
    allowed,
    approved,
    blocked,
    timedOut,
    pending,
    riskBreakdown: { low, medium, high, critical },
    avgRiskScore: riskCount > 0 ? Math.round(riskSum / riskCount) : 0,
    peakRiskScore: peakRisk,
    activeAgents: activeAgents.size,
    activeSessions: activeSessions.size,
  };
}

// Generate sessions from entries
export function generateMockSessions(entries: MockEntry[], agentId?: string) {
  let filtered = entries;
  if (agentId) filtered = entries.filter((e) => e.agentId === agentId);

  const sessionMap = new Map<string, MockEntry[]>();
  for (const e of filtered) {
    const list = sessionMap.get(e.sessionKey) || [];
    list.push(e);
    sessionMap.set(e.sessionKey, list);
  }

  const sessions = Array.from(sessionMap.entries()).map(([key, sEntries]) => {
    const sorted = [...sEntries].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    const scores = sEntries.filter((e) => e.riskScore != null).map((e) => e.riskScore);
    const startMs = new Date(sorted[0].timestamp).getTime();
    const endMs = new Date(sorted[sorted.length - 1].timestamp).getTime();

    return {
      sessionKey: key,
      agentId: sEntries[0].agentId,
      startTime: sorted[0].timestamp,
      endTime: sorted[sorted.length - 1].timestamp,
      duration: endMs > startMs ? endMs - startMs : null,
      toolCallCount: sEntries.filter((e) => e.decision).length,
      avgRisk: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0,
      peakRisk: scores.length ? Math.max(...scores) : 0,
    };
  });

  sessions.sort((a, b) => b.startTime.localeCompare(a.startTime));
  return sessions;
}

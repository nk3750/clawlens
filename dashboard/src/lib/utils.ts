export function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return "\u2014";
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return `${m}m ${rem}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export function riskTierFromScore(score: number): string {
  if (score > 80) return "critical";
  if (score > 60) return "high";
  if (score > 30) return "medium";
  return "low";
}

// ── Agent identity ──────────────────────────────

const AGENT_COLORS = [
  "#6366f1", // indigo
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#f97316", // orange
  "#14b8a6", // teal
  "#06b6d4", // cyan
  "#84cc16", // lime
  "#f43f5e", // rose
];

export function agentColor(agentId: string): string {
  let hash = 0;
  for (let i = 0; i < agentId.length; i++) {
    hash = agentId.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AGENT_COLORS[Math.abs(hash) % AGENT_COLORS.length];
}

export function agentInitial(agentId: string): string {
  return agentId.charAt(0).toUpperCase();
}

// ── Action descriptions (narrative) ─────────────

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max) + "\u2026" : str;
}

export function describeAction(entry: {
  toolName: string;
  params: Record<string, unknown>;
}): string {
  const { toolName, params } = entry;
  switch (toolName) {
    case "read":
      return params.path ? `Read ${truncate(String(params.path), 40)}` : "Read file";
    case "write":
      return params.path ? `Write to ${truncate(String(params.path), 40)}` : "Write file";
    case "exec":
      return params.command
        ? `Run \`${truncate(String(params.command), 35)}\``
        : "Execute command";
    case "message":
      if (params.to && params.subject)
        return `Email "${truncate(String(params.subject), 25)}" to ${params.to}`;
      if (params.to) return `Message to ${params.to}`;
      return "Send message";
    case "search":
      return params.query
        ? `Search "${truncate(String(params.query), 30)}"`
        : "Search";
    case "fetch_url":
      return params.url
        ? `Fetch ${truncate(String(params.url), 40)}`
        : "Fetch URL";
    default:
      return toolName;
  }
}

/** Decision label in plain language */
export function decisionLabel(d: string): string {
  const map: Record<string, string> = {
    allow: "allowed",
    block: "blocked",
    approved: "approved",
    denied: "denied",
    timeout: "timed out",
    pending: "awaiting approval",
    success: "succeeded",
    failure: "failed",
  };
  return map[d] || d;
}

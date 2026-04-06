import type { ActivityCategory, RiskTier, RiskPosture } from "./types";

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

export function riskTierFromScore(score: number): RiskTier {
  if (score > 75) return "critical";
  if (score > 50) return "high";
  if (score > 25) return "medium";
  return "low";
}

// ── Agent identity (deterministic from ID hash) ──

function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return hash;
}

export function agentGradient(agentId: string): [string, string] {
  const PALETTE = [
    "#6366f1", "#8b5cf6", "#ec4899", "#f97316",
    "#14b8a6", "#06b6d4", "#84cc16", "#f43f5e",
    "#d4a574", "#60a5fa",
  ];
  const h = Math.abs(hashCode(agentId));
  const c1 = PALETTE[h % PALETTE.length];
  const c2 = PALETTE[(h * 7 + 3) % PALETTE.length];
  return [c1, c2 === c1 ? PALETTE[(h + 1) % PALETTE.length] : c2];
}

// ── Risk tier color mapping ──

export function riskColor(tier: RiskTier | string | undefined): string {
  switch (tier) {
    case "critical": return "var(--cl-risk-critical)";
    case "high": return "var(--cl-risk-high)";
    case "medium": return "var(--cl-risk-medium)";
    default: return "var(--cl-risk-low)";
  }
}

export function riskColorRaw(tier: RiskTier | string | undefined): string {
  switch (tier) {
    case "critical": return "#ef4444";
    case "high": return "#f87171";
    case "medium": return "#fbbf24";
    default: return "#4ade80";
  }
}

export function postureLabel(posture: RiskPosture): string {
  switch (posture) {
    case "calm": return "Calm";
    case "elevated": return "Elevated";
    case "high": return "High";
    case "critical": return "Critical";
  }
}

// ── Category metadata with SVG icon paths ──

export const CATEGORY_META: Record<
  ActivityCategory,
  { label: string; color: string; iconPath: string }
> = {
  exploring: {
    label: "Exploring",
    color: "var(--cl-cat-exploring)",
    // Eye icon (Lucide)
    iconPath: "M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z M12 9a3 3 0 100 6 3 3 0 000-6z",
  },
  changes: {
    label: "Making changes",
    color: "var(--cl-cat-changes)",
    // Pencil icon
    iconPath: "M17 3a2.83 2.83 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z",
  },
  commands: {
    label: "Running commands",
    color: "var(--cl-cat-commands)",
    // Terminal icon
    iconPath: "M4 17l6-5-6-5 M12 19h8",
  },
  web: {
    label: "Web & APIs",
    color: "var(--cl-cat-web)",
    // Globe icon
    iconPath: "M12 2a10 10 0 100 20 10 10 0 000-20z M2 12h20 M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z",
  },
  comms: {
    label: "Communicating",
    color: "var(--cl-cat-comms)",
    // MessageSquare icon
    iconPath: "M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z",
  },
  data: {
    label: "Data & Storage",
    color: "var(--cl-cat-data)",
    // Database icon
    iconPath: "M12 2C6.48 2 2 3.79 2 6v12c0 2.21 4.48 4 10 4s10-1.79 10-4V6c0-2.21-4.48-4-10-4z M2 6c0 2.21 4.48 4 10 4s10-1.79 10-4 M2 12c0 2.21 4.48 4 10 4s10-1.79 10-4",
  },
};

export function categoryColor(cat: ActivityCategory): string {
  return CATEGORY_META[cat]?.color ?? "var(--cl-text-muted)";
}

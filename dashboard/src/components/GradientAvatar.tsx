import { agentGradient } from "../lib/utils";

interface Props {
  agentId: string;
  size?: "xs" | "sm" | "md" | "lg";
  /** 1 by default; bump to 2 when the parent detects another agent in the
   *  rendered fleet sharing this agent's first character (agent-grid-polish §2(c)). */
  letterCount?: 1 | 2;
}

const SIZES = { xs: 20, sm: 32, md: 44, lg: 60 };

export default function GradientAvatar({ agentId, size = "md", letterCount = 1 }: Props) {
  const [c1, c2] = agentGradient(agentId);
  const px = SIZES[size];
  // Outer glow uses c1's hue at ~15% alpha. Pre-HSL the gradient was hex so
  // `${c1}25` (hex 25 = 0.146 alpha) worked; on hsl(...) we must build hsla()
  // explicitly because string-concat alpha is hex-format-specific.
  const hue = c1.match(/hsl\((\d+)/)?.[1] ?? "0";
  const glow = `hsla(${hue}, 70%, 62%, 0.15)`;
  const initial =
    (letterCount === 2 ? agentId.slice(0, 2) : agentId.charAt(0)).toUpperCase() || "?";
  const fontSize = Math.max(
    letterCount === 2 ? 7 : 8,
    Math.round(px * (letterCount === 2 ? 0.35 : 0.45)),
  );
  return (
    <div
      className="rounded-full shrink-0 flex items-center justify-center"
      style={{
        width: px,
        height: px,
        background: `linear-gradient(135deg, ${c1}, ${c2})`,
        boxShadow: `0 0 ${px / 3}px ${glow}, inset 0 1px 2px rgba(255,255,255,0.15)`,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          color: "rgba(255, 255, 255, 0.92)",
          fontFamily: letterCount === 2 ? "var(--cl-font-mono)" : "var(--cl-font-sans)",
          fontFeatureSettings: letterCount === 2 ? "normal" : undefined,
          fontSize,
          fontWeight: 600,
          letterSpacing: letterCount === 2 ? "-0.05em" : "-0.02em",
          lineHeight: 1,
          userSelect: "none",
          textShadow: "0 1px 1px rgba(0, 0, 0, 0.18)",
        }}
      >
        {initial}
      </span>
    </div>
  );
}

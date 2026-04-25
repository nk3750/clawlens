import { type GatewayHealthStatus, useGatewayHealth } from "../hooks/useGatewayHealth";

const LABEL: Record<GatewayHealthStatus, string> = {
  unknown: "Gateway status unknown",
  ok: "Gateway connected",
  down: "Gateway unreachable",
};

const COLOR: Record<GatewayHealthStatus, string> = {
  unknown: "var(--cl-text-muted)",
  ok: "var(--cl-risk-low)",
  down: "var(--cl-risk-high)",
};

/**
 * 8px nav-bar dot wired to `useGatewayHealth`. Tri-state visual:
 *   - unknown → muted grey, no glow (initial / pre-verdict)
 *   - ok      → green, no glow (steady-state quiet)
 *   - down    → red with glow (attention-grabbing)
 *
 * `data-cl-gateway-health` is the test/probe surface; aria-label + title
 * mirror the same semantic so sighted and assistive tech both get a hint.
 */
export default function GatewayHealthDot() {
  const status = useGatewayHealth();
  const label = LABEL[status];
  const color = COLOR[status];

  return (
    <span
      data-cl-gateway-health={status}
      role="status"
      aria-label={label}
      title={label}
      style={{
        display: "inline-block",
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: color,
        boxShadow: status === "down" ? `0 0 6px var(--cl-risk-high)` : undefined,
        flexShrink: 0,
      }}
    />
  );
}

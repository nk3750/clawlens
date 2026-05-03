import type { CSSProperties, ReactNode } from "react";

/**
 * Shared style consts and shell for the FleetHeader stat cards (Actions,
 * Agents Running, Pending Approval). Extracted from FleetHeader.tsx so the
 * card components can live in their own files without re-declaring or
 * importing back across components. Risk Mix owns its own card surface and
 * does not use StatCardShell — see RiskMixTierRows.tsx.
 */

export const BIG_NUMBER_STYLE: CSSProperties = {
  fontFamily: "var(--cl-font-sans)",
  fontSize: 48,
  fontWeight: 510,
  lineHeight: 1,
  letterSpacing: "-1.056px",
  color: "var(--cl-text-primary)",
  fontVariantNumeric: "tabular-nums",
};

export const SUBLABEL_STYLE: CSSProperties = {
  fontFamily: "var(--cl-font-sans)",
  fontSize: 14,
  fontWeight: 400,
  color: "var(--cl-text-muted)",
};

export const SECONDARY_LINE_STYLE: CSSProperties = {
  fontFamily: "var(--cl-font-sans)",
  fontSize: 13,
  fontWeight: 400,
  color: "var(--cl-text-muted)",
};

export function StatCardShell({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div
      className="cl-card"
      style={{
        padding: "16px 18px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        minHeight: 132,
      }}
    >
      <span
        className="label-mono"
        style={{
          letterSpacing: "0.04em",
          color: "var(--cl-text-muted)",
        }}
      >
        {label}
      </span>
      {children}
    </div>
  );
}

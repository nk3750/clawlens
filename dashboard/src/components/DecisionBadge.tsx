interface Props {
  decision: string;
}

const STYLES: Record<string, { bg: string; text: string; label: string }> = {
  allow: { bg: "rgba(74, 222, 128, 0.08)", text: "#4ade80", label: "ALLOWED" },
  approved: { bg: "rgba(74, 222, 128, 0.08)", text: "#4ade80", label: "APPROVED" },
  block: { bg: "rgba(248, 113, 113, 0.08)", text: "#f87171", label: "BLOCKED" },
  denied: { bg: "rgba(248, 113, 113, 0.08)", text: "#f87171", label: "DENIED" },
  pending: { bg: "rgba(251, 191, 36, 0.08)", text: "#fbbf24", label: "PENDING" },
  timeout: { bg: "rgba(148, 142, 133, 0.08)", text: "#948e85", label: "TIMEOUT" },
};

export default function DecisionBadge({ decision }: Props) {
  const style = STYLES[decision] ?? STYLES.allow;
  return (
    <span
      className="label-mono px-2 py-0.5 rounded"
      style={{
        backgroundColor: style.bg,
        color: style.text,
      }}
    >
      {style.label}
    </span>
  );
}

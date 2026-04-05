/**
 * A tiny visual risk indicator — a thin colored bar.
 * Replaces numeric risk badges on the surface layer.
 * No numbers shown — just color and fill level.
 */
export default function RiskBar({ score }: { score: number }) {
  const width = Math.max(5, Math.min(100, score));
  const color =
    score > 80 ? "#ff4040" : score > 60 ? "#f87171" : score > 30 ? "#fbbf24" : "#34d399";

  return (
    <div className="w-16 h-1 bg-border/30 rounded-full overflow-hidden" title={`Risk: ${score}`}>
      <div
        className="h-full rounded-full transition-all duration-700 ease-out"
        style={{ width: `${width}%`, backgroundColor: color }}
      />
    </div>
  );
}

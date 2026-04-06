import { useEffect, useState } from "react";

interface Props {
  /** Bump this value to trigger a pulse */
  pulseKey?: number;
}

export default function LiveIndicator({ pulseKey }: Props) {
  const [pulsing, setPulsing] = useState(false);

  useEffect(() => {
    if (pulseKey == null || pulseKey === 0) return;
    setPulsing(true);
    const timer = setTimeout(() => setPulsing(false), 600);
    return () => clearTimeout(timer);
  }, [pulseKey]);

  return (
    <div
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full"
      style={{ backgroundColor: "rgba(74, 222, 128, 0.08)" }}
    >
      <svg
        width="8"
        height="8"
        viewBox="0 0 8 8"
        className="shrink-0"
      >
        <circle
          cx="4"
          cy="4"
          r="3"
          fill="var(--cl-risk-low)"
          style={{
            filter: pulsing ? "drop-shadow(0 0 4px #4ade80)" : undefined,
          }}
        >
          <animate
            attributeName="opacity"
            values="1;0.4;1"
            dur="2s"
            repeatCount="indefinite"
          />
        </circle>
      </svg>
      <span className="label-mono" style={{ color: "var(--cl-risk-low)" }}>
        LIVE
      </span>
    </div>
  );
}

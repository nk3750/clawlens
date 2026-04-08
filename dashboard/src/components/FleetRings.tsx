import { useEffect, useRef, useState } from "react";
import type { StatsResponse } from "../lib/types";
import { riskColorRaw, riskTierFromScore } from "../lib/utils";

interface Props {
  stats: StatsResponse;
  isToday: boolean;
}

// ── Ring color logic ──

function safetyColor(score: number): string {
  if (score >= 75) return riskColorRaw("low");
  if (score >= 50) return riskColorRaw("medium");
  if (score >= 25) return riskColorRaw("high");
  return riskColorRaw("critical");
}

function autonomyColor(pct: number): string {
  if (pct >= 90) return riskColorRaw("low");
  if (pct >= 70) return riskColorRaw("medium");
  if (pct >= 50) return riskColorRaw("high");
  return riskColorRaw("critical");
}

const LOAD_COLOR = "#d4a574"; // var(--cl-accent)

// ── Animated ring component ──

interface RingProps {
  value: string; // display value ("87", "94%", "142")
  fill: number; // 0-1
  color: string; // hex color
  label: string;
  delay: number; // ms stagger
  isEmpty: boolean;
}

const RADIUS = 52;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function Ring({ value, fill, color, label, delay, isEmpty }: RingProps) {
  const [animatedFill, setAnimatedFill] = useState(0);
  const [animatedValue, setAnimatedValue] = useState(isEmpty ? value : "0");
  const rafRef = useRef(0);

  useEffect(() => {
    const startTime = performance.now() + delay;
    const duration = 600;
    const targetNum = Number.parseFloat(value.replace("%", ""));
    const isPercent = value.includes("%");

    const animate = (now: number) => {
      const elapsed = now - startTime;
      if (elapsed < 0) {
        rafRef.current = requestAnimationFrame(animate);
        return;
      }
      const t = Math.min(elapsed / duration, 1);
      // Spring-like ease out
      const eased = 1 - (1 - t) ** 3;

      setAnimatedFill(fill * eased);

      if (!isEmpty && !Number.isNaN(targetNum)) {
        const current = Math.round(targetNum * eased);
        setAnimatedValue(isPercent ? `${current}%` : `${current}`);
      }

      if (t < 1) {
        rafRef.current = requestAnimationFrame(animate);
      }
    };

    if (isEmpty) {
      setAnimatedFill(0);
      setAnimatedValue("--");
    } else {
      rafRef.current = requestAnimationFrame(animate);
    }

    return () => cancelAnimationFrame(rafRef.current);
  }, [fill, value, delay, isEmpty]);

  const offset = CIRCUMFERENCE * (1 - animatedFill);
  const displayColor = isEmpty ? "var(--cl-text-muted)" : color;

  return (
    <div className="flex flex-col items-center">
      <svg
        width="120"
        height="120"
        viewBox="0 0 120 120"
        className="max-sm:w-24 max-sm:h-24"
      >
        {/* Background track */}
        <circle
          cx="60"
          cy="60"
          r={RADIUS}
          fill="none"
          stroke="var(--cl-elevated)"
          strokeWidth="8"
          opacity="0.4"
        />
        {/* Progress arc */}
        <circle
          cx="60"
          cy="60"
          r={RADIUS}
          fill="none"
          stroke={displayColor}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={offset}
          transform="rotate(-90 60 60)"
          style={{
            filter: isEmpty ? "none" : `drop-shadow(0 0 6px ${color}40)`,
          }}
        />
        {/* Center value */}
        <text
          x="60"
          y="60"
          textAnchor="middle"
          dominantBaseline="central"
          fill={displayColor}
          fontSize="28"
          fontWeight="700"
          fontFamily="'DM Mono', monospace"
        >
          {animatedValue}
        </text>
      </svg>
      <span
        className="text-[11px] font-medium tracking-widest uppercase mt-2"
        style={{ color: "var(--cl-text-muted)" }}
      >
        {label}
      </span>
    </div>
  );
}

// ── Stat strip ──

function StatStrip({ stats }: { stats: StatsResponse }) {
  const peakTier = riskTierFromScore(stats.peakRiskScore);
  const peakColor = riskColorRaw(peakTier);

  return (
    <div
      className="flex items-center justify-center gap-0 mt-4 flex-wrap"
      style={{ color: "var(--cl-text-muted)" }}
    >
      <span className="font-mono text-[11px]">
        peak:{" "}
        <span style={{ color: stats.peakRiskScore > 0 ? peakColor : undefined }}>
          {stats.peakRiskScore}
        </span>
      </span>
      <Dot />
      <span className="font-mono text-[11px]">
        <span
          style={{
            color: stats.activeAgents > 0 ? riskColorRaw("low") : undefined,
          }}
        >
          {stats.activeAgents}
        </span>{" "}
        active
      </span>
      <Dot />
      <span className="font-mono text-[11px]">
        <span
          style={{
            color: stats.blocked > 0 ? riskColorRaw("high") : undefined,
          }}
        >
          {stats.blocked}
        </span>{" "}
        blocked
      </span>
      <Dot />
      <span className="font-mono text-[11px]">{stats.activeSessions} sessions</span>
    </div>
  );
}

function Dot() {
  return (
    <span
      className="mx-2 text-[11px]"
      style={{ color: "var(--cl-border-default)", userSelect: "none" }}
    >
      &middot;
    </span>
  );
}

// ── Main component ──

export default function FleetRings({ stats, isToday: _isToday }: Props) {
  const isEmpty = stats.total === 0;

  const safety = isEmpty ? 0 : Math.round(100 - stats.avgRiskScore);
  const safetyFill = isEmpty ? 0 : safety / 100;

  const autonomy = isEmpty ? 0 : Math.round((stats.allowed / stats.total) * 100);
  const autonomyFill = isEmpty ? 0 : autonomy / 100;

  const load = stats.total;
  const historicMax = stats.historicDailyMax || 100;
  const loadFill = isEmpty ? 0 : Math.min(load / historicMax, 1);

  // Format load value
  const loadDisplay = load >= 1000 ? `${(load / 1000).toFixed(1)}k` : `${load}`;

  return (
    <section className="relative">
      {/* Atmospheric glow behind rings */}
      <div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[200px] rounded-full pointer-events-none"
        style={{
          background: `radial-gradient(ellipse, ${safetyColor(safety)}06 0%, transparent 70%)`,
          filter: "blur(50px)",
        }}
      />

      <div className="relative flex justify-center items-center gap-8 max-sm:gap-4 py-6">
        <Ring
          value={`${safety}`}
          fill={safetyFill}
          color={safetyColor(safety)}
          label="Safety"
          delay={0}
          isEmpty={isEmpty}
        />
        <Ring
          value={`${autonomy}%`}
          fill={autonomyFill}
          color={autonomyColor(autonomy)}
          label="Autonomy"
          delay={100}
          isEmpty={isEmpty}
        />
        <Ring
          value={loadDisplay}
          fill={loadFill}
          color={LOAD_COLOR}
          label="Load"
          delay={200}
          isEmpty={isEmpty}
        />
      </div>

      <StatStrip stats={stats} />
    </section>
  );
}

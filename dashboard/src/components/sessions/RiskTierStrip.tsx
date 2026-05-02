import { riskColorRaw, riskTierFromScore } from "../../lib/utils";

interface Props {
  scores: number[];
  width?: number;
  height?: number;
}

const DEFAULT_WIDTH = 160;
const DEFAULT_HEIGHT = 14;
const MAX_TICKS = 80;

/**
 * Average `scores` down to exactly `buckets` values. Used when a session has
 * more actions than will fit as one-tick-per-action (spec §5.5: keep the
 * strip a fixed 160px wide so column alignment holds across rows).
 */
export function bucketAverage(scores: number[], buckets: number): number[] {
  const out = new Array<number>(buckets);
  const per = scores.length / buckets;
  for (let i = 0; i < buckets; i++) {
    const start = Math.floor(i * per);
    const end = Math.floor((i + 1) * per);
    let sum = 0;
    let cnt = 0;
    for (let j = start; j < end; j++) {
      sum += scores[j];
      cnt++;
    }
    out[i] = cnt > 0 ? sum / cnt : 0;
  }
  return out;
}

/**
 * Fixed-width strip of tier-colored bars — one bar per action, bucketed when
 * the action count exceeds 80. Score-0 ticks render at 0.25 opacity so audit
 * entries without a risk score don't disappear from the strip (spec §5.5).
 */
export default function RiskTierStrip({
  scores,
  width = DEFAULT_WIDTH,
  height = DEFAULT_HEIGHT,
}: Props) {
  const n = scores.length;
  const ticks = n === 0 ? [] : n <= MAX_TICKS ? scores : bucketAverage(scores, MAX_TICKS);
  const tickW = ticks.length > 0 ? width / ticks.length : 0;

  return (
    <svg
      data-testid="risk-tier-strip"
      width={width}
      height={height}
      role="img"
      aria-label={n === 0 ? "No risk data" : `Risk profile across ${n} actions`}
    >
      {ticks.map((score, i) => (
        <rect
          // biome-ignore lint/suspicious/noArrayIndexKey: ticks are positionally indexed (i is the stable identity)
          key={i}
          x={i * tickW}
          y={0}
          width={Math.max(1, tickW - 0.5)}
          height={height}
          fill={riskColorRaw(riskTierFromScore(score))}
          opacity={score === 0 ? 0.25 : 1}
        />
      ))}
    </svg>
  );
}

interface BarProps {
  width?: string;
  height?: string;
  className?: string;
}

/** A pulsing skeleton bar that carries the design DNA */
export function SkeletonBar({ width = "100%", height = "12px", className = "" }: BarProps) {
  return (
    <div
      className={`skeleton ${className}`}
      style={{ width, height }}
    />
  );
}

/** Skeleton for agent detail: empty arc outline + pulsing stat blocks */
export function AgentDetailSkeleton() {
  return (
    <div className="page-enter">
      {/* Back link placeholder */}
      <SkeletonBar width="120px" height="14px" className="mb-8" />

      {/* Header: avatar + name */}
      <div className="flex items-center gap-5 mb-8">
        <div className="skeleton rounded-full" style={{ width: 60, height: 60 }} />
        <div className="flex-1 space-y-2">
          <SkeletonBar width="180px" height="24px" />
          <SkeletonBar width="140px" height="12px" />
        </div>
      </div>

      <div className="cl-divider mb-8" />

      {/* Two column grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-10 mb-10">
        <div className="cl-card p-6 space-y-4">
          <SkeletonBar width="140px" height="11px" />
          <div className="flex justify-center">
            <div className="skeleton-arc" />
          </div>
          <div className="flex justify-center gap-6">
            <SkeletonBar width="60px" height="10px" />
            <SkeletonBar width="60px" height="10px" />
            <SkeletonBar width="60px" height="10px" />
          </div>
        </div>
        <div className="cl-card p-6 space-y-3">
          <SkeletonBar width="140px" height="11px" />
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="skeleton rounded-full" style={{ width: 16, height: 16 }} />
              <SkeletonBar width="80px" height="10px" />
              <SkeletonBar height="8px" />
              <SkeletonBar width="30px" height="10px" />
            </div>
          ))}
        </div>
      </div>

      {/* Activity stream skeleton */}
      <SkeletonBar width="130px" height="11px" className="mb-5" />
      <div className="space-y-1">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3">
            <div className="skeleton rounded-full" style={{ width: 16, height: 16 }} />
            <SkeletonBar height="14px" />
            <SkeletonBar width="40px" height="12px" />
            <SkeletonBar width="50px" height="12px" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Skeleton for session detail */
export function SessionDetailSkeleton() {
  return (
    <div className="page-enter">
      {/* Breadcrumb */}
      <div className="flex gap-2 mb-8">
        <SkeletonBar width="50px" height="12px" />
        <SkeletonBar width="80px" height="12px" />
        <SkeletonBar width="50px" height="12px" />
      </div>

      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <div className="skeleton rounded-full" style={{ width: 44, height: 44 }} />
        <div className="space-y-2">
          <SkeletonBar width="200px" height="22px" />
          <SkeletonBar width="140px" height="12px" />
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="cl-card p-4 space-y-2">
            <SkeletonBar width="60px" height="10px" />
            <SkeletonBar width="40px" height="18px" />
          </div>
        ))}
      </div>

      <div className="cl-divider mb-8" />

      {/* Chart skeleton */}
      <SkeletonBar width="100px" height="11px" className="mb-5" />
      <div className="cl-card p-5">
        <SkeletonBar height="clamp(160px, 20vw, 240px)" />
      </div>
    </div>
  );
}

/** Skeleton for activity feed */
export function ActivityFeedSkeleton() {
  return (
    <div className="page-enter space-y-1">
      {[1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3">
          <div className="skeleton rounded-full" style={{ width: 32, height: 32 }} />
          <div className="skeleton rounded-full" style={{ width: 14, height: 14 }} />
          <SkeletonBar height="14px" />
          <SkeletonBar width="30px" height="10px" />
          <SkeletonBar width="50px" height="12px" />
        </div>
      ))}
    </div>
  );
}

/** Skeleton for the hex constellation (faint wireframe, dim glow circles) */
export function ConstellationSkeleton() {
  return (
    <div className="page-enter" style={{ aspectRatio: "3 / 2", maxHeight: 720, position: "relative" }}>
      <svg
        viewBox="0 0 1200 800"
        className="w-full h-full"
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <radialGradient id="skel-fade">
            <stop offset="0%" stopColor="white" stopOpacity="1" />
            <stop offset="60%" stopColor="white" stopOpacity="0.9" />
            <stop offset="100%" stopColor="white" stopOpacity="0" />
          </radialGradient>
          <mask id="skel-mask">
            <rect width="1200" height="800" fill="url(#skel-fade)" />
          </mask>
        </defs>
        <g mask="url(#skel-mask)">
          {/* Faint hex wireframes */}
          {[340, 250, 160, 75].map((r, i) => {
            const points = Array.from({ length: 6 }, (_, j) => {
              const angle = (Math.PI / 3) * j - Math.PI / 6;
              return `${600 + r * Math.cos(angle)},${400 + r * Math.sin(angle)}`;
            }).join(" ");
            return (
              <polygon
                key={r}
                points={points}
                fill="none"
                stroke="var(--cl-border-subtle)"
                strokeWidth={i === 0 ? 1 : 0.5}
                className="skeleton"
                style={{ animationDelay: `${i * 0.3}s` }}
              />
            );
          })}
          {/* Dim glow circles at approximate node positions */}
          {[
            [600, 376], [397, 268], [803, 268],
            [397, 484], [803, 484], [600, 560],
          ].map(([x, y], i) => (
            <circle
              key={i}
              cx={x}
              cy={y}
              r="20"
              fill="var(--cl-border-subtle)"
              className="skeleton"
              style={{ animationDelay: `${i * 0.15 + 0.5}s` }}
            />
          ))}
        </g>
      </svg>
    </div>
  );
}

import { useState, useMemo, useRef, useCallback } from "react";
import type { AgentInfo } from "../lib/types";
import { useBreathing } from "../hooks/useBreathing";
import HexField from "./HexField";
import type { HexNodeData } from "./HexField";
import HexNode from "./HexNode";
import AgentCard from "./AgentCard";

interface Props {
  agents: AgentInfo[];
}

type TooltipAnchor = "below" | "above" | "left" | "right";

export interface NodePosition {
  x: number;
  y: number;
  ring: number;
  indexInRing: number;
  angle: number;
  tooltip: TooltipAnchor;
}

export interface Edge {
  from: number;
  to: number;
  type: "perimeter" | "radial";
}

export interface WireframeShape {
  points: string;
  perimeter: number;
}

/* ─── Constants ─── */

const CX = 0.50;
const CY = 0.48;
const ASPECT = 1.2;

/* ─── Helpers ─── */

function makePos(x: number, y: number, ring: number, idx: number, angle: number): NodePosition {
  return { x, y, ring, indexInRing: idx, angle, tooltip: anchorFromAngle(angle) };
}

function anchorFromAngle(angle: number): TooltipAnchor {
  const a = ((angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  if (a > 5 * Math.PI / 4 && a < 7 * Math.PI / 4) return "below";
  if (a > Math.PI / 4 && a < 3 * Math.PI / 4) return "above";
  if (a >= 3 * Math.PI / 4 && a <= 5 * Math.PI / 4) return "right";
  return "left";
}

/** Seeded PRNG for deterministic layouts. */
function seededRng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/* ─── Polygon ring (N ≤ 6) ─── */

function polygonRing(cx: number, cy: number, r: number, sides: number): NodePosition[] {
  return Array.from({ length: sides }, (_, i) => {
    const angle = -Math.PI / 2 + (2 * Math.PI / sides) * i;
    return makePos(cx + r * Math.cos(angle) * ASPECT, cy + r * Math.sin(angle), 0, i, angle);
  });
}

/* ─── Force-directed layout (N ≥ 7) ─── */

function forceLayout(count: number): NodePosition[] {
  const rand = seededRng(42 + count);

  // Target spread: constellation fills ~65% of the 3:2 container
  const spread = Math.min(0.32, 0.12 * Math.sqrt(count));
  // 7 agents: spread = 0.317   → fills nicely
  // 12 agents: spread = 0.32   → capped
  // 21 agents: spread = 0.32   → capped

  // Golden-angle spiral: organic initial positions that fill the target area
  const pos = Array.from({ length: count }, (_, i) => {
    const angle = i * 2.399963 + (rand() - 0.5) * 0.5; // slight angle jitter
    const r = spread * Math.sqrt((i + 0.5) / count);
    return {
      x: CX + r * Math.cos(angle) * ASPECT,
      y: CY + r * Math.sin(angle),
    };
  });

  // Minimum distance: no two nodes closer than this
  // ~100px on 720px-tall container = 0.14 in 0-1 coords
  const minDist = Math.max(0.10, 0.09 + 0.05 / Math.sqrt(count / 7));
  // 7 agents: 0.14    (generous)
  // 12 agents: 0.128
  // 21 agents: 0.119

  // Relaxation: push apart overlapping pairs, gentle centering
  for (let iter = 0; iter < 60; iter++) {
    for (let i = 0; i < count; i++) {
      let fx = 0, fy = 0;

      for (let j = 0; j < count; j++) {
        if (i === j) continue;
        const dx = pos[i].x - pos[j].x;
        const dy = pos[i].y - pos[j].y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < minDist && d > 0.0001) {
          // Push apart proportional to overlap
          const push = (minDist - d) / d * 0.15;
          fx += dx * push;
          fy += dy * push;
        }
      }

      // Very gentle gravity — just prevents drift, doesn't crush
      fx += (CX - pos[i].x) * 0.003;
      fy += (CY - pos[i].y) * 0.003;

      pos[i].x += fx;
      pos[i].y += fy;
    }
  }

  return pos.map((p, i) => {
    const angle = Math.atan2(p.y - CY, p.x - CX);
    const dist = Math.sqrt((p.x - CX) ** 2 + (p.y - CY) ** 2);
    return makePos(p.x, p.y, Math.round(dist * 20), i, angle);
  });
}

/* ─── Layout dispatch ─── */

function generatePositions(count: number): NodePosition[] {
  if (count === 0) return [];
  if (count === 1) return [makePos(CX, CY, 0, 0, 0)];
  if (count <= 6) return polygonRing(CX, CY, 0.22, count);
  return forceLayout(count);
}

/* ─── KNN edges (K=2 for clean mesh) ─── */

function buildEdges(positions: NodePosition[]): Edge[] {
  const n = positions.length;
  if (n < 2) return [];
  if (n === 2) return [{ from: 0, to: 1, type: "perimeter" }];
  if (n <= 6) {
    return positions.map((_, i) => ({
      from: i, to: (i + 1) % n, type: "perimeter" as const,
    }));
  }

  // KNN: each node connects to its 2 nearest
  const K = 2;
  const edges: Edge[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < n; i++) {
    const dists: Array<{ j: number; d: number }> = [];
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const dx = positions[i].x - positions[j].x;
      const dy = positions[i].y - positions[j].y;
      dists.push({ j, d: dx * dx + dy * dy });
    }
    dists.sort((a, b) => a.d - b.d);
    for (let k = 0; k < Math.min(K, dists.length); k++) {
      const j = dists[k].j;
      const lo = Math.min(i, j), hi = Math.max(i, j);
      const key = `${lo}-${hi}`;
      if (!seen.has(key)) {
        seen.add(key);
        edges.push({ from: lo, to: hi, type: "perimeter" });
      }
    }
  }
  return edges;
}

/* ─── Node scale ─── */

function nodeScale(count: number): number {
  if (count <= 6) return 1.0;
  if (count <= 10) return 0.85;
  if (count <= 15) return 0.72;
  return 0.6;
}

/* ─── Component ─── */

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2.5;

export default function HexConstellation({ agents }: Props) {
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const isPanning = useRef(false);
  const panStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

  const sortedAgents = useMemo(() => {
    return [...agents].sort((a, b) => {
      if (a.status !== b.status) return a.status === "active" ? -1 : 1;
      return b.peakRiskScore - a.peakRiskScore;
    });
  }, [agents]);

  const equilibriumPositions = useMemo(
    () => generatePositions(sortedAgents.length),
    [sortedAgents.length],
  );

  const edges = useMemo(() => buildEdges(equilibriumPositions), [equilibriumPositions]);
  const scale = nodeScale(sortedAgents.length);

  const nodeIds = useMemo(() => sortedAgents.map((a) => a.id), [sortedAgents]);
  const breathingPositions = useBreathing(equilibriumPositions, nodeIds, {
    pausedId: hoveredNodeId,
  });

  const svgNodes: HexNodeData[] = sortedAgents.map((a, i) => ({
    x: breathingPositions[i].x,
    y: breathingPositions[i].y,
    id: a.id,
    riskScore: a.peakRiskScore,
    riskPosture: a.riskPosture,
    status: a.status,
    context: a.currentContext,
  }));

  // ── Pinch-only zoom (ctrlKey + wheel = trackpad pinch on macOS) ──
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) return; // ignore normal scroll
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.95 : 1.05;
    setZoom((z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z * delta)));
  }, []);

  // ── Pan handlers ──
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest(".hex-node")) return;
    isPanning.current = true;
    panStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, [pan]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isPanning.current) return;
    setPan({
      x: panStart.current.panX + (e.clientX - panStart.current.x),
      y: panStart.current.panY + (e.clientY - panStart.current.y),
    });
  }, []);

  const handlePointerUp = useCallback(() => { isPanning.current = false; }, []);

  const transformStyle = {
    transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
    transformOrigin: "50% 48%",
    transition: isPanning.current ? "none" : "transform 0.15s ease-out",
  };

  return (
    <>
      {/* ── Desktop ── */}
      <div
        className="hidden md:block relative overflow-hidden"
        style={{ aspectRatio: "3 / 2", maxHeight: 720, cursor: isPanning.current ? "grabbing" : "default" }}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        {zoom !== 1 && (
          <div
            className="absolute top-3 right-3 font-mono text-[10px] px-2 py-1 rounded z-10"
            style={{ color: "var(--cl-text-muted)", backgroundColor: "var(--cl-surface)", opacity: 0.6 }}
          >
            {Math.round(zoom * 100)}%
          </div>
        )}

        <div className="absolute inset-0" style={{ zIndex: 0, ...transformStyle }}>
          <HexField
            nodes={svgNodes}
            edges={edges}
            hoveredNodeId={hoveredNodeId}
            agentCount={sortedAgents.length}
          />
        </div>

        <div className="absolute inset-0" style={{ zIndex: 1, ...transformStyle }}>
          {sortedAgents.map((agent, i) => (
            <HexNode
              key={agent.id}
              agent={agent}
              position={breathingPositions[i]}
              tooltipAnchor={breathingPositions[i].tooltip}
              onHover={setHoveredNodeId}
              scale={scale}
            />
          ))}
        </div>
      </div>

      {/* ── Mobile ── */}
      <div className="md:hidden space-y-4 stagger">
        {agents.map((a) => (
          <AgentCard key={a.id} agent={a} />
        ))}
      </div>
    </>
  );
}

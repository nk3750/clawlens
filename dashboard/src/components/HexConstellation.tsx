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

/* ─── Organic spread layout ─── */
/*
 * Golden-angle spiral + repulsion.  Fills the container like a star field.
 * No edges — deferred until OpenClaw exposes sub-agent / related-agent data.
 */

function organicLayout(count: number): NodePosition[] {
  const rand = seededRng(42 + count);

  const SPREAD = 0.35 + 0.04 * Math.sqrt(count / 7);
  const GOLDEN = 2.399963;
  const pos = Array.from({ length: count }, (_, i) => {
    const angle = i * GOLDEN + (rand() - 0.5) * 0.4;
    const r = SPREAD * Math.sqrt((i + 0.5) / count) * (0.8 + rand() * 0.4);
    return { x: CX + Math.cos(angle) * r, y: CY + Math.sin(angle) * r };
  });

  const minDist = Math.max(0.12, 0.10 + 0.05 / Math.sqrt(count / 7));

  for (let iter = 0; iter < 80; iter++) {
    for (let i = 0; i < count; i++) {
      let fx = 0, fy = 0;
      for (let j = 0; j < count; j++) {
        if (i === j) continue;
        const dx = pos[i].x - pos[j].x;
        const dy = pos[i].y - pos[j].y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < minDist && d > 0.0001) {
          const push = ((minDist - d) / d) * 0.2;
          fx += dx * push;
          fy += dy * push;
        }
      }
      fx += (CX - pos[i].x) * 0.003;
      fy += (CY - pos[i].y) * 0.003;
      pos[i].x += fx;
      pos[i].y += fy;
    }
  }

  // Re-center by centroid (center of mass) — accounts for density bias,
  // not just bounding-box edges, so a left-heavy cloud shifts right.
  let sumX = 0, sumY = 0;
  for (const p of pos) { sumX += p.x; sumY += p.y; }
  const shiftX = CX - sumX / count;
  const shiftY = CY - sumY / count;
  for (const p of pos) { p.x += shiftX; p.y += shiftY; }

  return pos.map((p, i) => {
    const angle = Math.atan2(p.y - CY, p.x - CX);
    return makePos(p.x, p.y, 0, i, angle);
  });
}

/* ─── Layout dispatch ─── */

function generatePositions(count: number): NodePosition[] {
  if (count === 0) return [];
  if (count === 1) return [makePos(CX, CY, 0, 0, 0)];
  return organicLayout(count);
}

/* ─── Node scale ─── */

function nodeScale(count: number): number {
  if (count <= 6) return 1.0;
  if (count <= 10) return 0.9;
  if (count <= 15) return 0.8;
  if (count <= 25) return 0.72;
  return 0.65;
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

  const edges: Edge[] = []; // deferred until OpenClaw exposes agent relationships
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

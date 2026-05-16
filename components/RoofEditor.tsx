"use client";

import { useEffect, useRef, useState } from "react";
import type { BBox, Obstacle, Point } from "./RoofCanvas";

export interface Props {
  imageUrl: string;
  polygon: Point[];
  obstacles: Obstacle[];
  addObstacleMode: boolean;
  onPolygonChange: (polygon: Point[]) => void;
  onObstaclesChange: (obstacles: Obstacle[]) => void;
  onNewObstacleDrawn: (bbox: { x: number; y: number; w: number; h: number }) => void;
}

const COLORS: Record<string, string> = {
  water_tank: "#ef4444", ac_unit: "#f97316", vent: "#eab308",
  chimney: "#a855f7", parapet: "#06b6d4", skylight: "#3b82f6",
  antenna: "#ec4899", other: "#6b7280",
};

type VtxDrag = { idx: number };
type ObsDrag = {
  idx: number;
  handle: "move"|"nw"|"n"|"ne"|"e"|"se"|"s"|"sw"|"w";
  start: Point;
  orig: BBox;
};

const OBS_CURSORS: Record<string, string> = {
  move:"move", nw:"nw-resize", n:"n-resize", ne:"ne-resize",
  e:"e-resize", se:"se-resize", s:"s-resize", sw:"sw-resize", w:"w-resize",
};

export default function RoofEditor({
  imageUrl, polygon, obstacles,
  addObstacleMode,
  onPolygonChange, onObstaclesChange, onNewObstacleDrawn,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [imgSize, setImgSize] = useState({ w: 900, h: 600 });
  const [pts, setPts] = useState<Point[]>(polygon);
  const [selectedObs, setSelectedObs] = useState<number | null>(null);
  const [hoveredVertex, setHoveredVertex] = useState<number | null>(null);
  const [hoveredMid, setHoveredMid] = useState<number | null>(null);
  const [vtxDrag, setVtxDrag] = useState<VtxDrag | null>(null);
  const [obsDrag, setObsDrag] = useState<ObsDrag | null>(null);
  const [drawRect, setDrawRect] = useState<{ x1:number; y1:number; x2:number; y2:number } | null>(null);

  useEffect(() => {
    const img = new Image();
    img.src = imageUrl;
    img.onload = () => {
      const maxW = 900;
      const scale = img.naturalWidth > maxW ? maxW / img.naturalWidth : 1;
      setImgSize({ w: Math.round(img.naturalWidth * scale), h: Math.round(img.naturalHeight * scale) });
    };
  }, [imageUrl]);

  useEffect(() => { setPts(polygon); }, [polygon]);
  useEffect(() => { if (!addObstacleMode) setDrawRect(null); }, [addObstacleMode]);

  // ── Coordinate helpers ──────────────────────────────────────────────────
  function toPercent(e: React.PointerEvent): Point {
    const rect = svgRef.current!.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100)),
      y: Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100)),
    };
  }
  const W = imgSize.w, H = imgSize.h;
  const sx = (v: number) => (v / 100) * W;
  const sy = (v: number) => (v / 100) * H;

  // ── Vertex drag ─────────────────────────────────────────────────────────
  function startVtxDrag(e: React.PointerEvent, idx: number) {
    e.preventDefault(); e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    setVtxDrag({ idx });
  }
  function deleteVertex(e: React.MouseEvent, idx: number) {
    e.preventDefault();
    if (pts.length <= 3) return;
    const next = pts.filter((_, i) => i !== idx);
    setPts(next); onPolygonChange(next);
  }
  function insertVertex(edgeIdx: number) {
    const j = (edgeIdx + 1) % pts.length;
    const mid: Point = { x: (pts[edgeIdx].x + pts[j].x) / 2, y: (pts[edgeIdx].y + pts[j].y) / 2 };
    const next = [...pts.slice(0, edgeIdx + 1), mid, ...pts.slice(edgeIdx + 1)];
    setPts(next); onPolygonChange(next);
  }

  // ── Obstacle drag/resize ─────────────────────────────────────────────────
  function startObsDrag(
    e: React.PointerEvent,
    idx: number,
    handle: ObsDrag["handle"],
    orig: BBox
  ) {
    e.preventDefault(); e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    setSelectedObs(idx);
    setObsDrag({ idx, handle, start: toPercent(e), orig });
  }
  function deleteObstacle(e: React.MouseEvent, idx: number) {
    e.preventDefault(); e.stopPropagation();
    const next = obstacles.filter((_, i) => i !== idx);
    onObstaclesChange(next);
    if (selectedObs === idx) setSelectedObs(null);
  }
  function applyObsDelta(drag: ObsDrag, p: Point): BBox {
    const dx = p.x - drag.start.x, dy = p.y - drag.start.y;
    const b = drag.orig;
    let { x, y, w, h } = b;
    switch (drag.handle) {
      case "move": x += dx; y += dy; break;
      case "nw":   x += dx; y += dy; w -= dx; h -= dy; break;
      case "n":               y += dy;          h -= dy; break;
      case "ne":              y += dy; w += dx; h -= dy; break;
      case "e":                        w += dx;          break;
      case "se":                       w += dx; h += dy; break;
      case "s":                                 h += dy; break;
      case "sw":  x += dx;           w -= dx; h += dy; break;
      case "w":   x += dx;           w -= dx;           break;
    }
    w = Math.max(1, w); h = Math.max(1, h);
    x = Math.max(0, Math.min(100 - w, x));
    y = Math.max(0, Math.min(100 - h, y));
    return { x, y, w, h };
  }

  // ── Unified pointer handlers ─────────────────────────────────────────────
  function onPointerMove(e: React.PointerEvent) {
    const p = toPercent(e);
    if (vtxDrag !== null) {
      setPts(prev => { const n = [...prev]; n[vtxDrag.idx] = p; return n; });
    } else if (obsDrag !== null) {
      const newBBox = applyObsDelta(obsDrag, p);
      const next = [...obstacles];
      next[obsDrag.idx] = { ...next[obsDrag.idx], bbox: newBBox };
      onObstaclesChange(next);
    } else if (drawRect) {
      setDrawRect(prev => prev ? { ...prev, x2: p.x, y2: p.y } : null);
    }
  }
  function onPointerUp() {
    if (vtxDrag !== null) {
      setPts(current => { onPolygonChange(current); return current; });
      setVtxDrag(null);
    }
    if (obsDrag !== null) setObsDrag(null);
    if (drawRect) {
      const minX = Math.min(drawRect.x1, drawRect.x2);
      const minY = Math.min(drawRect.y1, drawRect.y2);
      const w = Math.abs(drawRect.x2 - drawRect.x1);
      const h = Math.abs(drawRect.y2 - drawRect.y1);
      if (w > 1 && h > 1) onNewObstacleDrawn({ x: minX, y: minY, w, h });
      setDrawRect(null);
    }
  }
  function onSvgPointerDown(e: React.PointerEvent) {
    if (!addObstacleMode) { setSelectedObs(null); return; }
    // Only start draw on the image background
    const tag = (e.target as Element).tagName;
    if (tag !== "svg" && tag !== "image") return;
    e.preventDefault();
    (e.target as Element).setPointerCapture(e.pointerId);
    const p = toPercent(e);
    setDrawRect({ x1: p.x, y1: p.y, x2: p.x, y2: p.y });
  }

  const polyStr = pts.map(p => `${sx(p.x)},${sy(p.y)}`).join(" ");
  const midPoints = pts.map((_, i) => {
    const j = (i + 1) % pts.length;
    return { x: (pts[i].x + pts[j].x) / 2, y: (pts[i].y + pts[j].y) / 2, ei: i };
  });

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto rounded-xl block select-none"
        style={{ touchAction: "none", cursor: addObstacleMode ? "crosshair" : "default" }}
        onPointerDown={onSvgPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <image href={imageUrl} width={W} height={H} />

        {/* Roof polygon */}
        <polygon
          points={polyStr}
          fill="rgba(34,197,94,0.08)"
          stroke="#22c55e"
          strokeWidth="2.5"
          strokeDasharray="8 4"
          pointerEvents="none"
        />

        {/* Obstacles */}
        {obstacles.map((o, i) => {
          const ox = sx(o.bbox.x), oy = sy(o.bbox.y);
          const ow = sx(o.bbox.w), oh = sy(o.bbox.h);
          const color = COLORS[o.type] ?? "#6b7280";
          const sel = selectedObs === i;
          const labelW = Math.max(ow, o.label.length * 7 + 12);

          const handles: { id: ObsDrag["handle"]; cx: number; cy: number }[] = sel ? [
            { id:"nw", cx:ox,       cy:oy       }, { id:"n",  cx:ox+ow/2, cy:oy       },
            { id:"ne", cx:ox+ow,    cy:oy       }, { id:"e",  cx:ox+ow,   cy:oy+oh/2  },
            { id:"se", cx:ox+ow,    cy:oy+oh    }, { id:"s",  cx:ox+ow/2, cy:oy+oh    },
            { id:"sw", cx:ox,       cy:oy+oh    }, { id:"w",  cx:ox,      cy:oy+oh/2  },
          ] : [];

          return (
            <g key={i}>
              {/* Body */}
              <rect
                x={ox} y={oy} width={ow} height={oh}
                fill={`${color}30`}
                stroke={color}
                strokeWidth={sel ? 2.5 : 2}
                style={{ cursor: "move" }}
                onClick={(e) => { e.stopPropagation(); setSelectedObs(i); }}
                onPointerDown={(e) => startObsDrag(e, i, "move", o.bbox)}
              />
              {/* Label bar */}
              <rect x={ox} y={oy - 18} width={Math.min(labelW, ow + 40)} height={18} fill={color} rx="3" pointerEvents="none" />
              <text x={ox + 5} y={oy - 5} fontSize="11" fill="white" pointerEvents="none"
                style={{ fontFamily:"sans-serif", fontWeight:"bold" }}>{o.label}</text>
              {/* X delete button */}
              <g style={{ cursor:"pointer" }} onClick={(e) => deleteObstacle(e, i)}>
                <rect x={ox + ow - 20} y={oy} width={20} height={20} fill={color} rx="0 3 0 0" opacity={0.9} />
                <text x={ox+ow-10} y={oy+14} fontSize="13" fill="white" textAnchor="middle" pointerEvents="none"
                  style={{ fontFamily:"sans-serif", fontWeight:"bold", lineHeight:1 }}>×</text>
              </g>
              {/* Resize handles */}
              {handles.map(h => (
                <rect
                  key={h.id}
                  x={h.cx - 5} y={h.cy - 5} width={10} height={10}
                  fill="white" stroke={color} strokeWidth="1.5" rx="1"
                  style={{ cursor: OBS_CURSORS[h.id] }}
                  onPointerDown={(e) => startObsDrag(e, i, h.id, o.bbox)}
                />
              ))}
            </g>
          );
        })}

        {/* Draw rect preview */}
        {drawRect && (() => {
          const dx = Math.min(drawRect.x1, drawRect.x2), dy = Math.min(drawRect.y1, drawRect.y2);
          const dw = Math.abs(drawRect.x2 - drawRect.x1), dh = Math.abs(drawRect.y2 - drawRect.y1);
          return (
            <rect x={sx(dx)} y={sy(dy)} width={sx(dw)} height={sy(dh)}
              fill="rgba(245,158,11,0.15)" stroke="#F59E0B" strokeWidth="2" strokeDasharray="4 2"
              pointerEvents="none" />
          );
        })()}

        {/* Polygon mid-edge handles */}
        {!addObstacleMode && midPoints.map((mp, i) => (
          <circle key={`mid-${i}`}
            cx={sx(mp.x)} cy={sy(mp.y)}
            r={hoveredMid === i ? 7 : 5}
            fill={hoveredMid === i ? "#86efac" : "rgba(255,255,255,0.85)"}
            stroke="#22c55e" strokeWidth="1.5"
            style={{ cursor:"crosshair" }}
            onClick={() => insertVertex(mp.ei)}
            onMouseEnter={() => setHoveredMid(i)}
            onMouseLeave={() => setHoveredMid(null)}
          />
        ))}

        {/* Polygon vertex handles */}
        {!addObstacleMode && pts.map((p, i) => {
          const dragging = vtxDrag?.idx === i;
          const hovered = hoveredVertex === i;
          return (
            <circle key={`v-${i}`}
              cx={sx(p.x)} cy={sy(p.y)}
              r={dragging ? 11 : hovered ? 10 : 8}
              fill={dragging ? "#16a34a" : hovered ? "#22c55e" : "white"}
              stroke="#16a34a" strokeWidth="2.5"
              style={{ cursor: dragging ? "grabbing" : "grab" }}
              onPointerDown={(e) => startVtxDrag(e, i)}
              onContextMenu={(e) => deleteVertex(e, i)}
              onMouseEnter={() => { if (!vtxDrag) setHoveredVertex(i); }}
              onMouseLeave={() => setHoveredVertex(null)}
            />
          );
        })}
      </svg>

      <p className="mt-2 text-center text-xs text-slate-400">
        {addObstacleMode
          ? "Drag to mark an obstacle area — release to set type"
          : <>
              Drag <span className="text-emerald-600 font-medium">●</span> vertices to adjust ·{" "}
              Click <span className="text-emerald-400 font-medium">◦</span> midpoints to add ·{" "}
              Right-click vertex to delete · Click obstacle to select &amp; resize
            </>
        }
      </p>
    </div>
  );
}

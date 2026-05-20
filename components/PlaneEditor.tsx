"use client";

import { useEffect, useRef, useState } from "react";
import { Undo2, Magnet } from "lucide-react";
import type { Obstacle, Point } from "./RoofCanvas";
import { planeColor, type Calibration, type PlanePackResult, type RoofPlane } from "@/lib/geometry";
import { detectEdges, snapToEdge, type EdgeData } from "@/lib/edgeDetect";

export type Tool = "select" | "calibrate" | "drawPlane" | "drawRidge";

interface Props {
  imageUrl: string;
  aiPolygon: Point[];
  obstacles: Obstacle[];
  planes: RoofPlane[];
  calibration: Calibration | null;
  selectedPlaneId: string | null;
  tool: Tool;
  packed: PlanePackResult[];
  onPlanesChange: (planes: RoofPlane[]) => void;
  onCalibrationChange: (cal: Calibration) => void;
  onSelectPlane: (id: string | null) => void;
  onToolChange: (tool: Tool) => void;
}

const genId = () => Math.random().toString(36).slice(2, 10);

function centroid(poly: Point[]): Point {
  return {
    x: poly.reduce((s, p) => s + p.x, 0) / poly.length,
    y: poly.reduce((s, p) => s + p.y, 0) / poly.length,
  };
}

export default function PlaneEditor({
  imageUrl, aiPolygon, obstacles, planes, calibration,
  selectedPlaneId, tool, packed,
  onPlanesChange, onCalibrationChange, onSelectPlane, onToolChange,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [imgSize, setImgSize] = useState({ w: 900, h: 600 });
  const [draft, setDraft] = useState<Point[]>([]);          // plane being drawn
  const [cursor, setCursor] = useState<Point | null>(null); // rubber-band target
  const [ridgeFirst, setRidgeFirst] = useState<Point | null>(null);
  const [calDraft, setCalDraft] = useState<{ a: Point; b: Point } | null>(null);
  const [pendingCal, setPendingCal] = useState<[Point, Point] | null>(null);
  const [meters, setMeters] = useState("");
  const [vtxDrag, setVtxDrag] = useState<number | null>(null);
  const [hoverMid, setHoverMid] = useState<number | null>(null);

  // Edge-snap: detect high-contrast lines (gutters, ridges, fascia) once per
  // image so vertex clicks/drags can magnetise to real roof edges (silent — no overlay).
  const [edges, setEdges] = useState<EdgeData | null>(null);
  const [snapEnabled, setSnapEnabled] = useState(true);
  /** True when the latest move snapped onto a detected edge (drives the
   *  green crosshair feedback so the user can SEE the snap firing). */
  const [snapActive, setSnapActive] = useState(false);

  // Convenience: snap a point to the nearest detected edge (if any) when
  // snapping is enabled. Otherwise return the point unchanged. Also records
  // whether the snap actually fired so the UI can highlight it.
  const snap = (p: Point): Point => {
    if (!snapEnabled) {
      setSnapActive(false);
      return p;
    }
    const out = snapToEdge(p, edges, 3);
    setSnapActive(out.x !== p.x || out.y !== p.y);
    return out;
  };

  const selected = planes.find((p) => p.id === selectedPlaneId) ?? null;

  // ── Image sizing ──────────────────────────────────────────────────────────
  useEffect(() => {
    const img = new Image();
    img.src = imageUrl;
    img.onload = () => {
      const maxW = 900;
      const scale = img.naturalWidth > maxW ? maxW / img.naturalWidth : 1;
      setImgSize({
        w: Math.round(img.naturalWidth * scale),
        h: Math.round(img.naturalHeight * scale),
      });
    };
  }, [imageUrl]);

  // ── Edge detection — runs once per image, ~100ms client-side ──────────────
  // Loads the edge map for silent magnetic snapping; no visual overlay shown.
  useEffect(() => {
    let cancelled = false;
    setEdges(null);
    detectEdges(imageUrl)
      .then((data) => { if (!cancelled) setEdges(data); })
      .catch((e) => console.warn("Edge detection failed:", e));
    return () => { cancelled = true; };
  }, [imageUrl]);

  // Reset transient drawing state whenever the tool changes
  useEffect(() => {
    setDraft([]); setCursor(null); setRidgeFirst(null); setCalDraft(null);
  }, [tool]);

  // Enter closes a plane; Escape cancels the current draft; Ctrl/Cmd+Z undoes
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Enter" && tool === "drawPlane") closeDraft();
      if (e.key === "Escape") { setDraft([]); setRidgeFirst(null); setCalDraft(null); }
      if ((e.key === "z" || e.key === "Z") && (e.ctrlKey || e.metaKey)) {
        const el = e.target as HTMLElement;
        if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") return;
        if (tool === "drawPlane" || tool === "drawRidge") { e.preventDefault(); undo(); }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool, draft, planes]);

  const W = imgSize.w, H = imgSize.h;
  const sx = (v: number) => (v / 100) * W;
  const sy = (v: number) => (v / 100) * H;

  function toPct(e: { clientX: number; clientY: number }): Point {
    const rect = svgRef.current!.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100)),
      y: Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100)),
    };
  }

  function setPlane(id: string, patch: Partial<RoofPlane>) {
    onPlanesChange(planes.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }

  // ── Plane drawing ─────────────────────────────────────────────────────────
  function closeDraft() {
    let v = draft;
    // Drop a trailing near-duplicate vertex left by a double-click
    if (v.length >= 2) {
      const a = v[v.length - 1], b = v[v.length - 2];
      if (Math.hypot(a.x - b.x, a.y - b.y) < 1.5) v = v.slice(0, -1);
    }
    if (v.length < 3) return;
    const id = genId();
    onPlanesChange([
      ...planes,
      { id, name: `Roof ${planes.length + 1}`, polygon: v, ridge: null, orientationMode: "auto", tiltDeg: null, azimuthDeg: null },
    ]);
    onSelectPlane(id);
    setDraft([]); setCursor(null);
    onToolChange("drawRidge");
  }

  // Undo: step back one corner while drawing a plane, or clear the first
  // ridge point. Wired to the on-canvas button and Ctrl/Cmd+Z.
  const canUndo =
    (tool === "drawPlane" && draft.length > 0) ||
    (tool === "drawRidge" && ridgeFirst !== null);

  function undo() {
    if (tool === "drawPlane") setDraft((d) => d.slice(0, -1));
    else if (tool === "drawRidge") setRidgeFirst(null);
  }

  // ── Pointer / click handlers ──────────────────────────────────────────────
  function onBgPointerDown(e: React.PointerEvent) {
    const tag = (e.target as Element).tagName;
    if (tag !== "svg" && tag !== "image") return;
    if (tool === "calibrate") {
      e.preventDefault();
      (e.target as Element).setPointerCapture(e.pointerId);
      const p = snap(toPct(e));
      setCalDraft({ a: p, b: p });
    } else if (tool === "select") {
      onSelectPlane(null);
    }
  }

  function onBgClick(e: React.MouseEvent) {
    const tag = (e.target as Element).tagName;
    if (tag !== "svg" && tag !== "image") return;
    const p = snap(toPct(e));
    if (tool === "drawPlane") {
      if (draft.length >= 3) {
        const f = draft[0];
        if (Math.hypot(p.x - f.x, p.y - f.y) < 2.5) { closeDraft(); return; }
      }
      setDraft([...draft, p]);
    } else if (tool === "drawRidge" && selected) {
      if (!ridgeFirst) setRidgeFirst(p);
      else {
        setPlane(selected.id, { ridge: [ridgeFirst, p] });
        setRidgeFirst(null);
        onToolChange("select");
      }
    }
  }

  function onMove(e: React.PointerEvent) {
    const raw = toPct(e);
    if (vtxDrag !== null && selected) {
      const p = snap(raw);
      setPlane(selected.id, {
        polygon: selected.polygon.map((v, i) => (i === vtxDrag ? p : v)),
      });
    } else if (calDraft) {
      setCalDraft({ ...calDraft, b: snap(raw) });
    } else if (tool === "drawPlane" || tool === "drawRidge") {
      // Only follow the cursor with a snap indicator while actively drawing.
      setCursor(snap(raw));
    } else {
      // Hovering in select mode — no on-screen indicator (it was visual noise).
      if (cursor) setCursor(null);
      setSnapActive(false);
    }
  }

  function onUp() {
    if (vtxDrag !== null) setVtxDrag(null);
    if (calDraft) {
      const { a, b } = calDraft;
      if (Math.hypot(a.x - b.x, a.y - b.y) > 1) { setPendingCal([a, b]); setMeters(""); }
      setCalDraft(null);
    }
  }

  function startVtx(e: React.PointerEvent, idx: number) {
    if (tool !== "select") return;
    e.preventDefault(); e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    setVtxDrag(idx);
  }
  function delVtx(e: React.MouseEvent, idx: number) {
    e.preventDefault(); e.stopPropagation();
    if (!selected || selected.polygon.length <= 3) return;
    setPlane(selected.id, { polygon: selected.polygon.filter((_, i) => i !== idx) });
  }
  function insertMid(edgeIdx: number) {
    if (!selected) return;
    const poly = selected.polygon;
    const j = (edgeIdx + 1) % poly.length;
    const mid: Point = { x: (poly[edgeIdx].x + poly[j].x) / 2, y: (poly[edgeIdx].y + poly[j].y) / 2 };
    setPlane(selected.id, {
      polygon: [...poly.slice(0, edgeIdx + 1), mid, ...poly.slice(edgeIdx + 1)],
    });
  }

  function confirmCal() {
    const m = parseFloat(meters);
    if (!pendingCal || !(m > 0)) return;
    onCalibrationChange({ line: pendingCal, meters: m });
    setPendingCal(null); setMeters("");
    onToolChange("select");
  }

  // ── Derived render data ───────────────────────────────────────────────────
  const flatPanels = packed.flatMap((r) => r.panels);
  const calLine = calDraft
    ? { a: calDraft.a, b: calDraft.b, draft: true }
    : calibration
    ? { a: calibration.line[0], b: calibration.line[1], draft: false }
    : null;

  const helpText: Record<Tool, string> = {
    select: "Click a plane to select · drag ● to reshape · click ◦ to add a point · right-click ● to remove",
    calibrate: "Drag a line over a feature of known length, then type its real length",
    drawPlane: "Click to drop corners · click the first point again, double-click, or press Enter to close",
    drawRidge: selected
      ? "Click two points along the ridge (the top horizontal edge) of the selected plane"
      : "Select a roof plane first, then draw its ridge",
  };

  return (
    <div className="relative select-none">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto rounded-xl block"
        style={{ touchAction: "none", cursor: tool === "select" ? "default" : "crosshair" }}
        onPointerDown={onBgPointerDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onClick={onBgClick}
        onDoubleClick={() => { if (tool === "drawPlane") closeDraft(); }}
      >
        <image href={imageUrl} width={W} height={H} />


        {/* AI obstacles — reference */}
        {obstacles.map((o, i) => (
          <rect key={`o-${i}`}
            x={sx(o.bbox.x)} y={sy(o.bbox.y)} width={sx(o.bbox.w)} height={sy(o.bbox.h)}
            fill="rgba(239,68,68,0.18)" stroke="#ef4444" strokeWidth="1.5"
            strokeDasharray="3 2" pointerEvents="none"
          />
        ))}

        {/* Packed panels — numbered sequentially across all planes */}
        {flatPanels.map((p, i) => {
          const cx = sx(p.x + p.w / 2), cy = sy(p.y + p.h / 2);
          const w = sx(p.w), h = sy(p.h);
          return (
            <g key={`p-${i}`} transform={`rotate(${p.angle} ${cx} ${cy})`} pointerEvents="none">
              <rect x={cx - w / 2} y={cy - h / 2} width={w} height={h}
                fill="rgba(23,55,162,0.72)" stroke="rgba(255,255,255,0.55)" strokeWidth="1" />
              {w > 11 && (
                <text x={cx} y={cy} fontSize="9" fontWeight="bold" fill="white"
                  textAnchor="middle" dominantBaseline="middle">{i + 1}</text>
              )}
            </g>
          );
        })}

        {/* Roof planes */}
        {planes.map((pl, i) => {
          const color = planeColor(i);
          const sel = pl.id === selectedPlaneId;
          const c = centroid(pl.polygon);
          return (
            <g key={pl.id}>
              <polygon
                points={pl.polygon.map((p) => `${sx(p.x)},${sy(p.y)}`).join(" ")}
                fill={`${color}22`} stroke={color} strokeWidth={sel ? 3.5 : 2}
                pointerEvents={tool === "select" ? "auto" : "none"}
                style={{ cursor: tool === "select" ? "pointer" : "inherit" }}
                onClick={(e) => { e.stopPropagation(); onSelectPlane(pl.id); }}
              />
              <text x={sx(c.x)} y={sy(c.y)} fontSize="12" fontWeight="bold" fill="white"
                stroke={color} strokeWidth="0.6" textAnchor="middle" dominantBaseline="middle"
                pointerEvents="none">{pl.name}</text>

              {/* Ridge line + up-slope arrow */}
              {pl.ridge && (() => {
                const [r0, r1] = pl.ridge;
                const mx = sx((r0.x + r1.x) / 2), my = sy((r0.y + r1.y) / 2);
                const cpx = sx(c.x), cpy = sy(c.y);
                let dx = mx - cpx, dy = my - cpy;
                const len = Math.hypot(dx, dy) || 1;
                dx /= len; dy /= len;
                const hx = mx + dx * 26, hy = my + dy * 26;
                const px = -dy, py = dx; // perpendicular for arrowhead
                return (
                  <g pointerEvents="none">
                    <line x1={sx(r0.x)} y1={sy(r0.y)} x2={sx(r1.x)} y2={sy(r1.y)}
                      stroke="#f97316" strokeWidth="3" strokeLinecap="round" />
                    <line x1={mx} y1={my} x2={hx} y2={hy} stroke="#f97316" strokeWidth="2" />
                    <polygon
                      points={`${hx},${hy} ${hx - dx * 8 + px * 5},${hy - dy * 8 + py * 5} ${hx - dx * 8 - px * 5},${hy - dy * 8 - py * 5}`}
                      fill="#f97316"
                    />
                  </g>
                );
              })()}
            </g>
          );
        })}

        {/* Selected plane — edit handles */}
        {selected && tool === "select" && (
          <>
            {selected.polygon.map((p, i) => {
              const j = (i + 1) % selected.polygon.length;
              const mp = { x: (p.x + selected.polygon[j].x) / 2, y: (p.y + selected.polygon[j].y) / 2 };
              return (
                <circle key={`m-${i}`}
                  cx={sx(mp.x)} cy={sy(mp.y)} r={hoverMid === i ? 7 : 5}
                  fill="rgba(255,255,255,0.9)" stroke="#0ea5e9" strokeWidth="1.5"
                  style={{ cursor: "crosshair" }}
                  onClick={(e) => { e.stopPropagation(); insertMid(i); }}
                  onMouseEnter={() => setHoverMid(i)}
                  onMouseLeave={() => setHoverMid(null)}
                />
              );
            })}
            {selected.polygon.map((p, i) => {
              const dragging = vtxDrag === i;
              const snapped = dragging && snapActive;
              return (
                <circle key={`v-${i}`}
                  cx={sx(p.x)} cy={sy(p.y)} r={dragging ? 10 : 8}
                  fill={snapped ? "#22c55e" : dragging ? "#0284c7" : "white"}
                  stroke={snapped ? "#16a34a" : "#0284c7"} strokeWidth="2.5"
                  style={{ cursor: "grab" }}
                  onPointerDown={(e) => startVtx(e, i)}
                  onContextMenu={(e) => delVtx(e, i)}
                />
              );
            })}
          </>
        )}

        {/* Plane draft in progress */}
        {tool === "drawPlane" && draft.length > 0 && (
          <g pointerEvents="none">
            <polyline
              points={[...draft, ...(cursor ? [cursor] : [])].map((p) => `${sx(p.x)},${sy(p.y)}`).join(" ")}
              fill="rgba(14,165,233,0.12)" stroke="#0ea5e9" strokeWidth="2" strokeDasharray="5 3"
            />
            {draft.map((p, i) => (
              <circle key={i} cx={sx(p.x)} cy={sy(p.y)} r={i === 0 ? 7 : 5}
                fill={i === 0 ? "#0ea5e9" : "white"} stroke="#0284c7" strokeWidth="2" />
            ))}
          </g>
        )}

        {/* Ridge draft in progress */}
        {tool === "drawRidge" && ridgeFirst && (
          <g pointerEvents="none">
            <circle cx={sx(ridgeFirst.x)} cy={sy(ridgeFirst.y)} r="6" fill="#f97316" />
            {cursor && (
              <line x1={sx(ridgeFirst.x)} y1={sy(ridgeFirst.y)} x2={sx(cursor.x)} y2={sy(cursor.y)}
                stroke="#f97316" strokeWidth="2.5" strokeDasharray="5 3" />
            )}
          </g>
        )}

        {/* Snap target indicator — glows green when the cursor is locking onto
            a detected edge, dim grey otherwise. Gives the user instant feedback
            that edge-snap is firing without them having to click first. */}
        {snapEnabled && edges && cursor && (
          <g pointerEvents="none">
            {snapActive ? (
              <>
                <circle cx={sx(cursor.x)} cy={sy(cursor.y)} r={14}
                  fill="rgba(34,197,94,0.18)" stroke="rgba(34,197,94,0.55)" strokeWidth={1.5} />
                <circle cx={sx(cursor.x)} cy={sy(cursor.y)} r={5}
                  fill="#22c55e" stroke="white" strokeWidth={2} />
              </>
            ) : (
              <circle cx={sx(cursor.x)} cy={sy(cursor.y)} r={4}
                fill="none" stroke="rgba(148,163,184,0.7)" strokeWidth={1.5} />
            )}
          </g>
        )}

        {/* Calibration line */}
        {calLine && (
          <g pointerEvents="none">
            <line x1={sx(calLine.a.x)} y1={sy(calLine.a.y)} x2={sx(calLine.b.x)} y2={sy(calLine.b.y)}
              stroke="#facc15" strokeWidth="3" strokeDasharray={calLine.draft ? "6 3" : undefined}
              strokeLinecap="round" />
            {[calLine.a, calLine.b].map((p, i) => (
              <circle key={i} cx={sx(p.x)} cy={sy(p.y)} r="5" fill="#facc15" stroke="#1e293b" strokeWidth="1.5" />
            ))}
            {!calLine.draft && calibration && (
              <text x={sx((calLine.a.x + calLine.b.x) / 2)} y={sy((calLine.a.y + calLine.b.y) / 2) - 8}
                fontSize="12" fontWeight="bold" fill="#facc15" stroke="#1e293b" strokeWidth="0.6"
                textAnchor="middle">{calibration.meters} m</text>
            )}
          </g>
        )}

      </svg>

      <div className="mt-2 flex items-center justify-between gap-3">
        <p className="flex-1 text-center text-xs text-stone-400">{helpText[tool]}</p>
        <button
          onClick={() => setSnapEnabled((v) => !v)}
          title={
            edges
              ? snapEnabled
                ? "Click points snap to real roof edges (cyan). Click to disable."
                : "Enable edge-snap — points jump to detected roof edges"
              : "Detecting edges…"
          }
          disabled={!edges}
          className={`flex shrink-0 items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
            snapEnabled
              ? "bg-cyan-600 text-white border-cyan-600 hover:bg-cyan-500"
              : "bg-white text-stone-700 border-stone-300 hover:bg-stone-50"
          }`}
        >
          <Magnet size={13} /> Edge snap
        </button>
        {(tool === "drawPlane" || tool === "drawRidge") && (
          <button
            onClick={undo}
            disabled={!canUndo}
            title="Undo last point (Ctrl+Z)"
            className="flex shrink-0 items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-stone-300 bg-white text-stone-700 transition-colors enabled:hover:bg-stone-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Undo2 size={13} /> Undo
          </button>
        )}
      </div>

      {/* Calibration length prompt */}
      {pendingCal && (
        <div className="mt-2 flex items-center justify-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          <span className="text-xs text-amber-700 font-medium">Real length of the drawn line:</span>
          <input
            type="number" autoFocus value={meters}
            onChange={(e) => setMeters(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") confirmCal(); }}
            placeholder="metres"
            className="w-24 px-2 py-1 text-sm border border-amber-300 rounded num focus:outline-none focus:ring-2 focus:ring-amber-200"
          />
          <span className="text-xs text-amber-700">m</span>
          <button onClick={confirmCal} disabled={!(parseFloat(meters) > 0)}
            className="text-xs font-semibold bg-orange-600 hover:bg-orange-500 disabled:bg-stone-200 disabled:text-stone-400 text-white px-3 py-1 rounded">
            Set Scale
          </button>
          <button onClick={() => { setPendingCal(null); setMeters(""); }}
            className="text-xs text-stone-400 hover:text-stone-600 px-1">Cancel</button>
        </div>
      )}
    </div>
  );
}

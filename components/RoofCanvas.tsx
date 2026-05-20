"use client";

import { useEffect, useRef } from "react";
import { PANEL_EDGE_SETBACK_M, planeColor } from "@/lib/geometry";
import { getObstacleDefinition } from "@/lib/obstacles";

export interface Point { x: number; y: number; }
export interface BBox { x: number; y: number; w: number; h: number; }
export interface Panel { x: number; y: number; w: number; h: number; angle: number; score?: number; }
export interface Obstacle {
  type: string;
  label: string;
  bbox: BBox;
  shadow_buffer_m: number;
}

interface Props {
  imageUrl: string;
  polygon?: Point[];
  obstacles?: Obstacle[];
  panels?: Panel[];
  expansionPanels?: Panel[];   // shown as greyed "reserved for expansion" slots
  planes?: Point[][];          // optional roof-plane outlines (one polygon each)
  showPanels?: boolean;
  showObstacles?: boolean;
  showRoof?: boolean;
}

export default function RoofCanvas({
  imageUrl,
  polygon = [],
  obstacles = [],
  panels = [],
  expansionPanels = [],
  planes = [],
  showPanels = true,
  showObstacles = true,
  showRoof = true,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const img = new Image();
    img.src = imageUrl;
    img.onload = () => {
      const maxW = 900;
      const scale = img.width > maxW ? maxW / img.width : 1;
      const W = img.width * scale;
      const H = img.height * scale;
      canvas.width = W;
      canvas.height = H;

      ctx.drawImage(img, 0, 0, W, H);

      // ── 1. Roof polygon — removed; manually drawn planes are shown instead

      // ── 1b. Roof-plane outlines ───────────────────────────────────────────
      planes.forEach((poly, idx) => {
        if (poly.length < 3) return;
        ctx.beginPath();
        poly.forEach((p, i) => {
          const px = (p.x / 100) * W;
          const py = (p.y / 100) * H;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
        ctx.closePath();
        ctx.strokeStyle = planeColor(idx);
        ctx.lineWidth = 2.5;
        ctx.setLineDash([]);
        ctx.stroke();
      });

      // ── 2. Obstacles ──────────────────────────────────────────────────────
      if (showObstacles) {
        obstacles.forEach((o) => {
          const x = (o.bbox.x / 100) * W;
          const y = (o.bbox.y / 100) * H;
          const w = (o.bbox.w / 100) * W;
          const h = (o.bbox.h / 100) * H;
          const definition = getObstacleDefinition(o.type);
          const color = definition.color;

          if (o.shadow_buffer_m > 0) {
            const bufferPx = Math.min(w, h) * 0.4;
            ctx.fillStyle = "rgba(239, 68, 68, 0.15)";
            ctx.fillRect(x - bufferPx, y, w + 2 * bufferPx, h + bufferPx * 1.5);
          }

          ctx.fillStyle = color + "55";
          ctx.fillRect(x, y, w, h);
          ctx.strokeStyle = color;
          ctx.lineWidth = 2;
          ctx.strokeRect(x, y, w, h);

          ctx.fillStyle = color;
          ctx.font = "bold 11px sans-serif";
          const label = o.label || definition.label;
          const textW = ctx.measureText(label).width;
          ctx.fillRect(x, y - 16, textW + 8, 16);
          ctx.fillStyle = "white";
          ctx.fillText(label, x + 4, y - 4);
        });
      }

      // ── 3a. Expansion slots ("Reserved for future expansion") ─────────────
      if (showPanels && expansionPanels.length > 0) {
        expansionPanels.forEach((p) => {
          const pcx = ((p.x + p.w / 2) / 100) * W;
          const pcy = ((p.y + p.h / 2) / 100) * H;
          const pw  = (p.w / 100) * W;
          const ph  = (p.h / 100) * H;
          const rot = ((p.angle ?? 0) * Math.PI) / 180;

          ctx.save();
          ctx.translate(pcx, pcy);
          ctx.rotate(rot);

          ctx.fillStyle = "rgba(148, 163, 184, 0.18)";
          ctx.fillRect(-pw / 2, -ph / 2, pw, ph);

          ctx.strokeStyle = "rgba(100, 116, 139, 0.45)";
          ctx.lineWidth = 1;
          ctx.setLineDash([3, 3]);
          ctx.strokeRect(-pw / 2, -ph / 2, pw, ph);
          ctx.setLineDash([]);

          ctx.restore();
        });
      }

      // ── 3b. Active panels ─────────────────────────────────────────────────
      // ── 3. Panels ─────────────────────────────────────────────────────────
      if (showPanels && panels.length > 0) {
        // Yield tint — best-scored panels read as deep vivid blue, lower-yield
        // panels lighten slightly, so the sun-aware ranking is visible.
        const scores = panels.map((p) => p.score ?? 1);
        const sMin = Math.min(...scores), sMax = Math.max(...scores);
        const sRange = sMax - sMin;

        panels.forEach((p, i) => {
          const pcx = ((p.x + p.w / 2) / 100) * W;   // centre in pixels
          const pcy = ((p.y + p.h / 2) / 100) * H;
          const pw  = (p.w / 100) * W;
          const ph  = (p.h / 100) * H;
          const rot = ((p.angle ?? 0) * Math.PI) / 180;

          ctx.save();
          ctx.translate(pcx, pcy);
          ctx.rotate(rot);

          // Panel body — deep blue like real monocrystalline silicon,
          // lightened for lower-yield panels (t = 1 best → 0 lowest).
          const t = sRange > 1e-6 ? ((p.score ?? 1) - sMin) / sRange : 1;
          const r = Math.round(23 + (1 - t) * 70);
          const g = Math.round(55 + (1 - t) * 70);
          const b = Math.round(162 + (1 - t) * 30);
          ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.78)`;
          ctx.fillRect(-pw / 2, -ph / 2, pw, ph);

          // Inner cell-grid lines (4 horizontal bands)
          ctx.strokeStyle = "rgba(147, 197, 253, 0.55)";
          ctx.lineWidth = 0.5;
          ctx.setLineDash([]);
          for (let r = 1; r < 4; r++) {
            const cy = -ph / 2 + (ph / 4) * r;
            ctx.beginPath();
            ctx.moveTo(-pw / 2, cy);
            ctx.lineTo( pw / 2, cy);
            ctx.stroke();
          }

          // Outer dark border
          ctx.strokeStyle = "rgba(30, 58, 138, 0.9)";
          ctx.lineWidth = 1.5;
          ctx.strokeRect(-pw / 2, -ph / 2, pw, ph);

          // White highlight border (gives the "module frame" look)
          ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
          ctx.lineWidth = 1;
          ctx.strokeRect(-pw / 2 + 1, -ph / 2 + 1, pw - 2, ph - 2);

          // Panel number — small, centred
          if (pw > 12) {
            ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
            ctx.font = "bold 10px sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(String(i + 1), 0, 0);
          }

          ctx.restore();
        });

        // ── Legend (bottom-right corner) ────────────────────────────────────
        const legendLines = expansionPanels.length > 0
          ? [`${panels.length} × 620 Wp (active)`, `${expansionPanels.length} slots reserved for expansion`, `0.5 m gap · ${PANEL_EDGE_SETBACK_M} m setback`]
          : [`${panels.length} × 620 Wp module`, `0.5 m gap · ${PANEL_EDGE_SETBACK_M} m setback · 1.0 m obs. buffer`];
        const padX = 10, padY = 8, lineH = 14;
        const boxH = legendLines.length * lineH + padY * 2;
        ctx.font = "11px sans-serif";
        const boxW = Math.max(...legendLines.map(l => ctx.measureText(l).width)) + padX * 2 + 16;

        ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
        const bx = W - boxW - 10, by = H - boxH - 10;
        ctx.fillRect(bx, by, boxW, boxH);

        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        legendLines.forEach((line, li) => {
          const tx = bx + padX, ty = by + padY + li * lineH;
          if (li === 0) {
            ctx.fillStyle = "rgba(23, 55, 162, 0.85)";
            ctx.fillRect(tx, ty + 2, 10, 10);
            ctx.strokeStyle = "rgba(255,255,255,0.35)"; ctx.lineWidth = 0.5; ctx.setLineDash([]);
            ctx.strokeRect(tx, ty + 2, 10, 10);
            ctx.fillStyle = "white";
            ctx.fillText(line, tx + 14, ty);
          } else if (li === 1 && expansionPanels.length > 0) {
            // Dashed gray swatch for reserved slots
            ctx.fillStyle = "rgba(148, 163, 184, 0.25)";
            ctx.fillRect(tx, ty + 2, 10, 10);
            ctx.strokeStyle = "rgba(100,116,139,0.6)"; ctx.lineWidth = 1; ctx.setLineDash([2, 2]);
            ctx.strokeRect(tx, ty + 2, 10, 10); ctx.setLineDash([]);
            ctx.fillStyle = "rgba(255,255,255,0.65)";
            ctx.fillText(line, tx + 14, ty);
          } else {
            ctx.fillStyle = "rgba(255,255,255,0.65)";
            ctx.fillText(line, tx, ty);
          }
        });
      }
    };
  }, [imageUrl, polygon, obstacles, panels, expansionPanels, planes, showPanels, showObstacles, showRoof]);

  return <canvas ref={canvasRef} className="w-full h-auto rounded-xl block" />;
}

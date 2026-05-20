"use client";

import { contours } from "d3-contour";
import simplify from "simplify-js";
import type { BBox, Point } from "@/components/RoofCanvas";
import { pointInPolygon } from "@/lib/geometry";

// Client-side conversion of SAM 2 mask images into the polygon / bbox geometry
// the Step 2 editor uses. Everything works in the project's 0–100 percentage
// coordinate space (see CLAUDE.md "Coordinate systems"). Tuned for precision —
// maxDim 768 keeps mask resolution high without overwhelming the browser, and
// the contour simplifier targets up to ~36 vertices so curves stay smooth.

/** A binary mask: `data[y * w + x]` is 1 inside the object, 0 outside. */
export interface MaskGrid {
  data: Uint8Array;
  w: number;
  h: number;
}

export interface GridStats {
  pixelCount: number;
  /** set pixels / total pixels, 0–1 */
  areaFraction: number;
  /** centroid in 0–100 percentage space */
  centroid: Point;
  /** tight bounding box in 0–100 percentage space */
  bbox: BBox;
}

const clampPct = (v: number) => Math.max(0, Math.min(100, v));

/**
 * Load a SAM mask image (data URL) and rasterise it to a binary grid. The
 * downscale is conservative (`maxDim=768`) so traced contours stay sharp.
 */
export function loadMaskGrid(dataUrl: string, maxDim = 768): Promise<MaskGrid> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));

      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("2D canvas context unavailable"));
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      const rgba = ctx.getImageData(0, 0, w, h).data;

      // SAM masks: either a black/white mask (alpha uniformly opaque) or a
      // transparent cut-out (object opaque, background clear).
      let anyTransparent = false;
      let anyOpaque = false;
      for (let i = 0; i < w * h; i++) {
        if (rgba[i * 4 + 3] < 128) anyTransparent = true;
        else anyOpaque = true;
        if (anyTransparent && anyOpaque) break;
      }
      const useAlpha = anyTransparent && anyOpaque;

      const data = new Uint8Array(w * h);
      for (let i = 0; i < w * h; i++) {
        if (useAlpha) {
          data[i] = rgba[i * 4 + 3] > 127 ? 1 : 0;
        } else {
          const lum = (rgba[i * 4] + rgba[i * 4 + 1] + rgba[i * 4 + 2]) / 3;
          data[i] = lum > 127 ? 1 : 0;
        }
      }
      resolve({ data, w, h });
    };
    img.onerror = () => reject(new Error("Failed to load mask image"));
    img.src = dataUrl;
  });
}

/** Compute area / centroid / bounding box for a mask grid. */
export function gridStats(g: MaskGrid): GridStats | null {
  let count = 0;
  let sx = 0;
  let sy = 0;
  let minX = g.w;
  let minY = g.h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      if (!g.data[y * g.w + x]) continue;
      count++;
      sx += x;
      sy += y;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (count === 0) return null;
  return {
    pixelCount: count,
    areaFraction: count / (g.w * g.h),
    centroid: {
      x: clampPct((sx / count / g.w) * 100),
      y: clampPct((sy / count / g.h) * 100),
    },
    bbox: {
      x: clampPct((minX / g.w) * 100),
      y: clampPct((minY / g.h) * 100),
      w: clampPct(((maxX - minX + 1) / g.w) * 100),
      h: clampPct(((maxY - minY + 1) / g.h) * 100),
    },
  };
}

/** Is the pixel at the given 0–100 percentage position inside the mask? */
export function gridContainsPercent(g: MaskGrid, xPct: number, yPct: number): boolean {
  const x = Math.floor((xPct / 100) * g.w);
  const y = Math.floor((yPct / 100) * g.h);
  if (x < 0 || y < 0 || x >= g.w || y >= g.h) return false;
  return g.data[y * g.w + x] === 1;
}

/**
 * Count how many of this mask's pixels fall inside the central `ratio`×`ratio`
 * box of the image (default the middle 40%). This is the "is this mask the
 * roof?" signal — far more robust than testing a single centre pixel, because
 * a hip-roof ridge line at the literal centre may fall between adjacent face
 * masks.
 */
export function centralPixelCount(g: MaskGrid, ratio = 0.4): number {
  const half = ratio / 2;
  const x0 = Math.floor(g.w * (0.5 - half));
  const x1 = Math.ceil(g.w * (0.5 + half));
  const y0 = Math.floor(g.h * (0.5 - half));
  const y1 = Math.ceil(g.h * (0.5 + half));
  let count = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (g.data[y * g.w + x]) count++;
    }
  }
  return count;
}

/** OR several mask grids into one. Grids with mismatched dimensions are skipped. */
export function unionGrids(grids: MaskGrid[]): MaskGrid | null {
  if (grids.length === 0) return null;
  const { w, h } = grids[0];
  const data = new Uint8Array(w * h);
  for (const g of grids) {
    if (g.w !== w || g.h !== h) continue;
    for (let i = 0; i < w * h; i++) if (g.data[i]) data[i] = 1;
  }
  return { data, w, h };
}

function ringArea(ring: number[][]): number {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

/**
 * Trace a mask grid into a simplified polygon in 0–100 percentage space.
 * Picks the largest contour ring, simplifies it (Douglas–Peucker) to roughly
 * 8–36 vertices, and orients it clockwise to match GPT's polygon convention.
 */
export function gridToPolygon(g: MaskGrid): Point[] {
  const values = Array.from(g.data);
  let multi;
  try {
    multi = contours().size([g.w, g.h]).thresholds([0.5])(values);
  } catch {
    return [];
  }
  const coords = multi?.[0]?.coordinates as number[][][][] | undefined;
  if (!coords || coords.length === 0) return [];

  let best: number[][] | null = null;
  let bestArea = 0;
  for (const poly of coords) {
    const ring = poly[0];
    if (!ring) continue;
    const a = Math.abs(ringArea(ring));
    if (a > bestArea) {
      bestArea = a;
      best = ring;
    }
  }
  if (!best || best.length < 4) return [];

  let pts: Point[] = best.map(([x, y]) => ({ x, y }));
  if (pts.length > 1) {
    const f = pts[0];
    const l = pts[pts.length - 1];
    if (f.x === l.x && f.y === l.y) pts.pop();
  }

  // Less aggressive simplification — keep up to ~36 vertices for sharp curves.
  let tol = Math.max(g.w, g.h) * 0.003;
  let simplified = simplify(pts, tol, true);
  let guard = 0;
  while (simplified.length > 36 && guard < 12) {
    tol *= 1.5;
    simplified = simplify(pts, tol, true);
    guard++;
  }
  if (simplified.length >= 4) pts = simplified;

  let out: Point[] = pts.map((p) => ({
    x: clampPct((p.x / g.w) * 100),
    y: clampPct((p.y / g.h) * 100),
  }));

  if (ringArea(out.map((p) => [p.x, p.y])) > 0) out = out.reverse();
  return out;
}

/**
 * Fraction of a mask's set pixels that fall inside the given polygon
 * (0–100 space). Sub-sampled for speed — an estimate is plenty for mask
 * selection.
 */
export function fractionInsidePolygon(g: MaskGrid, polygon: Point[]): number {
  if (polygon.length < 3) return 0;
  let total = 0;
  let inside = 0;
  for (let y = 0; y < g.h; y += 3) {
    for (let x = 0; x < g.w; x += 3) {
      if (!g.data[y * g.w + x]) continue;
      total++;
      if (pointInPolygon((x / g.w) * 100, (y / g.h) * 100, polygon)) inside++;
    }
  }
  return total > 0 ? inside / total : 0;
}

/**
 * Remap a polygon traced from a CROPPED image back to full-image percentage
 * coordinates. `cropBBox` is in full-image 0–100 percentage space; `poly` is
 * in crop 0–100 percentage space.
 */
export function mapPolygonCropToFull(poly: Point[], cropBBox: BBox): Point[] {
  return poly.map((p) => ({
    x: clampPct(cropBBox.x + (p.x / 100) * cropBBox.w),
    y: clampPct(cropBBox.y + (p.y / 100) * cropBBox.h),
  }));
}

/** Intersection-over-union of two bounding boxes in the same coordinate space. */
export function bboxIoU(a: BBox, b: BBox): number {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = ix * iy;
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

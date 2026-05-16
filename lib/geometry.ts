import type { Point, Obstacle, Panel } from "@/components/RoofCanvas";

export function polygonArea(pts: Point[]): number {
  let area = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    area += (pts[j].x + pts[i].x) * (pts[j].y - pts[i].y);
  }
  return Math.abs(area) / 2;
}

export function pointInPolygon(px: number, py: number, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

export function rectsOverlap(
  ax: number, ay: number, aw: number, ah: number,
  bx: number, by: number, bw: number, bh: number
): boolean {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

/**
 * Dominant axis angle (degrees) of a polygon — angle of its longest edge,
 * normalised to [-90, 90] so a panel rotated 180° looks the same as 0°.
 */
export function roofAngleDeg(pts: Point[]): number {
  let maxLen = 0, angle = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    const dx = pts[j].x - pts[i].x, dy = pts[j].y - pts[i].y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len > maxLen) { maxLen = len; angle = Math.atan2(dy, dx) * 180 / Math.PI; }
  }
  if (angle > 90) angle -= 180;
  if (angle < -90) angle += 180;
  return angle;
}

/** Rotate point p around (cx, cy) by rad radians. */
function rotPt(p: Point, cx: number, cy: number, rad: number): Point {
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const dx = p.x - cx, dy = p.y - cy;
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
}

/**
 * Pack solar panels inside a polygon, with the grid aligned to the roof's
 * dominant axis so panels visually follow the roofline.
 *
 * Strategy:
 *  1. Find the dominant edge angle θ.
 *  2. Rotate the entire polygon (and obstacles) by −θ → axis-aligned frame.
 *  3. Sweep a regular grid in that frame; reject cells whose corners fall
 *     outside the rotated polygon or overlap an obstacle buffer.
 *  4. Rotate each accepted panel's centre back by +θ and store angle = θ.
 */
export function packPanels(
  polygon: Point[],
  obstacles: Obstacle[],
  usableAreaSqm: number,
  orientation: "portrait" | "landscape" = "portrait"
): Panel[] {
  if (polygon.length < 3 || usableAreaSqm <= 0) return [];
  const areaPctSq = polygonArea(polygon);
  if (areaPctSq <= 0) return [];

  // Scale: metres per %-unit (in the polygon's coordinate space)
  const mPerPct = Math.sqrt(usableAreaSqm / areaPctSq);

  // Panel dimensions (the long side of a 620 Wp module is 2.278 m)
  const PW_M = orientation === "portrait" ? 2.278 : 1.134;
  const PH_M = orientation === "portrait" ? 1.134 : 2.278;
  const GAP_M     = 0.5;   // maintenance aisle between rows/columns
  const SETBACK_M = 0.3;   // polygon edge clearance
  const OBS_BUF_M = 1.0;   // buffer around obstacles (shading + access)

  const pw      = PW_M      / mPerPct;
  const ph      = PH_M      / mPerPct;
  const gap     = GAP_M     / mPerPct;
  const setback = SETBACK_M / mPerPct;
  const obsBuf  = OBS_BUF_M / mPerPct;

  // ── Roof angle: align the packing grid with the longest roof edge ─────────
  const angleDeg = roofAngleDeg(polygon);
  const angleRad = angleDeg * Math.PI / 180;

  const centroid: Point = {
    x: polygon.reduce((s, p) => s + p.x, 0) / polygon.length,
    y: polygon.reduce((s, p) => s + p.y, 0) / polygon.length,
  };

  // Rotate polygon into axis-aligned frame (−θ)
  const rotPoly = polygon.map(p => rotPt(p, centroid.x, centroid.y, -angleRad));
  const rxs = rotPoly.map(p => p.x), rys = rotPoly.map(p => p.y);
  const xMin = Math.min(...rxs) + setback;
  const xMax = Math.max(...rxs) - setback;
  const yMin = Math.min(...rys) + setback;
  const yMax = Math.max(...rys) - setback;

  // Rotate each obstacle's bbox corners into the same frame; build AABB + buffer
  const rotObsBufs = obstacles.map(o => {
    const corners: Point[] = [
      { x: o.bbox.x,            y: o.bbox.y            },
      { x: o.bbox.x + o.bbox.w, y: o.bbox.y            },
      { x: o.bbox.x + o.bbox.w, y: o.bbox.y + o.bbox.h },
      { x: o.bbox.x,            y: o.bbox.y + o.bbox.h },
    ].map(p => rotPt(p, centroid.x, centroid.y, -angleRad));
    const cxs = corners.map(p => p.x), cys = corners.map(p => p.y);
    return {
      x: Math.min(...cxs) - obsBuf,
      y: Math.min(...cys) - obsBuf,
      w: Math.max(...cxs) - Math.min(...cxs) + 2 * obsBuf,
      h: Math.max(...cys) - Math.min(...cys) + 2 * obsBuf,
    };
  });

  const panels: Panel[] = [];
  for (let ry = yMin; ry + ph <= yMax; ry += ph + gap) {
    for (let rx = xMin; rx + pw <= xMax; rx += pw + gap) {
      // All 4 corners must lie inside the rotated polygon
      if (
        !pointInPolygon(rx,      ry,      rotPoly) ||
        !pointInPolygon(rx + pw, ry,      rotPoly) ||
        !pointInPolygon(rx,      ry + ph, rotPoly) ||
        !pointInPolygon(rx + pw, ry + ph, rotPoly)
      ) continue;

      // Must not overlap any obstacle's buffer zone
      if (rotObsBufs.some(o => rectsOverlap(rx, ry, pw, ph, o.x, o.y, o.w, o.h))) continue;

      // Rotate panel centre back to screen frame (+θ)
      const pc = rotPt({ x: rx + pw / 2, y: ry + ph / 2 }, centroid.x, centroid.y, angleRad);
      panels.push({ x: pc.x - pw / 2, y: pc.y - ph / 2, w: pw, h: ph, angle: angleDeg });
    }
  }
  return panels;
}

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

export interface RoofFace {
  name: string;
  polygon: Point[];
  tile_angle_deg: number;
}

/**
 * Pack panels inside ONE roof-plane polygon at ONE tile angle.
 *
 * Inputs are in isotropic space (u = x * aspect, v = y). Panel dimensions
 * (pw/ph/colGap/rowGap/setback/obsBuf) are precomputed by the caller so every
 * face of a roof shares the same scale. Obstacle corner-sets also arrive in iso
 * space and are rotated into this face's aligned frame here.
 *
 * `colGap` separates panels within a row (kept tiny so they read as one
 * connected strip); `rowGap` separates successive rows (a wider maintenance
 * walkway). Together they give the array a real, serviceable row layout.
 *
 * Strategy: rotate the face by −θ → axis-aligned frame, sweep a regular grid,
 * rotate accepted panel centres back by +θ, convert to % space, tag angle = θ.
 */
function packFace(
  faceIso: Point[],
  obsCornersIso: Point[][],
  angleDeg: number,
  pw: number,
  ph: number,
  colGap: number,
  rowGap: number,
  setback: number,
  obsBuf: number,
  imageAspect: number
): Panel[] {
  if (faceIso.length < 3) return [];

  const centroidIso: Point = {
    x: faceIso.reduce((s, p) => s + p.x, 0) / faceIso.length,
    y: faceIso.reduce((s, p) => s + p.y, 0) / faceIso.length,
  };
  const angleRad = angleDeg * Math.PI / 180;

  // Rotate face polygon into axis-aligned frame (−θ)
  const rotPoly = faceIso.map(p => rotPt(p, centroidIso.x, centroidIso.y, -angleRad));
  const rxs = rotPoly.map(p => p.x), rys = rotPoly.map(p => p.y);
  const xMin = Math.min(...rxs) + setback;
  const xMax = Math.max(...rxs) - setback;
  const yMin = Math.min(...rys) + setback;
  const yMax = Math.max(...rys) - setback;

  // Obstacles: rotate iso corners into this face's aligned frame, build AABB + buffer
  const rotObsBufs = obsCornersIso.map(corners => {
    const rc = corners.map(p => rotPt(p, centroidIso.x, centroidIso.y, -angleRad));
    const cxs = rc.map(p => p.x), cys = rc.map(p => p.y);
    return {
      x: Math.min(...cxs) - obsBuf,
      y: Math.min(...cys) - obsBuf,
      w: Math.max(...cxs) - Math.min(...cxs) + 2 * obsBuf,
      h: Math.max(...cys) - Math.min(...cys) + 2 * obsBuf,
    };
  });

  const panels: Panel[] = [];
  for (let ry = yMin; ry + ph <= yMax; ry += ph + rowGap) {
    for (let rx = xMin; rx + pw <= xMax; rx += pw + colGap) {
      if (
        !pointInPolygon(rx,      ry,      rotPoly) ||
        !pointInPolygon(rx + pw, ry,      rotPoly) ||
        !pointInPolygon(rx,      ry + ph, rotPoly) ||
        !pointInPolygon(rx + pw, ry + ph, rotPoly)
      ) continue;
      if (rotObsBufs.some(o => rectsOverlap(rx, ry, pw, ph, o.x, o.y, o.w, o.h))) continue;

      // Rotate panel centre back to iso frame (+θ), then convert to % space
      const pcIso = rotPt({ x: rx + pw / 2, y: ry + ph / 2 }, centroidIso.x, centroidIso.y, angleRad);
      const xPct  = pcIso.x / imageAspect;
      const yPct  = pcIso.y;
      // Panel size back in % space: w shrinks by aspect, h unchanged
      const wPct  = pw / imageAspect;
      const hPct  = ph;
      panels.push({ x: xPct - wPct / 2, y: yPct - hPct / 2, w: wPct, h: hPct, angle: angleDeg });
    }
  }
  return panels;
}

/**
 * Pack panels across a multi-plane roof. Each face is packed on its own grid,
 * aligned to that plane's tile direction, so panels follow the roofline of every
 * slope independently (a hip roof gets ~4 differently-angled panel groups).
 *
 * imageAspect (W/H of the source image) converts the percentage-coordinate
 * polygons into isotropic (pixel-proportional) space so angles and panel shapes
 * stay accurate on non-square images.
 *
 * The packing scale is derived once from the overall `outline` polygon, so panel
 * size is uniform across faces regardless of how the AI tessellated them. After
 * packing, panels are clipped to `outline` — trimming anything past the
 * (editable) roof boundary.
 */
export function packPanelsMultiFace(
  faces: RoofFace[],
  outline: Point[],
  obstacles: Obstacle[],
  usableAreaSqm: number,
  orientation: "portrait" | "landscape" = "portrait",
  imageAspect: number = 1,
  angleOverrides?: number[]
): Panel[] {
  if (faces.length === 0 || outline.length < 3 || usableAreaSqm <= 0) return [];

  const toIso = (p: Point): Point => ({ x: p.x * imageAspect, y: p.y });

  // Shared scale: metres per iso-unit, anchored to the overall roof outline
  const outlineIso = outline.map(toIso);
  const areaIso = polygonArea(outlineIso);
  if (areaIso <= 0) return [];
  const mPerIso = Math.sqrt(usableAreaSqm / areaIso);

  // Panel dimensions in iso units — the fixed Trina Vertex N module (2.382 × 1.134 m)
  const PW_M = orientation === "portrait" ? FIXED_MODULE.lengthM : FIXED_MODULE.widthM;
  const PH_M = orientation === "portrait" ? FIXED_MODULE.widthM : FIXED_MODULE.lengthM;
  const pw      = PW_M / mPerIso;
  const ph      = PH_M / mPerIso;
  const colGap  = PANEL_ROW_GAP_M / mPerIso; // panels connected within a row
  const rowGap  = ROW_WALKWAY_M   / mPerIso; // walkway channel between rows
  const setback = PANEL_EDGE_SETBACK_M / mPerIso;
  const obsBuf  = 1.0  / mPerIso;

  // Obstacle corner-sets, converted to iso space once and reused for every face
  const obsCornersIso: Point[][] = obstacles.map(o =>
    [
      { x: o.bbox.x,            y: o.bbox.y            },
      { x: o.bbox.x + o.bbox.w, y: o.bbox.y            },
      { x: o.bbox.x + o.bbox.w, y: o.bbox.y + o.bbox.h },
      { x: o.bbox.x,            y: o.bbox.y + o.bbox.h },
    ].map(toIso)
  );

  // Pack each face on a grid aligned to its own tile angle
  const all: Panel[] = [];
  faces.forEach((face, i) => {
    const angle = angleOverrides?.[i] ?? face.tile_angle_deg ?? 0;
    const faceIso = face.polygon.map(toIso);
    all.push(...packFace(faceIso, obsCornersIso, angle, pw, ph, colGap, rowGap, setback, obsBuf, imageAspect));
  });

  // Clip to the overall outline — a panel is kept only if all 4 of its rotated
  // corners sit inside the roof, so no panel body overhangs the edge. Corner
  // rotation is done in iso space to mirror how packFace placed the panel.
  return all.filter((p) => panelCornersInside(p, outline, imageAspect));
}

/** True when all 4 rotated corners of a panel lie inside the polygon. */
function panelCornersInside(p: Panel, poly: Point[], imageAspect: number): boolean {
  const cIso: Point = { x: (p.x + p.w / 2) * imageAspect, y: p.y + p.h / 2 };
  const pwIso = p.w * imageAspect;
  const phIso = p.h;
  const angleRad = ((p.angle ?? 0) * Math.PI) / 180;
  const offsets = [
    [-pwIso / 2, -phIso / 2],
    [ pwIso / 2, -phIso / 2],
    [ pwIso / 2,  phIso / 2],
    [-pwIso / 2,  phIso / 2],
  ];
  return offsets.every(([dx, dy]) => {
    const c = rotPt({ x: cIso.x + dx, y: cIso.y + dy }, cIso.x, cIso.y, angleRad);
    return pointInPolygon(c.x / imageAspect, c.y, poly);
  });
}

// ── Manual roof-plane drawing & ridge-defined packing ────────────────────────

export interface Calibration {
  line: [Point, Point];   // % coords of the drawn reference line
  meters: number;         // its real-world length
}

export type Orientation = "landscape" | "portrait";

export interface RoofPlane {
  id: string;
  name: string;
  polygon: Point[];                       // % coords
  ridge: [Point, Point] | null;           // % coords — two clicked points
  orientationMode: "auto" | Orientation;
  /** Engineer-entered roof tilt in degrees. null = use auto default (15°). */
  tiltDeg: number | null;
  /** Engineer-entered compass azimuth in degrees (N=0, E=90, S=180, W=270).
   *  null = auto-suggested from the drawn ridge line. */
  azimuthDeg: number | null;
}

export interface ModuleSpec {
  lengthM: number;
  widthM: number;
  wattage: number;
}

/**
 * The fixed PV module this app designs for — Trina Vertex N (TSM-NEG19RC.20):
 * 2382 × 1134 mm, 620 Wp. Single source of truth for panel dimensions.
 */
export const FIXED_MODULE: ModuleSpec = { lengthM: 2.382, widthM: 1.134, wattage: 620 };

/**
 * Spacing for the connected-row layout. Within a row panels sit nearly flush —
 * they share mounting rails — so the row reads as one continuous strip. Between
 * rows a wider gap is left as a maintenance walkway / access channel.
 */
export const PANEL_ROW_GAP_M = 0.02; // in-row gap — panels effectively touching
export const ROW_WALKWAY_M   = 0.6;  // walkway channel between successive rows
export const PANEL_EDGE_SETBACK_M = 0.6;

export interface PlanePackResult {
  planeId: string;
  orientation: Orientation;
  ridgeAngleDeg: number;
  panels: Panel[];
}

// Distinct outline colour per roof plane (cycled by index)
export const PLANE_COLORS = [
  "#06b6d4", "#f59e0b", "#ec4899", "#8b5cf6",
  "#10b981", "#ef4444", "#3b82f6", "#eab308",
];
export const planeColor = (i: number) => PLANE_COLORS[i % PLANE_COLORS.length];

const isoOf = (p: Point, aspect: number): Point => ({ x: p.x * aspect, y: p.y });

/** Ridge-line direction in degrees (iso space), normalised to [-90, 90]. */
export function ridgeAngleDeg(p1: Point, p2: Point, imageAspect: number): number {
  const a = isoOf(p1, imageAspect), b = isoOf(p2, imageAspect);
  let deg = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  if (deg > 90) deg -= 180;
  if (deg < -90) deg += 180;
  return deg;
}

/** Metres per iso-unit, derived from a calibration line of known real length. */
export function calibrationMPerIso(cal: Calibration, imageAspect: number): number {
  const a = isoOf(cal.line[0], imageAspect), b = isoOf(cal.line[1], imageAspect);
  const isoLen = Math.hypot(b.x - a.x, b.y - a.y);
  if (isoLen <= 0 || cal.meters <= 0) return 0;
  return cal.meters / isoLen;
}

/**
 * Pack panels into each manually-drawn roof plane on a grid aligned to that
 * plane's ridge line. Scale comes from the calibration line (mPerIso), not the
 * AI area estimate. Reuses packFace() for the per-plane rotated grid sweep.
 */
export function packPlanes(
  planes: RoofPlane[],
  mPerIso: number,
  module: ModuleSpec,
  obstacles: Obstacle[],
  imageAspect: number
): PlanePackResult[] {
  const empty = (pl: RoofPlane): PlanePackResult => ({
    planeId: pl.id, orientation: "landscape", ridgeAngleDeg: 0, panels: [],
  });
  if (mPerIso <= 0) return planes.map(empty);

  const obsCornersIso: Point[][] = obstacles.map((o) =>
    [
      { x: o.bbox.x,            y: o.bbox.y            },
      { x: o.bbox.x + o.bbox.w, y: o.bbox.y            },
      { x: o.bbox.x + o.bbox.w, y: o.bbox.y + o.bbox.h },
      { x: o.bbox.x,            y: o.bbox.y + o.bbox.h },
    ].map((p) => isoOf(p, imageAspect))
  );

  const colGap  = PANEL_ROW_GAP_M / mPerIso; // panels connected within a row
  const rowGap  = ROW_WALKWAY_M   / mPerIso; // walkway channel between rows
  const setback = PANEL_EDGE_SETBACK_M / mPerIso;
  const obsBuf  = 1.0 / mPerIso;

  return planes.map((pl) => {
    if (!pl.ridge || pl.polygon.length < 3) return empty(pl);
    const angle = ridgeAngleDeg(pl.ridge[0], pl.ridge[1], imageAspect);
    // "auto" lays panels landscape — long edge along the ridge — so they
    // connect into continuous rows. This is the standard rooftop arrangement.
    const orientation: Orientation =
      pl.orientationMode === "auto" ? "landscape" : pl.orientationMode;
    // landscape → module's long edge runs along the ridge (the swept x-axis)
    const alongM = orientation === "landscape" ? module.lengthM : module.widthM;
    const downM  = orientation === "landscape" ? module.widthM  : module.lengthM;
    const faceIso = pl.polygon.map((p) => isoOf(p, imageAspect));
    const panels = packFace(
      faceIso, obsCornersIso, angle,
      alongM / mPerIso, downM / mPerIso,
      colGap, rowGap, setback, obsBuf, imageAspect
    );
    return { planeId: pl.id, orientation, ridgeAngleDeg: angle, panels };
  });
}

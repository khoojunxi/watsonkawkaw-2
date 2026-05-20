import OpenAI from "openai";
import { NextRequest, NextResponse } from "next/server";
import type { BBox, Point, Obstacle } from "@/components/RoofCanvas";
import {
  packPanelsMultiFace,
  pointInPolygon,
  polygonArea,
  roofAngleDeg,
  FIXED_MODULE,
  type RoofFace,
} from "@/lib/geometry";
import {
  getObstacleDefinition,
  normalizeObstacleType,
  obstaclePromptList,
  OBSTACLE_TYPES,
} from "@/lib/obstacles";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const VISION_MODEL = process.env.OPENAI_VISION_MODEL || "gpt-4o";
const isReasoningModel = VISION_MODEL.startsWith("gpt-5");
const useTwoPassAnalyze = process.env.ANALYZE_TWO_PASS === "true";

type RawPoint = { x?: unknown; y?: unknown };
type RawBBox = { x?: unknown; y?: unknown; w?: unknown; h?: unknown };
type RawObstacle = {
  type?: unknown;
  label?: unknown;
  bbox?: RawBBox;
  shadow_buffer_m?: unknown;
};
type RawFace = { name?: unknown; polygon?: unknown; tile_angle_deg?: unknown };
type RawRoof = {
  roof_type?: unknown;
  estimated_total_area_sqm?: unknown;
  usable_area_sqm?: unknown;
  polygon?: unknown;
};

function finiteNumber(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value: unknown, min: number, max: number, fallback = min): number {
  return Math.max(min, Math.min(max, finiteNumber(value, fallback)));
}

function sanitizePolygon(
  value: unknown,
  minPoints: number,
  qualityFlags: string[],
  flagPrefix: string
): Point[] {
  if (!Array.isArray(value)) {
    qualityFlags.push(`${flagPrefix}_missing`);
    return [];
  }

  let clamped = false;
  const points = value
    .map((raw): Point | null => {
      const p = raw as RawPoint;
      const x = finiteNumber(p?.x, Number.NaN);
      const y = finiteNumber(p?.y, Number.NaN);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      const cx = clamp(x, 0, 100);
      const cy = clamp(y, 0, 100);
      clamped = clamped || cx !== x || cy !== y;
      return { x: cx, y: cy };
    })
    .filter((p): p is Point => p !== null)
    .filter((p, i, arr) => {
      if (i === 0) return true;
      const prev = arr[i - 1];
      return Math.hypot(p.x - prev.x, p.y - prev.y) > 0.15;
    });

  if (points.length > 2) {
    const first = points[0];
    const last = points[points.length - 1];
    if (Math.hypot(first.x - last.x, first.y - last.y) <= 0.15) points.pop();
  }

  if (clamped) qualityFlags.push(`${flagPrefix}_clamped_to_image`);
  if (points.length < minPoints) qualityFlags.push(`${flagPrefix}_too_few_points`);
  if (points.length >= 3 && polygonArea(points) < 1) qualityFlags.push(`${flagPrefix}_tiny_area`);

  return points.length >= minPoints ? points : [];
}

function sanitizeObstacleBBox(raw: RawBBox | undefined): BBox | null {
  if (!raw) return null;
  const x = finiteNumber(raw.x, Number.NaN);
  const y = finiteNumber(raw.y, Number.NaN);
  const w = finiteNumber(raw.w, Number.NaN);
  const h = finiteNumber(raw.h, Number.NaN);
  if (![x, y, w, h].every(Number.isFinite)) return null;
  if (w <= 0 || h <= 0) return null;

  const sx = clamp(x, 0, 100);
  const sy = clamp(y, 0, 100);
  const sw = Math.max(0, Math.min(w, 100 - sx));
  const sh = Math.max(0, Math.min(h, 100 - sy));
  if (sw <= 0 || sh <= 0) return null;
  return { x: sx, y: sy, w: sw, h: sh };
}

function sanitizeObstacles(
  value: unknown,
  polygon: Point[],
  qualityFlags: string[]
): Obstacle[] {
  if (!Array.isArray(value)) return [];

  const obstacles: Obstacle[] = [];
  value.forEach((raw, idx) => {
    const obs = raw as RawObstacle;
    const bbox = sanitizeObstacleBBox(obs.bbox);
    if (!bbox) {
      qualityFlags.push(`obstacle_${idx}_invalid_bbox`);
      return;
    }

    const center = { x: bbox.x + bbox.w / 2, y: bbox.y + bbox.h / 2 };
    if (polygon.length >= 3 && !pointInPolygon(center.x, center.y, polygon)) {
      qualityFlags.push(`obstacle_${idx}_outside_roof`);
      return;
    }

    const type = normalizeObstacleType(obs.type);
    const definition = getObstacleDefinition(type);
    const shadowBuffer = clamp(
      obs.shadow_buffer_m,
      0,
      3,
      definition.defaultShadowBufferM
    );
    obstacles.push({
      type,
      label: typeof obs.label === "string" && obs.label.trim()
        ? obs.label.trim()
        : definition.label,
      bbox,
      shadow_buffer_m: shadowBuffer,
    });
  });

  return obstacles;
}

function sanitizeFaces(
  value: unknown,
  fallbackAngle: number,
  qualityFlags: string[]
): RoofFace[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((raw, idx) => {
    const face = raw as RawFace;
    const polygon = sanitizePolygon(face.polygon, 3, qualityFlags, `roof_face_${idx}`);
    if (polygon.length < 3 || polygonArea(polygon) < 1) return [];
    return [{
      name: typeof face.name === "string" && face.name.trim()
        ? face.name.trim()
        : `roof face ${idx + 1}`,
      polygon,
      tile_angle_deg: clamp(face.tile_angle_deg, -45, 45, fallbackAngle),
    }];
  });
}

function confidenceWithFlags(confidence: unknown, qualityFlags: string[]) {
  const value = typeof confidence === "string" ? confidence.toLowerCase() : "medium";
  const normalized = value === "high" || value === "low" ? value : "medium";
  if (qualityFlags.some((flag) => flag.includes("too_few_points") || flag.includes("tiny_area"))) {
    return "low";
  }
  if (qualityFlags.length > 0 && normalized === "high") return "medium";
  return normalized;
}

function detectionNotes(aiNotes: unknown, qualityFlags: string[]) {
  const notes = typeof aiNotes === "string" ? aiNotes.trim() : "";
  if (qualityFlags.length === 0) return notes;
  const flagText = `Validation adjusted the AI result: ${qualityFlags.join(", ")}.`;
  return notes ? `${notes} ${flagText}` : flagText;
}

// Route handler

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get("image") as File | null;
  if (!file) return NextResponse.json({ error: "No image provided" }, { status: 400 });

  const isRetry = formData.get("retry") === "true";
  const imageAspect = clamp(formData.get("image_aspect"), 0.2, 5, 1);

  const bytes = await file.arrayBuffer();
  const base64 = Buffer.from(bytes).toString("base64");
  const mediaType = file.type || "image/jpeg";
  const dataUrl = `data:${mediaType};base64,${base64}`;

  const retryWarning = isRetry
    ? "\nRETRY MODE: The previous detection was wrong. Be stricter about excluding ground, driveways, grass, adjacent roofs, patios, canopies, and tank platforms. The final polygon must hug real roof edges, not a loose rectangle.\n"
    : "";

  const locatePrompt = `You are analysing an aerial/drone image to identify the PRIMARY rooftop for solar panel assessment.${retryWarning}

Find the target roof by material and structure. This first pass returns only a ROUGH target region so the next pass knows which building to trace.

ACCEPT as target roof material:
- Corrugated or ribbed metal sheeting with parallel ridges.
- Clay or concrete roof tiles with repeated tile rows and visible joints.
- Asphalt shingles with repeated granular rows.
- Flat concrete or membrane roofs only when raised above walls and bounded by parapet/roof edges.

REJECT from the target:
- Roads, driveways, pavements, cars, grass, soil, trees, and ground shadows.
- Courtyards, patios, balconies, roof terraces, and flat living areas with railings.
- Adjacent or neighbouring roofs, even if they touch the target building.
- Glass canopies, awnings, and water tank platforms unless they are part of the actual roof surface.

Return a rough bounding box around the chosen target roof, not the final design polygon. Include enough of the target roof so hips/eaves are visible, but do not merge neighbouring buildings.

If the identifiable target roof covers less than 15% of the image area, set low_coverage true.

Respond ONLY with valid JSON:
{
  "material": "<corrugated_metal|clay_tiles|concrete_tiles|asphalt_shingles|flat_membrane|unknown>",
  "colour": "<describe roof colour>",
  "texture_description": "<describe repeating texture pattern>",
  "roof_type": "<flat|pitched|complex>",
  "x_min": <rough left edge as % of image width, 0-100>,
  "y_min": <rough top edge as % of image height, 0-100>,
  "x_max": <rough right edge as % of image width, 0-100>,
  "y_max": <rough bottom edge as % of image height, 0-100>,
  "low_coverage": <true|false>,
  "rejection_notes": "<what you excluded and where, e.g. 'excluded road at y>82%, adjacent brown roof at x<20%'>"
}`;

  const locateRes = await client.chat.completions.create({
    model: VISION_MODEL,
    ...(isReasoningModel
      ? { max_completion_tokens: 1200, reasoning_effort: "low" as const }
      : { max_tokens: 1200 }),
    response_format: { type: "json_object" },
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: locatePrompt },
          { type: "image_url", image_url: { url: dataUrl, detail: "high" } },
        ],
      },
    ],
  });

  const loc = JSON.parse(locateRes.choices[0].message.content ?? "{}") as {
    material?: string;
    colour?: string;
    texture_description?: string;
    roof_type?: string;
    x_min?: number; y_min?: number;
    x_max?: number; y_max?: number;
    low_coverage?: boolean;
    rejection_notes?: string;
  };

  if (loc.low_coverage) {
    return NextResponse.json({
      roof: { roof_type: "unknown", estimated_total_area_sqm: 0, usable_area_sqm: 0, polygon: [] },
      roof_faces: [],
      obstacles: [], panels: [], panel_count: 0, panel_orientation: "portrait",
      system_capacity_kwp: 0, annual_yield_kwh: 0, tilt_assumed_deg: 10, azimuth_deg: 180,
      confidence: "low",
      engineer_notes: "Roof surface covers less than 15% of the image. Please re-upload a closer aerial shot with the target rooftop filling most of the frame.",
      quality_flags: ["low_roof_coverage"],
      detection_notes: "The target roof is too small in the uploaded image for reliable tracing.",
    });
  }

  const obstacleTypes = OBSTACLE_TYPES.join("|");
  const analyzePrompt = `You are an expert solar PV layout engineer for Malaysia.${retryWarning}

The rough target roof region is:
- Material: ${loc.material ?? "unknown"} (${loc.colour ?? "unknown colour"})
- Texture: ${loc.texture_description ?? "unknown texture"}
- Roof type: ${loc.roof_type ?? "complex"}
- Rough locator box: x ${loc.x_min ?? "?"}% to ${loc.x_max ?? "?"}%, y ${loc.y_min ?? "?"}% to ${loc.y_max ?? "?"}%
- Already excluded: ${loc.rejection_notes ?? "none"}

Important: the locator box is only a target-selection hint. Do not copy it as the roof polygon. If the visible roof edge conflicts with the box, trust the image.

Coordinate system:
- x=0 is the left image edge, x=100 is the right image edge.
- y=0 is the top image edge, y=100 is the bottom image edge.
- All coordinates are percentages of the whole image.

TASK 1: TRACE THE USABLE ROOF POLYGON
Draw 4-20 clockwise points around the selected roof surface. The polygon must follow visible roof edges:
- Eaves, gutters, fascia lines, gable edges, parapet walls, hips, valleys, and real concave cutouts.
- Use a concave polygon for L-shaped roofs, courtyards, notches, or areas where neighbouring buildings touch the target roof.
- Do not use a simple enclosing rectangle unless the actual usable roof outline is rectangular.
- Keep every point on the roof material edge, not on grass, driveway, wall, road, carport, awning, or neighbouring roof.
- For hipped roofs, the outer roof polygon follows the eave/gutter perimeter; internal hip/ridge lines belong in roof_faces.
- Exclude visible flat patios, balconies, courtyards, water-tank platforms, glass canopies, and non-roof slabs from the polygon.

TASK 1B: SPLIT THE ROOF INTO FLAT FACES
Return roof_faces for visible roof planes:
- Flat roof: 1 face.
- Simple gable roof: 2 faces.
- Hipped roof: usually 4 faces.
- Complex/L-shaped roof: one face per visible plane.
- Each face polygon must stay inside the roof polygon and follow ridge/hip/valley/eave lines.
- tile_angle_deg is the tile-row/ridge direction for that face, from -45 to 45 degrees clockwise from horizontal.

TASK 2: DETECT OBSTACLES ON THE SELECTED ROOF ONLY
Return tight bounding boxes only for objects or shade zones that block panel placement. Ignore cars, roads, ground items, and objects outside the roof polygon. For tree_shade, mark only the shadow/canopy footprint that falls on the roof.

Allowed obstacle types:
${obstaclePromptList()}

Use one of these exact type values: ${obstacleTypes}
shadow_buffer_m: 0 for flush/low-profile objects, 1 for small/tall objects, 2-3 for tanks, chimneys, trees, or strong shade risks.

TASK 3: ESTIMATE AREAS
- estimated_total_area_sqm: total visible roof surface inside the final polygon.
- usable_area_sqm: subtract obstacles, steep sections over 35 degrees, and a 0.5m perimeter setback.

Return ONLY valid JSON, no markdown:
{
  "roof": {
    "roof_type": "${loc.roof_type ?? "complex"}",
    "estimated_total_area_sqm": <number>,
    "usable_area_sqm": <number>,
    "polygon": [{"x": <0-100>, "y": <0-100>}, ...]
  },
  "roof_faces": [
    {
      "name": "<short label>",
      "polygon": [{"x": <0-100>, "y": <0-100>}, ...],
      "tile_angle_deg": <-45 to 45>
    }
  ],
  "obstacles": [
    {
      "type": "<${obstacleTypes}>",
      "label": "<short label>",
      "bbox": {"x": <0-100>, "y": <0-100>, "w": <0-100>, "h": <0-100>},
      "shadow_buffer_m": <number>
    }
  ],
  "panel_orientation": "<portrait|landscape>",
  "tilt_assumed_deg": <10-15>,
  "grid_angle_deg": <dominant tile-row angle, -45 to 45>,
  "confidence": "<high|medium|low>",
  "engineer_notes": "<2-3 sentences describing traced roof edges, excluded areas, and recommended orientation>",
  "detection_notes": "<brief note about any uncertainty or hard-to-see edges>"
}`;

  const analyzeRes = await client.chat.completions.create({
    model: VISION_MODEL,
    ...(isReasoningModel
      ? { max_completion_tokens: 3200, reasoning_effort: "low" as const }
      : { max_tokens: 3200 }),
    response_format: { type: "json_object" },
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: analyzePrompt },
          { type: "image_url", image_url: { url: dataUrl, detail: "high" } },
        ],
      },
    ],
  });

  const ai = JSON.parse(analyzeRes.choices[0].message.content ?? "{}") as {
    roof?: RawRoof;
    roof_faces?: unknown;
    obstacles?: unknown;
    panel_orientation?: unknown;
    tilt_assumed_deg?: unknown;
    grid_angle_deg?: unknown;
    confidence?: unknown;
    engineer_notes?: unknown;
    detection_notes?: unknown;
  };

  const qualityFlags: string[] = [];
  const polygon = sanitizePolygon(ai.roof?.polygon, 4, qualityFlags, "roof_polygon");
  const estimatedTotalSqm = Math.max(0, finiteNumber(ai.roof?.estimated_total_area_sqm, 0));
  const usableAreaSqm = Math.max(0, finiteNumber(ai.roof?.usable_area_sqm, estimatedTotalSqm));
  const gridAngleDeg = clamp(ai.grid_angle_deg, -45, 45, roofAngleDeg(polygon));
  const obstacles = sanitizeObstacles(ai.obstacles, polygon, qualityFlags);
  const faces = sanitizeFaces(ai.roof_faces, gridAngleDeg, qualityFlags);
  const effectiveFaces: RoofFace[] = faces.length > 0
    ? faces
    : polygon.length >= 3
      ? [{ name: "roof", polygon, tile_angle_deg: gridAngleDeg }]
      : [];

  if (polygon.length === 0) qualityFlags.push("roof_polygon_rejected");
  if (estimatedTotalSqm <= 0) qualityFlags.push("missing_total_area");
  if (usableAreaSqm <= 0 && estimatedTotalSqm > 0) qualityFlags.push("missing_usable_area");

  const orientation: "portrait" | "landscape" =
    ai.panel_orientation === "landscape" ? "landscape" : "portrait";
  const panels = packPanelsMultiFace(
    effectiveFaces,
    polygon,
    obstacles,
    usableAreaSqm,
    orientation,
    imageAspect
  );
  const panelCount = panels.length;
  const systemKwp = Math.round(panelCount * (FIXED_MODULE.wattage / 1000) * 100) / 100;
  const annualKwh = Math.round(systemKwp * 4.5 * 365 * 0.85 * 10) / 10;
  const confidence = confidenceWithFlags(ai.confidence, qualityFlags);
  const notes = detectionNotes(ai.detection_notes ?? ai.engineer_notes, qualityFlags);

  return NextResponse.json({
    roof: {
      roof_type: typeof ai.roof?.roof_type === "string" ? ai.roof.roof_type : loc.roof_type ?? "unknown",
      estimated_total_area_sqm: estimatedTotalSqm,
      usable_area_sqm: usableAreaSqm,
      polygon,
    },
    roof_faces: effectiveFaces,
    obstacles,
    panels,
    panel_count: panelCount,
    panel_orientation: orientation,
    system_capacity_kwp: systemKwp,
    annual_yield_kwh: annualKwh,
    tilt_assumed_deg: clamp(ai.tilt_assumed_deg, 10, 15, 12),
    azimuth_deg: 180,
    grid_angle_deg: gridAngleDeg,
    confidence,
    engineer_notes: typeof ai.engineer_notes === "string" ? ai.engineer_notes : "",
    quality_flags: qualityFlags,
    detection_notes: notes,
  });
}

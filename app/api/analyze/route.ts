import OpenAI from "openai";
import { NextRequest, NextResponse } from "next/server";
import type { Point, Obstacle } from "@/components/RoofCanvas";
import { packPanels } from "@/lib/geometry";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get("image") as File | null;
  if (!file) return NextResponse.json({ error: "No image provided" }, { status: 400 });

  // retry=true means a previous detection was wrong — apply stricter prompt additions
  const isRetry = formData.get("retry") === "true";

  const bytes = await file.arrayBuffer();
  const base64 = Buffer.from(bytes).toString("base64");
  const mediaType = file.type || "image/jpeg";
  const dataUrl = `data:${mediaType};base64,${base64}`;

  const retryWarning = isRetry
    ? `\nIMPORTANT — RETRY MODE: The previous detection was incorrect. Be significantly stricter this time. You must follow ONLY the sloped tile/metal roof surface. Exclude all flat ground, courtyards, balconies, adjacent roofs, and water tank platforms, even if they appear inside the bounding box.\n`
    : "";

  // ── STEP 1: Material-first roof location ──────────────────────────────────
  const locatePrompt = `You are analysing an aerial/drone image to identify the PRIMARY rooftop for solar panel assessment.${retryWarning}

IDENTIFY THE ROOF BY MATERIAL TEXTURE:
✅ ACCEPT — these surfaces are roofs:
  - Corrugated/ribbed metal sheeting: parallel ridged lines running in one direction, uniform silver/grey/dark
  - Clay or concrete roof tiles: overlapping rows of curved or flat tiles (terracotta/brown/grey), visible tile joints
  - Asphalt shingles: overlapping granular rows, dark
  - Flat concrete membrane: smooth uniform slab, light grey/cream, bounded by visible parapet walls
  All of the above sit RAISED above walls. They have visible slope or pitched surfaces.

❌ REJECT — these are NOT roofs (exclude even if adjacent to the roof):
  - Ground-level roads, driveways, pavements: flat, at street level, may have vehicles or lane markings
  - Courtyards, inner patios, open-air corridors: flat paved areas between or inside buildings
  - Balconies, terraces, roof terraces used as living space: flat horizontal slabs, may have railings
  - Water tank platforms: flat concrete pads at ground or mid-level holding cylindrical tanks
  - Glass/polycarbonate canopies or skylights: transparent or semi-transparent covers
  - Grass, soil, vegetation, trees
  - Vertical walls of buildings
  - Sky and clouds

EXACT BOUNDARY RULES for the bounding box:
  - BOTTOM boundary (y_max): the GUTTER LINE — the lowest edge of the sloped roof surface where it meets the fascia board or gutter channel. Do NOT extend below this into walls or ground.
  - TOP boundary (y_min): the RIDGE LINE — the highest point where two roof slopes meet.
  - LEFT/RIGHT boundaries (x_min/x_max): the GABLE ENDS or EAVE ENDS — the outermost edge of the roof overhang, not the wall below it.

ONE ROOF ONLY:
  - If multiple separate buildings are visible, pick ONLY the largest, most complete, most centrally-positioned one.
  - Do NOT merge multiple adjacent buildings' roofs into one bounding box.
  - Neighbouring rooftops that share a wall are still separate roofs — pick only one.

COVERAGE CHECK:
  - If the identifiable roof material covers less than 15% of the image area, set low_coverage: true.

Respond ONLY with valid JSON:
{
  "material": "<corrugated_metal|clay_tiles|concrete_tiles|asphalt_shingles|flat_membrane|unknown>",
  "colour": "<describe roof colour>",
  "texture_description": "<describe repeating texture pattern, e.g. 'parallel corrugations running NW–SE'>",
  "roof_type": "<flat|pitched|complex>",
  "x_min": <left gable/eave edge as % of image width, 0–100>,
  "y_min": <ridge line as % of image height, 0–100>,
  "x_max": <right gable/eave edge as % of image width, 0–100>,
  "y_max": <gutter line as % of image height, 0–100>,
  "low_coverage": <true|false>,
  "rejection_notes": "<explicitly list what you excluded and at what image % position, e.g. 'excluded courtyard at y>75%, excluded adjacent roof at x<20%'>"
}`;

  const locateRes = await client.chat.completions.create({
    model: "gpt-4o",
    max_tokens: 700,
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
    material: string;
    colour: string;
    texture_description: string;
    roof_type: string;
    x_min: number; y_min: number;
    x_max: number; y_max: number;
    low_coverage: boolean;
    rejection_notes: string;
  };

  if (loc.low_coverage) {
    return NextResponse.json({
      roof: { roof_type: "unknown", estimated_total_area_sqm: 0, usable_area_sqm: 0, polygon: [] },
      obstacles: [], panels: [], panel_count: 0, panel_orientation: "portrait",
      system_capacity_kwp: 0, annual_yield_kwh: 0, tilt_assumed_deg: 10, azimuth_deg: 180,
      confidence: "low",
      engineer_notes: "Roof surface covers less than 15% of the image. Please re-upload a closer aerial shot with the target rooftop filling most of the frame.",
    });
  }

  // ── STEP 2: Strict polygon tracing + obstacle detection ───────────────────
  const analyzePrompt = `You are an expert solar PV layout engineer for Malaysia.${retryWarning}

The target rooftop has been identified:
  Material: ${loc.material} (${loc.colour})
  Texture: ${loc.texture_description}
  Roof type: ${loc.roof_type}
  Bounding box (gutter→ridge, gable→gable): x ${loc.x_min}%→${loc.x_max}%, y ${loc.y_min}%→${loc.y_max}%
  Already excluded: ${loc.rejection_notes}

COORDINATE SYSTEM:
  - x=0 = LEFT edge, x=100 = RIGHT edge of the image
  - y=0 = TOP edge, y=100 = BOTTOM edge
  - All values are % of image dimensions

━━━ TASK 1: TRACE THE ROOF POLYGON ━━━
Draw 8–16 clockwise points that follow EXACTLY the physical edges of the ${loc.material} surface.

Boundary rules — each edge of the polygon must follow a specific roof feature:
  • BOTTOM edge points → place on the GUTTER LINE (the lowest edge of the sloped roof, where the tile/metal ends before the fascia or gutter channel). Do NOT place any point below the gutter line into walls, ground, or driveway.
  • TOP edge points → place on the RIDGE LINE (the apex where two slopes meet).
  • LEFT/RIGHT edge points → place on the GABLE END or EAVE OVERHANG edge.
  • For hipped roofs: follow each hip rafter line from ridge to corner.
  • For complex roofs: trace each slope section separately; join at valleys and ridges.

What to EXCLUDE from the polygon interior (even if inside the bounding box):
  ✗ Flat courtyard, patio, or inner open space — these are horizontal ground-level areas, not sloped roofs
  ✗ Water tank platforms — raised concrete pads holding tanks; exclude the tank and its base
  ✗ Glass skylights or transparent canopy sections — not a solar-compatible surface
  ✗ Any area belonging to an adjacent or neighbouring building's roof
  ✗ Balconies or terraces with railings

Use a CONCAVE polygon if needed — you may draw inward dents to exclude flat internal courtyards from a complex roof.

━━━ TASK 2: DETECT OBSTACLES ━━━
On the roof surface only — AC units, water tanks, vents, chimneys, skylights, antennas, satellite dishes.
  • Tight bbox around each object
  • shadow_buffer_m: 0 for flush/low-profile, 1–3 for tall objects casting shadows

━━━ TASK 3: ESTIMATE AREAS ━━━
  • estimated_total_area_sqm: total visible sloped roof surface
  • usable_area_sqm: subtract obstacles, steep sections >35°, and a 0.5m perimeter setback

Return ONLY valid JSON, no markdown:
{
  "roof": {
    "roof_type": "${loc.roof_type}",
    "estimated_total_area_sqm": <number>,
    "usable_area_sqm": <number>,
    "polygon": [{"x": <0–100>, "y": <0–100>}, ...]
  },
  "obstacles": [
    {
      "type": "<water_tank|ac_unit|vent|chimney|parapet|skylight|antenna|other>",
      "label": "<short label>",
      "bbox": {"x": <0–100>, "y": <0–100>, "w": <0–100>, "h": <0–100>},
      "shadow_buffer_m": <number>
    }
  ],
  "panel_orientation": "<portrait|landscape>",
  "tilt_assumed_deg": <10–15 for Malaysia>,
  "confidence": "<high|medium|low>",
  "engineer_notes": "<2–3 sentences: which roof edge features were traced, what areas were excluded from the polygon, recommended orientation>"
}`;

  const analyzeRes = await client.chat.completions.create({
    model: "gpt-4o",
    max_tokens: 2048,
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

  const ai = JSON.parse(analyzeRes.choices[0].message.content ?? "{}");

  const polygon: Point[] = ai.roof?.polygon ?? [];
  const obstacles: Obstacle[] = ai.obstacles ?? [];
  const usableAreaSqm: number = ai.roof?.usable_area_sqm ?? 0;
  const orientation: "portrait" | "landscape" =
    ai.panel_orientation === "landscape" ? "landscape" : "portrait";

  const panels = packPanels(polygon, obstacles, usableAreaSqm, orientation);
  const panelCount = panels.length;
  const systemKwp = Math.round(panelCount * 0.620 * 100) / 100;
  const annualKwh = Math.round(systemKwp * 4.5 * 365 * 0.85 * 10) / 10;

  return NextResponse.json({
    roof: ai.roof ?? { roof_type: "unknown", estimated_total_area_sqm: 0, usable_area_sqm: 0, polygon: [] },
    obstacles,
    panels,
    panel_count: panelCount,
    panel_orientation: orientation,
    system_capacity_kwp: systemKwp,
    annual_yield_kwh: annualKwh,
    tilt_assumed_deg: ai.tilt_assumed_deg ?? 12,
    azimuth_deg: 180,
    confidence: ai.confidence ?? "medium",
    engineer_notes: ai.engineer_notes ?? "",
  });
}

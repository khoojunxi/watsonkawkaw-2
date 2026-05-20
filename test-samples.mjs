// Run: node test-samples.mjs
// Tests all 5 sample rooftop images against the running dev server at localhost:3000

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLES_DIR = path.join(__dirname, "..", "rooftop picture");
const API_URL = process.env.ANALYZE_API_URL || "http://localhost:3000/api/analyze";
const VALID_OBSTACLE_TYPES = new Set([
  "water_tank",
  "ac_unit",
  "vent_pipe",
  "chimney",
  "skylight",
  "antenna",
  "satellite_dish",
  "parapet",
  "roof_hatch",
  "existing_solar_panel",
  "cable_tray",
  "tree_shade",
  "other",
]);

const samples = [1, 2, 3, 4, 5].map((n) => ({
  name: `Sample rooftop - ${n}.jpeg`,
  path: path.join(SAMPLES_DIR, `Sample rooftop - ${n}.jpeg`),
}));

function isFinitePct(value) {
  return Number.isFinite(value) && value >= 0 && value <= 100;
}

function polygonArea(pts) {
  let area = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    area += (pts[j].x + pts[i].x) * (pts[j].y - pts[i].y);
  }
  return Math.abs(area) / 2;
}

function validateResult(data) {
  const failures = [];
  const roof = data?.roof ?? {};
  const polygon = Array.isArray(roof.polygon) ? roof.polygon : [];
  const obstacles = Array.isArray(data?.obstacles) ? data.obstacles : [];

  if (polygon.length < 4) failures.push(`roof polygon has ${polygon.length} points`);
  polygon.forEach((p, idx) => {
    if (!isFinitePct(p?.x) || !isFinitePct(p?.y)) {
      failures.push(`roof polygon point ${idx} is outside 0-100`);
    }
  });
  if (polygon.length >= 4 && polygonArea(polygon) <= 0) failures.push("roof polygon area is zero");

  if (!Number.isFinite(roof.estimated_total_area_sqm) || roof.estimated_total_area_sqm <= 0) {
    failures.push("total roof area is missing or non-positive");
  }
  if (!Number.isFinite(roof.usable_area_sqm) || roof.usable_area_sqm < 0) {
    failures.push("usable roof area is missing or negative");
  }

  obstacles.forEach((o, idx) => {
    if (!VALID_OBSTACLE_TYPES.has(o?.type)) failures.push(`obstacle ${idx} has invalid type ${o?.type}`);
    const b = o?.bbox ?? {};
    if (![b.x, b.y, b.w, b.h].every(Number.isFinite)) {
      failures.push(`obstacle ${idx} bbox has non-finite values`);
      return;
    }
    if (b.x < 0 || b.y < 0 || b.w <= 0 || b.h <= 0 || b.x + b.w > 100 || b.y + b.h > 100) {
      failures.push(`obstacle ${idx} bbox is outside image bounds`);
    }
  });

  if (!Array.isArray(data?.quality_flags)) failures.push("quality_flags is not an array");
  if (typeof data?.detection_notes !== "string") failures.push("detection_notes is not a string");

  return failures;
}

async function testImage(sample) {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`Testing: ${sample.name}`);
  console.log("─".repeat(60));

  if (!fs.existsSync(sample.path)) {
    console.log("  ❌ File not found:", sample.path);
    return false;
  }

  const fileBuffer = fs.readFileSync(sample.path);
  const blob = new Blob([fileBuffer], { type: "image/jpeg" });
  const form = new FormData();
  form.append("image", blob, sample.name);
  form.append("image_aspect", "1");

  const start = Date.now();
  let res;
  try {
    res = await fetch(API_URL, { method: "POST", body: form });
  } catch (e) {
    console.log("  ❌ Network error — is the dev server running?", e.message);
    return false;
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  if (!res.ok) {
    console.log(`  ❌ HTTP ${res.status} after ${elapsed}s`);
    const text = await res.text();
    console.log("  Body:", text.slice(0, 200));
    return false;
  }

  let data;
  try {
    data = await res.json();
  } catch (e) {
    console.log(`  ❌ Invalid JSON after ${elapsed}s:`, e.message);
    return false;
  }
  const roof = data.roof ?? {};
  const obs = data.obstacles ?? [];
  const panels = data.panels ?? [];
  const validationFailures = validateResult(data);

  console.log(`  ✅ Done in ${elapsed}s`);
  console.log(`  Roof type    : ${roof.roof_type ?? "?"}`);
  console.log(`  Total area   : ${roof.estimated_total_area_sqm ?? "?"} m²`);
  console.log(`  Usable area  : ${roof.usable_area_sqm ?? "?"} m²`);
  console.log(`  Confidence   : ${data.confidence ?? "?"}`);
  console.log(`  Obstacles    : ${obs.length} → ${obs.map((o) => o.label).join(", ") || "none"}`);
  console.log(`  Panels       : ${data.panel_count ?? panels.length}`);
  console.log(`  Capacity     : ${data.system_capacity_kwp ?? "?"} kWp`);
  console.log(`  Annual yield : ${data.annual_yield_kwh ?? "?"} kWh`);
  console.log(`  Quality flags: ${data.quality_flags?.join(", ") || "none"}`);

  if (roof.polygon?.length) {
    const xs = roof.polygon.map((p) => p.x);
    const ys = roof.polygon.map((p) => p.y);
    console.log(
      `  Polygon bbox : x ${Math.min(...xs).toFixed(1)}–${Math.max(...xs).toFixed(1)}%,` +
      ` y ${Math.min(...ys).toFixed(1)}–${Math.max(...ys).toFixed(1)}%`
    );
  } else {
    console.log("  Polygon      : ⚠️  empty");
  }

  console.log(`  Notes        : ${data.engineer_notes ?? "(none)"}`);
  if (data.detection_notes) console.log(`  Detection    : ${data.detection_notes}`);
  if (validationFailures.length > 0) {
    console.log("  ❌ Validation failures:");
    validationFailures.forEach((failure) => console.log(`     - ${failure}`));
    return false;
  }
  console.log("  ✅ Validation passed");
  return true;
}

console.log("SolarFit AI — Sample Image Test");
console.log(`API: ${API_URL}`);
console.log(`Samples dir: ${SAMPLES_DIR}`);

let failed = 0;
for (const s of samples) {
  const ok = await testImage(s);
  if (!ok) failed += 1;
}

console.log(`\n${"─".repeat(60)}`);
console.log(failed === 0 ? "Done. All samples passed." : `Done. ${failed} sample(s) failed.`);
if (failed > 0) process.exitCode = 1;

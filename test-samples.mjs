// Run: node test-samples.mjs
// Tests all 5 sample rooftop images against the running dev server at localhost:3000

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLES_DIR = path.join(__dirname, "..", "rooftop picture");
const API_URL = "http://localhost:3000/api/analyze";

const samples = [1, 2, 3, 4, 5].map((n) => ({
  name: `Sample rooftop - ${n}.jpeg`,
  path: path.join(SAMPLES_DIR, `Sample rooftop - ${n}.jpeg`),
}));

async function testImage(sample) {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`Testing: ${sample.name}`);
  console.log("─".repeat(60));

  if (!fs.existsSync(sample.path)) {
    console.log("  ❌ File not found:", sample.path);
    return;
  }

  const fileBuffer = fs.readFileSync(sample.path);
  const blob = new Blob([fileBuffer], { type: "image/jpeg" });
  const form = new FormData();
  form.append("image", blob, sample.name);

  const start = Date.now();
  let res;
  try {
    res = await fetch(API_URL, { method: "POST", body: form });
  } catch (e) {
    console.log("  ❌ Network error — is the dev server running?", e.message);
    return;
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  if (!res.ok) {
    console.log(`  ❌ HTTP ${res.status} after ${elapsed}s`);
    const text = await res.text();
    console.log("  Body:", text.slice(0, 200));
    return;
  }

  const data = await res.json();
  const roof = data.roof ?? {};
  const obs = data.obstacles ?? [];
  const panels = data.panels ?? [];

  console.log(`  ✅ Done in ${elapsed}s`);
  console.log(`  Roof type    : ${roof.roof_type ?? "?"}`);
  console.log(`  Total area   : ${roof.estimated_total_area_sqm ?? "?"} m²`);
  console.log(`  Usable area  : ${roof.usable_area_sqm ?? "?"} m²`);
  console.log(`  Confidence   : ${data.confidence ?? "?"}`);
  console.log(`  Obstacles    : ${obs.length} → ${obs.map((o) => o.label).join(", ") || "none"}`);
  console.log(`  Panels       : ${data.panel_count ?? panels.length}`);
  console.log(`  Capacity     : ${data.system_capacity_kwp ?? "?"} kWp`);
  console.log(`  Annual yield : ${data.annual_yield_kwh ?? "?"} kWh`);

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
}

console.log("SolarFit AI — Sample Image Test");
console.log(`API: ${API_URL}`);
console.log(`Samples dir: ${SAMPLES_DIR}`);

for (const s of samples) {
  await testImage(s);
}

console.log(`\n${"─".repeat(60)}`);
console.log("Done.");

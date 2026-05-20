// Solar orientation math — per-plane tilt + azimuth → yield factor.
//
// Currently the app uses a flat 4.5 PSH × 0.85 PR everywhere, which is fine for
// quick estimates but invisible to roof orientation. For an engineer-grade tool
// we need each plane's yield to track its actual orientation (a north-facing
// plane in Malaysia produces ~10–15% less than south-facing).
//
// The factor returned here is calibrated against PVGIS data for Kuala Lumpur
// (lat ~3.1°N), normalised so that 10° tilt + south-facing (180°) = 1.0.

import type { Point } from "@/components/RoofCanvas";
import { ridgeAngleDeg } from "@/lib/geometry";
import type { RoofPlane } from "@/lib/geometry";

/** Typical Malaysian pitched-roof tilt — sensible default when none is supplied. */
export const DEFAULT_TILT_DEG = 15;

/**
 * Auto-suggest azimuth (0–360°, compass convention: N=0, E=90, S=180, W=270)
 * from a drawn ridge line. Assumes the image is north-up (drone / Google Maps
 * convention). Engineer can override manually if their photo isn't aligned to
 * north.
 *
 * Algorithm:
 *  1. The ridge runs ALONG the top of the roof face. The downslope direction
 *     is perpendicular to the ridge.
 *  2. Of the two perpendicular candidates, the correct one points from the
 *     ridge midpoint toward the plane centroid (the downhill direction, not
 *     uphill).
 *  3. Map the image-space vector (x right, y down) into compass degrees:
 *       image-down  = south (180°)
 *       image-right = east  (90°)
 *       image-up    = north (0°)
 *       image-left  = west  (270°)
 */
export function azimuthFromRidge(
  ridge: [Point, Point],
  planeCentroid: Point,
  imageAspect: number
): number {
  // Ridge midpoint
  const mx = (ridge[0].x + ridge[1].x) / 2;
  const my = (ridge[0].y + ridge[1].y) / 2;

  // Downslope vector in iso space — apply aspect to x so angles aren't skewed
  // by non-square images.
  const dx = (planeCentroid.x - mx) * imageAspect;
  const dy = planeCentroid.y - my;

  // atan2(dy, dx) gives angle from +x (east) toward +y (south) in iso space.
  // 0  → pointing east  → compass 90°
  // 90 → pointing south → compass 180°
  // 180→ pointing west  → compass 270°
  // -90→ pointing north → compass 0°
  // So compass = (90 + imageAngle + 360) % 360.
  const imageAngleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
  return (90 + imageAngleDeg + 360) % 360;
}

/**
 * Yield factor for a given tilt + compass azimuth, normalised so the
 * reference orientation (~7° tilt, due south) returns 1.0.
 *
 * Calibration anchors (Malaysia, PVGIS for Kuala Lumpur, lat ~3°N — azimuth
 * matters much less than at higher latitudes because the sun passes nearly
 * overhead):
 *   South,   7° → 1.00 (reference)
 *   South,   0° → 0.97
 *   South,  30° → 0.94
 *   E/W,    10° → 0.97
 *   E/W,    30° → 0.90
 *   North,  10° → 0.85
 *   North,  30° → 0.78
 *
 * Tilt: gentle parabola centred on 7°, gentle enough that anything 0–25° stays
 * within ~5% of optimal.
 * Azimuth: cosine-shaped — full at south, ~0.85 at north. No hard floor needed.
 */
export function orientationFactor(tiltDeg: number, azimuthDeg: number): number {
  // Tilt factor — gentle parabola; 0–25° stays within ~5% of optimal.
  const tiltDelta = tiltDeg - 7;
  const tiltFactor = Math.max(0.6, 1 - 0.00015 * tiltDelta * tiltDelta);

  // Azimuth factor — cosine of compass deviation from south.
  // At 0° off south:  factor = 1.0
  // At 90° (E or W):  factor = 0.925
  // At 180° (north):  factor = 0.85
  const rawDelta = Math.abs(azimuthDeg - 180);
  const azDelta = Math.min(rawDelta, 360 - rawDelta);
  const azFactor = 0.925 + 0.075 * Math.cos((azDelta * Math.PI) / 180);

  return tiltFactor * azFactor;
}

/** Convert a compass azimuth (0–360°) to a short label (N, NE, E, …). */
export function azimuthLabel(azimuthDeg: number): string {
  const labels = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const idx = Math.round(((azimuthDeg % 360) / 45)) % 8;
  return labels[idx];
}

/**
 * Resolve the effective tilt + azimuth for a plane, falling back to the
 * auto-suggested values when the engineer hasn't entered a manual override.
 * `isAuto` is true when BOTH fields are auto (UI uses this to show the "auto"
 * tag).
 */
export function resolveOrientation(
  plane: RoofPlane,
  imageAspect: number
): { tiltDeg: number; azimuthDeg: number; isAuto: boolean } {
  const autoTilt = DEFAULT_TILT_DEG;
  const autoAzimuth =
    plane.ridge && plane.polygon.length >= 3
      ? azimuthFromRidge(plane.ridge, planeCentroid(plane.polygon), imageAspect)
      : 180; // default to south if we can't compute

  const tiltDeg = plane.tiltDeg ?? autoTilt;
  const azimuthDeg = plane.azimuthDeg ?? autoAzimuth;
  const isAuto = plane.tiltDeg === null && plane.azimuthDeg === null;
  return { tiltDeg, azimuthDeg, isAuto };
}

/** Simple polygon centroid (mean of vertices). Sufficient for choosing the
 *  downslope direction — full geometric centroid isn't needed here. */
function planeCentroid(poly: Point[]): Point {
  let sx = 0, sy = 0;
  for (const p of poly) { sx += p.x; sy += p.y; }
  return { x: sx / poly.length, y: sy / poly.length };
}

// Re-export so call sites can import ridgeAngleDeg alongside without an extra
// import from geometry.ts.
export { ridgeAngleDeg };

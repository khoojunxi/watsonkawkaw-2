import type { Obstacle, Panel } from "@/components/RoofCanvas";

/**
 * Shading yield model — ranks packed panels by how clear they are of
 * shade-casting obstacles, so the active set is the best-exposed positions
 * rather than the first ones the grid sweep produced.
 *
 * Coordinates are percentages 0–100; an `imageAspect` (image W/H) de-skews x
 * so clearance distances stay accurate on non-square images.
 */

/** Shortest gap between two axis-aligned rectangles (0 when they overlap). */
function rectGap(
  ax: number, ay: number, aw: number, ah: number,
  bx: number, by: number, bw: number, bh: number
): number {
  const dx = Math.max(ax - (bx + bw), bx - (ax + aw), 0);
  const dy = Math.max(ay - (by + bh), by - (ay + ah), 0);
  return Math.hypot(dx, dy);
}

const SHADE_FLOOR = 0.55; // worst-case yield for a panel hard against an obstacle

/**
 * Relative yield from shading (0–1). For each shade-casting obstacle (those with
 * shadow_buffer_m > 0), the panel's clearance in metres is ramped from a floor
 * (touching) up to 1.0 once it clears max(shadow_buffer_m, 3) m. The worst
 * obstacle wins. Open-roof panels score 1.0; panels hugging a vent/tank ≈ 0.6.
 */
export function shadeFactor(
  panel: Panel,
  obstacles: Obstacle[],
  mPerIso: number,
  imageAspect: number
): number {
  if (mPerIso <= 0) return 1;
  const px = panel.x * imageAspect;
  const pw = panel.w * imageAspect;

  let factor = 1;
  for (const o of obstacles) {
    if (o.shadow_buffer_m <= 0) continue;
    const ox = o.bbox.x * imageAspect;
    const ow = o.bbox.w * imageAspect;
    const gapM = rectGap(px, panel.y, pw, panel.h, ox, o.bbox.y, ow, o.bbox.h) * mPerIso;
    const rampM = Math.max(o.shadow_buffer_m, 3);
    const f = SHADE_FLOOR + (1 - SHADE_FLOOR) * Math.min(1, gapM / rampM);
    if (f < factor) factor = f;
  }
  return factor;
}

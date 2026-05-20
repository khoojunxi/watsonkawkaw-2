"use client";

// Client-side edge detection — runs Sobel on a downscaled copy of the roof
// image to find high-contrast lines (gutter, fascia, ridge, hip lines). The
// resulting edge map is used for two things:
//
//   1. Visual overlay (faint cyan dots) so the user can see where the real
//      edges are while drawing.
//   2. Magnetic snap — when a user clicks or drags a vertex near a detected
//      edge, the vertex jumps to the nearest edge pixel.
//
// Everything is free, deterministic, and runs in ~50–150 ms per image. No
// API calls.

import type { Point } from "@/components/RoofCanvas";

export interface EdgeData {
  /** 1 if pixel is on an edge, 0 otherwise. */
  data: Uint8Array;
  w: number;
  h: number;
}

const clampPct = (v: number) => Math.max(0, Math.min(100, v));

/**
 * Load an image and run Sobel edge detection. `maxDim` caps the working
 * resolution so detection stays fast on big drone photos.
 */
/** 5×5 box blur — smooths out fine roof-tile texture so Sobel doesn't
 *  flag every tile seam as an edge. */
function boxBlur5(src: Float32Array, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h);
  const r = 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      let count = 0;
      for (let dy = -r; dy <= r; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -r; dx <= r; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          sum += src[yy * w + xx];
          count++;
        }
      }
      out[y * w + x] = sum / count;
    }
  }
  return out;
}

/**
 * Drop edge pixels that belong to short connected components — those are
 * almost always tile-pattern noise. Long components (gutters, ridges, hip
 * lines) are what we actually want.
 */
function keepLongRuns(src: Uint8Array, w: number, h: number, minLen = 24): Uint8Array {
  const out = new Uint8Array(w * h);
  const visited = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  const total = w * h;
  for (let start = 0; start < total; start++) {
    if (!src[start] || visited[start]) continue;
    // BFS-collect this connected component (8-connectivity).
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    visited[start] = 1;
    const component: number[] = [];
    while (head < tail) {
      const idx = queue[head++];
      component.push(idx);
      const x = idx % w;
      const y = (idx - x) / w;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const nIdx = yy * w + xx;
          if (src[nIdx] && !visited[nIdx]) {
            visited[nIdx] = 1;
            queue[tail++] = nIdx;
          }
        }
      }
    }
    if (component.length >= minLen) {
      for (const idx of component) out[idx] = 1;
    }
  }
  return out;
}

export function detectEdges(
  imageUrl: string,
  maxDim = 720,
  threshold = 90
): Promise<EdgeData> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.max(1, Math.round(img.naturalWidth * scale));
        const h = Math.max(1, Math.round(img.naturalHeight * scale));

        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("2D context unavailable"));
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        const rgba = ctx.getImageData(0, 0, w, h).data;

        // Grayscale (luminance approximation).
        const grayRaw = new Float32Array(w * h);
        for (let i = 0; i < w * h; i++) {
          grayRaw[i] = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
        }

        // Box blur the grayscale image first — kills fine tile texture so
        // Sobel only fires on the *real* long lines (gutter, ridge, hip).
        const gray = boxBlur5(grayRaw, w, h);

        // Sobel — compute gradient magnitude on the blurred image.
        const raw = new Uint8Array(w * h);
        for (let y = 1; y < h - 1; y++) {
          for (let x = 1; x < w - 1; x++) {
            const idx = y * w + x;
            const gx =
              -gray[idx - w - 1] + gray[idx - w + 1] +
              -2 * gray[idx - 1] + 2 * gray[idx + 1] +
              -gray[idx + w - 1] + gray[idx + w + 1];
            const gy =
              -gray[idx - w - 1] - 2 * gray[idx - w] - gray[idx - w + 1] +
              gray[idx + w - 1] + 2 * gray[idx + w] + gray[idx + w + 1];
            const mag = Math.sqrt(gx * gx + gy * gy);
            if (mag > threshold) raw[idx] = 1;
          }
        }

        // Drop short connected components — that's the residual tile noise.
        // Only long, continuous lines (gutters, ridges) survive.
        const data = keepLongRuns(raw, w, h, 24);

        resolve({ data, w, h });
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => reject(new Error("Failed to load image for edge detection"));
    img.src = imageUrl;
  });
}

/**
 * Find the edge pixel nearest to the given point (in 0–100 percentage space).
 * If no edge falls within `radiusPct` of the image's larger dimension, the
 * original point is returned unchanged — so clicking in open areas still works.
 */
export function snapToEdge(
  p: Point,
  edges: EdgeData | null,
  radiusPct = 2
): Point {
  if (!edges) return p;
  const cx = Math.round((p.x / 100) * edges.w);
  const cy = Math.round((p.y / 100) * edges.h);
  const r = Math.round((radiusPct / 100) * Math.max(edges.w, edges.h));

  let bestDistSq = r * r + 1;
  let bestX = -1;
  let bestY = -1;
  const xMin = Math.max(0, cx - r);
  const xMax = Math.min(edges.w - 1, cx + r);
  const yMin = Math.max(0, cy - r);
  const yMax = Math.min(edges.h - 1, cy + r);
  for (let y = yMin; y <= yMax; y++) {
    const dy = y - cy;
    const row = y * edges.w;
    for (let x = xMin; x <= xMax; x++) {
      if (!edges.data[row + x]) continue;
      const dx = x - cx;
      const d = dx * dx + dy * dy;
      if (d < bestDistSq) {
        bestDistSq = d;
        bestX = x;
        bestY = y;
      }
    }
  }

  if (bestX < 0) return p;
  return {
    x: clampPct((bestX / edges.w) * 100),
    y: clampPct((bestY / edges.h) * 100),
  };
}

/**
 * Render the edge map as a transparent PNG data URL (cyan strokes on
 * transparent background) so it can be overlaid on the photo as an
 * <image> element.
 */
export function edgesToDataUrl(edges: EdgeData): string {
  const canvas = document.createElement("canvas");
  canvas.width = edges.w;
  canvas.height = edges.h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  const imageData = ctx.createImageData(edges.w, edges.h);
  for (let i = 0; i < edges.w * edges.h; i++) {
    if (edges.data[i]) {
      // Bright cyan, fully opaque — reads clearly even under the coloured plane fills.
      imageData.data[i * 4] = 6;
      imageData.data[i * 4 + 1] = 230;
      imageData.data[i * 4 + 2] = 255;
      imageData.data[i * 4 + 3] = 255;
    }
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL("image/png");
}

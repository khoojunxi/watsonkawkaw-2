"use client";

// Client-side project persistence using IndexedDB. Stores everything needed
// to fully reconstruct a past project — original image blob, GPT/SAM result,
// manually-drawn planes, calibration, usage, computed financials.
//
// IndexedDB chosen over localStorage because drone photos are typically
// 2–5 MB each; localStorage's 5 MB total cap would only fit one project.

import type { Obstacle, Point } from "@/components/RoofCanvas";
import type { Calibration, RoofPlane } from "@/lib/geometry";

// ── Schema ────────────────────────────────────────────────────────────────

/** Stored shape of an `AnalysisResult` (kept loose to survive future GPT shape changes). */
export interface StoredAnalysisResult {
  roof: { roof_type: string; estimated_total_area_sqm: number; usable_area_sqm: number; polygon: Point[] };
  obstacles: Obstacle[];
  panel_orientation: string;
  tilt_assumed_deg: number;
  azimuth_deg: number;
  confidence: string;
  engineer_notes: string;
  quality_flags?: string[];
  detection_notes?: string;
}

export interface SavedProject {
  id: string;                  // UUID
  name: string;                // user-entered project name
  clientName: string;          // user-entered client name (may be empty)
  createdAt: number;
  updatedAt: number;

  /** Original uploaded image — stored as a Blob so we get full quality back. */
  imageBlob: Blob;
  imageType: string;           // MIME type for re-creating object URL
  imageAspect: number;

  // Step 2 — AI detection
  result: StoredAnalysisResult;
  editedPolygon: Point[] | null;
  editedObstacles: Obstacle[] | null;

  // Step 3 — manual planes
  planes: RoofPlane[];
  calibration: Calibration | null;

  // Step 4 — usage
  monthlyKwh: string;

  // Step 5 — flags
  maxFill: boolean;

  // Denormalised summary for the history list (avoids hydrating the whole
  // project just to render a card).
  summary: {
    activeSystemKwp: number;
    activeAnnualKwh: number;
    paybackYears: number | null;
    bill_coverage_percent: number | null;
  };
}

/** Lightweight metadata used by the history list (no blob, fast to fetch). */
export type ProjectListItem = Omit<SavedProject, "imageBlob"> & {
  thumbDataUrl: string | null;
};

// ── IndexedDB plumbing ────────────────────────────────────────────────────

const DB_NAME = "solarfit-ai";
const DB_VERSION = 1;
const STORE = "projects";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("updatedAt", "updatedAt", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Failed to open IndexedDB"));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    const req = fn(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
    tx.oncomplete = () => db.close();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
  });
}

// ── Public API ────────────────────────────────────────────────────────────

export function newProjectId(): string {
  // Simple UUID-ish — sufficient for client-side uniqueness.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function saveProject(p: SavedProject): Promise<void> {
  await withStore("readwrite", (store) => store.put(p));
}

export async function loadProject(id: string): Promise<SavedProject | null> {
  const r = await withStore<SavedProject | undefined>("readonly", (store) => store.get(id));
  return r ?? null;
}

export async function deleteProject(id: string): Promise<void> {
  await withStore("readwrite", (store) => store.delete(id));
}

/**
 * List all saved projects, most recently updated first. Image blob is
 * downgraded to a small JPEG data URL thumbnail to keep the list cheap.
 */
export async function listProjects(): Promise<ProjectListItem[]> {
  const all = await withStore<SavedProject[]>("readonly", (store) => store.getAll());
  all.sort((a, b) => b.updatedAt - a.updatedAt);
  return Promise.all(
    all.map(async (p) => {
      const { imageBlob, ...rest } = p;
      const thumbDataUrl = await blobToThumb(imageBlob, 240).catch(() => null);
      return { ...rest, thumbDataUrl };
    })
  );
}

/** Render a Blob image to a small data-URL thumbnail. */
async function blobToThumb(blob: Blob, maxSide: number): Promise<string> {
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("thumb load failed"));
      i.src = url;
    });
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d ctx");
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", 0.7);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Format a timestamp as "21 May 2026, 12:30". */
export function formatDate(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

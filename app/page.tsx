"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check, RotateCcw, Lightbulb, TrendingUp, Wallet,
  Droplets, Wind, Flame, SunDim, Radio, LayoutGrid,
  Plus, X, AlertTriangle, Target, MousePointer2, Ruler,
  Pencil, MoveUpRight, Trash2, ArrowLeft, Sparkles,
  SatelliteDish, DoorOpen, SquareActivity, Cable, Trees,
  FolderOpen, FileText, Printer, Save,
} from "lucide-react";
import RoofCanvas, { type BBox, type Obstacle, type Panel, type Point } from "@/components/RoofCanvas";
import RoofEditor from "@/components/RoofEditor";
import PlaneEditor, { type Tool } from "@/components/PlaneEditor";
import { tariffBill, energyRate, financialAnalysis, nemSizing } from "@/lib/tnb";
import {
  polygonArea, packPlanes, calibrationMPerIso, ridgeAngleDeg, planeColor,
  FIXED_MODULE, type RoofPlane, type Calibration,
} from "@/lib/geometry";
import { orientationFactor, resolveOrientation, azimuthLabel } from "@/lib/orientation";
import {
  saveProject, loadProject, newProjectId,
  type SavedProject,
} from "@/lib/storage";
import ProjectHistory from "@/components/ProjectHistory";
import Step6Report from "@/components/Step6Report";
import {
  loadMaskGrid, gridStats, bboxIoU,
  type MaskGrid, type GridStats,
} from "@/lib/mask";
import { shadeFactor } from "@/lib/solar";
import {
  getObstacleDefinition,
  normalizeObstacleType,
  OBSTACLE_CATALOG,
} from "@/lib/obstacles";

// ── Types ──────────────────────────────────────────────────────────────────
interface AnalysisResult {
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
type Step = 1 | 2 | 3 | 4 | 5 | 6;
type TnbBillMessage = { kind: "success" | "warning" | "error"; text: string };

interface TnbBillExtractResponse {
  monthly_kwh: number | null;
  confidence: "high" | "medium" | "low";
  notes?: string;
}

const OBSTACLE_ICONS: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  water_tank: Droplets, ac_unit: Wind, vent_pipe: Wind, vent: Wind,
  chimney: Flame, parapet: LayoutGrid, skylight: SunDim,
  antenna: Radio, satellite_dish: SatelliteDish,
  roof_hatch: DoorOpen, existing_solar_panel: SquareActivity,
  cable_tray: Cable, tree_shade: Trees, other: LayoutGrid,
};
const ADDABLE_OBSTACLE_TYPES = OBSTACLE_CATALOG;
const CONFIDENCE_COLOR: Record<string, string> = {
  high:"text-emerald-600 bg-emerald-50 border-emerald-200",
  medium:"text-amber-600 bg-amber-50 border-amber-200",
  low:"text-red-600 bg-red-50 border-red-200",
};

// ── Root component ─────────────────────────────────────────────────────────
export default function Home() {
  const [step, setStep] = useState<Step>(1);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [redetecting, setRedetecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [monthlyKwh, setMonthlyKwh] = useState("");
  const [tnbBillLoading, setTnbBillLoading] = useState(false);
  const [tnbBillMessage, setTnbBillMessage] = useState<TnbBillMessage | null>(null);

  const [editedPolygon, setEditedPolygon] = useState<Point[] | null>(null);
  const [editedObstacles, setEditedObstacles] = useState<Obstacle[] | null>(null);
  const [addObstacleMode, setAddObstacleMode] = useState(false);
  const [pendingBBox, setPendingBBox] = useState<BBox | null>(null);
  const [maxFill, setMaxFill] = useState(false);

  // SAM 2 segmentation state (Step 2 — precise roof outline + obstacle boxes)
  const [segmenting, setSegmenting] = useState(false);
  const [samReady, setSamReady] = useState(false);
  const [samError, setSamError] = useState<string | null>(null);

  const [imageAspect, setImageAspect] = useState(1);
  const [showConfirmReset, setShowConfirmReset] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const tnbBillInputRef = useRef<HTMLInputElement>(null);

  // Project metadata — entered in Step 1, persisted via IndexedDB.
  const [projectName, setProjectName] = useState("");
  const [clientName, setClientName] = useState("");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");

  // Manual roof-plane drawing state
  const [planes, setPlanes] = useState<RoofPlane[]>([]);
  const [calibration, setCalibration] = useState<Calibration | null>(null);
  const [selectedPlaneId, setSelectedPlaneId] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>("select");

  // Reset manual edits when a fresh AI result arrives — but only if there's no
  // loaded project. Loaded projects bring their own planes/edits via handleLoadProject.
  const skipResetOnce = useRef(false);
  useEffect(() => {
    if (skipResetOnce.current) { skipResetOnce.current = false; return; }
    setEditedPolygon(null);
    setEditedObstacles(null);
    setPlanes([]);
    setCalibration(null);
    setSelectedPlaneId(null);
    setTool("select");
  }, [result]);

  // Auto-save on entering Step 5 / Step 6. The ref guards against re-firing
  // on every render once we're already on that step.
  const lastSavedStepRef = useRef<number | null>(null);
  useEffect(() => {
    if (step < 5) { lastSavedStepRef.current = null; return; }
    if (lastSavedStepRef.current === step) return;
    if (!imageFile || !result) return;
    lastSavedStepRef.current = step;
    void persistProject();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, imageFile, result]);

  // ── Derived active state ─────────────────────────────────────────────────
  const activePolygon: Point[] = editedPolygon ?? result?.roof.polygon ?? [];
  const activeObstacles: Obstacle[] = editedObstacles ?? result?.obstacles ?? [];
  const isEdited = editedPolygon !== null || editedObstacles !== null;

  const origPolyArea = result ? polygonArea(result.roof.polygon) : 0;
  const mPerPctSq = origPolyArea > 0 ? result!.roof.estimated_total_area_sqm / origPolyArea : 1;
  const obsAreaSqm = (o: Obstacle) => o.bbox.w * o.bbox.h * mPerPctSq;

  // ── Manual-plane panel packing ───────────────────────────────────────────
  const calMPerIso = useMemo(
    () => (calibration ? calibrationMPerIso(calibration, imageAspect) : 0),
    [calibration, imageAspect]
  );
  const packed = useMemo(
    () => packPlanes(planes, calMPerIso, FIXED_MODULE, activeObstacles, imageAspect),
    [planes, calMPerIso, activeObstacles, imageAspect]
  );
  const packedById = useMemo(() => {
    const m = new Map(packed.map((r) => [r.planeId, r]));
    return m;
  }, [packed]);
  // Shade-aware ranking: score every packed panel by how clear it is of
  // shade-casting obstacles, then sort best-first so the active slice below
  // picks the best-exposed positions rather than the first swept ones.
  const allPanels: Panel[] = useMemo(() => {
    const scored = packed.flatMap((r) =>
      r.panels.map((panel, i) => ({
        panel,
        sweepIndex: i,
        score: shadeFactor(panel, activeObstacles, calMPerIso, imageAspect),
      }))
    );
    scored.sort((a, b) => b.score - a.score || a.sweepIndex - b.sweepIndex);
    return scored.map((s) => ({ ...s.panel, score: s.score }));
  }, [packed, activeObstacles, calMPerIso, imageAspect]);

  const roofCapacity = allPanels.length;
  const selectedPlane = planes.find((p) => p.id === selectedPlaneId) ?? null;
  const planesReady = !!calibration && planes.some((p) => p.ridge);

  // ── Usage / TNB bill / NEM 3.0 sizing ─────────────────────────────────────
  const consumptionKwh = parseFloat(monthlyKwh) || 0;
  const annualKwh = consumptionKwh * 12;
  const sizing = consumptionKwh > 0 ? nemSizing(annualKwh) : null;
  const estimatedBill = consumptionKwh > 0 ? tariffBill(consumptionKwh) : null;
  const isRoofConstrained = sizing ? roofCapacity < sizing.recommendedPanels : false;

  const smartLimit = (!maxFill && sizing) ? sizing.recommendedPanels : roofCapacity;
  const activePanels = allPanels.slice(0, smartLimit);
  const expansionPanels = allPanels.slice(smartLimit);

  const activePanelCount = activePanels.length;
  const activeSystemKwp = Math.round(activePanelCount * (FIXED_MODULE.wattage / 1000) * 100) / 100;

  // Weighted orientation factor — each plane's PVGIS-calibrated factor weighted
  // by its panel count. A south-facing 10° plane scores 1.00; a north-facing
  // 30° plane scores ~0.78. With no panels packed yet, default to 1.0.
  const weightedFactor = useMemo(() => {
    if (allPanels.length === 0) return 1;
    let sum = 0;
    let n = 0;
    packed.forEach((pr) => {
      const plane = planes.find((p) => p.id === pr.planeId);
      if (!plane) return;
      const { tiltDeg, azimuthDeg } = resolveOrientation(plane, imageAspect);
      const f = orientationFactor(tiltDeg, azimuthDeg);
      sum += pr.panels.length * f;
      n += pr.panels.length;
    });
    return n > 0 ? sum / n : 1;
  }, [packed, planes, imageAspect, allPanels.length]);

  const activeAnnualKwh = Math.round(activeSystemKwp * 4.5 * 365 * 0.85 * weightedFactor * 10) / 10;

  const financial = result && consumptionKwh > 0
    ? financialAnalysis(activeSystemKwp, activeAnnualKwh, consumptionKwh)
    : null;

  // ── Helpers ───────────────────────────────────────────────────────────────
  function handleFile(file: File) {
    const url = URL.createObjectURL(file);
    setImageFile(file); setImageUrl(url);
    setResult(null); setError(null);
    setTnbBillMessage(null);
    const img = new Image();
    img.onload = () => setImageAspect(img.naturalWidth / img.naturalHeight);
    img.src = url;
  }
  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file?.type.startsWith("image/")) handleFile(file);
  }
  async function callAnalyzeApi(retry: boolean) {
    if (!imageFile) return;
    const form = new FormData();
    form.append("image", imageFile);
    form.append("image_aspect", String(imageAspect));
    if (retry) form.append("retry", "true");
    const res = await fetch("/api/analyze", { method:"POST", body:form });
    if (!res.ok) throw new Error("Analysis failed");
    return res.json();
  }
  async function callSegmentApi(
    file: File
  ): Promise<{ id: number; dataUrl: string }[] | null> {
    try {
      const form = new FormData();
      form.append("image", file);
      const res = await fetch("/api/segment", { method: "POST", body: form });
      if (!res.ok) {
        let detail = `SAM 2 request failed (HTTP ${res.status}).`;
        try {
          const e = await res.json();
          if (e?.error) detail = String(e.error);
        } catch { /* keep generic message */ }
        console.error("SAM segmentation failed:", detail);
        setSamError(detail);
        return null;
      }
      const data = await res.json();
      const masks = Array.isArray(data?.masks) ? data.masks : [];
      if (masks.length === 0) {
        setSamError("SAM 2 returned no masks for this image.");
        return null;
      }
      setSamError(null);
      return masks;
    } catch (e) {
      console.error("SAM segmentation failed", e);
      setSamError("Could not reach the SAM 2 segmentation service.");
      return null;
    }
  }
  // Crop the original image to the given full-image bbox (with padding) and
  // return a JPEG blob ready to upload to /api/segment. Cropping BEFORE SAM
  // sees the photo eliminates the "which of these 30 masks is the roof?"
  // ambiguity that wrecked every previous selection heuristic.
  async function cropImageToBBox(
    src: File,
    bbox: BBox,
    padPct = 10
  ): Promise<{ blob: Blob; cropBBox: BBox } | null> {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(src);
      const img = new Image();
      img.onload = () => {
        const pad = padPct;
        const x = Math.max(0, bbox.x - pad);
        const y = Math.max(0, bbox.y - pad);
        const w = Math.min(100 - x, bbox.w + pad * 2);
        const h = Math.min(100 - y, bbox.h + pad * 2);

        const sx = (x / 100) * img.naturalWidth;
        const sy = (y / 100) * img.naturalHeight;
        const sw = (w / 100) * img.naturalWidth;
        const sh = (h / 100) * img.naturalHeight;

        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(sw));
        canvas.height = Math.max(1, Math.round(sh));
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          URL.revokeObjectURL(url);
          resolve(null);
          return;
        }
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(
          (blob) => {
            URL.revokeObjectURL(url);
            if (!blob) {
              resolve(null);
              return;
            }
            resolve({ blob, cropBBox: { x, y, w, h } });
          },
          "image/jpeg",
          0.92
        );
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(null);
      };
      img.src = url;
    });
  }

  // Use SAM 2 to detect precise obstacle bboxes on the roof.
  // Crops to the GPT roof polygon bbox first so SAM sees mostly-roof content,
  // then keeps only the small-to-medium masks (obstacles, not the roof itself).
  // Matches each SAM bbox to GPT obstacles by IoU to inherit type labels.
  async function detectObstaclesWithSam(
    file: File,
    roofPolygon: Point[],
    gptObstacles: Obstacle[]
  ): Promise<Obstacle[]> {
    // 1. Crop to roof polygon bbox + 10% padding.
    let toSend: File | Blob = file;
    let cropBBox: BBox | null = null;
    if (roofPolygon.length >= 3) {
      const xs = roofPolygon.map((p) => p.x);
      const ys = roofPolygon.map((p) => p.y);
      const bx = Math.min(...xs);
      const by = Math.min(...ys);
      const bw = Math.max(...xs) - bx;
      const bh = Math.max(...ys) - by;
      if (bw * bh >= 10) {
        const cropped = await cropImageToBBox(file, { x: bx, y: by, w: bw, h: bh }, 10);
        if (cropped) { toSend = cropped.blob; cropBBox = cropped.cropBBox; }
      }
    }

    // 2. Run SAM on the crop (or full image as fallback).
    const cropFile = toSend instanceof File
      ? toSend : new File([toSend], "crop.jpg", { type: "image/jpeg" });
    const masks = await callSegmentApi(cropFile);
    if (!masks || masks.length === 0) return gptObstacles;

    // 3. Load grids, filter to obstacle-sized masks (0.5% to 20% of crop area).
    //    Roof surface / large faces will be >20%; background/noise will be <0.5%.
    const loaded = await Promise.all(
      masks.map(async (m) => {
        try {
          const grid = await loadMaskGrid(m.dataUrl);
          const stats = gridStats(grid);
          return stats ? { grid, stats } : null;
        } catch {
          return null;
        }
      })
    );
    const obsMasks = loaded
      .filter((e): e is { grid: MaskGrid; stats: GridStats } => e !== null)
      .filter((e) => e.stats.areaFraction >= 0.005 && e.stats.areaFraction <= 0.20);

    if (obsMasks.length === 0) return gptObstacles; // fallback to GPT boxes

    // 4. Remap bboxes from crop-space to full-image percentage space.
    const remapped: BBox[] = obsMasks.map((e) => {
      const b = e.stats.bbox;
      if (!cropBBox) return b;
      return {
        x: cropBBox.x + (b.x / 100) * cropBBox.w,
        y: cropBBox.y + (b.y / 100) * cropBBox.h,
        w: (b.w / 100) * cropBBox.w,
        h: (b.h / 100) * cropBBox.h,
      };
    });

    // 5. Match SAM bboxes to GPT obstacles by IoU to inherit their type labels.
    const used = new Set<number>();
    const result: Obstacle[] = remapped.map((samBbox) => {
      let best = 0, bestIdx = -1;
      gptObstacles.forEach((g, i) => {
        if (used.has(i)) return;
        const iou = bboxIoU(samBbox, g.bbox);
        if (iou > best) { best = iou; bestIdx = i; }
      });
      if (best > 0.1 && bestIdx >= 0) {
        used.add(bestIdx);
        return { ...gptObstacles[bestIdx], bbox: samBbox };
      }
      const def = getObstacleDefinition("other");
      return { type: "other", label: def.label, bbox: samBbox, shadow_buffer_m: def.defaultShadowBufferM };
    });
    // Also carry forward GPT obstacles SAM had no match for (SAM may miss tiny ones).
    gptObstacles.forEach((g, i) => { if (!used.has(i)) result.push(g); });

    console.log(`[SAM obstacles] ${obsMasks.length} masks -> ${result.length} obstacles`);
    return result;
  }
  function resetSamState() {
    setSamReady(false);
    setSamError(null);
  }
  async function analyze() {
    if (!imageFile) return;
    setLoading(true); setError(null);
    resetSamState();

    let data: AnalysisResult;
    try {
      data = (await callAnalyzeApi(false)) as AnalysisResult;
    } catch (e) {
      setError("Analysis failed. Check your API key and try again."); console.error(e);
      setLoading(false); return;
    }

    // Show Step 2 immediately with GPT polygon + GPT obstacle boxes.
    setResult(data);
    setStep(2);
    setLoading(false);

    // SAM 2 refines obstacle bboxes in the background.
    setSegmenting(true);
    try {
      const obs = await detectObstaclesWithSam(imageFile, data.roof.polygon, data.obstacles);
      setEditedObstacles(obs);
      setSamReady(true);
    } catch (e) {
      setSamError("SAM obstacle detection failed — GPT boxes shown."); console.error(e);
    } finally {
      setSegmenting(false);
    }
  }
  async function redetect() {
    if (!imageFile) return;
    setRedetecting(true); setError(null);
    resetSamState();

    let data: AnalysisResult;
    try {
      data = (await callAnalyzeApi(true)) as AnalysisResult;
    } catch (e) {
      setError("Re-analysis failed. Please try again."); console.error(e);
      setRedetecting(false); return;
    }

    setResult(data);
    setRedetecting(false);

    // SAM 2 refines obstacle bboxes in the background.
    setSegmenting(true);
    try {
      const obs = await detectObstaclesWithSam(imageFile, data.roof.polygon, data.obstacles);
      setEditedObstacles(obs);
      setSamReady(true);
    } catch (e) {
      setSamError("SAM obstacle detection failed — GPT boxes shown."); console.error(e);
    } finally {
      setSegmenting(false);
    }
  }
  async function importTnbBill(file: File) {
    const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    if (!file.type.startsWith("image/") && !isPdf) {
      setTnbBillMessage({ kind: "error", text: "Please upload a TNB bill image or PDF file." });
      return;
    }
    setTnbBillLoading(true);
    setTnbBillMessage(null);
    try {
      const form = new FormData();
      form.append("image", file);
      const res = await fetch("/api/tnb-bill", { method: "POST", body: form });
      if (!res.ok) throw new Error("Bill extraction failed");
      const data = (await res.json()) as TnbBillExtractResponse;
      if (typeof data.monthly_kwh === "number" && data.monthly_kwh > 0) {
        const roundedKwh = Math.round(data.monthly_kwh * 10) / 10;
        setMonthlyKwh(String(roundedKwh));
        setTnbBillMessage({
          kind: data.confidence === "low" ? "warning" : "success",
          text: data.confidence === "low"
            ? `AI found ${roundedKwh} kWh, but please confirm it against your bill.`
            : `Imported ${roundedKwh} kWh from your TNB bill.`,
        });
      } else {
        setTnbBillMessage({
          kind: "warning",
          text: data.notes || "AI could not find monthly kWh. Please enter it manually.",
        });
      }
    } catch (e) {
      console.error(e);
      setTnbBillMessage({ kind: "error", text: "Could not read the bill. Please enter kWh manually." });
    } finally {
      setTnbBillLoading(false);
      if (tnbBillInputRef.current) tnbBillInputRef.current.value = "";
    }
  }
  function reset() {
    setStep(1); setImageUrl(null); setImageFile(null); setResult(null);
    setMonthlyKwh(""); setError(null); setEditedPolygon(null);
    setTnbBillLoading(false); setTnbBillMessage(null);
    setEditedObstacles(null); setAddObstacleMode(false); setPendingBBox(null);
    setMaxFill(false); setImageAspect(1);
    setPlanes([]); setCalibration(null); setSelectedPlaneId(null);
    setTool("select");
    setSegmenting(false); resetSamState();
    setProjectName(""); setClientName(""); setProjectId(null);
    setSaveStatus("idle");
  }
  function addObstacle(type: string) {
    if (!pendingBBox) return;
    const definition = getObstacleDefinition(type);
    const newObs: Obstacle = {
      type: normalizeObstacleType(type),
      label: definition.label,
      bbox: pendingBBox,
      shadow_buffer_m: definition.defaultShadowBufferM,
    };
    setEditedObstacles([...activeObstacles, newObs]);
    setPendingBBox(null); setAddObstacleMode(false);
  }
  function updatePlane(id: string, patch: Partial<RoofPlane>) {
    setPlanes((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }
  function deletePlane(id: string) {
    setPlanes((prev) => prev.filter((p) => p.id !== id));
    if (selectedPlaneId === id) setSelectedPlaneId(null);
  }

  // ── Project save / load ──────────────────────────────────────────────────
  /** Persist current state to IndexedDB. Creates a new id if none yet. */
  async function persistProject(): Promise<string | null> {
    if (!imageFile || !result) return null;
    try {
      setSaveStatus("saving");
      const id = projectId ?? newProjectId();
      const now = Date.now();
      const project: SavedProject = {
        id,
        name: projectName.trim() || `Project ${new Date(now).toLocaleDateString()}`,
        clientName: clientName.trim(),
        createdAt: projectId ? (await loadProject(id))?.createdAt ?? now : now,
        updatedAt: now,
        imageBlob: imageFile,
        imageType: imageFile.type,
        imageAspect,
        result,
        editedPolygon,
        editedObstacles,
        planes,
        calibration,
        monthlyKwh,
        maxFill,
        summary: {
          activeSystemKwp,
          activeAnnualKwh,
          paybackYears: financial?.paybackYears ?? null,
          bill_coverage_percent: financial?.offsetPercent ?? null,
        },
      };
      await saveProject(project);
      if (!projectId) setProjectId(id);
      setSaveStatus("saved");
      // Drop "saved" indicator back to idle after a short pause so it pulses on each save.
      setTimeout(() => setSaveStatus("idle"), 1800);
      return id;
    } catch (e) {
      console.error("Save failed", e);
      setSaveStatus("idle");
      return null;
    }
  }

  /** Load a saved project back into the form, jumping to Step 5. */
  async function handleLoadProject(id: string) {
    const p = await loadProject(id);
    if (!p) return;
    // Reset transient UI state
    setSelectedPlaneId(null);
    setTool("select");
    setAddObstacleMode(false);
    setPendingBBox(null);
    setSegmenting(false);
    resetSamState();
    // Hydrate
    setProjectId(p.id);
    setProjectName(p.name);
    setClientName(p.clientName);
    const url = URL.createObjectURL(p.imageBlob);
    const file = new File([p.imageBlob], "rooftop.jpg", { type: p.imageType });
    setImageFile(file);
    setImageUrl(url);
    setImageAspect(p.imageAspect);
    // Suppress the result-watching effect that would otherwise wipe loaded planes/edits.
    skipResetOnce.current = true;
    setResult(p.result);
    setEditedPolygon(p.editedPolygon);
    setEditedObstacles(p.editedObstacles);
    setPlanes(p.planes);
    setCalibration(p.calibration);
    setMonthlyKwh(p.monthlyKwh);
    setMaxFill(p.maxFill);
    setShowHistory(false);
    setStep(5);
  }

  // ── Step indicator ────────────────────────────────────────────────────────
  const STEPS = [
    { n:1, label:"Upload Roof"  }, { n:2, label:"AI Detection" },
    { n:3, label:"Draw Planes"  }, { n:4, label:"Usage"        },
    { n:5, label:"Solar Layout" }, { n:6, label:"Report"       },
  ] as const;

  return (
    <main className="min-h-screen bg-stone-50">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="bg-stone-900 sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-amber-500 rounded-lg flex items-center justify-center">
              <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-white" stroke="currentColor" strokeWidth={2}>
                <circle cx="12" cy="12" r="5" fill="currentColor" stroke="none"/>
                <line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
                <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
              </svg>
            </div>
            <div>
              <h1 className="text-sm font-bold text-white tracking-tight">SolarFit AI</h1>
              <p className="text-xs text-stone-400">Automated PV Layout Designer · ESUM × RExharge</p>
            </div>
          </div>
          <div className="flex items-center gap-2 print:hidden">
            <button
              onClick={() => setShowHistory(true)}
              className="flex items-center gap-2 border border-stone-600 rounded-lg px-3 py-1.5 text-stone-300 hover:bg-stone-800 text-xs transition-colors"
              title="View saved projects"
            >
              <FolderOpen size={13} /> History
            </button>
            {saveStatus !== "idle" && (
              <span className={`text-[10px] font-medium ${saveStatus === "saved" ? "text-emerald-400" : "text-stone-400"}`}>
                {saveStatus === "saving" ? "Saving…" : "✓ Saved"}
              </span>
            )}
            {step > 1 && (
              <>
                <button
                  onClick={() => setStep((s) => Math.max(1, s - 1) as Step)}
                  className="flex items-center gap-2 border border-stone-600 rounded-lg px-3 py-1.5 text-stone-300 hover:bg-stone-800 text-xs transition-colors"
                >
                  <ArrowLeft size={13} /> Back
                </button>
                <button
                  onClick={() => setShowConfirmReset(true)}
                  className="flex items-center gap-2 border border-stone-600 rounded-lg px-3 py-1.5 text-stone-300 hover:bg-stone-800 text-xs transition-colors"
                >
                  <RotateCcw size={13} /> Start over
                </button>
              </>
            )}
          </div>
        </div>

        {/* Step indicator */}
        <div className="max-w-6xl mx-auto px-6 pb-4">
          <div className="flex items-center gap-2">
            {STEPS.map((s, i) => (
              <div key={s.n} className="flex items-center gap-2 flex-1">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                  step > s.n  ? "bg-emerald-500 text-white" :
                  step === s.n ? "bg-white text-stone-900 ring-4 ring-white/20" :
                                 "bg-stone-700 text-stone-400"
                }`}>
                  {step > s.n ? <Check size={13} /> : s.n}
                </div>
                <span className={`text-xs hidden sm:block ${
                  step >= s.n ? "text-stone-200 font-medium" : "text-stone-500"
                }`}>{s.label}</span>
                {i < STEPS.length - 1 && <div className={`flex-1 h-px ${step > s.n ? "bg-emerald-500" : "bg-stone-700"}`} />}
              </div>
            ))}
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 py-8">

        {/* ── STEP 1: UPLOAD ─────────────────────────────────────────────── */}
        {step === 1 && (
          <div className="max-w-2xl mx-auto">
            <div className="text-center mb-8">
              <h2 className="text-2xl font-bold text-stone-900 mb-2">Let&apos;s design your solar layout</h2>
              <p className="text-stone-500 text-sm">
                Upload an aerial photo of your rooftop and we&apos;ll take it from there.
                Our AI finds the roof and obstacles — then you draw the precise roof
                planes for a panel layout that fits just right.
              </p>
            </div>

            <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-6">
              {/* Project metadata — used for the saved record + the printed report */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
                <div>
                  <label className="block text-xs font-medium text-stone-600 mb-1">
                    Project name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={projectName}
                    onChange={(e) => setProjectName(e.target.value)}
                    placeholder="e.g. 12 Jalan Kiara Residency"
                    className="w-full px-3 py-2 text-sm border border-stone-200 rounded-lg focus:outline-none focus:border-amber-400"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-stone-600 mb-1">
                    Client name
                  </label>
                  <input
                    type="text"
                    value={clientName}
                    onChange={(e) => setClientName(e.target.value)}
                    placeholder="e.g. Mr. Tan"
                    className="w-full px-3 py-2 text-sm border border-stone-200 rounded-lg focus:outline-none focus:border-amber-400"
                  />
                </div>
              </div>

              <div
                onDrop={onDrop}
                onDragOver={(e) => e.preventDefault()}
                onClick={() => !imageUrl && inputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl transition-all min-h-64 flex items-center justify-center ${
                  imageUrl
                    ? "border-amber-200 bg-amber-50/50 cursor-default"
                    : "border-stone-200 hover:border-amber-400 hover:bg-amber-50/30 cursor-pointer"
                }`}
              >
                <input ref={inputRef} type="file" accept="image/*" className="hidden"
                  onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
                {imageUrl ? (
                  <div className="relative w-full p-3">
                    <img src={imageUrl} alt="Rooftop" className="max-h-80 mx-auto rounded-lg object-contain" />
                    <button
                      onClick={(e) => { e.stopPropagation(); reset(); }}
                      className="absolute top-5 right-5 w-7 h-7 bg-white rounded-full shadow border border-stone-200 text-stone-400 hover:text-red-500 flex items-center justify-center"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <div className="text-center px-6 py-10">
                    <div className="w-14 h-14 bg-stone-100 rounded-xl flex items-center justify-center mx-auto mb-3">
                      <SunDim size={28} className="text-amber-500" />
                    </div>
                    <p className="text-stone-700 font-medium">Drop your rooftop photo here</p>
                    <p className="text-stone-400 text-xs mt-1">or click to browse · JPG / PNG · aerial view works best</p>
                  </div>
                )}
              </div>

              <button
                onClick={analyze}
                disabled={!imageFile || loading || !projectName.trim()}
                className="w-full mt-5 bg-orange-600 hover:bg-orange-500 disabled:bg-stone-100 disabled:text-stone-400 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl text-sm transition-colors flex items-center justify-center gap-2"
              >
                {loading ? (
                  <><span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Analysing roof structure...</>
                ) : "Detect Roof & Obstacles"}
              </button>
              {!projectName.trim() && imageFile && (
                <p className="mt-2 text-xs text-amber-600 text-center">Enter a project name to continue</p>
              )}
              {error && (
                <div className="mt-3 bg-red-50 border border-red-200 text-red-600 rounded-xl px-4 py-3 text-xs flex items-center gap-2">
                  <AlertTriangle size={14} /> {error}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── STEP 2: DETECTION ──────────────────────────────────────────── */}
        {step === 2 && result && imageUrl && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 bg-white rounded-2xl border border-stone-200 shadow-sm p-4">
              <div className="flex items-center gap-2 mb-3">
                <p className="text-sm font-semibold text-stone-900">AI Detection Results</p>
                {isEdited && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                    Manually adjusted
                  </span>
                )}
                <span className={`ml-auto text-xs px-2 py-0.5 rounded-full border font-medium ${CONFIDENCE_COLOR[result.confidence] ?? CONFIDENCE_COLOR.medium} capitalize`}>
                  {result.confidence} confidence
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2 mb-3">
                <button
                  onClick={() => setAddObstacleMode(!addObstacleMode)}
                  className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors ${
                    addObstacleMode
                      ? "bg-orange-600 text-white border-orange-600"
                      : "bg-white text-stone-600 border-stone-300 hover:bg-stone-50"
                  }`}
                >
                  <Plus size={13} /> Add Obstacle
                </button>
                {addObstacleMode && (
                  <span className="text-xs text-amber-600 font-medium">Draw a rectangle on the image</span>
                )}
              </div>

              {samError && !segmenting && (
                <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                  <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />
                  <span>
                    SAM obstacle detection unavailable — showing GPT estimate.{" "}
                    <span className="text-amber-600">{samError}</span>
                  </span>
                </div>
              )}
              {samReady && !segmenting && (
                <div className="mb-3 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                  <Sparkles size={13} className="flex-shrink-0" />
                  <span>Obstacles refined by SAM 2 — drag the handles to fine-tune.</span>
                </div>
              )}

              <RoofEditor
                imageUrl={imageUrl}
                polygon={activePolygon}
                obstacles={activeObstacles}
                addObstacleMode={addObstacleMode}
                segmenting={segmenting}
                onPolygonChange={(poly) => setEditedPolygon(poly)}
                onObstaclesChange={(obs) => setEditedObstacles(obs)}
                onNewObstacleDrawn={(bbox) => { setPendingBBox(bbox); setAddObstacleMode(false); }}
              />

              <div className="flex flex-wrap gap-2 mt-3 text-xs">
                <span className="px-2 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                  Usable roof area
                </span>
                {activeObstacles.map((o, i) => {
                  const definition = getObstacleDefinition(o.type);
                  const Icon = OBSTACLE_ICONS[definition.type] ?? LayoutGrid;
                  return (
                    <span key={i} className="flex items-center gap-1 px-2 py-1 rounded-full bg-stone-50 text-stone-600 border border-stone-200">
                      <Icon size={11} /> {o.label || definition.label}
                    </span>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-col gap-4">
              <div className="bg-orange-50 rounded-2xl border border-orange-200 shadow-sm p-4">
                <p className="text-sm font-semibold text-orange-900 mb-1">AI obstacle detection.</p>
                <p className="text-xs text-orange-800 leading-relaxed">
                  Drag obstacle boxes to fine-tune positions. Final panel placement uses the precise roof planes you draw in Step 3.
                </p>
              </div>
              <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-5">
                <p className="text-xs text-stone-500 mb-1">Roof Type</p>
                <p className="text-lg font-bold capitalize text-stone-900">{result.roof.roof_type}</p>
              </div>

              <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-5">
                <p className="text-xs text-stone-500 mb-3">Obstacles Found ({activeObstacles.length})</p>
                {activeObstacles.length === 0 ? (
                  <p className="text-xs text-stone-400">No obstacles found — nice clear roof!</p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {activeObstacles.map((o, i) => {
                      const definition = getObstacleDefinition(o.type);
                      const Icon = OBSTACLE_ICONS[definition.type] ?? LayoutGrid;
                      const area = obsAreaSqm(o);
                      return (
                        <div key={i} className="flex items-center gap-2 text-xs">
                          <div className="w-6 h-6 rounded-md bg-stone-100 flex items-center justify-center flex-shrink-0">
                            <Icon size={12} className="text-stone-500" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-stone-700 truncate">{o.label || definition.label}</p>
                            <p className="text-stone-400 num">{area < 1 ? "<1" : Math.round(area)} m²</p>
                          </div>
                          <button
                            onClick={() => setEditedObstacles(activeObstacles.filter((_, j) => j !== i))}
                            className="text-stone-300 hover:text-red-400 transition-colors flex-shrink-0"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {isEdited && (
                <button
                  onClick={() => { setEditedPolygon(null); setEditedObstacles(null); }}
                  className="w-full border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-700 font-medium py-2.5 rounded-xl text-xs transition-colors"
                >
                  ↺ Reset to AI Detection
                </button>
              )}

              <button
                onClick={redetect}
                disabled={redetecting || segmenting}
                className="w-full border border-stone-300 bg-white hover:bg-stone-50 disabled:opacity-60 disabled:cursor-not-allowed text-stone-600 font-medium py-2.5 rounded-xl text-xs transition-colors flex items-center justify-center gap-2"
              >
                {redetecting
                  ? <><span className="inline-block w-3.5 h-3.5 border-2 border-stone-300 border-t-stone-600 rounded-full animate-spin" />Re-analyzing...</>
                  : "Redetect Roof"}
              </button>

              <button
                onClick={() => setStep(3)}
                disabled={redetecting || segmenting}
                className="w-full bg-orange-600 hover:bg-orange-500 disabled:bg-stone-100 disabled:text-stone-400 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl text-sm transition-colors"
              >
                Continue → Draw Roof Planes
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 3: DRAW ROOF PLANES ────────────────────────────────────── */}
        {step === 3 && result && imageUrl && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 bg-white rounded-2xl border border-stone-200 shadow-sm p-4">
              <p className="text-sm font-semibold text-stone-900 mb-3">Draw Roof Planes</p>
              <PlaneEditor
                imageUrl={imageUrl}
                aiPolygon={activePolygon}
                obstacles={activeObstacles}
                planes={planes}
                calibration={calibration}
                selectedPlaneId={selectedPlaneId}
                tool={tool}
                packed={packed}
                onPlanesChange={setPlanes}
                onCalibrationChange={setCalibration}
                onSelectPlane={setSelectedPlaneId}
                onToolChange={setTool}
              />
            </div>

            {/* Side panel */}
            <div className="flex flex-col gap-4">

              <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-4">
                <p className="text-xs text-stone-500 mb-2 font-medium">Step 3 Guide</p>
                <ol className="list-decimal list-inside space-y-1 text-xs text-stone-600">
                  <li>Calibrate scale using a known roof length.</li>
                  <li>Draw Plane around the real roof face.</li>
                  <li>Select the plane.</li>
                  <li>Draw Ridge along the roof ridge or top edge.</li>
                  <li>Repeat for each roof face, then continue.</li>
                </ol>
              </div>

              {/* Tools */}
              <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-4">
                <p className="text-xs text-stone-500 mb-2 font-medium">Tools</p>
                <div className="grid grid-cols-2 gap-2">
                  {([
                    { t:"select"    as Tool, label:"Select",    icon: MousePointer2 },
                    { t:"calibrate" as Tool, label:"Calibrate",  icon: Ruler },
                    { t:"drawPlane" as Tool, label:"Draw Plane", icon: Pencil },
                    { t:"drawRidge" as Tool, label:"Draw Ridge", icon: MoveUpRight },
                  ]).map(({ t, label, icon: Icon }) => {
                    const disabled = t === "drawRidge" && !selectedPlane;
                    return (
                      <button key={t}
                        onClick={() => setTool(t)}
                        disabled={disabled}
                        className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-2 rounded-lg border transition-colors ${
                          tool === t
                            ? "bg-stone-900 text-white border-stone-900"
                            : disabled
                            ? "bg-stone-50 text-stone-300 border-stone-200 cursor-not-allowed"
                            : "bg-white text-stone-600 border-stone-300 hover:bg-stone-50"
                        }`}
                      >
                        <Icon size={13} /> {label}
                      </button>
                    );
                  })}
                </div>
                <div className={`mt-3 text-xs rounded-lg px-3 py-2 border flex items-center gap-1.5 ${
                  calibration
                    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                    : "bg-amber-50 text-amber-700 border-amber-200"
                }`}>
                  {calibration
                    ? <><Check size={12} /> Scale set · {calibration.meters} m reference</>
                    : <><AlertTriangle size={12} /> Calibrate the scale before placing panels</>}
                </div>
              </div>

              {/* Solar module — fixed panel, not editable */}
              <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-4">
                <p className="text-xs text-stone-500 mb-2 font-medium">Solar Module</p>
                <p className="text-sm font-bold text-stone-900">Trina Vertex N · 620 Wp</p>
                <p className="text-[11px] text-stone-400 mb-3">Fixed module · TSM-NEG19RC.20</p>
                <div className="grid grid-cols-3 gap-2">
                  {([
                    { label:"Length", val:"2.382 m" },
                    { label:"Width",  val:"1.134 m" },
                    { label:"Power",  val:"620 Wp"  },
                  ]).map(({ label, val }) => (
                    <div key={label} className="bg-stone-50 rounded-lg px-2 py-1.5 border border-stone-100">
                      <p className="text-[10px] text-stone-400">{label}</p>
                      <p className="text-sm font-semibold text-stone-800 num">{val}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Plane list */}
              <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-4">
                <p className="text-xs text-stone-500 mb-2 font-medium">Roof Planes ({planes.length})</p>
                {planes.length === 0 ? (
                  <p className="text-xs text-stone-400">Use “Draw Plane” to outline a roof face.</p>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {planes.map((pl, i) => {
                      const count = packedById.get(pl.id)?.panels.length ?? 0;
                      return (
                        <button key={pl.id}
                          onClick={() => setSelectedPlaneId(pl.id)}
                          className={`flex items-center gap-2 text-xs px-2 py-1.5 rounded-lg border transition-colors ${
                            selectedPlaneId === pl.id
                              ? "border-stone-900 bg-stone-50"
                              : "border-stone-200 hover:bg-stone-50"
                          }`}
                        >
                          <span className="w-3 h-3 rounded-sm flex-shrink-0" style={{ background: planeColor(i) }} />
                          <span className="font-medium text-stone-700 flex-1 text-left truncate">{pl.name}</span>
                          <span className="text-stone-400 num">{count} panels</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Selected plane properties */}
              {selectedPlane && (() => {
                const idx = planes.findIndex((p) => p.id === selectedPlane.id);
                const pk = packedById.get(selectedPlane.id);
                const ridgeAngle = selectedPlane.ridge
                  ? Math.round(ridgeAngleDeg(selectedPlane.ridge[0], selectedPlane.ridge[1], imageAspect))
                  : null;
                const { tiltDeg: effTilt, azimuthDeg: effAzimuth } = resolveOrientation(selectedPlane, imageAspect);
                const yieldFactor = orientationFactor(effTilt, effAzimuth);
                return (
                  <div className="bg-white rounded-2xl border-2 shadow-sm p-4" style={{ borderColor: planeColor(idx) }}>
                    <input
                      value={selectedPlane.name}
                      onChange={(e) => updatePlane(selectedPlane.id, { name: e.target.value })}
                      className="w-full text-sm font-semibold text-stone-900 mb-3 px-2 py-1 border border-stone-200 rounded-lg focus:outline-none focus:border-amber-400"
                    />
                    <div className="grid grid-cols-2 gap-2 text-xs mb-3">
                      <div>
                        <p className="text-stone-400" title="Angle of the ridge line you drew, measured on the photo. Used only to rotate the panel grid.">Ridge angle <span className="text-stone-300">ⓘ</span></p>
                        <p className="font-bold text-stone-800 num">{ridgeAngle === null ? "— not set" : `${ridgeAngle}°`}</p>
                      </div>
                      <div>
                        <p className="text-stone-400">Panel layout</p>
                        <p className="font-bold text-stone-800 capitalize">{selectedPlane.ridge ? pk?.orientation ?? "—" : "—"}</p>
                      </div>
                      <div>
                        <p className="text-stone-400">Panels on plane</p>
                        <p className="font-bold text-stone-800 num">{pk?.panels.length ?? 0}</p>
                      </div>
                      <div>
                        <p className="text-stone-400" title="Energy multiplier vs. an optimally-oriented (south, 7°) panel. 1.00× = optimal.">Yield factor <span className="text-stone-300">ⓘ</span></p>
                        <p className="font-bold text-stone-800 num">{yieldFactor.toFixed(2)}×</p>
                      </div>
                    </div>

                    {/* Engineer overrides — tilt + azimuth, each with a plain-English explainer */}
                    <div className="mb-3 p-3 rounded-lg bg-stone-50 border border-stone-100 space-y-3">
                      {/* Tilt */}
                      <div>
                        <div className="flex items-baseline justify-between mb-1">
                          <label className="text-xs font-semibold text-stone-700">
                            Tilt <span className="font-normal text-stone-400">— roof slope steepness</span>
                          </label>
                          {selectedPlane.tiltDeg === null && <span className="text-emerald-600 text-[9px] font-semibold">AUTO</span>}
                        </div>
                        <div className="flex items-center gap-1">
                          <input
                            type="number" min={0} max={60} step={1}
                            value={selectedPlane.tiltDeg ?? Math.round(effTilt)}
                            onChange={(e) => {
                              const v = e.target.value;
                              updatePlane(selectedPlane.id, { tiltDeg: v === "" ? null : parseFloat(v) });
                            }}
                            className="w-14 px-1 py-0.5 border border-stone-300 rounded text-xs num focus:outline-none focus:border-amber-400"
                          />
                          <span className="text-stone-500 text-xs">°</span>
                          <span className="ml-2 text-[10px] text-stone-400">0° flat · 30° typical · 45° steep</span>
                        </div>
                      </div>

                      {/* Azimuth */}
                      <div>
                        <div className="flex items-baseline justify-between mb-1">
                          <label className="text-xs font-semibold text-stone-700">
                            Azimuth <span className="font-normal text-stone-400">— downhill compass direction</span>
                          </label>
                          {selectedPlane.azimuthDeg === null && <span className="text-emerald-600 text-[9px] font-semibold">AUTO</span>}
                        </div>
                        <div className="flex items-center gap-1">
                          <input
                            type="number" min={0} max={360} step={1}
                            value={selectedPlane.azimuthDeg ?? Math.round(effAzimuth)}
                            onChange={(e) => {
                              const v = e.target.value;
                              updatePlane(selectedPlane.id, { azimuthDeg: v === "" ? null : parseFloat(v) });
                            }}
                            className="w-16 px-1 py-0.5 border border-stone-300 rounded text-xs num focus:outline-none focus:border-amber-400"
                          />
                          <span className="text-stone-500 text-xs">°</span>
                          <span className="ml-1 px-1.5 py-0.5 bg-stone-200 text-stone-700 text-[10px] font-semibold rounded">{azimuthLabel(effAzimuth)}</span>
                          <span className="ml-1 text-[10px] text-stone-400">0=N · 90=E · 180=S · 270=W</span>
                        </div>
                      </div>

                      <p className="text-[10px] text-stone-500 leading-snug border-t border-stone-200 pt-2">
                        💡 Image is assumed north-up (drone default). Override azimuth manually if the photo isn&apos;t.
                      </p>

                      {(selectedPlane.tiltDeg !== null || selectedPlane.azimuthDeg !== null) && (
                        <button
                          onClick={() => updatePlane(selectedPlane.id, { tiltDeg: null, azimuthDeg: null })}
                          className="text-[10px] text-emerald-600 hover:text-emerald-700 font-medium"
                        >
                          ↺ Reset to auto
                        </button>
                      )}
                    </div>
                    <label className="block text-[10px] text-stone-400 mb-1">Panel orientation</label>
                    <select
                      value={selectedPlane.orientationMode}
                      onChange={(e) => updatePlane(selectedPlane.id, { orientationMode: e.target.value as RoofPlane["orientationMode"] })}
                      className="w-full px-2 py-1.5 text-sm border border-stone-200 rounded-lg mb-3 focus:outline-none focus:border-amber-400"
                    >
                      <option value="auto">Auto (landscape rows)</option>
                      <option value="landscape">Force Landscape</option>
                      <option value="portrait">Force Portrait</option>
                    </select>
                    <div className="flex gap-2">
                      <button
                        onClick={() => { setSelectedPlaneId(selectedPlane.id); setTool("drawRidge"); }}
                        className="flex-1 flex items-center justify-center gap-1 text-xs font-medium border border-stone-300 hover:bg-stone-50 text-stone-600 py-2 rounded-lg transition-colors"
                      >
                        <MoveUpRight size={12} /> Redraw ridge
                      </button>
                      <button
                        onClick={() => deletePlane(selectedPlane.id)}
                        className="flex items-center justify-center gap-1 text-xs font-medium border border-red-200 bg-red-50 hover:bg-red-100 text-red-600 px-3 py-2 rounded-lg transition-colors"
                      >
                        <Trash2 size={12} /> Delete
                      </button>
                    </div>
                  </div>
                );
              })()}

              {!planesReady && (
                <p className="text-xs text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 flex items-start gap-1.5">
                  <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
                  Set the scale and give at least one plane a ridge line to continue.
                </p>
              )}

              <button
                onClick={() => setStep(4)}
                disabled={!planesReady}
                className="w-full bg-orange-600 hover:bg-orange-500 disabled:bg-stone-100 disabled:text-stone-400 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl text-sm transition-colors"
              >
                Continue → Enter Usage
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 4: TNB BILL ───────────────────────────────────────────── */}
        {step === 4 && result && (
          <div className="max-w-2xl mx-auto">
            <div className="text-center mb-6">
              <h2 className="text-2xl font-bold text-stone-900 mb-1">Your monthly electricity usage</h2>
              <p className="text-stone-500 text-sm">
                Enter how many kWh you use per month — it&apos;s on your TNB bill as
                &ldquo;Jumlah Penggunaan Anda&rdquo;.
              </p>
            </div>

            <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-6">
              <label className="block text-xs font-medium text-stone-600 mb-2">Average Monthly Usage</label>
              <div className="relative">
                <input
                  type="number"
                  value={monthlyKwh}
                  onChange={(e) => setMonthlyKwh(e.target.value)}
                  placeholder="e.g. 900"
                  className="w-full pl-4 pr-16 py-3 border border-stone-200 rounded-xl text-lg font-semibold num focus:outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-stone-400 font-medium text-sm">kWh</span>
              </div>

              <div className="mt-3 rounded-xl border border-stone-200 bg-stone-50 p-3">
                <input
                  ref={tnbBillInputRef}
                  type="file"
                  accept="image/*,application/pdf"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) importTnbBill(file);
                  }}
                />
                <button
                  onClick={() => tnbBillInputRef.current?.click()}
                  disabled={tnbBillLoading}
                  className="w-full flex items-center justify-center gap-2 rounded-lg border border-orange-200 bg-white px-3 py-2 text-xs font-semibold text-orange-700 transition-colors hover:bg-orange-50 disabled:cursor-not-allowed disabled:border-stone-200 disabled:text-stone-400"
                >
                  {tnbBillLoading ? (
                    <><span className="inline-block w-3.5 h-3.5 border-2 border-orange-200 border-t-orange-600 rounded-full animate-spin" /> Reading TNB bill...</>
                  ) : (
                    <><Wallet size={13} /> Import the TNB bill</>
                  )}
                </button>
                {tnbBillMessage && (
                  <p className={`mt-2 text-xs rounded-lg px-3 py-2 border ${
                    tnbBillMessage.kind === "success"
                      ? "bg-emerald-50 text-emerald-700 border-emerald-100"
                      : tnbBillMessage.kind === "warning"
                      ? "bg-amber-50 text-amber-700 border-amber-100"
                      : "bg-red-50 text-red-600 border-red-100"
                  }`}>
                    {tnbBillMessage.text}
                  </p>
                )}
              </div>

              <div className="flex flex-wrap gap-2 mt-3">
                {[300, 600, 900, 1200, 1500, 2000].map(v => (
                  <button key={v} onClick={() => setMonthlyKwh(String(v))}
                    className="text-xs bg-stone-100 hover:bg-amber-100 hover:text-amber-700 text-stone-600 px-3 py-1 rounded-full transition-colors num">
                    {v} kWh
                  </button>
                ))}
              </div>

              {estimatedBill && (
                <div className="mt-5 bg-stone-50 rounded-xl p-4 border border-stone-200">
                  <p className="text-xs text-stone-500 font-medium mb-2">Estimated TNB Bill · RP4 tariff (Jul 2025)</p>
                  <div className="space-y-1 text-xs">
                    {[
                      { label:`Energy (${(energyRate(consumptionKwh) * 100).toFixed(2)} sen/kWh)`, val: estimatedBill.energy },
                      { label:"Capacity (4.55 sen/kWh)", val: estimatedBill.capacity },
                      { label:"Network (12.85 sen/kWh)", val: estimatedBill.network },
                      { label:"Retail",            val: estimatedBill.retail },
                      { label:"Service Tax (8%)",  val: estimatedBill.serviceTax },
                      { label:"KWTBB (1.6%)",      val: estimatedBill.kwtbb },
                    ].map(r => (
                      <div key={r.label} className="flex items-center justify-between text-stone-600">
                        <span>{r.label}</span>
                        <span className="num">RM {r.val.toFixed(2)}</span>
                      </div>
                    ))}
                    <div className="flex items-center justify-between font-bold text-stone-900 pt-1.5 mt-1 border-t border-stone-200">
                      <span>Estimated monthly bill</span>
                      <span className="num">RM {estimatedBill.total.toFixed(2)}</span>
                    </div>
                  </div>
                  {consumptionKwh > 1500 && (
                    <p className="mt-2 text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2 border border-amber-100 flex items-start gap-1.5">
                      <AlertTriangle size={11} className="mt-0.5 flex-shrink-0" />
                      Above 1500 kWh/month — TNB bills all energy at the higher 37.03 sen/kWh tier.
                    </p>
                  )}
                </div>
              )}

              {sizing && (
                <div className="mt-4 bg-stone-50 rounded-xl p-4 border border-stone-200 space-y-3">
                  <p className="text-xs text-stone-500 font-medium">NEM 3.0 Sizing Preview</p>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    {[
                      { label:"Monthly consumption", val:`${consumptionKwh.toLocaleString()} kWh` },
                      { label:"Annual consumption",  val:`${Math.round(annualKwh).toLocaleString()} kWh` },
                      { label:"Recommended system",  val:`${sizing.targetKwp} kWp`, highlight:true },
                      { label:"Panels required",     val:`${sizing.recommendedPanels} panels`, highlight:true },
                    ].map(item => (
                      <div key={item.label}>
                        <p className="text-stone-400">{item.label}</p>
                        <p className={`text-lg font-bold num ${item.highlight ? "text-stone-900" : "text-stone-700"}`}>{item.val}</p>
                      </div>
                    ))}
                  </div>
                  <div className="text-xs text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2 border border-emerald-100 flex items-center gap-1.5">
                    <Check size={11} />
                    Sized for 75% self-consumption — optimal under Malaysia NEM 3.0
                  </div>
                  {isRoofConstrained && (
                    <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2 border border-amber-100 flex items-center gap-1.5">
                      <AlertTriangle size={11} />
                      Drawn planes fit {roofCapacity} panels — will offset ~{Math.round((roofCapacity / sizing.recommendedPanels) * 75)}% of consumption
                    </p>
                  )}
                </div>
              )}

              <button
                onClick={() => setStep(5)}
                disabled={consumptionKwh <= 0}
                className="w-full mt-5 bg-orange-600 hover:bg-orange-500 disabled:bg-stone-100 disabled:text-stone-400 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl text-sm transition-colors"
              >
                Show My Solar Layout
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 5: RESULTS ────────────────────────────────────────────── */}
        {step === 5 && result && imageUrl && financial && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 flex flex-col gap-6">

              {/* Layout canvas */}
              <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm font-semibold text-stone-900">Solar Panel Layout</p>
                  <span className="text-xs text-stone-400 num">
                    {activePanelCount} active · {expansionPanels.length > 0 ? `${expansionPanels.length} reserved` : "max fill"} · {activeSystemKwp.toFixed(2)} kWp
                  </span>
                </div>

                <RoofCanvas
                  imageUrl={imageUrl}
                  polygon={activePolygon}
                  obstacles={activeObstacles}
                  panels={activePanels}
                  expansionPanels={expansionPanels}
                  planes={planes.map((p) => p.polygon)}
                  showObstacles showPanels
                />
              </div>

              {/* Engineer's notes */}
              <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-5">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-stone-900 mb-3">
                  <Lightbulb size={16} className="text-amber-500" /> Engineer&apos;s Notes
                </h3>
                {sizing && !maxFill ? (
                  <p className="text-sm text-stone-600 leading-relaxed">
                    System sized for 75% self-consumption under Malaysia NEM 3.0 — {sizing.targetKwp} kWp
                    matches {Math.round(annualKwh).toLocaleString()} kWh annual usage.{" "}
                    {activePanelCount} of {roofCapacity} drawn-plane positions used
                    {expansionPanels.length > 0
                      ? `; ${expansionPanels.length} slots reserved for future load expansion (EV charging, additional A/C). `
                      : ". "}
                    Panels are placed on {planes.length} manually-drawn roof {planes.length === 1 ? "plane" : "planes"}, each aligned to its ridge line.{" "}
                    The active set is ranked by predicted yield — positions with the least obstacle shading first; reserved slots are the lower-yield positions.{" "}
                    {result.engineer_notes}
                  </p>
                ) : (
                  <p className="text-sm text-stone-600 leading-relaxed">
                    Max-fill mode: {activePanelCount} × {FIXED_MODULE.wattage} Wp ({activeSystemKwp.toFixed(2)} kWp) placed across {planes.length} drawn {planes.length === 1 ? "plane" : "planes"} to maximise roof utilisation.
                    Under NEM 3.0, excess generation exports at a lower displaced rate — consider future EV or HVAC loads to absorb additional yield.{" "}
                    {result.engineer_notes}
                  </p>
                )}
                <div className="grid grid-cols-4 gap-2 mt-4 pt-4 border-t border-stone-100">
                  {[
                    { label:"Roof Planes",  val:String(planes.length)               },
                    { label:"Orient. Factor", val:`${weightedFactor.toFixed(2)}×`   },
                    { label:"Performance",  val:"85%"                               },
                    { label:"Peak Sun",     val:"4.5h"                              },
                  ].map(item => (
                    <div key={item.label} className="bg-stone-900 rounded-lg px-3 py-2 text-xs">
                      <p className="text-stone-400 mb-0.5">{item.label}</p>
                      <p className="font-bold text-white capitalize num">{item.val}</p>
                    </div>
                  ))}
                </div>

                {/* Per-plane orientation table — replaces the misleading global tilt/azimuth */}
                {planes.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-stone-100">
                    <p className="text-xs font-semibold text-stone-500 mb-2">Per-plane orientation</p>
                    <div className="overflow-hidden rounded-lg border border-stone-200">
                      <table className="w-full text-xs">
                        <thead className="bg-stone-50">
                          <tr className="text-stone-500 text-left">
                            <th className="px-2 py-1.5 font-medium">Plane</th>
                            <th className="px-2 py-1.5 font-medium text-right">Tilt</th>
                            <th className="px-2 py-1.5 font-medium text-right">Azimuth</th>
                            <th className="px-2 py-1.5 font-medium text-center">Facing</th>
                            <th className="px-2 py-1.5 font-medium text-right">Panels</th>
                            <th className="px-2 py-1.5 font-medium text-right">Yield</th>
                          </tr>
                        </thead>
                        <tbody>
                          {planes.map((pl, i) => {
                            const r = resolveOrientation(pl, imageAspect);
                            const f = orientationFactor(r.tiltDeg, r.azimuthDeg);
                            const panelsOnPlane = packedById.get(pl.id)?.panels.length ?? 0;
                            return (
                              <tr key={pl.id} className="border-t border-stone-100">
                                <td className="px-2 py-1.5">
                                  <span className="inline-block w-2 h-2 rounded-sm mr-1.5 align-middle" style={{ background: planeColor(i) }} />
                                  <span className="text-stone-800 font-medium">{pl.name}</span>
                                </td>
                                <td className="px-2 py-1.5 text-right num text-stone-700">{Math.round(r.tiltDeg)}°</td>
                                <td className="px-2 py-1.5 text-right num text-stone-700">{Math.round(r.azimuthDeg)}°</td>
                                <td className="px-2 py-1.5 text-center font-semibold text-stone-700">{azimuthLabel(r.azimuthDeg)}</td>
                                <td className="px-2 py-1.5 text-right num text-stone-700">{panelsOnPlane}</td>
                                <td className="px-2 py-1.5 text-right num text-stone-700">{f.toFixed(2)}×</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Data cards */}
            <div className="flex flex-col gap-4">

              {sizing && (
                <div className="bg-white rounded-2xl border-2 border-emerald-200 shadow-sm p-5">
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-stone-900 mb-3">
                    <Target size={15} className="text-emerald-500" /> Sizing Logic (NEM 3.0)
                  </h3>
                  <div className="space-y-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-stone-500">Recommended</span>
                      <span className="font-bold text-stone-900 num">{sizing.targetKwp} kWp · {sizing.recommendedPanels} panels</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-stone-500">Roof capacity (max)</span>
                      <span className="font-medium text-stone-600 num">{roofCapacity} panels</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-stone-500">Self-consumption target</span>
                      <span className="font-medium text-stone-600 num">75% · NEM 3.0</span>
                    </div>
                  </div>

                  {isRoofConstrained ? (
                    <div className="mt-3 text-amber-700 bg-amber-50 rounded-lg px-3 py-2 border border-amber-100 text-xs">
                      <p className="font-medium flex items-center gap-1.5 mb-0.5">
                        <AlertTriangle size={11} /> Roof-constrained
                      </p>
                      Drawn planes fit {roofCapacity} panels — offsets ~{Math.round((roofCapacity / sizing.recommendedPanels) * 75)}% of consumption
                    </div>
                  ) : (
                    <div className="mt-3 text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2 border border-emerald-100 text-xs">
                      <p className="font-medium flex items-center gap-1.5 mb-0.5">
                        <Check size={11} /> Optimal sizing applied
                      </p>
                      Matched to consumption · {expansionPanels.length} slots for future expansion
                    </div>
                  )}

                  <div className="mt-4 pt-3 border-t border-stone-100">
                    <p className="text-xs text-stone-400 mb-2">Panel count override</p>
                    <div className="flex rounded-lg border border-stone-200 overflow-hidden text-xs">
                      <button
                        onClick={() => setMaxFill(false)}
                        className={`flex-1 py-1.5 font-medium transition-colors ${!maxFill ? "bg-emerald-500 text-white" : "bg-white text-stone-500 hover:bg-stone-50"}`}
                      >Smart Sizing</button>
                      <button
                        onClick={() => setMaxFill(true)}
                        className={`flex-1 py-1.5 font-medium transition-colors ${maxFill ? "bg-stone-900 text-white" : "bg-white text-stone-500 hover:bg-stone-50"}`}
                      >Max Fill</button>
                    </div>
                    {maxFill && (
                      <p className="text-xs text-amber-600 mt-2 flex items-start gap-1">
                        <AlertTriangle size={11} className="mt-0.5 flex-shrink-0" />
                        Over-sizing may extend payback beyond 10 years under NEM 3.0
                      </p>
                    )}
                  </div>
                </div>
              )}

              <div className="bg-stone-900 rounded-2xl p-5 text-white shadow-md">
                <p className="text-xs text-stone-400 mb-1">System Capacity</p>
                <p className="text-3xl font-bold text-amber-400 num">{activeSystemKwp.toFixed(2)} <span className="text-lg font-normal text-stone-300">kWp</span></p>
                <p className="text-xs text-stone-400 mt-1 num">{activePanelCount} × {FIXED_MODULE.wattage} Wp modules</p>
              </div>

              <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-5">
                <p className="text-xs text-stone-500 mb-1">Annual Energy Yield</p>
                <p className="text-2xl font-bold text-stone-900 num">{activeAnnualKwh.toLocaleString()} <span className="text-sm font-normal text-stone-400">kWh</span></p>
                <p className="text-xs text-stone-400 mt-1">4.5h PSH · 85% PR · {weightedFactor.toFixed(2)}× orientation</p>
              </div>

              <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-5">
                <p className="text-xs text-stone-500 mb-2">Bill Coverage</p>
                <div className="flex items-end gap-2 mb-3">
                  <p className="text-3xl font-bold text-emerald-600 num">{financial.offsetPercent}%</p>
                  <p className="text-xs text-stone-400 mb-1">of consumption</p>
                </div>
                <div className="relative w-full bg-stone-100 rounded-full h-3 overflow-hidden">
                  <div className="h-full bg-emerald-500 transition-all duration-500" style={{ width:`${Math.min(100, financial.offsetPercent)}%` }} />
                </div>
                {financial.offsetPercent >= 100 && (
                  <div className="mt-2 flex items-center gap-1 text-xs text-emerald-600 font-medium">
                    <Check size={12} /> Fully Offset
                  </div>
                )}
              </div>

              <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-5">
                <div className="flex items-center gap-2 mb-1">
                  <Wallet size={14} className="text-stone-400" />
                  <p className="text-xs text-stone-500">Monthly Savings</p>
                </div>
                <p className="text-2xl font-bold text-emerald-600 num">RM {financial.monthlySavings.toLocaleString()}</p>
                <p className="text-xs text-stone-400 mt-1 num">RM {financial.annualSavings.toLocaleString()} / year</p>
              </div>

              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5">
                <p className="text-xs text-amber-700 mb-1">Payback Period</p>
                <p className="text-3xl font-bold text-amber-800 num">{financial.paybackYears} <span className="text-lg font-normal">years</span></p>
                <p className="text-xs text-amber-600 mt-1 num">System cost: RM {financial.systemCost.toLocaleString()}</p>
              </div>

              <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-5">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs text-stone-500">25-Year Net Profit</p>
                  <TrendingUp size={14} className="text-emerald-500" />
                </div>
                <p className="text-3xl font-bold text-emerald-600 num">RM {financial.lifetimeProfit.toLocaleString()}</p>
                <p className="text-xs text-stone-400 mt-1">After system cost · 0.5%/yr degradation</p>
              </div>

              <button
                onClick={() => setStep(6)}
                className="w-full bg-stone-900 hover:bg-stone-800 text-white font-semibold py-3 rounded-xl text-sm transition-colors flex items-center justify-center gap-2"
              >
                <FileText size={15} /> Generate Report
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 6: PROFESSIONAL REPORT ───────────────────────────────────── */}
        {step === 6 && result && imageUrl && financial && (
          <Step6Report
            projectName={projectName}
            clientName={clientName}
            imageUrl={imageUrl}
            result={result}
            activeObstacles={activeObstacles}
            activePolygon={activePolygon}
            activePanels={activePanels}
            expansionPanels={expansionPanels}
            planes={planes}
            calibration={calibration}
            imageAspect={imageAspect}
            packedById={packedById}
            consumptionKwh={consumptionKwh}
            estimatedBill={estimatedBill}
            sizing={sizing}
            maxFill={maxFill}
            roofCapacity={roofCapacity}
            activePanelCount={activePanelCount}
            activeSystemKwp={activeSystemKwp}
            activeAnnualKwh={activeAnnualKwh}
            financial={financial}
            weightedFactor={weightedFactor}
          />
        )}
      </div>

      {/* ── Project history modal ────────────────────────────────────────── */}
      <ProjectHistory open={showHistory} onClose={() => setShowHistory(false)} onLoad={handleLoadProject} />

      {/* ── Obstacle type dialog ─────────────────────────────────────────── */}
      {pendingBBox && (
        <div className="fixed inset-0 bg-stone-900/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xs p-6">
            <h3 className="font-semibold text-stone-900 mb-1">Select Obstacle Type</h3>
            <p className="text-xs text-stone-400 mb-4">What did you mark on the rooftop?</p>
            <div className="grid grid-cols-2 gap-2">
              {ADDABLE_OBSTACLE_TYPES.map(t => {
                const Icon = OBSTACLE_ICONS[t.type] ?? LayoutGrid;
                return (
                  <button key={t.type} onClick={() => addObstacle(t.type)}
                    className="flex items-center gap-2 text-sm text-stone-700 font-medium px-3 py-2.5 rounded-xl border border-stone-200 hover:border-amber-400 hover:bg-amber-50 transition-colors">
                    <Icon size={15} className="text-stone-400" /> {t.label}
                  </button>
                );
              })}
            </div>
            <button onClick={() => setPendingBBox(null)}
              className="w-full mt-3 text-xs text-stone-400 hover:text-stone-600 py-2">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── Start over confirmation ───────────────────────────────────────── */}
      {showConfirmReset && (
        <div className="fixed inset-0 bg-stone-900/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <h3 className="font-semibold text-stone-900 mb-2">Start a new analysis?</h3>
            <p className="text-sm text-stone-500 mb-6">Your current progress will be lost.</p>
            <div className="flex gap-3">
              <button onClick={() => setShowConfirmReset(false)}
                className="flex-1 border border-stone-200 rounded-xl py-2.5 text-sm text-stone-600 hover:bg-stone-50 transition-colors">
                Cancel
              </button>
              <button onClick={() => { reset(); setShowConfirmReset(false); }}
                className="flex-1 bg-stone-900 hover:bg-stone-800 text-white rounded-xl py-2.5 text-sm font-semibold transition-colors">
                Start Over
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

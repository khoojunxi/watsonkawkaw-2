"use client";

import { Printer, ArrowLeft } from "lucide-react";
import type { Obstacle, Panel, Point, BBox } from "@/components/RoofCanvas";
import RoofCanvas from "@/components/RoofCanvas";
import { planeColor, type RoofPlane, type Calibration, type PlanePackResult, FIXED_MODULE } from "@/lib/geometry";
import { resolveOrientation, orientationFactor, azimuthLabel } from "@/lib/orientation";
import { getObstacleDefinition } from "@/lib/obstacles";
import type { BillBreakdown } from "@/lib/tnb";

interface FinancialAnalysis {
  systemCost: number;
  monthlySavings: number;
  annualSavings: number;
  paybackYears: number;
  lifetimeProfit: number;
  offsetPercent: number;
}

interface NemSizing {
  targetKwp: number;
  recommendedPanels: number;
}

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

interface Props {
  projectName: string;
  clientName: string;
  imageUrl: string;
  result: AnalysisResult;
  activeObstacles: Obstacle[];
  activePolygon: Point[];
  activePanels: Panel[];
  expansionPanels: Panel[];
  planes: RoofPlane[];
  calibration: Calibration | null;
  imageAspect: number;
  packedById: Map<string, PlanePackResult>;
  consumptionKwh: number;
  estimatedBill: BillBreakdown | null;
  sizing: NemSizing | null;
  maxFill: boolean;
  roofCapacity: number;
  activePanelCount: number;
  activeSystemKwp: number;
  activeAnnualKwh: number;
  financial: FinancialAnalysis;
  weightedFactor: number;
}

export default function Step6Report(props: Props) {
  const {
    projectName, clientName, imageUrl, result, activeObstacles, activePolygon,
    activePanels, expansionPanels, planes, packedById, imageAspect,
    consumptionKwh, estimatedBill, sizing, maxFill,
    activePanelCount, activeSystemKwp, activeAnnualKwh, financial, weightedFactor,
  } = props;

  const today = new Date().toLocaleDateString("en-GB", {
    day: "2-digit", month: "long", year: "numeric",
  });

  return (
    <>
      {/* Print-only CSS — hides the rest of the chrome and tightens spacing */}
      <style jsx global>{`
        @media print {
          @page { size: A4; margin: 14mm; }
          body { background: white !important; }
          .print\\:hidden { display: none !important; }
          header { display: none !important; }
          main { background: white !important; padding: 0 !important; }
          .print-page { page-break-after: always; }
          .print-page:last-child { page-break-after: auto; }
          .no-shadow-print { box-shadow: none !important; border-color: #e7e5e4 !important; }
        }
      `}</style>

      {/* Toolbar — hidden in print */}
      <div className="print:hidden flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-stone-900">Report</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => history.back()}
            className="flex items-center gap-2 border border-stone-300 hover:bg-stone-50 text-stone-700 px-4 py-2 rounded-lg text-sm font-medium"
          >
            <ArrowLeft size={14} /> Back
          </button>
          <button
            onClick={() => window.print()}
            className="flex items-center gap-2 bg-stone-900 hover:bg-stone-800 text-white px-4 py-2 rounded-lg text-sm font-semibold"
          >
            <Printer size={14} /> Print / Save as PDF
          </button>
        </div>
      </div>

      {/* Report — A4-styled single column */}
      <div className="bg-white shadow rounded-xl border border-stone-200 p-8 max-w-[800px] mx-auto no-shadow-print">

        {/* ── Page 1: Cover + Site Summary ───────────────────────────────── */}
        <section className="print-page">
          {/* Header */}
          <div className="flex items-start justify-between border-b-2 border-stone-900 pb-4 mb-6">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <div className="w-7 h-7 bg-amber-500 rounded-md flex items-center justify-center">
                  <svg viewBox="0 0 24 24" fill="white" className="w-4 h-4">
                    <circle cx="12" cy="12" r="5" />
                  </svg>
                </div>
                <span className="font-bold text-stone-900 tracking-tight">SolarFit AI</span>
              </div>
              <p className="text-[10px] text-stone-500">Automated PV Layout Designer · ESUM × RExharge</p>
            </div>
            <div className="text-right text-[10px] text-stone-500">
              <p>Report generated</p>
              <p className="font-semibold text-stone-700">{today}</p>
            </div>
          </div>

          {/* Title */}
          <h1 className="text-3xl font-bold text-stone-900 mb-1">{projectName || "Solar PV Layout Report"}</h1>
          {clientName && <p className="text-sm text-stone-600 mb-6">Prepared for: <span className="font-semibold">{clientName}</span></p>}

          {/* Headline metrics */}
          <div className="grid grid-cols-4 gap-3 mb-6">
            <Metric label="System Capacity" value={`${activeSystemKwp.toFixed(2)}`} unit="kWp" highlight />
            <Metric label="Annual Yield" value={activeAnnualKwh.toLocaleString()} unit="kWh" />
            <Metric label="Payback" value={`${financial.paybackYears}`} unit="years" />
            <Metric label="25-yr Profit" value={`RM ${financial.lifetimeProfit.toLocaleString()}`} />
          </div>

          {/* Aerial photo */}
          <div className="rounded-lg overflow-hidden border border-stone-200 mb-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imageUrl} alt="Rooftop aerial" className="w-full" />
          </div>
          <p className="text-[10px] text-stone-500 italic mb-6">Figure 1 · Aerial photograph of the site rooftop.</p>

          {/* Site summary table */}
          <h2 className="text-base font-bold text-stone-900 border-l-4 border-amber-500 pl-2 mb-3">1. Site Summary</h2>
          <table className="w-full text-xs mb-6 border border-stone-200">
            <tbody>
              <RowKV k="Roof Type" v={result.roof.roof_type} />
              <RowKV k="Estimated Total Area" v={`${result.roof.estimated_total_area_sqm} m²`} />
              <RowKV k="Usable Area (AI estimate)" v={`${result.roof.usable_area_sqm} m²`} />
              <RowKV k="AI Detection Confidence" v={result.confidence} />
              <RowKV k="Obstacles Detected" v={`${activeObstacles.length}`} />
              <RowKV k="Roof Planes Drawn" v={`${planes.length}`} />
              <RowKV k="Monthly Consumption" v={consumptionKwh > 0 ? `${consumptionKwh} kWh` : "—"} />
              <RowKV k="Estimated Bill (pre-solar)" v={estimatedBill !== null ? `RM ${estimatedBill.total.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : "—"} />
            </tbody>
          </table>

          {result.engineer_notes && (
            <>
              <h3 className="text-sm font-bold text-stone-800 mb-2">AI Engineer&apos;s Notes</h3>
              <p className="text-xs text-stone-600 leading-relaxed mb-4 italic border-l-2 border-stone-300 pl-3">
                {result.engineer_notes}
              </p>
            </>
          )}
        </section>

        {/* ── Page 2: Layout + per-plane orientation ─────────────────────── */}
        <section className="print-page mt-8">
          <h2 className="text-base font-bold text-stone-900 border-l-4 border-amber-500 pl-2 mb-3">2. Solar Panel Layout</h2>
          <div className="rounded-lg overflow-hidden border border-stone-200 mb-2">
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
          <p className="text-[10px] text-stone-500 italic mb-4">
            Figure 2 · Final panel layout. {activePanelCount} active modules, {expansionPanels.length} reserved for future expansion.
          </p>

          {/* Per-plane orientation table */}
          <h3 className="text-sm font-bold text-stone-800 mb-2">2.1 Per-Plane Orientation</h3>
          <table className="w-full text-xs mb-6 border border-stone-200">
            <thead className="bg-stone-100 text-stone-700">
              <tr>
                <th className="text-left px-2 py-1.5">Plane</th>
                <th className="text-right px-2 py-1.5">Tilt</th>
                <th className="text-right px-2 py-1.5">Azimuth</th>
                <th className="text-center px-2 py-1.5">Facing</th>
                <th className="text-right px-2 py-1.5">Panels</th>
                <th className="text-right px-2 py-1.5">Yield ×</th>
              </tr>
            </thead>
            <tbody>
              {planes.map((pl, i) => {
                const r = resolveOrientation(pl, imageAspect);
                const f = orientationFactor(r.tiltDeg, r.azimuthDeg);
                const n = packedById.get(pl.id)?.panels.length ?? 0;
                return (
                  <tr key={pl.id} className="border-t border-stone-100">
                    <td className="px-2 py-1.5">
                      <span className="inline-block w-2 h-2 rounded-sm mr-1.5 align-middle" style={{ background: planeColor(i) }} />
                      {pl.name}
                    </td>
                    <td className="px-2 py-1.5 text-right num">{Math.round(r.tiltDeg)}°</td>
                    <td className="px-2 py-1.5 text-right num">{Math.round(r.azimuthDeg)}°</td>
                    <td className="px-2 py-1.5 text-center font-semibold">{azimuthLabel(r.azimuthDeg)}</td>
                    <td className="px-2 py-1.5 text-right num">{n}</td>
                    <td className="px-2 py-1.5 text-right num">{f.toFixed(2)}</td>
                  </tr>
                );
              })}
              <tr className="border-t-2 border-stone-300 bg-stone-50 font-semibold">
                <td className="px-2 py-1.5">Weighted average</td>
                <td colSpan={3} />
                <td className="px-2 py-1.5 text-right num">{activePanelCount}</td>
                <td className="px-2 py-1.5 text-right num">{weightedFactor.toFixed(2)}</td>
              </tr>
            </tbody>
          </table>

          {/* Obstacles table */}
          {activeObstacles.length > 0 && (
            <>
              <h3 className="text-sm font-bold text-stone-800 mb-2">2.2 Obstacles</h3>
              <table className="w-full text-xs mb-6 border border-stone-200">
                <thead className="bg-stone-100 text-stone-700">
                  <tr>
                    <th className="text-left px-2 py-1.5">#</th>
                    <th className="text-left px-2 py-1.5">Type</th>
                    <th className="text-right px-2 py-1.5">Shadow buffer</th>
                  </tr>
                </thead>
                <tbody>
                  {activeObstacles.map((o, i) => {
                    const def = getObstacleDefinition(o.type);
                    return (
                      <tr key={i} className="border-t border-stone-100">
                        <td className="px-2 py-1.5">{i + 1}</td>
                        <td className="px-2 py-1.5">{o.label ?? def.label}</td>
                        <td className="px-2 py-1.5 text-right num">{o.shadow_buffer_m} m</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}

          {/* Module spec */}
          <h3 className="text-sm font-bold text-stone-800 mb-2">2.3 Module Specification</h3>
          <table className="w-full text-xs mb-2 border border-stone-200">
            <tbody>
              <RowKV k="Manufacturer / Model" v="Trina Vertex N · TSM-NEG19RC.20" />
              <RowKV k="Dimensions" v={`${FIXED_MODULE.lengthM} × ${FIXED_MODULE.widthM} m`} />
              <RowKV k="Rated Power" v={`${FIXED_MODULE.wattage} Wp`} />
              <RowKV k="Modules Installed" v={`${activePanelCount} × ${FIXED_MODULE.wattage} Wp = ${activeSystemKwp.toFixed(2)} kWp`} />
              {expansionPanels.length > 0 && (
                <RowKV k="Reserved Slots" v={`${expansionPanels.length} (future expansion)`} />
              )}
            </tbody>
          </table>
        </section>

        {/* ── Page 3: Financial analysis ─────────────────────────────────── */}
        <section className="mt-8">
          <h2 className="text-base font-bold text-stone-900 border-l-4 border-amber-500 pl-2 mb-3">3. Financial Analysis</h2>
          <p className="text-xs text-stone-600 mb-4 leading-relaxed">
            System sized for {maxFill ? "maximum roof utilisation" : "75% self-consumption under Malaysia NEM 3.0"}.
            All figures use the Tenaga Nasional Berhad RP4 domestic tariff effective 1 July 2025.
            Yield assumes 4.5 peak-sun-hours, 85% performance ratio, and a weighted orientation factor of {weightedFactor.toFixed(2)}×.
          </p>

          <table className="w-full text-xs mb-6 border border-stone-200">
            <tbody>
              <RowKV k="Installed Capacity" v={`${activeSystemKwp.toFixed(2)} kWp · ${activePanelCount} modules`} />
              <RowKV k="Annual Yield (estimated)" v={`${activeAnnualKwh.toLocaleString()} kWh`} />
              <RowKV k="System Cost (turnkey)" v={`RM ${financial.systemCost.toLocaleString()}`} />
              <RowKV k="Monthly Savings" v={`RM ${financial.monthlySavings.toLocaleString()}`} highlight />
              <RowKV k="Annual Savings" v={`RM ${financial.annualSavings.toLocaleString()}`} />
              <RowKV k="Bill Coverage" v={`${financial.offsetPercent}% of consumption`} />
              <RowKV k="Payback Period" v={`${financial.paybackYears} years`} highlight />
              <RowKV k="25-Year Net Profit" v={`RM ${financial.lifetimeProfit.toLocaleString()}`} highlight />
            </tbody>
          </table>

          {sizing && !maxFill && (
            <p className="text-xs text-stone-600 leading-relaxed mb-4">
              <strong>NEM 3.0 sizing:</strong> recommended {sizing.targetKwp} kWp ({sizing.recommendedPanels} modules)
              to match the household&apos;s annual consumption while keeping self-consumption near 75%. Excess
              generation exports at a reduced displaced rate, so deliberate oversize is only recommended when
              future loads (EV, additional A/C) are imminent.
            </p>
          )}

          {/* Sign-off */}
          <div className="grid grid-cols-2 gap-8 mt-12 pt-4 border-t border-stone-200">
            <div>
              <div className="h-12 border-b border-stone-400 mb-1" />
              <p className="text-[10px] text-stone-500">Engineer signature</p>
            </div>
            <div>
              <div className="h-12 border-b border-stone-400 mb-1" />
              <p className="text-[10px] text-stone-500">Client signature</p>
            </div>
          </div>

          {/* Disclaimer */}
          <p className="text-[9px] text-stone-400 leading-snug mt-8 italic">
            Disclaimer: This report is generated by SolarFit AI from an aerial photograph and engineer-entered
            site parameters. Actual yield depends on site conditions, shading, weather variability, and
            installation quality. Financial projections use the RP4 domestic tariff and assume no significant
            tariff change; AFA charges and time-of-use components are excluded. Final figures must be verified
            by an accredited solar professional before procurement or installation.
          </p>
        </section>
      </div>
    </>
  );
}

function RowKV({ k, v, highlight }: { k: string; v: string; highlight?: boolean }) {
  return (
    <tr className="border-b border-stone-100 last:border-b-0">
      <td className="px-3 py-1.5 text-stone-600 w-1/2">{k}</td>
      <td className={`px-3 py-1.5 text-right num ${highlight ? "font-bold text-stone-900" : "text-stone-800"}`}>{v}</td>
    </tr>
  );
}

function Metric({ label, value, unit, highlight }: { label: string; value: string; unit?: string; highlight?: boolean }) {
  return (
    <div className={`rounded-lg p-3 border ${highlight ? "bg-amber-50 border-amber-300" : "bg-stone-50 border-stone-200"}`}>
      <p className="text-[10px] text-stone-500 mb-0.5">{label}</p>
      <p className={`text-lg font-bold num ${highlight ? "text-amber-700" : "text-stone-900"}`}>
        {value}
        {unit && <span className="text-xs font-normal text-stone-500 ml-1">{unit}</span>}
      </p>
    </div>
  );
}

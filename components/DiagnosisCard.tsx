import { SeverityBadge, FaultTypeBadge } from "./FaultBadge";
import TroubleshootingSteps from "./TroubleshootingSteps";
import TicketForm from "./TicketForm";

export interface DiagnosisResult {
  fault_type: string;
  severity: string;
  resolution_type: string;
  confidence: number;
  fault_summary: string;
  visual_findings: string[];
  led_status: string | null;
  error_code: string | null;
  steps: { step: number; action: string; detail: string }[];
  technician_notes: string | null;
  estimated_downtime: string;
  similar_cases: string;
}

export default function DiagnosisCard({ result, imageUrl }: { result: DiagnosisResult; imageUrl: string }) {
  const needsTechnician = result.resolution_type === "TECHNICIAN_REQUIRED";

  return (
    <div className="flex flex-col gap-5">
      {/* Summary banner */}
      <div
        className={`rounded-2xl p-5 border ${
          needsTechnician
            ? result.severity === "CRITICAL"
              ? "bg-red-50 border-red-200"
              : "bg-orange-50 border-orange-200"
            : "bg-green-50 border-green-200"
        }`}
      >
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-2 flex-wrap">
            <SeverityBadge severity={result.severity} />
            <FaultTypeBadge faultType={result.fault_type} />
            {result.error_code && (
              <span className="text-xs font-mono bg-slate-800 text-slate-100 px-2 py-1 rounded">
                {result.error_code}
              </span>
            )}
          </div>
          <div className="text-right flex-shrink-0">
            <p className="text-xs text-slate-500">AI Confidence</p>
            <p className="text-lg font-bold text-slate-700">{result.confidence}%</p>
          </div>
        </div>
        <p className="text-sm font-medium text-slate-800">{result.fault_summary}</p>
        <p className="text-xs text-slate-500 mt-1">
          Estimated downtime: <span className="font-medium text-slate-700">{result.estimated_downtime}</span>
        </p>
      </div>

      {/* Visual findings */}
      <div className="rounded-2xl border bg-white p-5">
        <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
          <span>🔍</span> Visual Findings
        </h3>
        <ul className="flex flex-col gap-2">
          {result.visual_findings.map((f, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-slate-600">
              <span className="text-slate-300 mt-0.5">•</span>
              {f}
            </li>
          ))}
        </ul>
        {result.led_status && (
          <div className="mt-3 pt-3 border-t border-slate-100 flex items-center gap-2 text-xs text-slate-500">
            <span>💡</span>
            <span>LED Status: <span className="text-slate-700 font-medium">{result.led_status}</span></span>
          </div>
        )}
      </div>

      {/* Troubleshooting steps */}
      <TroubleshootingSteps steps={result.steps} resolutionType={result.resolution_type} />

      {/* Technician ticket (only if needed) */}
      {needsTechnician && (
        <TicketForm
          faultType={result.fault_type}
          severity={result.severity}
          technicianNotes={result.technician_notes}
          imageUrl={imageUrl}
        />
      )}

      {/* Similar cases note */}
      <div className="rounded-xl bg-slate-50 border border-slate-200 px-4 py-3 text-xs text-slate-500">
        <span className="font-medium text-slate-600">Context: </span>{result.similar_cases}
      </div>
    </div>
  );
}

const severityConfig = {
  LOW: { bg: "bg-green-100", text: "text-green-800", border: "border-green-300", label: "Low" },
  MEDIUM: { bg: "bg-yellow-100", text: "text-yellow-800", border: "border-yellow-300", label: "Medium" },
  HIGH: { bg: "bg-orange-100", text: "text-orange-800", border: "border-orange-300", label: "High" },
  CRITICAL: { bg: "bg-red-100", text: "text-red-800", border: "border-red-300", label: "Critical ⚠️" },
};

const faultLabels: Record<string, string> = {
  LED_ERROR: "LED Error",
  CONNECTIVITY: "Connectivity Issue",
  PHYSICAL_DAMAGE: "Physical Damage",
  CABLE_CONNECTOR: "Cable / Connector",
  DISPLAY_ERROR: "Display Error",
  POWER_ISSUE: "Power Issue",
  OVERHEATING: "Overheating",
  NO_FAULT: "No Fault Detected",
  UNKNOWN: "Unknown Fault",
};

export function SeverityBadge({ severity }: { severity: string }) {
  const cfg = severityConfig[severity as keyof typeof severityConfig] ?? severityConfig.MEDIUM;
  return (
    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${cfg.bg} ${cfg.text} ${cfg.border}`}>
      {cfg.label}
    </span>
  );
}

export function FaultTypeBadge({ faultType }: { faultType: string }) {
  return (
    <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
      {faultLabels[faultType] ?? faultType}
    </span>
  );
}

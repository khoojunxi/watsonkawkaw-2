interface Step {
  step: number;
  action: string;
  detail: string;
}

export default function TroubleshootingSteps({
  steps,
  resolutionType,
}: {
  steps: Step[];
  resolutionType: string;
}) {
  const isUserResolvable = resolutionType === "USER_RESOLVABLE";

  return (
    <div className="rounded-2xl border bg-white overflow-hidden">
      <div
        className={`px-5 py-3 flex items-center gap-2 ${
          isUserResolvable
            ? "bg-green-50 border-b border-green-100"
            : "bg-orange-50 border-b border-orange-100"
        }`}
      >
        <span className="text-xl">{isUserResolvable ? "🔧" : "👨‍🔧"}</span>
        <div>
          <p className={`font-semibold text-sm ${isUserResolvable ? "text-green-800" : "text-orange-800"}`}>
            {isUserResolvable ? "You Can Fix This" : "Technician Intervention Required"}
          </p>
          <p className={`text-xs ${isUserResolvable ? "text-green-600" : "text-orange-600"}`}>
            {isUserResolvable
              ? "Follow the steps below to resolve the issue"
              : "Follow the interim steps while awaiting a technician"}
          </p>
        </div>
      </div>

      <div className="p-5 flex flex-col gap-4">
        {steps.map((s) => (
          <div key={s.step} className="flex gap-4">
            <div
              className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                isUserResolvable
                  ? "bg-green-100 text-green-700"
                  : "bg-orange-100 text-orange-700"
              }`}
            >
              {s.step}
            </div>
            <div className="pt-0.5">
              <p className="font-medium text-sm text-slate-800">{s.action}</p>
              <p className="text-xs text-slate-500 mt-0.5">{s.detail}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

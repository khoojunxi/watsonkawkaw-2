// TNB Tariff B (Domestic) — effective July 2025
// Source: Tenaga Nasional Berhad published rates
export const TARIFF_B_TIERS = [
  { upTo: 200, rate: 0.218 },   // 1-200 kWh: 21.8 sen
  { upTo: 300, rate: 0.334 },   // 201-300: 33.4 sen
  { upTo: 600, rate: 0.516 },   // 301-600: 51.6 sen
  { upTo: 900, rate: 0.546 },   // 601-900: 54.6 sen
  { upTo: Infinity, rate: 0.571 }, // 901+: 57.1 sen
];

// Tariff C1 (Commercial Low Voltage) flat-ish average
export const TARIFF_C1_AVG = 0.435;

// Calculate the kWh consumption that produces a given monthly bill (Tariff B inverse)
export function billToKwh(monthlyBillMyr: number): number {
  if (monthlyBillMyr <= 0) return 0;
  let remaining = monthlyBillMyr;
  let kwh = 0;
  let prevCap = 0;

  for (const tier of TARIFF_B_TIERS) {
    const tierKwh = tier.upTo === Infinity ? Infinity : tier.upTo - prevCap;
    const tierCostMax = tierKwh === Infinity ? Infinity : tierKwh * tier.rate;

    if (remaining <= tierCostMax) {
      kwh += remaining / tier.rate;
      return Math.round(kwh);
    }

    kwh += tierKwh === Infinity ? 0 : tierKwh;
    remaining -= tierCostMax;
    prevCap = tier.upTo === Infinity ? prevCap : tier.upTo;
  }
  return Math.round(kwh);
}

// Calculate bill from kWh (Tariff B progressive)
export function kwhToBill(kwh: number): number {
  if (kwh <= 0) return 0;
  let bill = 0;
  let prev = 0;
  for (const tier of TARIFF_B_TIERS) {
    const inTier = Math.min(kwh, tier.upTo) - prev;
    if (inTier <= 0) break;
    bill += inTier * tier.rate;
    prev = tier.upTo;
    if (kwh <= tier.upTo) break;
  }
  return Math.round(bill * 100) / 100;
}

// Marginal/effective rate for a given consumption level
export function effectiveRate(monthlyKwh: number): number {
  if (monthlyKwh <= 0) return TARIFF_B_TIERS[0].rate;
  return kwhToBill(monthlyKwh) / monthlyKwh;
}

// PV system constants (Malaysia)
export const PV_CONSTANTS = {
  PANEL_WATTAGE: 620,            // Wp per panel
  PANEL_LENGTH_M: 2.278,         // 2278mm
  PANEL_WIDTH_M: 1.134,          // 1134mm
  PANEL_AREA_SQM: 2.578,
  PEAK_SUN_HOURS: 4.5,           // Malaysia average
  SYSTEM_LOSSES: 0.15,           // 15% combined losses
  PERFORMANCE_RATIO: 0.85,       // 1 - losses
  COST_PER_KWP_MYR: 3500,        // typical installed cost in Malaysia (incl inverter, mounting, labour)
};

// Number of panels needed to fully offset given annual consumption (NEM 1:1)
export function panelsNeededForConsumption(annualKwh: number): {
  panels: number;
  kwp: number;
  cost: number;
} {
  const c = PV_CONSTANTS;
  const yieldPerPanelKwh = (c.PANEL_WATTAGE / 1000) * c.PEAK_SUN_HOURS * 365 * c.PERFORMANCE_RATIO;
  const panels = Math.ceil(annualKwh / yieldPerPanelKwh);
  const kwp = (panels * c.PANEL_WATTAGE) / 1000;
  const cost = kwp * c.COST_PER_KWP_MYR;
  return { panels, kwp, cost };
}

// ── NEM 3.0 System Sizing ─────────────────────────────────────────────────
// Malaysia NEM 3.0: self-consumption valued at full tariff rate,
// export valued at "Displaced Cost" (~8–12 sen). Sizing to 75% self-consumption
// maximises ROI under this asymmetric pricing.
export const NEM3 = {
  SELF_CONSUMPTION_RATIO: 0.75,   // Target self-consumption fraction
  PEAK_SUN_HOURS: 4.5,            // Malaysia average PSH
  PERFORMANCE_RATIO: 0.85,        // PR (1 − 15% losses)
  PANEL_WP: 620,                  // Module wattage
};

export function nemSizing(annualKwh: number): {
  targetKwp: number;           // Raw kWp target (before rounding to panels)
  recommendedPanels: number;   // Panels needed (ceiling)
  projectedYieldKwh: number;   // Actual yield with recommendedPanels installed
} {
  const rawKwp = (annualKwh * NEM3.SELF_CONSUMPTION_RATIO) /
    (NEM3.PEAK_SUN_HOURS * 365 * NEM3.PERFORMANCE_RATIO);
  const recommendedPanels = Math.ceil((rawKwp * 1000) / NEM3.PANEL_WP);
  const actualKwp = (recommendedPanels * NEM3.PANEL_WP) / 1000;
  const projectedYieldKwh =
    Math.round(actualKwp * NEM3.PEAK_SUN_HOURS * 365 * NEM3.PERFORMANCE_RATIO * 10) / 10;
  return {
    targetKwp: Math.round(rawKwp * 100) / 100,
    recommendedPanels,
    projectedYieldKwh,
  };
}

// Financial analysis given installed system and bill
export function financialAnalysis(
  installedPanels: number,
  installedKwp: number,
  annualYieldKwh: number,
  monthlyBillMyr: number
) {
  const c = PV_CONSTANTS;
  const annualConsumptionKwh = billToKwh(monthlyBillMyr) * 12;
  const offsetKwh = Math.min(annualYieldKwh, annualConsumptionKwh);
  const remainingKwh = Math.max(0, annualConsumptionKwh - offsetKwh);
  const effRate = effectiveRate(billToKwh(monthlyBillMyr));

  const annualSavings = offsetKwh * effRate;
  const systemCost = installedKwp * c.COST_PER_KWP_MYR;
  const paybackYears = systemCost / Math.max(annualSavings, 1);
  const offsetPercent = annualConsumptionKwh > 0 ? (offsetKwh / annualConsumptionKwh) * 100 : 0;

  // 25-year lifetime projection (panels degrade ~0.5%/yr → average 90% over lifetime)
  const lifetimeSavings = annualSavings * 25 * 0.9;
  const lifetimeProfit = lifetimeSavings - systemCost;

  return {
    annualConsumptionKwh,
    offsetKwh: Math.round(offsetKwh),
    remainingKwh: Math.round(remainingKwh),
    offsetPercent: Math.round(offsetPercent),
    annualSavings: Math.round(annualSavings),
    monthlySavings: Math.round(annualSavings / 12),
    systemCost: Math.round(systemCost),
    paybackYears: Math.round(paybackYears * 10) / 10,
    lifetimeProfit: Math.round(lifetimeProfit),
    effectiveRate: effRate,
  };
}

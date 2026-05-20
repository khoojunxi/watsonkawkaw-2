// ── Malaysia TNB Domestic Tariff — effective 1 July 2025 (RP4 "Tariff Reform") ──
// Rates reconciled cent-for-cent against a real TNB bill ("Pecahan Pengiraan Bil
// Anda"). AFA (Automatic Fuel Adjustment) is intentionally excluded — it changes
// every month and can swing either way, so it cannot be forecast.
export const TNB_TARIFF = {
  ENERGY_LOW:  0.2703,  // RM/kWh — when total monthly usage ≤ 1500 kWh
  ENERGY_HIGH: 0.3703,  // RM/kWh — when usage > 1500 kWh (applies to ALL kWh)
  CAPACITY:    0.0455,  // RM/kWh
  NETWORK:     0.1285,  // RM/kWh
  RETAIL:      10.00,   // RM/month — waived when usage ≤ 600 kWh
  TIER_KWH:        1500, // whole-consumption tier boundary
  RETAIL_FREE_KWH:  600,
  ST_RATE:         0.08, // service tax — on the usage charge for kWh above 600
  ST_THRESHOLD_KWH: 600,
  KWTBB_RATE:     0.016, // renewable-energy fund (KWTBB)
  KWTBB_FREE_KWH:   300, // KWTBB waived when usage ≤ 300 kWh
} as const;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Energy rate (RM/kWh) — whole-consumption tier: cross 1500 kWh and ALL kWh jump. */
export function energyRate(monthlyKwh: number): number {
  return monthlyKwh > TNB_TARIFF.TIER_KWH ? TNB_TARIFF.ENERGY_HIGH : TNB_TARIFF.ENERGY_LOW;
}

export interface BillBreakdown {
  kwh: number;
  energy: number;
  capacity: number;
  network: number;
  retail: number;
  serviceTax: number;
  kwtbb: number;
  total: number;          // RM/month
  effectiveRate: number;  // RM/kWh, all-in average
}

/** Full itemised monthly TNB bill for a given consumption (kWh). */
export function tariffBill(monthlyKwh: number): BillBreakdown {
  const t = TNB_TARIFF;
  if (monthlyKwh <= 0) {
    return { kwh: 0, energy: 0, capacity: 0, network: 0, retail: 0,
             serviceTax: 0, kwtbb: 0, total: 0, effectiveRate: 0 };
  }
  const eRate = energyRate(monthlyKwh);

  const energy   = monthlyKwh * eRate;
  const capacity = monthlyKwh * t.CAPACITY;
  const network  = monthlyKwh * t.NETWORK;
  const retail   = monthlyKwh > t.RETAIL_FREE_KWH ? t.RETAIL : 0;

  // Service tax 8% — on the usage charge for the kWh above 600 (retail is taxed too).
  const taxedKwh    = Math.max(0, monthlyKwh - t.ST_THRESHOLD_KWH);
  const taxedCharge = taxedKwh * (eRate + t.CAPACITY + t.NETWORK) + retail;
  const serviceTax  = taxedCharge * t.ST_RATE;

  // KWTBB 1.6% — on energy + capacity + network (retail excluded), waived ≤ 300 kWh.
  const kwtbb = monthlyKwh > t.KWTBB_FREE_KWH
    ? (energy + capacity + network) * t.KWTBB_RATE
    : 0;

  const total = energy + capacity + network + retail + serviceTax + kwtbb;
  return {
    kwh: monthlyKwh,
    energy: round2(energy), capacity: round2(capacity), network: round2(network),
    retail: round2(retail), serviceTax: round2(serviceTax), kwtbb: round2(kwtbb),
    total: round2(total), effectiveRate: total / monthlyKwh,
  };
}

// ── PV system economics (Malaysia) ────────────────────────────────────────────
export const PV_CONSTANTS = {
  PEAK_SUN_HOURS: 4.5,      // Malaysia average peak-sun-hours/day
  PERFORMANCE_RATIO: 0.85,  // 1 − 15% combined system losses
  COST_PER_KWP_MYR: 3500,   // typical installed cost (inverter, mounting, labour)
};

// ── NEM 3.0 System Sizing ──────────────────────────────────────────────────────
// Malaysia NEM 3.0: self-consumption valued at the full tariff rate, export at a
// low "displaced cost". Sizing to 75% self-consumption maximises ROI.
export const NEM3 = {
  SELF_CONSUMPTION_RATIO: 0.75,
  PEAK_SUN_HOURS: 4.5,
  PERFORMANCE_RATIO: 0.85,
  PANEL_WP: 620,            // matches FIXED_MODULE.wattage in lib/geometry.ts
};

export function nemSizing(annualKwh: number): {
  targetKwp: number;
  recommendedPanels: number;
  projectedYieldKwh: number;
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

// ── Solar financial analysis ───────────────────────────────────────────────────
/**
 * Savings = the drop in the monthly TNB bill once solar offsets self-consumed
 * energy, evaluated with the real tariff via tariffBill() — so the 1500 kWh tier
 * jump, the fixed retail charge and the taxes are all handled correctly.
 */
export function financialAnalysis(
  installedKwp: number,
  annualYieldKwh: number,
  monthlyKwh: number,
) {
  const annualConsumptionKwh = monthlyKwh * 12;

  const billBefore = tariffBill(monthlyKwh);
  // Solar offsets consumption month by month (cannot push usage below 0).
  const monthlyOffset = Math.min(annualYieldKwh / 12, monthlyKwh);
  const billAfter = tariffBill(monthlyKwh - monthlyOffset);

  const monthlySavings = billBefore.total - billAfter.total;
  const annualSavings = monthlySavings * 12;

  const systemCost = installedKwp * PV_CONSTANTS.COST_PER_KWP_MYR;
  const paybackYears = systemCost / Math.max(annualSavings, 1);

  const offsetKwh = Math.min(annualYieldKwh, annualConsumptionKwh);
  const offsetPercent = annualConsumptionKwh > 0
    ? (offsetKwh / annualConsumptionKwh) * 100
    : 0;

  // 25-year lifetime projection (panels degrade ~0.5%/yr → ~90% average output).
  const lifetimeProfit = annualSavings * 25 * 0.9 - systemCost;

  return {
    annualConsumptionKwh,
    billBefore,
    offsetKwh: Math.round(offsetKwh),
    offsetPercent: Math.round(offsetPercent),
    annualSavings: Math.round(annualSavings),
    monthlySavings: Math.round(monthlySavings),
    systemCost: Math.round(systemCost),
    paybackYears: Math.round(paybackYears * 10) / 10,
    lifetimeProfit: Math.round(lifetimeProfit),
    effectiveRate: billBefore.effectiveRate,
  };
}

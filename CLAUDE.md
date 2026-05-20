# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

All commands run from this directory (`ev-charger-ai/`, package name `watsonkawkaw2`):

```bash
npm install        # first-time setup
npm run dev        # dev server at http://localhost:3000
npm run build      # production build
npm run start      # serve the production build
npm run lint       # ESLint (eslint-config-next)
```

There is no unit-test runner. `node test-samples.mjs` is an integration script that POSTs the
five images in `../rooftop picture/` to a **running** dev server's `/api/analyze` and prints
the parsed results — start `npm run dev` first.

Requires `.env.local` with `OPENAI_API_KEY` (copy `.env.example`). Missing key → the analyze
route throws and the UI shows "Analysis failed. Check your API key."

## What this project actually is

Despite the `ev-charger-ai` folder name and `THEME2_PLAYBOOK.md`, the **live application is
SolarFit AI** — an automated rooftop solar PV layout designer (competition Theme 3, see
`esumrecharge.md`). The project pivoted from Theme 2 (EV charger fault diagnosis) to Theme 3.

Leftover Theme 2 code is still present but **not reachable from the UI** — treat it as dead
code unless explicitly asked to revive it:
- `app/api/diagnose/route.ts`
- `components/FaultBadge.tsx`, `TroubleshootingSteps.tsx`, `DiagnosisCard.tsx`, `TicketForm.tsx`

The active Theme 3 surface is `app/page.tsx`, `app/api/analyze/route.ts`, `lib/`, and
`components/RoofCanvas.tsx` / `RoofEditor.tsx` / `PlaneEditor.tsx`.

## Architecture

Single Next.js 15 App Router codebase (React 19, Tailwind v4, TypeScript). Frontend and the
OpenAI vision calls live in the same project — no separate backend.

### The 5-step wizard (`app/page.tsx`)

`Home` is one large client component holding all state in `useState`. Steps:
1. **Upload** a rooftop aerial photo.
2. **AI Detection** — calls `/api/analyze`; user can hand-edit the roof polygon / obstacles.
3. **Draw Planes** — user manually traces roof planes, a calibration line, and per-plane ridge lines.
4. **Usage** — user enters monthly **kWh**; the TNB bill and NEM 3.0 sizing are computed.
5. **Solar Layout** — final packed layout, capacity, and financials.

### `/api/analyze` — two-pass GPT-4o vision

`route.ts` makes **two** sequential `gpt-4o` calls with `response_format: json_object`:
1. **Locate** — identify the primary roof by material texture, return a bounding box and a
   `low_coverage` flag (bails out early if the roof fills <15% of the image).
2. **Analyze** — trace an 8–16 point roof polygon, split it into flat `roof_faces` (each with
   its own `tile_angle_deg`), detect obstacles, estimate areas.

`retry=true` in the form data injects a stricter prompt addendum (used by the "Redetect" button).

### Coordinate systems — important

- All polygon / obstacle / panel coordinates are **percentages 0–100** of image width/height,
  never pixels. This keeps geometry resolution-independent.
- `lib/geometry.ts` converts to **"iso space"** by multiplying `x` by `imageAspect` (image
  W/H). Angles and panel rectangles are only correct in iso space; non-square images would
  otherwise skew. Always convert back (`x / imageAspect`) before storing as a percentage.

### Panel packing — two pathways, one core

`packFace()` in `lib/geometry.ts` is the shared grid-sweep: rotate a polygon by −θ into an
axis-aligned frame, sweep a regular grid, reject cells outside the polygon or overlapping
obstacle buffers, rotate accepted panels back by +θ.

Both pathways use one fixed panel: **`FIXED_MODULE`** in `lib/geometry.ts` — the single
source of truth (Trina Vertex N TSM-NEG19RC.20, **2.382 × 1.134 m, 620 Wp**). There is no
editable module spec; the Step-3 "Solar Module" card is read-only.

- **`packPanelsMultiFace()`** — server side, called by `/api/analyze`. Packs the AI-detected
  faces; scale (metres per iso-unit) is derived from the AI's `usable_area_sqm` estimate.
- **`packPlanes()`** — client side, called from `app/page.tsx` for the Step-3 manually-drawn
  planes. Scale comes from the user's **calibration line** of known real length, not from any
  AI estimate. Takes a `ModuleSpec` argument — `page.tsx` always passes `FIXED_MODULE`.

Each plane/face is packed on a grid aligned to its **ridge / tile angle**, so a hip roof gets
several differently-angled panel groups. Panels are then clipped so all 4 rotated corners sit
inside the roof outline.

### Financial / sizing logic (`lib/tnb.ts`)

- `TNB_TARIFF` + `tariffBill(monthlyKwh)` — the **RP4 domestic tariff** (effective 1 Jul
  2025), reconciled against a real bill: energy 27.03 sen/kWh (≤1500 kWh) **or** 37.03
  sen/kWh (>1500 — a *whole-consumption* tier: cross 1500 and every kWh jumps), capacity
  4.55, network 12.85, RM10 retail (waived ≤600 kWh), 8% service tax on usage above 600
  kWh, 1.6% KWTBB (waived ≤300 kWh). AFA is deliberately excluded. Step 4 inputs **kWh**,
  not RM.
- `nemSizing()` — Malaysia **NEM 3.0** sizing: targets 75% self-consumption, because export
  is paid at a low displaced rate. This is what "Smart Sizing" mode uses; "Max Fill" mode
  ignores it and uses full roof capacity.
- `financialAnalysis(installedKwp, annualYieldKwh, monthlyKwh)` — savings = the drop in
  `tariffBill()` once solar offsets self-consumed energy; plus payback and 25-year profit.
- Yield assumptions: 4.5 peak-sun-hours, 0.85 performance ratio (15% losses).
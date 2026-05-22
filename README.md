# SolarFit AI

**Automated Rooftop PV Layout Design Software for Malaysia**

> *ESUM x RExharge Case Study Competition · Theme 3 · Team Watson Kaw Kaw*

SolarFit AI is a web-based MVP that turns an aerial rooftop photo into a complete solar PV
design in minutes — usable roof boundary detection, obstacle avoidance, 620 Wp panel
packing, installed capacity, annual yield, and a Malaysian TNB / NEM 3.0 financial estimate.
What normally takes one to three hours of manual CAD + spreadsheet work is reduced to a
guided six-step workflow.

---

## What the MVP does

| Step | Screen | What happens |
| --- | --- | --- |
| 1 | **Upload** | User uploads a rooftop aerial image (JPEG/PNG). |
| 2 | **AI Detection** | Two-pass GPT-4o vision call locates the roof, traces an 8–16 point polygon, splits it into ridge-aligned faces, and flags obstacles. Meta SAM2 (via Replicate) refines the obstacle masks. The engineer can hand-edit anything. |
| 3 | **Draw Planes** | User traces roof planes, a calibration line of known real length (so we can convert pixels → metres), and per-plane ridge directions. |
| 4 | **Usage** | User enters monthly **kWh** consumption. The app computes the TNB RP4 domestic bill and the NEM 3.0 system size that targets 75 % self-consumption. |
| 5 | **Solar Layout** | A deterministic grid-sweep packs 620 Wp Trina Vertex N modules into each plane, respecting edge setbacks, row spacing, and a 1 m obstacle buffer. Returns installed capacity (kWp), annual yield (kWh), bill savings, payback, and 25-year profit. |
| 6 | **Report** | Single-page summary the user can screenshot or print for a customer. |

---

## Tech stack

- **Frontend & API:** Next.js 15 (App Router), React 19, TypeScript, Tailwind v4
- **Vision:** OpenAI GPT-4o (two-pass `response_format: json_object`)
- **Obstacle refinement:** Meta SAM2 via Replicate
- **Geometry & packing:** in-house deterministic solver in `lib/geometry.ts`
- **Financial logic:** Malaysian TNB RP4 tariff + NEM 3.0 sizing in `lib/tnb.ts`

No separate backend — everything runs inside the Next.js project.

---

## Quick start

You need **Node.js 18+**.

```bash
git clone https://github.com/khoojunxi/watsonkawkaw-2.git
cd watsonkawkaw-2
npm install
cp .env.example .env.local      # then open .env.local and paste your keys
npm run dev
```

Open **http://localhost:3000** and follow the six-step wizard. Sample rooftop images are in
the `rooftop picture/` folder of the submission bundle — drag one into Step 1 to try the
flow end-to-end.

> **Competition judges:** you don't need your own API keys. A pre-filled `.env.local`
> is in our Google Drive submission folder. Download it and place it in the cloned
> project folder (next to `package.json`) instead of running the `cp .env.example` step
> above.

### Required environment variables

| Variable | Required? | Where to get it |
| --- | --- | --- |
| `OPENAI_API_KEY` | **Yes** | https://platform.openai.com/api-keys |
| `REPLICATE_API_TOKEN` | Optional | https://replicate.com/account/api-tokens — without it, SAM2 silently falls back to OpenAI-only obstacle detection. |
| `OPENAI_VISION_MODEL` | Optional | Defaults to `gpt-4o`. Set to a newer vision model if available. |
| `ANALYZE_TWO_PASS` | Optional | `true` (default) runs the locate + analyze passes. Set `false` for a faster single-pass call. |

---

## Project structure

```
ev-charger-ai/                    ← folder name is a leftover from the Theme 2 pivot
├── app/
│   ├── page.tsx                  ← the 6-step wizard (single client component)
│   ├── layout.tsx
│   └── api/
│       └── analyze/route.ts      ← two-pass OpenAI vision + SAM2 fusion
├── components/
│   ├── RoofCanvas.tsx            ← interactive roof / obstacle editor
│   ├── RoofEditor.tsx
│   ├── PlaneEditor.tsx
│   └── Step6Report.tsx           ← final report screen
├── lib/
│   ├── geometry.ts               ← polygon math + panel grid-sweep packer
│   ├── tnb.ts                    ← TNB RP4 tariff + NEM 3.0 sizing
│   ├── solar.ts                  ← peak-sun-hours + performance ratio
│   ├── obstacles.ts              ← SAM2 ↔ OpenAI box matching
│   ├── replicate.ts              ← SAM2 client
│   └── …
├── .env.example                  ← copy to .env.local and fill in keys
└── package.json
```

A few Theme 2 (EV charger fault diagnosis) files are still present (`FaultBadge.tsx`,
`TroubleshootingSteps.tsx`, `DiagnosisCard.tsx`, `TicketForm.tsx`, `app/api/diagnose/route.ts`)
but are **not reachable from the live UI** — the project pivoted to Theme 3 and we left the
old code in place rather than delete it.

---

## Modelling assumptions

These are the numbers a judge can verify against the technical report:

- **Module:** Trina Vertex N TSM-NEG19RC.20, 2.382 m × 1.134 m, **620 Wp**
- **Spacing:** 0.02 m within row, 0.6 m row gap, 0.6 m edge setback, 1.0 m obstacle buffer
- **Yield:** 4.5 peak-sun-hours/day, 0.85 performance ratio (15 % losses)
- **Tariff:** TNB RP4 domestic, effective 1 Jul 2025 (energy 27.03 / 37.03 sen/kWh, capacity 4.55, network 12.85, RM10 retail, 8 % service tax above 600 kWh, 1.6 % KWTBB above 300 kWh). AFA excluded.
- **NEM:** NEM 3.0 sizing targets 75 % self-consumption

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `npm` not recognised | Reinstall Node.js LTS and restart your terminal. |
| Step 2 shows "Analysis failed. Check your API key." | `.env.local` is missing or `OPENAI_API_KEY` is empty/invalid. |
| Port 3000 already in use | Next.js will fall back to 3001 — use whatever URL it prints. |
| Obstacles look rough | Add a `REPLICATE_API_TOKEN` to `.env.local` to enable SAM2 mask refinement. |

---

## Submission bundle

The competition deliverables live in the Google Drive folder alongside this repo:

- **Demo video** — `Video Project 1.mp4`
- **Technical report** — `SolarFit_AI_Technical_Report.pdf`
- **Source code** — this repository

## Team

**Watson Kaw Kaw** — submitted for the ESUM x RExharge Case Study Competition, Theme 3
(Automated PV Layout Design Software).

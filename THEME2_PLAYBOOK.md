# 🚀 ESUM x RExharge Theme 2: Technical Playbook

**Project:** ChargeSense AI — Automated EV Charger Troubleshooting System
**Dev Strategy:** Prompt-Driven Development (Next.js + Vision AI)

---

## 1. Core Concept & Environment

We are building a web-based **AI-Powered EV Charger Diagnostic SaaS**.

**The Core Pipeline:**
User snaps a photo of a faulty EV charger ➡️ Vision AI inspects LED, display, cable, physical state ➡️ Classification engine decides whether the issue is **user-resolvable** or **technician-required** ➡️ System returns step-by-step guidance + auto-generates technician ticket if needed.

**Dev Environment (Prompt-Driven):**
This project leverages **VS Code + AI Agents (Cursor / GitHub Copilot / Claude Code)**. We do not hardcode every line — we write clear domain logic prompts (EV charger fault taxonomy, Malaysian operator standards) and let the LLM generate components, API routes, and classification logic.

---

## 2. Expected Deliverables

Based on competition guidelines, our system must deliver:

- **Working MVP Prototype**: A functional web app that accepts a charger photo, runs AI diagnosis, classifies fault type, and produces resolution steps.
- **Demo Video**: Walkthrough showing real fault cases being diagnosed (uploaded to YouTube, max 10 minutes).
- **Technical Report (Encouraged)**: Max 10-page PDF explaining system architecture, classification accuracy methodology, and operational impact on Malaysian EV networks.

---

## 3. Tech Stack

| Layer | Choice | Reason |
|---|---|---|
| Frontend | **Next.js 15 + Tailwind v4** | Fast iteration, server actions, beautiful UI |
| AI Vision | **GPT-4o** (or Claude Sonnet) | Best-in-class image reasoning, JSON mode |
| Backend | **Next.js API Routes** | Single-codebase, no separate Python server needed |
| State | React `useState` + URL params | Simple, no Redux overkill |
| Deployment | **Vercel** | Zero-config Next.js hosting |

> **Why no Python backend?** Unlike Theme 3 (heavy OpenCV math), Theme 2 is dominated by Vision LLM calls. Keeping it all in Next.js means **one repo, one deploy, no cold-start hell**.

---

## 4. The Communication Layer

Single Next.js codebase — frontend talks to its own `/api/diagnose` route. No CORS, no cold-start traps.

**Request flow:**
1. User uploads image → `FormData` with image + optional text description
2. Next.js API route → base64 encodes → calls OpenAI Vision
3. LLM returns strict JSON (`response_format: json_object`)
4. Frontend renders diagnosis cards, troubleshooting steps, ticket form

**The contract (JSON):**
```ts
{
  fault_type: "LED_ERROR" | "CONNECTIVITY" | "PHYSICAL_DAMAGE" | "CABLE_CONNECTOR"
            | "DISPLAY_ERROR" | "POWER_ISSUE" | "OVERHEATING" | "NO_FAULT" | "UNKNOWN",
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
  resolution_type: "USER_RESOLVABLE" | "TECHNICIAN_REQUIRED",
  confidence: number,           // 0–100
  fault_summary: string,
  visual_findings: string[],
  led_status: string | null,
  error_code: string | null,
  steps: { step: number, action: string, detail: string }[],
  technician_notes: string | null,
  estimated_downtime: string,
  similar_cases: string
}
```

---

## 5. The Agentic Brain

The core engine, split into two reasoning passes:

### Vision Sub-brain — "Seeing"
GPT-4o analyses the image for:
- **LED indicator state** (green / amber / red / blue / off, blinking patterns)
- **Display panel** (error codes like `E04`, status messages)
- **Physical condition** (cracks, burn marks, water damage, vandalism, corrosion)
- **Cable & connector** (fraying, bent pins, missing protective cap)

### Triage Sub-brain — "Deciding"
Classification logic via prompt engineering:
- **USER_RESOLVABLE** → Wi-Fi disconnect, charger reset needed, isolator off, loose connector
- **TECHNICIAN_REQUIRED** → Physical damage, electrical hazard, internal fault, burn marks, error codes pointing to hardware

Severity gates the urgency (`CRITICAL` = stop using immediately).

---

## 6. LLM & Autonomous Capabilities

We are not manually writing every line of code. We act as **Architects**.

**Example Prompt (used to scaffold our actual code):**
> "Write a Next.js API route that accepts a multipart form upload with an image and description. Encode to base64, call OpenAI GPT-4o with vision, return strict JSON with this schema: { fault_type, severity, resolution_type, confidence, steps[] }. Include rules: critical severity = electrical hazard."

**Example Prompt (for UI):**
> "Write a Tailwind React component that shows AI-detected fault badges colour-coded by severity (green/yellow/orange/red), a confidence bar, and a numbered troubleshooting steps list. Use rounded-2xl cards and a soft shadow."

We review, test, and integrate — the AI does the typing.

---

## 7. Technical Challenges

| Challenge | Mitigation |
|---|---|
| LLM hallucinates faults on a clean charger | Prompt includes `NO_FAULT` enum; confidence < 50% triggers "manual review" UI |
| Photos in low light / wrong angle | Frontend shows tips ("ensure LED is visible") + user description field supplements vision |
| Inconsistent JSON output | OpenAI `response_format: { type: "json_object" }` guarantees parseable JSON |
| Charger model variability (ChargEV vs TNB Electron vs EV Connection) | Prompt explicitly names major Malaysian operators so model frames findings in local context |

---

## 8. Technical Feasibility & Constraints

**Feasibility:** Absolutely doable. Vision LLMs (GPT-4o, Claude 4.x Sonnet) already solve general visual reasoning. An MVP within the hackathon window is realistic — **we have one working today**.

**Constraints:**
- No real fault dataset → we rely on zero-shot visual reasoning + curated synthetic test images
- No live OCPP backend → we simulate ticket dispatch, not actual technician assignment
- Cost: ~$0.01 per diagnosis (GPT-4o pricing) → cheap enough to demo freely

---

## 9. Operational Constraints (Competition Specific)

To score high against the rubric:

- **Classification Accuracy Demonstration:** Run our system across the 5 sample charger photos provided + 5 chargers we photograph at local sites. Track accuracy in a table for the report.
- **User-Resolvable vs Technician differentiation:** This is the rubric's headline metric. Our UI must visually scream this distinction (green vs orange banners).
- **Malaysian Context:** Steps reference Malaysian operators (ChargEV app, EV Connection hotline), MYR-denominated cost savings, and local technician dispatch realities (3-site/day baseline → reduced via AI triage).

---

## 10. Frontend Data Handling & Optimization (The "Payload" Trap)

Phone photos can be 8–15MB. Sending raw to a serverless API → timeout.

**Image Compression (Client-Side):**
Before upload, compress in-browser using a `<canvas>` resize to max 1280px width + JPEG quality 0.85. Cuts payload to ~300KB.

**State Management:**
Flow: `Upload → Analyse → Results → Submit Ticket`. Use plain `useState` (project is small). No Zustand needed.

---

## 11. Deployment Traps (The "Cold Start" Killer)

Next.js API routes on Vercel **also have cold starts** (~2–3 seconds). Plus OpenAI calls take 5–10s.

**Mitigation:**
- Show a clear **animated loading state** ("Analysing LED indicators... Inspecting cable condition...") so judges see progress, not a dead screen
- Pre-warm the route by hitting `/api/diagnose` on page load with a HEAD request
- Keep a **Demo Mode** fallback (see §13)

---

## 12. Advanced Domain Logic: Multi-Step Reasoning (The "Wow" Factor)

Simple classification is table stakes. To score on **Innovation**, we go further:

**Estimated Downtime Calculation:**
The system returns not just a fault, but **a time estimate**:
- User-resolvable LED reset → "5 minutes"
- Connectivity issue → "10–20 minutes (depends on Wi-Fi)"
- Physical damage → "Pending technician visit (4–8 business hours)"

**Technician Triage Score:**
Auto-prioritises tickets by severity. The dashboard could show "12 tickets queued, 4 critical — dispatch in this order."

**Similar Cases Context:**
Each diagnosis includes "Common in Malaysian EV infrastructure because..." — judges love that local awareness.

---

## 13. Graceful Degradation & Demo Fallbacks (Hackathon Survival Net)

**The "Mock" API Toggle:**
Triple-click the logo → switches to Demo Mode.
- Loads pre-canned JSON for 3 specific charger photos we ship in `/public/demo/`
- Guarantees a flawless demo even if Wi-Fi dies on stage

**Implementation:**
```ts
if (demoMode) {
  return demoFixtures[imageHash] ?? defaultDemoResponse;
}
```

---

## 14. Edge Cases & Input Validation

LLMs hallucinate. What if the user uploads a cat?

**Sanity Checks:**
- If `fault_type === "UNKNOWN"` AND `confidence < 30%` → UI shows "Image unclear — please retake closer to LED panel"
- If image fails to upload (>10MB, wrong type) → Frontend error toast before API call
- API key missing → friendly server error message, not a 500 white screen

**Error Boundaries:**
Wrap `<DiagnosisCard>` in a React Error Boundary. If JSON parse fails, show "Diagnosis temporarily unavailable, please try again" instead of crashing.

---

# 🗺️ RExharge ChargeSense AI: Team Action Roadmap

**Our Dev Strategy:** AI-Driven Development. Domain experts write prompts; AI writes code; humans review.

**Roles:**
- **Tech Lead:** Architecture, GitHub, API wiring, deployment.
- **Domain Lead:** Charger fault taxonomy, Malaysian operator knowledge, UX flows, prompt writing for AI.

---

## 🚩 Milestone 1 — SaaS Shell (UI & Infrastructure)

**Goal:** Get the app running and looking like commercial software.

- [x] Initialise Next.js 15 + Tailwind v4 project
- [x] Setup GitHub repo, invite team
- [x] Base layout: header + centered upload card + results panel
- [x] `.env.local` with `OPENAI_API_KEY`

### Task A — Upload UI
**Prompt for AI:**
> "Write a React drag-and-drop image upload component using Tailwind. Show a placeholder when empty (camera icon, 'Drop charger photo'), and a preview with a red X to remove when an image is loaded. Validate file type is `image/*`."

### Task B — Results Dashboard
**Prompt for AI:**
> "Build a Tailwind card showing: SeverityBadge (colour-coded LOW/MEDIUM/HIGH/CRITICAL), fault type label, AI confidence percentage with progress bar, and a 'Findings' bulleted list."

✅ **Status: COMPLETE** (see `app/page.tsx`, `components/*.tsx`)

---

## 🚩 Milestone 2 — Vision Brain (AI Diagnosis Engine)

**Goal:** Charger photo in → structured fault JSON out.

- [x] Create `/api/diagnose` Next.js API route
- [x] Base64 encode uploaded image
- [x] Call OpenAI GPT-4o with vision input
- [x] Force JSON output via `response_format: { type: "json_object" }`

### Task A — Diagnostic Prompt
**Prompt for AI:**
> "Write a system prompt for GPT-4o that instructs it to inspect an EV charger image for LED status, display errors, physical damage, and cable issues. Output must match this JSON schema: { fault_type: enum, severity: enum, resolution_type, confidence, visual_findings[], steps[] }. Include the rule: CRITICAL severity means electrical hazard or fire risk."

### Task B — Test Data
- Photograph 5–10 real chargers around campus (some working, some faulty)
- Create a CSV: `image_path | expected_fault | actual_fault | accuracy`
- Goal: ≥75% classification accuracy on initial test set

✅ **Status: COMPLETE** (see `app/api/diagnose/route.ts`)

---

## 🚩 Milestone 3 — Classification & Resolution Logic

**Goal:** Differentiate user-resolvable vs technician-required, generate step-by-step fixes.

### Task A — Resolution Tree
Build a deterministic taxonomy:

| Fault Type | Default Resolution | Severity Bias |
|---|---|---|
| `LED_ERROR` (red blinking) | USER (try reset) | MEDIUM |
| `CONNECTIVITY` | USER (check Wi-Fi) | LOW |
| `PHYSICAL_DAMAGE` | TECHNICIAN | HIGH–CRITICAL |
| `CABLE_CONNECTOR` (visible burn) | TECHNICIAN | HIGH |
| `OVERHEATING` | TECHNICIAN | CRITICAL |

### Task B — Step Generation
**Prompt for AI:**
> "Given a fault_type and resolution_type, generate 3–5 numbered troubleshooting steps. If USER_RESOLVABLE, use plain Malaysian English ('Press the red button at the back of the charger for 10 seconds'). If TECHNICIAN_REQUIRED, output interim steps ('Do not use this charger. Place an Out-of-Service sign. Submit ticket below.')."

✅ **Status: COMPLETE** (handled in single prompt — see `route.ts`)

---

## 🚩 Milestone 4 — Ticketing & Dashboard Integration

**Goal:** When AI says "technician needed," the user can dispatch one with two clicks.

- [x] Build `<TicketForm>` component
- [x] Pre-fill fault type, severity, AI notes for technician
- [x] Collect: site name, charger unit ID, user contact
- [x] Generate ticket ID, show confirmation card
- [ ] **(Stretch)** Persist tickets to a `tickets.json` file or Supabase for a "tickets queue" page

### Task A — Operator Dashboard (Stretch)
**Prompt for AI:**
> "Build a `/dashboard` route in Next.js showing a table of all submitted tickets, sortable by severity. Each row: ticket ID, site, fault type, severity badge, timestamp, status (NEW / IN_PROGRESS / RESOLVED)."

✅ **Status: CORE COMPLETE** (TicketForm done; persistence is stretch goal)

---

## 🚩 Milestone 5 — Hackathon Survival & Pitch Prep

**Goal:** Flawless live demo on D-Day + commercial-grade pitch.

- [ ] **Demo Mode toggle** — Triple-click logo → switches to canned JSON for 3 specific test photos
- [ ] Record 10-min demo video showing 3 scenarios:
  1. Simple LED issue → user resolves in 5 minutes
  2. Connectivity issue → guided Wi-Fi reset
  3. Physical damage → ticket auto-dispatched to technician
- [ ] **Technical Report (PDF, ≤10 pages)**:
  - System architecture diagram
  - Classification accuracy table (from M2 test data)
  - Cost-benefit analysis: AI triage @ RM0.05/scan vs technician visit @ RM200
  - Malaysian EV market sizing
- [ ] **Pitch deck (15 minutes)**:
  - **Problem:** 1 technician = 3 sites/day max; many issues are trivial
  - **Solution:** AI triage routes 60% of issues to self-service
  - **Demo:** Live diagnosis on stage
  - **Business model:** B2B SaaS to ChargEV / EV Connection — RM0.50/charger/month

**Bonus AI ROI Summary:**
> "Based on this diagnosis, estimated technician dispatch saving: RM 200. Time saved: 3 hours. Charger back online in 5 minutes via guided self-service."

---

# 🎯 Judging Rubric Alignment

| Criterion | How We Score |
|---|---|
| **Detects & classifies faults** | 9 fault types, severity, confidence % — all visible in UI |
| **Visual anomaly identification** | GPT-4o lists specific findings (cracks, burns, LED state) per image |
| **User-fix vs technician decision** | Headline binary classification, colour-coded UI |
| **Classification accuracy** | Test set CSV + accuracy table in Technical Report |
| **Innovation** | Estimated downtime, severity-prioritised triage, demo fallback |
| **Malaysian context** | Operator names, MYR savings, local technician constraints |
| **Operational efficiency** | Single Next.js codebase, ≤10s diagnosis, no cold-start hell |

---

**Current implementation:** Milestones 1–4 are functional in `C:\UM\Claude watson kaw kaw deal\ev-charger-ai\`. Remaining work is Milestone 5 (demo mode + report + pitch).

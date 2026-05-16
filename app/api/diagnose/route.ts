import OpenAI from "openai";
import { NextRequest, NextResponse } from "next/server";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get("image") as File | null;
  const description = (formData.get("description") as string) || "";

  if (!file) return NextResponse.json({ error: "No image provided" }, { status: 400 });

  const bytes = await file.arrayBuffer();
  const base64 = Buffer.from(bytes).toString("base64");
  const mediaType = file.type || "image/jpeg";
  const dataUrl = `data:${mediaType};base64,${base64}`;

  const prompt = `You are an expert EV charger technician AI for Malaysia's EV charging network (similar to ChargEV, EV Connection, TNB Electron). Analyse this EV charger image and provide a structured fault diagnosis in JSON.

User's description of the problem: "${description || "No description provided"}"

Analyse the image carefully for:
- LED indicator colours and patterns (green=normal, red=fault, amber=warning, blue=charging, no light=offline/power issue)
- Display panel error codes or messages
- Physical damage: cracks, burn marks, water damage, corrosion, vandalism
- Cable and connector condition: fraying, bent pins, missing cap
- Charger status screen content
- Any visible hardware anomalies

Return ONLY a valid JSON object with this exact structure:
{
  "fault_type": "<one of: LED_ERROR | CONNECTIVITY | PHYSICAL_DAMAGE | CABLE_CONNECTOR | DISPLAY_ERROR | POWER_ISSUE | OVERHEATING | NO_FAULT | UNKNOWN>",
  "severity": "<one of: LOW | MEDIUM | HIGH | CRITICAL>",
  "resolution_type": "<one of: USER_RESOLVABLE | TECHNICIAN_REQUIRED>",
  "confidence": <number 0-100>,
  "fault_summary": "<1-2 sentence summary of what is wrong>",
  "visual_findings": ["<finding 1>", "<finding 2>", "<finding 3>"],
  "led_status": "<description of LED state if visible, else null>",
  "error_code": "<error code if visible on display, else null>",
  "steps": [
    { "step": 1, "action": "<what to do>", "detail": "<how to do it>" }
  ],
  "technician_notes": "<notes for technician if intervention needed, else null>",
  "estimated_downtime": "<e.g. 5 minutes | 1-2 hours | Pending technician visit>",
  "similar_cases": "<brief note on common occurrences of this fault in Malaysian EV infrastructure>"
}

Rules:
- steps should be user-facing if USER_RESOLVABLE (max 5 steps, plain language)
- steps should be interim user actions if TECHNICIAN_REQUIRED (e.g. "do not use charger", "report via app")
- severity CRITICAL = fire risk, electrical hazard, severe physical damage
- severity HIGH = charger completely down, needs technician
- severity MEDIUM = partial function, user can attempt fix
- severity LOW = minor, user easily fixable`;

  const response = await client.chat.completions.create({
    model: "gpt-4o",
    max_tokens: 2048,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ],
  });

  const raw = response.choices[0].message.content ?? "{}";
  const result = JSON.parse(raw);

  return NextResponse.json(result);
}

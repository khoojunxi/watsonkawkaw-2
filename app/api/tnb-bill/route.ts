import OpenAI from "openai";
import { NextRequest, NextResponse } from "next/server";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const VISION_MODEL = process.env.OPENAI_VISION_MODEL || "gpt-4o";

type Confidence = "high" | "medium" | "low";

function confidence(value: unknown): Confidence {
  return value === "high" || value === "medium" || value === "low" ? value : "low";
}

function monthlyKwh(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value.replace(/,/g, "")) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.round(n * 10) / 10 : null;
}

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get("image") as File | null;
  if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });

  const fileName = (file.name || "").toLowerCase();
  const isPdf = file.type === "application/pdf" || fileName.endsWith(".pdf");
  const isImage = file.type.startsWith("image/");
  if (!isImage && !isPdf) {
    return NextResponse.json({ error: "Please upload an image or PDF file" }, { status: 400 });
  }

  const bytes = await file.arrayBuffer();
  const base64 = Buffer.from(bytes).toString("base64");
  const mediaType = isPdf ? "application/pdf" : (file.type || "image/jpeg");
  const dataUrl = `data:${mediaType};base64,${base64}`;

  const prompt = `You extract monthly electricity usage from Malaysian TNB bill documents (image or PDF).

Find the customer's current monthly electricity consumption in kWh. Prefer fields labelled "Jumlah Penggunaan Anda", "Penggunaan", "Total Usage", "kWh", or "unit". Do not return RM amounts, tariff rates, account numbers, meter numbers, tax values, or day counts. If the bill shows multiple months, use the current/latest billing period total.

Return JSON only:
{
  "monthly_kwh": <number or null>,
  "confidence": "high" | "medium" | "low",
  "notes": "<short reason>"
}`;

  // A PDF goes in as a `file` content part; an image as an `image_url` part.
  const billContent = isPdf
    ? { type: "file" as const, file: { filename: file.name || "tnb-bill.pdf", file_data: dataUrl } }
    : { type: "image_url" as const, image_url: { url: dataUrl, detail: "high" as const } };

  const response = await client.chat.completions.create({
    model: VISION_MODEL,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          billContent,
        ],
      },
    ],
  });

  const raw = response.choices[0].message.content ?? "{}";
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = {};
  }

  return NextResponse.json({
    monthly_kwh: monthlyKwh(parsed.monthly_kwh),
    confidence: confidence(parsed.confidence),
    notes: typeof parsed.notes === "string" ? parsed.notes : "No readable monthly kWh field found.",
  });
}

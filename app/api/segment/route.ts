import { NextRequest, NextResponse } from "next/server";
import { runSam } from "@/lib/replicate";

// SAM 2 cold starts on Replicate can take a while — give the route headroom.
export const maxDuration = 120;

/**
 * POST /api/segment
 *
 * Body: multipart form-data with a single `image` file.
 * Runs SAM 2 (Replicate, automatic mode) and returns every object mask it
 * found, inlined as data URLs so the browser can read their pixels directly.
 * The client (lib/mask.ts + page.tsx) selects the roof masks, traces them
 * into a precise polygon, and snaps obstacles onto the matching small masks.
 *
 * On any failure this returns a non-2xx status; the caller falls back to
 * GPT-only geometry so the wizard still works.
 */
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("image") as File | null;
    if (!file) {
      return NextResponse.json({ error: "No image provided" }, { status: 400 });
    }

    const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");
    const mediaType = file.type || "image/jpeg";
    const dataUrl = `data:${mediaType};base64,${base64}`;

    const maskUrls = await runSam(dataUrl);
    if (maskUrls.length === 0) {
      return NextResponse.json({ masks: [] });
    }

    const masks = await Promise.all(
      maskUrls.map(async (url, i) => {
        try {
          if (url.startsWith("data:")) return { id: i, dataUrl: url };
          const res = await fetch(url);
          if (!res.ok) return null;
          const buf = Buffer.from(await res.arrayBuffer());
          const type = res.headers.get("content-type") || "image/png";
          return { id: i, dataUrl: `data:${type};base64,${buf.toString("base64")}` };
        } catch {
          return null;
        }
      })
    );

    const filtered = masks.filter((m) => m !== null);
    console.log(
      `[/api/segment] SAM returned ${maskUrls.length} mask URLs, inlined ${filtered.length}`
    );
    return NextResponse.json({ masks: filtered });
  } catch (err) {
    console.error("[/api/segment]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Segmentation failed" },
      { status: 502 }
    );
  }
}

import "server-only";
import Replicate from "replicate";

// Thin server-only wrapper around Replicate for Meta's SAM 2.
//
// SAM 2 automatic mode segments every object in the image; the caller
// (lib/mask.ts + page.tsx) then picks the roof masks by size + overlap with
// GPT's rough polygon, and snaps GPT obstacle boxes onto the small SAM masks
// they best match. points_per_side defaults to 32 — the model's full-recall
// setting — because precision (catching every obstacle, tight roof outline)
// matters more than per-run cost for this product.

const SAM_MODEL = process.env.REPLICATE_SAM_MODEL || "meta/sam-2";

let cached: Replicate | null = null;
let resolvedRef:
  | `${string}/${string}`
  | `${string}/${string}:${string}`
  | null = null;

function getClient(): Replicate {
  const auth = process.env.REPLICATE_API_TOKEN;
  if (!auth) {
    throw new Error("REPLICATE_API_TOKEN is not set");
  }
  if (!cached) cached = new Replicate({ auth, useFileOutput: false });
  return cached;
}

/**
 * Resolve the model reference. Bare `owner/model` only runs for Replicate
 * "official models"; meta/sam-2 needs an explicit version hash, looked up once.
 */
async function resolveModelRef(
  replicate: Replicate
): Promise<`${string}/${string}` | `${string}/${string}:${string}`> {
  if (resolvedRef) return resolvedRef;

  if (SAM_MODEL.includes(":")) {
    resolvedRef = SAM_MODEL as `${string}/${string}:${string}`;
    return resolvedRef;
  }

  const [owner, name] = SAM_MODEL.split("/");
  if (!owner || !name) {
    throw new Error(`Invalid REPLICATE_SAM_MODEL: "${SAM_MODEL}"`);
  }
  const model = await replicate.models.get(owner, name);
  const version = model.latest_version?.id;
  if (!version) {
    throw new Error(`Could not resolve a version for ${SAM_MODEL}`);
  }
  resolvedRef = `${SAM_MODEL}:${version}` as `${string}/${string}:${string}`;
  return resolvedRef;
}

/** Walk SAM 2's output and collect every individual object-mask URL. */
function collectMaskUrls(output: unknown): string[] {
  const urls: string[] = [];
  const visit = (v: unknown) => {
    if (v == null) return;
    if (typeof v === "string") {
      if (/^(https?:|data:)/.test(v)) urls.push(v);
      return;
    }
    if (Array.isArray(v)) {
      v.forEach(visit);
      return;
    }
    if (typeof v === "object") {
      const o = v as Record<string, unknown>;
      if (Array.isArray(o.individual_masks)) {
        o.individual_masks.forEach(visit);
        return;
      }
      if (Array.isArray(o.masks)) {
        o.masks.forEach(visit);
        return;
      }
      if (typeof o.url === "function") {
        try {
          urls.push(String((o.url as () => unknown)()));
        } catch {
          /* ignore */
        }
        return;
      }
      Object.values(o).forEach(visit);
    }
  };
  visit(output);
  return urls;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run SAM 2 automatic segmentation and return URLs of every individual mask
 * (capped, de-duplicated). Retries politely through Replicate's rate limit.
 */
export async function runSam(imageDataUrl: string): Promise<string[]> {
  const replicate = getClient();

  // Full-recall sampling — the precision lever the user explicitly asked for.
  const input: Record<string, unknown> = {
    image: imageDataUrl,
    points_per_side: 32,
  };

  let lastErr: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const modelRef = await resolveModelRef(replicate);
      const output = await replicate.run(modelRef, { input });
      return Array.from(new Set(collectMaskUrls(output))).slice(0, 120);
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);

      // Rate limited — wait out the throttle window the API reports.
      if (/\b429\b|too many requests|throttl/i.test(msg)) {
        const m =
          msg.match(/"retry_after":\s*(\d+)/i) ||
          msg.match(/resets?\s+in\s+~?(\d+)\s*s/i);
        await sleep(((m ? Number(m[1]) : 10) + 3) * 1000);
        continue;
      }

      // Optional knob rejected — drop it and retry.
      if (
        "points_per_side" in input &&
        /\b422\b|points_per_side|invalid|unexpected/i.test(msg)
      ) {
        delete input.points_per_side;
        continue;
      }

      throw err;
    }
  }

  throw lastErr instanceof Error
    ? lastErr
    : new Error("SAM segmentation failed after retries");
}

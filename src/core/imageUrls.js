import { MAX_PHOTOS_PER_ORDER } from "../domain/printPricingService.js";

/**
 * Validate the image URL(s) of a print request. Accepts either:
 *   - `imageUrls`: string[] (preferred — multi-photo bundles)
 *   - `imageUrl`:  string   (legacy — single photo)
 * With `ownStorageOnly`, every URL must point at this project's Supabase Storage
 * (used where the server pays for the print, so it cannot be any URL on the internet).
 *
 * @param {{ imageUrl?: unknown, imageUrls?: unknown }} body
 * @param {{ ownStorageOnly?: boolean }} [options]
 * @returns {{ imageUrls: string[] } | { error: string }}
 */
export function parseImageUrls(body, { ownStorageOnly = false } = {}) {
  let raw;
  if (Array.isArray(body.imageUrls)) {
    raw = body.imageUrls;
  } else if (typeof body.imageUrl === "string") {
    raw = [body.imageUrl];
  } else {
    return { error: "imageUrl or imageUrls is required" };
  }

  if (raw.length === 0) {
    return { error: "imageUrls cannot be empty" };
  }
  if (raw.length > MAX_PHOTOS_PER_ORDER) {
    return { error: `at most ${MAX_PHOTOS_PER_ORDER} photos per order` };
  }

  const storageHost = ownStorageOnly ? supabaseHost() : null;
  for (const url of raw) {
    if (typeof url !== "string") {
      return { error: "each image URL must be a string" };
    }
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return { error: "invalid image URL" };
    }
    if (parsed.protocol !== "https:") {
      return { error: "image URLs must use https" };
    }
    if (storageHost && (parsed.host !== storageHost || !parsed.pathname.startsWith("/storage/v1/object/"))) {
      return { error: "image URLs must point at Fotoshop storage" };
    }
  }

  return { imageUrls: raw };
}

function supabaseHost() {
  try {
    return new URL(process.env.SUPABASE_URL ?? "").host;
  } catch {
    return null;
  }
}

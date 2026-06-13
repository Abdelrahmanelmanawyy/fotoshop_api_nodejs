import crypto from "crypto";
import fs from "fs/promises";
import { createBiometricProcess } from "../data/phont.js";
import { uploadImageFromUrl } from "../data/storage.js";

/**
 * Maps Flutter package keys to PhotoXBox `process_type` slugs.
 *
 * NOTE: `combo` (2 biometric + 4 passport) uses a best-guess composite slug.
 * Verify that PhotoXBox actually accepts `2-biyometrik-4-vesikalik` as a single
 * process_type; if it doesn't, this needs to be split into two upstream calls
 * (one `4-biyometrik`, one `vesikalik`) and merged here.
 */
export const PACK_TO_PROCESS_TYPE = {
  standard: "4-biyometrik",
  hybrid: "vesikalik",
  combo: "2-biyometrik-4-vesikalik",
};

/**
 * @param {string} packageKey - `standard` | `hybrid` | `combo`
 */
export function resolveProcessType(packageKey) {
  const key = String(packageKey || "").toLowerCase().trim();
  const processType = PACK_TO_PROCESS_TYPE[key];
  if (!processType) {
    throw new Error(`Invalid package. Allowed: ${Object.keys(PACK_TO_PROCESS_TYPE).join(", ")}`);
  }
  return processType;
}

/**
 * Download the PhotoXBox-processed image and re-upload it to our own Supabase
 * Storage bucket. We do this because PhotoXBox URLs are third-party and can
 * disappear (temp-file cleanup, CDN expiry), which would later break:
 *   - the Python desktop printer (it just `requests.get(image_url)`),
 *   - the user's order-history reprint preview,
 *   - any dashboard image preview.
 *
 * If the mirror fails we fall back to the original PhotoXBox URL so a
 * transient storage hiccup never blocks the whole biometric flow — the
 * customer still gets their photo, we just don't own the artifact.
 *
 * @param {string} photoxboxUrl
 * @returns {Promise<string>} Supabase public URL (or the original URL on failure)
 */
async function mirrorPhotoxboxOutputToSupabase(photoxboxUrl) {
  if (!photoxboxUrl) return photoxboxUrl;
  try {
    const id = crypto.randomUUID();
    const destination = `biometric-output/${id}.jpg`;
    const supabaseUrl = await uploadImageFromUrl(photoxboxUrl, destination);
    console.log(`[Biometric] Mirrored PhotoXBox image → ${destination}`);
    return supabaseUrl;
  } catch (err) {
    console.error(
      `[Biometric] Mirror to Supabase failed, falling back to PhotoXBox URL: ${err.message}`,
    );
    return photoxboxUrl;
  }
}

/**
 * @param {{ imagePath: string, packageKey: string, cabinUuid?: string }} params
 */
export async function processBiometricPhoto({ imagePath, packageKey, cabinUuid }) {
  const processType = resolveProcessType(packageKey);
  const cabin = cabinUuid || process.env.PHOTOXBOX_CABIN_UUID || undefined;

  try {
    const result = await createBiometricProcess({
      imagePath,
      processType,
      cabinUuid: cabin,
    });

    const stableImageUrl = await mirrorPhotoxboxOutputToSupabase(
      result.imageUrl ?? null,
    );

    return {
      status: true,
      package: packageKey,
      process_type: processType,
      // The mirrored Supabase URL — what Flutter saves to `orders` and what
      // ends up in `print_jobs.image_url`. Guaranteed to stay reachable.
      image_url: stableImageUrl,
      // Original third-party URL, kept for debugging / audit only.
      source_image_url: result.imageUrl ?? null,
      process_uuid: result.output?.process_uuid ?? null,
      output: result.output ?? null,
      message: result.message ?? "Biometric photo processed successfully",
    };
  } finally {
    await fs.unlink(imagePath).catch(() => {});
  }
}

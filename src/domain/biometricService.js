import fs from "fs/promises";
import { createBiometricProcess } from "../data/phont.js";

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

    return {
      status: true,
      package: packageKey,
      process_type: processType,
      image_url: result.imageUrl ?? null,
      process_uuid: result.output?.process_uuid ?? null,
      output: result.output ?? null,
      message: result.message ?? "Biometric photo processed successfully",
    };
  } finally {
    await fs.unlink(imagePath).catch(() => {});
  }
}

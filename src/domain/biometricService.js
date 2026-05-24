import fs from "fs/promises";
import { createBiometricProcess } from "../data/phont.js";

/** Maps Flutter package keys to PhotoXBox `process_type` slugs. */
export const PACK_TO_PROCESS_TYPE = {
  standard: "4-biyometrik",
  hybrid: "vesikalik",
};

/**
 * @param {string} packageKey - `standard` | `hybrid`
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

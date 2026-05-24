import axios from "axios";
import FormData from "form-data";
import fs from "fs";

const PHOTOXBOX_CREATE_PROCESS_URL =
  process.env.PHOTOXBOX_CREATE_PROCESS_URL ||
  "https://dashboard.photoxbox.com/api/create-process";

const PHONT_BASE_URL = process.env.PHONT_BASE_URL || "https://phont.photoxbox.com";

/**
 * Calls PhotoXBox Laravel create-process (loads print template coordinates server-side).
 * @param {{ imagePath: string, processType: string, cabinUuid?: string }} params
 */
export async function createBiometricProcess({ imagePath, processType, cabinUuid }) {
  const form = new FormData();
  form.append("image", fs.createReadStream(imagePath));
  form.append("process_type", processType);
  if (cabinUuid) {
    form.append("cabin_uuid", cabinUuid);
  }

  const response = await axios.post(PHOTOXBOX_CREATE_PROCESS_URL, form, {
    headers: form.getHeaders(),
    timeout: Number(process.env.PHONT_REQUEST_TIMEOUT_MS) || 120_000,
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    validateStatus: () => true,
  });

  const data = response.data ?? {};
  if (response.status >= 400) {
    const message =
      data.message || data.error || `PhotoXBox API returned HTTP ${response.status}`;
    throw new Error(message);
  }

  if (!data.status) {
    throw new Error(data.message || "Biometric image processing failed");
  }

  const imagePathFromOutput = data.output?.image;
  if (typeof imagePathFromOutput === "string" && imagePathFromOutput.length > 0) {
    return {
      ...data,
      imageUrl: normalizePhontUrl(imagePathFromOutput),
    };
  }

  const processedPath = data.processed_image_path;
  if (typeof processedPath === "string" && processedPath.length > 0) {
    return {
      ...data,
      imageUrl: normalizePhontUrl(processedPath),
    };
  }

  return data;
}

/** Build absolute URL from phont path or pass through if already absolute. */
export function normalizePhontUrl(pathOrUrl) {
  const normalized = String(pathOrUrl).replace(/\\/g, "/");
  if (/^https?:\/\//i.test(normalized)) {
    return normalized;
  }
  const base = PHONT_BASE_URL.replace(/\/$/, "");
  const path = normalized.startsWith("/") ? normalized : `/${normalized}`;
  return `${base}${path}`;
}

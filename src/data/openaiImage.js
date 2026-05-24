import axios from "axios";
import OpenAI, { toFile } from "openai";
import { uploadImageFromBuffer } from "./storage.js";

const GPT_IMAGE_MODEL = "gpt-image-1";

/** Direct OpenAI Images API (not Replicate). */
export function isOpenAiDirectModel(model) {
  return String(model || "") === GPT_IMAGE_MODEL;
}

function getOpenAiApiKey() {
  return (process.env.OPENAI_API_KEY ?? "").trim().replace(/^["']|["']$/g, "");
}

function getOpenAiClient() {
  const apiKey = getOpenAiApiKey();
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY is not set. Add it to fotoshop_api_nodejs/.env (https://platform.openai.com/api-keys)"
    );
  }
  return new OpenAI({ apiKey });
}

/**
 * Detect image MIME from magic bytes or Content-Type (Firebase often sends octet-stream).
 */
export function detectImageMime(buffer, contentTypeHeader) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mime: "image/jpeg", ext: "jpg" };
  }
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return { mime: "image/png", ext: "png" };
  }
  if (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return { mime: "image/webp", ext: "webp" };
  }

  const ct = String(contentTypeHeader || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (ct === "image/jpeg" || ct === "image/jpg") {
    return { mime: "image/jpeg", ext: "jpg" };
  }
  if (ct === "image/png") {
    return { mime: "image/png", ext: "png" };
  }
  if (ct === "image/webp") {
    return { mime: "image/webp", ext: "webp" };
  }

  return { mime: "image/jpeg", ext: "jpg" };
}

/**
 * @returns {{ ok: boolean, message?: string }}
 */
export function verifyOpenAiAuth() {
  const apiKey = getOpenAiApiKey();
  if (!apiKey) {
    return {
      ok: false,
      message:
        "OPENAI_API_KEY is missing in fotoshop_api_nodejs/.env — create one at https://platform.openai.com/api-keys",
    };
  }
  if (!apiKey.startsWith("sk-")) {
    return {
      ok: false,
      message: "OPENAI_API_KEY must start with sk- (check for typos or quotes in .env)",
    };
  }
  return { ok: true };
}

/**
 * Edit image via OpenAI Images API (gpt-image-1), upload result to Firebase Storage.
 */
export async function runGptImageEdit({ inputImageUrl, prompt, storagePath }) {
  const client = getOpenAiClient();
  const size = process.env.OPENAI_IMAGE_SIZE?.trim() || "1024x1024";

  try {
    const response = await axios.get(inputImageUrl, { responseType: "arraybuffer" });
    const buffer = Buffer.from(response.data);
    const { mime, ext } = detectImageMime(buffer, response.headers["content-type"]);

    const imageFile = await toFile(buffer, `input.${ext}`, { type: mime });

    const result = await client.images.edit({
      model: GPT_IMAGE_MODEL,
      image: imageFile,
      prompt,
      size,
    });

    const b64 = result.data?.[0]?.b64_json;
    if (!b64) {
      throw new Error("OpenAI returned no image data");
    }

    const outBuffer = Buffer.from(b64, "base64");
    return uploadImageFromBuffer(outBuffer, storagePath, "image/png");
  } catch (err) {
    const msg = err?.message || String(err);
    throw new Error(`OpenAI image edit failed: ${msg}`);
  }
}

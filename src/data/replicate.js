import Replicate from "replicate";

function getReplicateToken() {
  return (process.env.REPLICATE_API_TOKEN ?? "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/\s+/g, "");
}

function createReplicateClient() {
  return new Replicate({ auth: getReplicateToken() });
}

/**
 * Verifies token with Replicate (GET /v1/account).
 * @returns {Promise<{ ok: boolean, message?: string }>}
 */
export async function verifyReplicateAuth() {
  const token = getReplicateToken();
  if (!token) {
    return {
      ok: false,
      message:
        "REPLICATE_API_TOKEN is missing in fotoshop_api_nodejs/.env — create one at https://replicate.com/account/api-tokens",
    };
  }
  if (!token.startsWith("r8_")) {
    return {
      ok: false,
      message: "REPLICATE_API_TOKEN must start with r8_ (check for typos or quotes in .env)",
    };
  }

  try {
    const response = await fetch("https://api.replicate.com/v1/account", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (response.ok) {
      return { ok: true };
    }
    if (response.status === 401) {
      return {
        ok: false,
        message:
          "REPLICATE_API_TOKEN was rejected by Replicate (401). Generate a NEW token at https://replicate.com/account/api-tokens, paste it in .env, then restart npm run dev.",
      };
    }
    return {
      ok: false,
      message: `Replicate account check failed (HTTP ${response.status})`,
    };
  } catch (err) {
    return { ok: false, message: `Cannot reach Replicate API: ${err.message}` };
  }
}

/** Call on server start — logs result of live token check. */
export async function assertReplicateConfigured() {
  const check = await verifyReplicateAuth();
  if (check.ok) {
    console.log("[Replicate] API token OK — AI order processing is enabled.");
    return true;
  }
  console.error(`[Replicate] ${check.message}`);
  return false;
}

/** Default: google/nano-banana-2. Override with e.g. black-forest-labs/flux-kontext-pro */
const DEFAULT_MODEL = "google/nano-banana-2";

function modelId() {
  return process.env.REPLICATE_MODEL?.trim() || DEFAULT_MODEL;
}

function isNanoBanana(model) {
  return model.includes("nano-banana");
}

/** Replicate: openai/gpt-image-2 only (not direct OpenAI API gpt-image-1). */
export function isGptImageReplicateModel(model) {
  const m = String(model || "");
  if (m === "gpt-image-1") {
    return false;
  }
  return m.includes("openai/gpt-image") || m.includes("gpt-image-2");
}

function gptImageAspectRatio() {
  return process.env.REPLICATE_GPT_IMAGE_ASPECT_RATIO?.trim() || "1:1";
}

/** low ($0.012) | medium ($0.047) | high ($0.128) | auto ($0.128) — Replicate pricing */
function gptImageQuality() {
  const q = process.env.REPLICATE_GPT_IMAGE_QUALITY?.trim().toLowerCase();
  if (q === "low" || q === "high" || q === "auto") {
    return q;
  }
  return "medium";
}

/**
 * Normalize Replicate output to a single image URL (string | FileOutput | array).
 */
function outputToUrl(output) {
  if (output == null) {
    throw new Error("Replicate returned empty output");
  }
  if (typeof output === "string") {
    return output;
  }
  if (Array.isArray(output)) {
    return outputToUrl(output[0]);
  }
  if (typeof output.url === "function") {
    return output.url();
  }
  if (typeof output?.url === "string") {
    return output.url;
  }
  throw new Error("Unexpected output format from Replicate");
}

/**
 * Image editing via Replicate (google/nano-banana-2 by default).
 * @param {object} params
 * @param {string} params.inputImageUrl
 * @param {string} params.prompt
 * @param {string} [params.model] Full Replicate model id (overrides env default).
 * @param {string} [params.aspectRatio] nano-banana / flux
 * @param {string} [params.outputFormat]
 * @param {number} [params.safetyTolerance] flux only
 * @param {boolean} [params.promptUpsampling] flux only
 * @returns {Promise<string>} Output image URL
 */
export async function runImageEdit({
  inputImageUrl,
  prompt,
  model: modelOverride,
  aspectRatio = "match_input_image",
  outputFormat = "jpg",
  safetyTolerance = 2,
  promptUpsampling = false,
}) {
  const trimmed = modelOverride && String(modelOverride).trim();
  const model = isGptImageReplicateModel(trimmed)
    ? "openai/gpt-image-2"
    : trimmed || modelId();

  let input;
  if (isGptImageReplicateModel(trimmed) || model === "openai/gpt-image-2") {
    input = {
      prompt,
      input_images: [inputImageUrl],
      aspect_ratio: gptImageAspectRatio(),
      quality: gptImageQuality(),
    };
  } else if (isNanoBanana(model)) {
    input = {
      prompt,
      image_input: [inputImageUrl],
      aspect_ratio: aspectRatio,
      resolution: process.env.REPLICATE_RESOLUTION || "1K",
      image_search: process.env.REPLICATE_IMAGE_SEARCH === "true",
      google_search: process.env.REPLICATE_GOOGLE_SEARCH === "true",
      output_format: outputFormat,
    };
  } else {
    input = {
      prompt,
      input_image: inputImageUrl,
      aspect_ratio: aspectRatio,
      output_format: outputFormat,
      safety_tolerance: safetyTolerance,
      prompt_upsampling: promptUpsampling,
    };
  }

  const token = getReplicateToken();
  if (!token) {
    throw new Error(
      "REPLICATE_API_TOKEN is not set. Add it to fotoshop_api_nodejs/.env and restart the server."
    );
  }

  try {
    const output = await createReplicateClient().run(model, { input });
    return outputToUrl(output);
  } catch (err) {
    const msg = err?.message || String(err);
    if (msg.includes("401") || /unauthenticated/i.test(msg)) {
      throw new Error(
        "Replicate authentication failed (401). Set a valid REPLICATE_API_TOKEN in fotoshop_api_nodejs/.env " +
          "(https://replicate.com/account/api-tokens), then restart npm run dev."
      );
    }
    throw new Error(`Replicate request failed: ${msg}`);
  }
}

import Replicate from "replicate";

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

const MODEL = "black-forest-labs/flux-kontext-pro";

/**
 * Run image editing with flux-kontext-pro (data boundary — external API).
 * @param {object} params
 * @param {string} params.inputImageUrl
 * @param {string} params.prompt
 * @returns {Promise<string>} Output image URL
 */
export async function runImageEdit({
  inputImageUrl,
  prompt,
  aspectRatio = "match_input_image",
  outputFormat = "jpg",
  safetyTolerance = 2,
  promptUpsampling = false,
}) {
  const input = {
    prompt,
    input_image: inputImageUrl,
    aspect_ratio: aspectRatio,
    output_format: outputFormat,
    safety_tolerance: safetyTolerance,
    prompt_upsampling: promptUpsampling,
  };

  try {
    const output = await replicate.run(MODEL, { input });
    const result = Array.isArray(output) ? output[0] : output;
    if (typeof result === "string") {
      return result;
    }
    if (result?.url) {
      return typeof result.url === "function" ? result.url() : result.url;
    }
    throw new Error("Unexpected output format from Replicate");
  } catch (err) {
    const msg = err?.message || String(err);
    throw new Error(`Replicate request failed: ${msg}`);
  }
}

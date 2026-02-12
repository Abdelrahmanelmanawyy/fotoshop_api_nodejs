import Replicate from "replicate";

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

const MODEL = "black-forest-labs/flux-kontext-pro";

/**
 * Run image editing with flux-kontext-pro
 * @param {Object} params
 * @param {string} params.inputImageUrl - URL of the input image
 * @param {string} params.prompt - Edit instruction (e.g. "make it disney pixar", "portrait enhance")
 * @param {string} [params.aspectRatio] - "1:1" | "16:9" | "9:16" | "4:3" | "3:4" | "match_input_image"
 * @param {string} [params.outputFormat] - "jpg" | "png" | "webp"
 * @param {number} [params.safetyTolerance] - 1-6
 * @param {boolean} [params.promptUpsampling] - false
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

  const output = await replicate.run(MODEL, { input });

  // Replicate returns FileOutput (with .url() method), string URL, or array
  const result = Array.isArray(output) ? output[0] : output;
  if (typeof result === "string") {
    return result;
  }
  if (result?.url) {
    return typeof result.url === "function" ? result.url() : result.url;
  }
  throw new Error("Unexpected output format from Replicate");
}

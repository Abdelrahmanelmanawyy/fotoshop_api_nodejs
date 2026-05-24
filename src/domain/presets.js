/**
 * Map preset names to Replicate flux-kontext-pro prompts.
 * Pure domain logic — no I/O.
 */
export const PRESET_PROMPTS = {
  portrait_enhance:
    "enhance this portrait photo, improve skin quality, lighting, and overall professional look",
  disney_pixar: "make it disney pixar style",
  anime: "transform into anime style",
  oil_painting: "convert to beautiful oil painting style",
  vintage: "apply vintage film photography look",
  cinematic: "make it cinematic with dramatic lighting",
  professional: "professional headshot quality, clean background, great lighting",
};

export function getPromptForPreset(preset) {
  return PRESET_PROMPTS[preset] || preset;
}

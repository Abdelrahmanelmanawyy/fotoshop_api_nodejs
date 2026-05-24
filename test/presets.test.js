import assert from "node:assert/strict";
import test from "node:test";

import { getPromptForPreset, PRESET_PROMPTS } from "../src/domain/presets.js";

test("getPromptForPreset returns mapped prompt for known preset", () => {
  assert.equal(
    getPromptForPreset("portrait_enhance"),
    PRESET_PROMPTS.portrait_enhance
  );
});

test("getPromptForPreset passes through unknown preset string", () => {
  assert.equal(getPromptForPreset("custom_xyz"), "custom_xyz");
});

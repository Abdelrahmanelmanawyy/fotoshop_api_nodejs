import assert from "node:assert/strict";
import test from "node:test";

import { isOpenAiDirectModel } from "../src/data/openaiImage.js";
import { isGptImageReplicateModel } from "../src/data/replicate.js";

test("isGptImageReplicateModel matches Replicate gpt-image-2 only", () => {
  assert.equal(isGptImageReplicateModel("openai/gpt-image-2"), true);
  assert.equal(isGptImageReplicateModel("gpt-image-1"), false);
  assert.equal(isGptImageReplicateModel("google/nano-banana-2"), false);
});

test("isOpenAiDirectModel matches direct API id", () => {
  assert.equal(isOpenAiDirectModel("gpt-image-1"), true);
  assert.equal(isOpenAiDirectModel("openai/gpt-image-2"), false);
});

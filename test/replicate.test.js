import assert from "node:assert/strict";
import test from "node:test";

import { isOpenAiDirectModel } from "../src/data/openaiImage.js";
import {
  isAllowedReplicateModel,
  isGptImageReplicateModel,
} from "../src/data/replicate.js";

test("isGptImageReplicateModel matches Replicate gpt-image-2 only", () => {
  assert.equal(isGptImageReplicateModel("openai/gpt-image-2"), true);
  assert.equal(isGptImageReplicateModel("gpt-image-1"), false);
  assert.equal(isGptImageReplicateModel("google/nano-banana-2"), false);
});

test("isOpenAiDirectModel matches direct API id", () => {
  assert.equal(isOpenAiDirectModel("gpt-image-1"), true);
  assert.equal(isOpenAiDirectModel("openai/gpt-image-2"), false);
});

test("isAllowedReplicateModel whitelists client models, rejects injection", () => {
  // Every id the Flutter ReplicateModelOption enum can send (minus the
  // OpenAI-direct gpt-image-1, which never reaches runImageEdit).
  assert.equal(isAllowedReplicateModel("google/nano-banana-2"), true);
  assert.equal(isAllowedReplicateModel("google/nano-banana"), true);
  assert.equal(isAllowedReplicateModel("black-forest-labs/flux-kontext-pro"), true);
  assert.equal(isAllowedReplicateModel("openai/gpt-image-2"), true);
  // Empty → server env default is used.
  assert.equal(isAllowedReplicateModel(""), true);
  assert.equal(isAllowedReplicateModel(undefined), true);
  // A tampered client requesting an arbitrary (expensive) model is rejected.
  assert.equal(isAllowedReplicateModel("some-org/very-expensive-video-model"), false);

  // Ops can extend the list via env without a code change.
  process.env.ALLOWED_REPLICATE_MODELS = "acme/custom-model";
  try {
    assert.equal(isAllowedReplicateModel("acme/custom-model"), true);
  } finally {
    delete process.env.ALLOWED_REPLICATE_MODELS;
  }
});

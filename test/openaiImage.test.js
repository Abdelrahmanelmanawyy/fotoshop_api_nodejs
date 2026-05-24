import assert from "node:assert/strict";
import test from "node:test";

import { detectImageMime } from "../src/data/openaiImage.js";

test("detectImageMime reads JPEG magic bytes despite octet-stream header", () => {
  const buf = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
  assert.deepEqual(detectImageMime(buf, "application/octet-stream"), {
    mime: "image/jpeg",
    ext: "jpg",
  });
});

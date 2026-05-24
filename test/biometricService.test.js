import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PACK_TO_PROCESS_TYPE, resolveProcessType } from "../src/domain/biometricService.js";

describe("biometricService", () => {
  it("maps standard, hybrid, and combo to their PhotoXBox process_type slugs", () => {
    assert.equal(resolveProcessType("standard"), "4-biyometrik");
    assert.equal(resolveProcessType("hybrid"), "vesikalik");
    assert.equal(resolveProcessType("combo"), "2-biyometrik-4-vesikalik");
    assert.equal(PACK_TO_PROCESS_TYPE.standard, "4-biyometrik");
    assert.equal(PACK_TO_PROCESS_TYPE.hybrid, "vesikalik");
    assert.equal(PACK_TO_PROCESS_TYPE.combo, "2-biyometrik-4-vesikalik");
  });

  it("rejects unknown package", () => {
    assert.throws(() => resolveProcessType("premium"), /Invalid package/);
  });
});

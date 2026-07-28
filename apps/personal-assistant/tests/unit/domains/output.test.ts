import { describe, expect, it } from "vitest";

import { minimizeJsonString } from "../../../src/runtime-agents/shared/output.js";

describe("minimizeJsonString", () => {
  it("serializes a single object as compact JSON", () => {
    expect(minimizeJsonString({ name: "Test", type: "test" })).toBe('{"name":"Test","type":"test"}');
  });

  it("serializes arrays as newline-delimited compact objects without null fields", () => {
    expect(
      minimizeJsonString([
        { id: 1, name: "Debts", note: null },
        { id: 4, name: "Food", note: null },
      ]),
    ).toBe('{"id":1,"name":"Debts"}\n{"id":4,"name":"Food"}');
  });
});

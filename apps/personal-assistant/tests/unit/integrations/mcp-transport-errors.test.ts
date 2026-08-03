import { describe, expect, it } from "vitest";

import { isTransportError } from "../../../src/integrations/mcp/transport-errors.js";

describe("isTransportError", () => {
  it("detects common node transport error codes", () => {
    expect(isTransportError(Object.assign(new Error("reset"), { code: "ECONNRESET" }))).toBe(true);
    expect(isTransportError(Object.assign(new Error("broken pipe"), { code: "EPIPE" }))).toBe(true);
    expect(isTransportError(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }))).toBe(true);
  });

  it("detects transport failures in nested error causes", () => {
    const error = new Error("tool call failed", {
      cause: Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }),
    });

    expect(isTransportError(error)).toBe(true);
  });

  it("detects transport failures from message patterns", () => {
    expect(isTransportError(new Error("fetch failed"))).toBe(true);
    expect(isTransportError(new Error("Connection was closed before response"))).toBe(true);
  });

  it("returns false for non-transport application errors", () => {
    expect(isTransportError(new Error("Unexpected response format from execute_sql tool"))).toBe(false);
    expect(isTransportError(new Error("permission denied for table expense"))).toBe(false);
  });
});

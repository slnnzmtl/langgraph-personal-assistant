import { describe, expect, it } from "vitest";

import { isMcpTransportError } from "../../../src/integrations/mcp/transport-errors.js";

describe("isMcpTransportError", () => {
  it("detects common node transport error codes", () => {
    expect(isMcpTransportError(Object.assign(new Error("reset"), { code: "ECONNRESET" }))).toBe(true);
    expect(isMcpTransportError(Object.assign(new Error("broken pipe"), { code: "EPIPE" }))).toBe(true);
    expect(isMcpTransportError(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }))).toBe(true);
  });

  it("detects transport failures in nested error causes", () => {
    const error = new Error("tool call failed", {
      cause: Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }),
    });

    expect(isMcpTransportError(error)).toBe(true);
  });

  it("detects transport failures from message patterns", () => {
    expect(isMcpTransportError(new Error("fetch failed"))).toBe(true);
    expect(isMcpTransportError(new Error("Connection was closed before response"))).toBe(true);
  });

  it("returns false for non-transport application errors", () => {
    expect(isMcpTransportError(new Error("Unexpected response format from execute_sql tool"))).toBe(false);
    expect(isMcpTransportError(new Error("permission denied for table expense"))).toBe(false);
  });
});

import { describe, expect, it } from "vitest";

import { DEFAULT_GEMINI_MODEL, GeminiConnector } from "../../src/gemini-connector.js";

describe("GeminiConnector", () => {
  it("uses the shared default model when none is provided", () => {
    const connector = new GeminiConnector("test-key");
    expect(connector.getModelName()).toBe(DEFAULT_GEMINI_MODEL);
  });

  it("exposes api key, model name, and chat model", () => {
    const connector = new GeminiConnector("test-key", "gemini-2.5-flash");
    expect(connector.getApiKey()).toBe("test-key");
    expect(connector.getModelName()).toBe("gemini-2.5-flash");
    expect(connector.getModel()).toBeDefined();
  });
});

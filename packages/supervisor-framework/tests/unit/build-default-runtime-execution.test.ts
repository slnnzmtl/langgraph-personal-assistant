import { describe, expect, it } from "vitest";

import {
  buildDefaultRuntimeExecution,
  createCapabilityCatalog,
  NONE_CAPABILITY_PROVIDER,
} from "@personal-assistant/supervisor-framework";

describe("buildDefaultRuntimeExecution", () => {
  it("returns empty prompt loader and a graph policy by default", () => {
    const catalog = createCapabilityCatalog([NONE_CAPABILITY_PROVIDER]);
    const kit = buildDefaultRuntimeExecution(catalog);

    expect(kit.loadPromptByKey("foo")).toBe("");
    expect(kit.runtimeAgentPolicy.createGraphBundle).toBeTypeOf("function");
  });

  it("uses a custom prompt loader when provided", () => {
    const catalog = createCapabilityCatalog([NONE_CAPABILITY_PROVIDER]);
    const kit = buildDefaultRuntimeExecution(catalog, {
      loadPromptByKey: (key) => `Prompt for ${key}`,
    });

    expect(kit.loadPromptByKey("researcher")).toBe("Prompt for researcher");
  });
});

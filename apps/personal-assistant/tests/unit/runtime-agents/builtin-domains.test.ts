import { describe, expect, it } from "vitest";

import {
  createSystemAgentDefinition,
  isRuntimeAgentBuiltin,
  SYSTEM_AGENT_ID,
} from "@personal-assistant/supervisor-framework";
import { resolveBuiltinModelName } from "../../../src/composition/runtime-agent-defaults.js";
import type { AppConfig } from "../../../src/config.js";

describe("system admin agent manifest", () => {
  it("defines the configuration system agent id for skill module continuity", () => {
    expect(SYSTEM_AGENT_ID).toBe("configuration");
  });

  it("builds the system admin runtime agent from framework options", () => {
    const agent = createSystemAgentDefinition({
      modelKey: "configuration",
    });

    expect(agent.id).toBe("configuration");
    expect(isRuntimeAgentBuiltin(agent)).toBe(true);
    expect(agent.capabilityIds).toEqual(["system-config"]);
  });

  it("resolves model names from model key overrides", () => {
    const config = {
      geminiModel: "gemini-default",
      obsidianModel: "obsidian-model",
      financeModel: "finance-model",
      configurationModel: "configuration-model",
    } as AppConfig;

    expect(resolveBuiltinModelName(config, "generic")).toBe("gemini-default");
    expect(resolveBuiltinModelName(config, "finance")).toBe("finance-model");
    expect(resolveBuiltinModelName(config, "obsidian")).toBe("obsidian-model");
    expect(resolveBuiltinModelName(config, "configuration")).toBe("configuration-model");
    expect(resolveBuiltinModelName(config, "unknown")).toBe("gemini-default");
  });
});

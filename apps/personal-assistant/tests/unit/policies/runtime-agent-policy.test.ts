import { describe, expect, it } from "vitest";

import {
  createRuntimeShellHooks,
  createSystemAgentDefinition,
} from "@personal-assistant/supervisor-framework";
import {
  buildPersonalRuntimeAgentNodeConfig,
} from "../../../src/composition/personal-runtime-policy.js";
import { createDefaultRuntimeShellFormatters } from "../../../src/composition/runtime-execution.js";
import { buildLocalModuleAgents } from "../../helpers/runtime-agent-fixtures.js";
import { createTestSkillCatalog } from "../../helpers/test-skills-dir.js";

const skillCatalog = createTestSkillCatalog();
const shellFormatters = createDefaultRuntimeShellFormatters(skillCatalog);
const shellHooks = createRuntimeShellHooks(shellFormatters);

describe("personal runtime policy Obsidian attachment", () => {
  it("keeps system-config over Obsidian for the configuration agent", () => {
    const configuration = createSystemAgentDefinition({ modelKey: "configuration" });
    const config = buildPersonalRuntimeAgentNodeConfig(configuration, shellHooks, {
      shellFormatters,
      skillCatalog,
      vaultRoot: "/tmp/vault",
    });

    expect(config.buildErrorMessage?.(new Error("boom"), configuration)).toContain(
      "Unable to update configuration",
    );
  });

  it("attaches Obsidian vault error messaging when vault is closed over", () => {
    const obsidian = buildLocalModuleAgents().find((agent) => agent.id === "obsidian");
    expect(obsidian).toBeDefined();

    const withVault = buildPersonalRuntimeAgentNodeConfig(obsidian!, shellHooks, {
      shellFormatters,
      skillCatalog,
      vaultRoot: "/tmp/vault",
    });
    expect(withVault.buildErrorMessage?.(new Error("boom"), obsidian!)).toContain(
      "Unable to edit the local markdown vault",
    );

    const withoutVault = buildPersonalRuntimeAgentNodeConfig(obsidian!, shellHooks, {
      shellFormatters,
      skillCatalog,
    });
    expect(withoutVault.buildErrorMessage?.(new Error("boom"), obsidian!)).toContain(
      "Unable to run runtime agent",
    );
  });

  it("leaves tools-only finance agents on the default case", () => {
    const finance = buildLocalModuleAgents().find((agent) => agent.id === "finance");
    expect(finance).toBeDefined();

    const config = buildPersonalRuntimeAgentNodeConfig(finance!, shellHooks, {
      shellFormatters,
      skillCatalog,
      vaultRoot: "/tmp/vault",
    });
    expect(config.buildErrorMessage?.(new Error("boom"), finance!)).toContain(
      "Unable to run runtime agent",
    );
  });
});

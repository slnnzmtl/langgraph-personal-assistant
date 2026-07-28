import { describe, expect, it } from "vitest";

import {
  createSystemAgentDefinition,
  deriveCronTargetAgentIds,
} from "@personal-assistant/supervisor-framework";
import { createPersonalCapabilityCatalog } from "../../helpers/capability-catalog.js";
import { createSkillCatalog } from "@personal-assistant/supervisor-framework";
import { buildTestRuntimeAgents } from "../../helpers/runtime-agent-fixtures.js";
import {
  createCapabilityDeps,
  createDomainCapabilityCatalog,
  listAvailableCapabilities,
  resolveCapabilities,
  validateGrantableCapabilityIds,
} from "../../../src/runtime-agents/capabilities.js";
import { createCronRepositoryFake } from "../../helpers/configuration-tools.js";
import { createRuntimeAgentRepositoryFake } from "../../helpers/fakes.js";

describe("builtin capabilities", () => {
  it("seeds the configuration agent with the system-config capability", () => {
    const configuration = createSystemAgentDefinition({
      modelKey: "configuration",
    });

    expect(configuration.capabilityIds).toEqual(["system-config"]);
  });

  it("resolves system-config tools when repositories are available", () => {
    const catalog = createPersonalCapabilityCatalog();
    const deps = createCapabilityDeps("/tmp/vault", {
      cronJobRepository: createCronRepositoryFake(),
      runtimeAgentRepository: createRuntimeAgentRepositoryFake(),
      cronTargetAgentIds: deriveCronTargetAgentIds(buildTestRuntimeAgents()),
      capabilityCatalog: catalog,
      skillCatalog: createSkillCatalog({ approvedModules: ["configuration", "finance", "obsidian"] }),
    });

    const tools = resolveCapabilities(["system-config"], deps);
    const toolNames = tools.map((tool) => tool.name);

    expect(toolNames).toEqual(
      expect.arrayContaining([
        "list_cron_jobs",
        "create_cron_job",
        "delete_cron_job",
        "list_skills",
        "create_skill",
        "list_runtime_agents",
        "create_runtime_agent",
        "list_capabilities",
      ]),
    );
  });

  it("omits system-config from the domain catalog when repositories are unavailable", () => {
    const withoutRepos = createCapabilityDeps("/tmp/vault");
    const withRepos = createCapabilityDeps("/tmp/vault", {
      cronJobRepository: createCronRepositoryFake(),
      runtimeAgentRepository: createRuntimeAgentRepositoryFake(),
      capabilityCatalog: createPersonalCapabilityCatalog(),
    });

    expect(listAvailableCapabilities(withoutRepos).map((entry) => entry.id)).not.toContain("system-config");
    expect(listAvailableCapabilities(withRepos).map((entry) => entry.id)).toContain("system-config");
  });

  it("rejects non-grantable capabilities when creating runtime agents", () => {
    const deps = createCapabilityDeps("/tmp/vault", {
      cronJobRepository: createCronRepositoryFake(),
      runtimeAgentRepository: createRuntimeAgentRepositoryFake(),
      capabilityCatalog: createPersonalCapabilityCatalog(),
    });

    expect(() => validateGrantableCapabilityIds(["system-config"], deps)).toThrow(
      /cannot be granted/i,
    );
  });

  it("allows grantable capabilities", () => {
    const catalog = createDomainCapabilityCatalog();

    catalog.validateGrantableIds(["none"], {
      obsidianVaultPath: "/tmp/vault",
    });
  });
});

import { describe, expect, it } from "vitest";

import {
  createSystemAgentDefinition,
  deriveCronTargetAgentIds,
} from "@personal-assistant/supervisor-framework";
import {
  createProductCapabilityCatalog,
  createPersonalCapabilityCatalog,
} from "../helpers/capability-catalog.js";
import { createSkillCatalog } from "@personal-assistant/supervisor-framework";
import { buildTestRuntimeAgents } from "../helpers/runtime-agent-fixtures.js";
import type { PersonalCapabilityDeps } from "../../src/runtime-agents/personal-capability-deps.js";
import { createCronRepositoryFake } from "../helpers/configuration-tools.js";
import { createRuntimeAgentRepositoryFake } from "../helpers/fakes.js";

describe("builtin capabilities", () => {
  it("seeds the configuration agent with the system-config capability", () => {
    const configuration = createSystemAgentDefinition({
      modelKey: "configuration",
    });

    expect(configuration.capabilityIds).toEqual(["system-config"]);
  });

  it("resolves system-config tools when repositories are available", () => {
    const catalog = createPersonalCapabilityCatalog();
    const deps: PersonalCapabilityDeps = {
      cronJobRepository: createCronRepositoryFake(),
      runtimeAgentRepository: createRuntimeAgentRepositoryFake(),
      cronTargetAgentIds: deriveCronTargetAgentIds(buildTestRuntimeAgents()),
      capabilityCatalog: catalog,
      skillCatalog: createSkillCatalog({ approvedModules: ["configuration", "finance", "obsidian"] }),
    };

    const tools = catalog.resolveTools(["system-config"], deps);
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
    const catalog = createPersonalCapabilityCatalog();
    const withoutRepos: PersonalCapabilityDeps = {
      capabilityCatalog: catalog,
    };
    const withRepos: PersonalCapabilityDeps = {
      cronJobRepository: createCronRepositoryFake(),
      runtimeAgentRepository: createRuntimeAgentRepositoryFake(),
      capabilityCatalog: catalog,
    };

    expect(catalog.listAvailable(withoutRepos).map((entry) => entry.id)).not.toContain("system-config");
    expect(catalog.listAvailable(withRepos).map((entry) => entry.id)).toContain("system-config");
  });

  it("rejects non-grantable capabilities when creating runtime agents", () => {
    const catalog = createPersonalCapabilityCatalog();
    const deps: PersonalCapabilityDeps = {
      cronJobRepository: createCronRepositoryFake(),
      runtimeAgentRepository: createRuntimeAgentRepositoryFake(),
      capabilityCatalog: catalog,
    };

    expect(() => catalog.validateGrantableIds(["system-config"], deps)).toThrow(
      /cannot be granted/i,
    );
  });

  it("allows grantable capabilities", () => {
    const catalog = createProductCapabilityCatalog();

    catalog.validateGrantableIds(["none"], {});
  });

  it("reserves finance-domain for the finance agent via descriptor reservedForAgentIds", () => {
    const catalog = createProductCapabilityCatalog({
      adapters: {
        supabaseWriteSession: {
          executeSql: async <T>() => [] as T,
          close: async () => {},
        },
      },
    });

    expect(catalog.reservedCapabilityIdsForAgent("finance")).toEqual(["finance-domain"]);
    expect(() => catalog.validateGrantableIds(["finance-domain"], {})).toThrow(/cannot be granted/i);
  });
});

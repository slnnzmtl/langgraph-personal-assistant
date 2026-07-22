import { describe, expect, it } from "vitest";

import { buildDefaultRuntimeAgents } from "../../src/app/composition/bootstrap-agents.js";
import { deriveCronTargetAgentIds } from "../../src/app/composition/create-supervisor-system.js";
import { buildTestRuntimeAgents } from "../helpers/runtime-agent-fixtures.js";
import {
  createCapabilityDeps,
  createDefaultCapabilityCatalog,
  listAvailableCapabilities,
  resolveCapabilities,
  validateGrantableCapabilityIds,
} from "../../src/runtime-agents/builtin-capabilities.js";
import { createCronRepositoryFake } from "../helpers/configuration-tools.js";
import { createRuntimeAgentRepositoryFake } from "../helpers/fakes.js";

describe("builtin capabilities", () => {
  it("seeds the configuration agent with the system-config capability", () => {
    const configuration = buildDefaultRuntimeAgents().find((agent) => agent.id === "configuration");

    expect(configuration?.capabilityIds).toEqual(["system-config"]);
  });

  it("resolves system-config tools when repositories are available", () => {
    const deps = createCapabilityDeps("/tmp/vault", {
      cronJobRepository: createCronRepositoryFake(),
      runtimeAgentRepository: createRuntimeAgentRepositoryFake(),
      cronTargetAgentIds: deriveCronTargetAgentIds(buildTestRuntimeAgents()),
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

  it("omits system-config from the catalog when repositories are unavailable", () => {
    const withoutRepos = createCapabilityDeps("/tmp/vault");
    const withRepos = createCapabilityDeps("/tmp/vault", {
      cronJobRepository: createCronRepositoryFake(),
      runtimeAgentRepository: createRuntimeAgentRepositoryFake(),
    });

    expect(listAvailableCapabilities(withoutRepos).map((entry) => entry.id)).not.toContain("system-config");
    expect(listAvailableCapabilities(withRepos).map((entry) => entry.id)).toContain("system-config");
  });

  it("rejects non-grantable capabilities when creating runtime agents", () => {
    const deps = createCapabilityDeps("/tmp/vault", {
      cronJobRepository: createCronRepositoryFake(),
      runtimeAgentRepository: createRuntimeAgentRepositoryFake(),
    });

    expect(() => validateGrantableCapabilityIds(["system-config"], deps)).toThrow(
      /cannot be granted/i,
    );
  });

  it("allows grantable capabilities", () => {
    const catalog = createDefaultCapabilityCatalog();

    catalog.validateGrantableIds(["none"], {
      obsidianVaultPath: "/tmp/vault",
      supabaseAvailable: false,
      configurationReposAvailable: false,
    });
  });
});

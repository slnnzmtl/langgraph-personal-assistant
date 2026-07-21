import { describe, expect, it } from "vitest";

import { buildDefaultRuntimeAgents } from "../../src/app/composition/bootstrap-agents.js";
import { deriveCronTargetAgentIds } from "../../src/app/runtime-agent-catalog.js";
import { buildTestRuntimeAgents } from "../helpers/runtime-agent-fixtures.js";
import {
  createRuntimeToolBundleDeps,
  listAvailableRuntimeToolBundles,
  resolveRuntimeToolBundles,
} from "../../src/runtime-agents/tool-bundles.js";
import { createCronRepositoryFake } from "../helpers/configuration-tools.js";
import { createRuntimeAgentRepositoryFake } from "../helpers/fakes.js";

describe("runtime tool bundles", () => {
  it("seeds the configuration agent with the system-config bundle", () => {
    const configuration = buildDefaultRuntimeAgents().find((agent) => agent.id === "configuration");

    expect(configuration?.toolBundleIds).toEqual(["system-config"]);
  });

  it("resolves system-config tools when repositories are available", () => {
    const deps = createRuntimeToolBundleDeps("/tmp/vault", {
      cronJobRepository: createCronRepositoryFake(),
      runtimeAgentRepository: createRuntimeAgentRepositoryFake(),
      cronTargetAgentIds: deriveCronTargetAgentIds(buildTestRuntimeAgents()),
    });

    const tools = resolveRuntimeToolBundles(["system-config"], deps);
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
        "list_runtime_tool_bundles",
      ]),
    );
  });

  it("omits system-config from the catalog when repositories are unavailable", () => {
    const withoutRepos = createRuntimeToolBundleDeps("/tmp/vault");
    const withRepos = createRuntimeToolBundleDeps("/tmp/vault", {
      cronJobRepository: createCronRepositoryFake(),
      runtimeAgentRepository: createRuntimeAgentRepositoryFake(),
    });

    expect(listAvailableRuntimeToolBundles(withoutRepos).map((entry) => entry.id)).not.toContain("system-config");
    expect(listAvailableRuntimeToolBundles(withRepos).map((entry) => entry.id)).toContain("system-config");
  });
});

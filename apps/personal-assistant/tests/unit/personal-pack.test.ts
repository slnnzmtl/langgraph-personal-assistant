import { describe, expect, it } from "vitest";

import {
  createCapabilityCatalog,
  createSystemAgentDefinition,
  deriveCronTargetAgentIds,
  mergeCapabilityCatalogs,
  type ILLMConnector,
} from "@personal-assistant/supervisor-framework";
import { buildPersonalSupervisorPack } from "../../src/app/composition/personal-pack.js";
import type { AppConfig } from "../../src/config.js";
import {
  createCapabilityDeps,
  createDefaultCapabilityCatalog,
  createPersonalCapabilityProviders,
} from "../../src/runtime-agents/builtin-capabilities.js";
import { createSkillCatalog } from "../../src/runtime-agents/skills/skill-catalog.js";
import { createCronRepositoryFake } from "../helpers/configuration-tools.js";
import { createRuntimeExecutionContextFake, createRuntimeAgentRepositoryFake } from "../helpers/fakes.js";
import { buildTestRuntimeAgents } from "../helpers/runtime-agent-fixtures.js";

const testConfig = {
  obsidianVaultPath: "/tmp/vault",
  runtimeAgentsFilePath: "data/runtime-agents.json",
  cronJobsFilePath: "data/cron-jobs.json",
} as AppConfig;

const buildBootstrapContext = (
  runtimeAgents: ReturnType<typeof buildTestRuntimeAgents>,
  skillCatalog: ReturnType<typeof createSkillCatalog>,
  capabilityCatalog: ReturnType<typeof createDefaultCapabilityCatalog>,
) => ({
  config: testConfig,
  runtimeAgentRepository: createRuntimeAgentRepositoryFake(),
  runtimeAgents,
  cronTargetAgentIds: deriveCronTargetAgentIds(runtimeAgents),
  cronJobRepository: createCronRepositoryFake(),
  capabilityCatalog,
  skillCatalog,
  adapters: {},
});

describe("buildPersonalSupervisorPack", () => {
  it("buildRuntimeExecution uses the bootstrap capability catalog for configuration tools", () => {
    const runtimeAgents = buildTestRuntimeAgents();
    const pack = buildPersonalSupervisorPack({
      config: testConfig,
      supervisorLlm: {} as ILLMConnector,
    });
    const skillCatalog = createSkillCatalog({ approvedModules: ["configuration"] });
    const capabilityCatalog = mergeCapabilityCatalogs(createPersonalCapabilityProviders() as never, true);
    const bootstrapContext = buildBootstrapContext(runtimeAgents, skillCatalog, capabilityCatalog);
    const { runtimeAgentPolicy } = pack.buildRuntimeExecution!(
      runtimeAgents,
      skillCatalog,
      bootstrapContext,
    );
    const configuration = createSystemAgentDefinition({ modelKey: "configuration" });
    const context = createRuntimeExecutionContextFake({
      cronJobRepository: createCronRepositoryFake(),
      runtimeAgentRepository: createRuntimeAgentRepositoryFake(),
      capabilityDeps: createCapabilityDeps("/tmp/vault", {
        cronJobRepository: createCronRepositoryFake(),
        runtimeAgentRepository: createRuntimeAgentRepositoryFake(),
        cronTargetAgentIds: deriveCronTargetAgentIds(runtimeAgents),
        capabilityCatalog,
        skillCatalog,
      }),
    });

    expect(() => runtimeAgentPolicy.createGraphBundle(context, configuration)).not.toThrow();
  });

  it("buildRuntimeExecution fails for configuration when bootstrap catalog omits system-config", () => {
    const runtimeAgents = buildTestRuntimeAgents();
    const pack = buildPersonalSupervisorPack({
      config: testConfig,
      supervisorLlm: {} as ILLMConnector,
    });
    const skillCatalog = createSkillCatalog({ approvedModules: ["configuration"] });
    const domainOnlyCatalog = createDefaultCapabilityCatalog();
    const bootstrapContext = buildBootstrapContext(runtimeAgents, skillCatalog, domainOnlyCatalog);
    const { runtimeAgentPolicy } = pack.buildRuntimeExecution!(
      runtimeAgents,
      skillCatalog,
      bootstrapContext,
    );
    const configuration = createSystemAgentDefinition({ modelKey: "configuration" });
    const context = createRuntimeExecutionContextFake({
      cronJobRepository: createCronRepositoryFake(),
      runtimeAgentRepository: createRuntimeAgentRepositoryFake(),
      capabilityDeps: createCapabilityDeps("/tmp/vault", {
        cronJobRepository: createCronRepositoryFake(),
        runtimeAgentRepository: createRuntimeAgentRepositoryFake(),
        cronTargetAgentIds: deriveCronTargetAgentIds(runtimeAgents),
        capabilityCatalog: domainOnlyCatalog,
        skillCatalog,
      }),
    });

    expect(() => runtimeAgentPolicy.createGraphBundle(context, configuration)).toThrow(
      /system-config/i,
    );
  });
});

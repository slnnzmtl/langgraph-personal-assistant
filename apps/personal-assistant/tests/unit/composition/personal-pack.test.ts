import { describe, expect, it } from "vitest";

import {
  createSystemAgentDefinition,
  deriveCronTargetAgentIds,
  type ILLMConnector,
} from "@personal-assistant/supervisor-framework";
import { createPersonalCapabilityCatalog } from "../../helpers/capability-catalog.js";
import { buildPersonalSupervisorPack } from "../../../src/composition/personal-pack.js";
import type { AppConfig } from "../../../src/config.js";
import { createObsidianVault } from "../../../src/integrations/obsidian.js";
import {
  createCapabilityDeps,
  createDomainCapabilityCatalog,
} from "../../../src/runtime-agents/capabilities.js";
import { createSkillCatalog } from "@personal-assistant/supervisor-framework";
import { createCronRepositoryFake } from "../../helpers/configuration-tools.js";
import { createRuntimeExecutionContextFake, createRuntimeAgentRepositoryFake } from "../../helpers/fakes.js";
import { buildTestRuntimeAgents } from "../../helpers/runtime-agent-fixtures.js";

const testConfig = {
  obsidianVaultPath: "/tmp/vault",
  runtimeAgentsFilePath: "data/runtime-agents.json",
  cronJobsFilePath: "data/cron-jobs.json",
  stateDbPath: "/tmp/state.db",
  persistenceEnabled: false,
} as AppConfig;

const buildBootstrapContext = (
  runtimeAgents: ReturnType<typeof buildTestRuntimeAgents>,
  skillCatalog: ReturnType<typeof createSkillCatalog>,
  capabilityCatalog: ReturnType<typeof createDomainCapabilityCatalog>,
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
  it("registers initializeDefaults to seed framework default content", () => {
    const pack = buildPersonalSupervisorPack({
      config: testConfig,
      supervisorLlm: {} as ILLMConnector,
    });

    expect(pack.initializeDefaults).toBeTypeOf("function");
  });

  it("buildRuntimeExecution uses the bootstrap capability catalog for configuration tools", () => {
    const runtimeAgents = buildTestRuntimeAgents();
    const pack = buildPersonalSupervisorPack({
      config: testConfig,
      supervisorLlm: {} as ILLMConnector,
    });
    const skillCatalog = createSkillCatalog({ approvedModules: ["configuration"] });
    const capabilityCatalog = createPersonalCapabilityCatalog();
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
      capabilityDeps: createCapabilityDeps({
        obsidianVault: createObsidianVault("/tmp/vault"),
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
    const domainOnlyCatalog = createDomainCapabilityCatalog();
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
      capabilityDeps: createCapabilityDeps({
        obsidianVault: createObsidianVault("/tmp/vault"),
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

import { describe, expect, it, vi } from "vitest";

import {
  createSystemAgentDefinition,
  deriveCronTargetAgentIds,
  type ILLMConnector,
} from "@personal-assistant/supervisor-framework";
import { createPersonalCapabilityCatalog, createProductCapabilityCatalog } from "../../helpers/capability-catalog.js";
import { buildPersonalSupervisorPack } from "../../../src/composition/personal-pack.js";
import type { AppConfig } from "../../../src/config.js";
import type { PersonalCapabilityDeps } from "../../../src/runtime-agents/system-capability-deps.js";
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
  capabilityCatalog: ReturnType<typeof createPersonalCapabilityCatalog>,
  config: AppConfig = testConfig,
) => ({
  config,
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
      capabilityDeps: {
        cronJobRepository: createCronRepositoryFake(),
        runtimeAgentRepository: createRuntimeAgentRepositoryFake(),
        cronTargetAgentIds: deriveCronTargetAgentIds(runtimeAgents),
        capabilityCatalog,
        skillCatalog,
      } satisfies PersonalCapabilityDeps,
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
    const productOnlyCatalog = createProductCapabilityCatalog();
    const bootstrapContext = buildBootstrapContext(runtimeAgents, skillCatalog, productOnlyCatalog);
    const { runtimeAgentPolicy } = pack.buildRuntimeExecution!(
      runtimeAgents,
      skillCatalog,
      bootstrapContext,
    );
    const configuration = createSystemAgentDefinition({ modelKey: "configuration" });
    const context = createRuntimeExecutionContextFake({
      cronJobRepository: createCronRepositoryFake(),
      runtimeAgentRepository: createRuntimeAgentRepositoryFake(),
      capabilityDeps: {
        cronJobRepository: createCronRepositoryFake(),
        runtimeAgentRepository: createRuntimeAgentRepositoryFake(),
        cronTargetAgentIds: deriveCronTargetAgentIds(runtimeAgents),
        capabilityCatalog: productOnlyCatalog,
        skillCatalog,
      } satisfies PersonalCapabilityDeps,
    });

    expect(() => runtimeAgentPolicy.createGraphBundle(context, configuration)).toThrow(
      /system-config/i,
    );
  });

  it("buildCapabilityProviders closes over adapter sessions and vault path", () => {
    const runtimeAgents = buildTestRuntimeAgents();
    const config = {
      ...testConfig,
      wiseApiToken: "token",
      wiseProfileId: "profile",
    };
    const pack = buildPersonalSupervisorPack({
      config,
      supervisorLlm: {} as ILLMConnector,
    });
    const skillCatalog = createSkillCatalog({ approvedModules: ["configuration"] });
    const capabilityCatalog = createPersonalCapabilityCatalog();
    const mockSession = {
      executeSql: async <T>() => [] as T,
      close: async () => {},
    };
    const providers = pack.buildCapabilityProviders!({
      config,
      adapters: {
        supabaseReadSession: mockSession,
        supabaseWriteSession: mockSession,
      },
      runtimeAgentRepository: createRuntimeAgentRepositoryFake(),
      runtimeAgents,
      cronTargetAgentIds: deriveCronTargetAgentIds(runtimeAgents),
      cronJobRepository: createCronRepositoryFake(),
      skillCatalog,
    });

    const financeWrite = providers.find((provider) => provider.descriptor.id === "finance-domain");
    expect(financeWrite?.isAvailable({})).toBe(true);
    const toolNames = financeWrite?.resolveTools({}).map((tool) => tool.name) ?? [];
    expect(toolNames).toContain("fetch_wise_transactions");

    const deps = pack.buildCapabilityDeps({
      ...buildBootstrapContext(runtimeAgents, skillCatalog, capabilityCatalog, config),
      adapters: {
        supabaseReadSession: mockSession,
        supabaseWriteSession: mockSession,
      },
    });
    expect(deps.capabilityCatalog).toBe(capabilityCatalog);
    expect(deps).not.toHaveProperty("obsidianVaultRoot");
  });

  it("keeps old SqlSession closures after rebinding providers for a soft recompile", async () => {
    const runtimeAgents = buildTestRuntimeAgents();
    const pack = buildPersonalSupervisorPack({
      config: testConfig,
      supervisorLlm: {} as ILLMConnector,
    });
    const skillCatalog = createSkillCatalog({ approvedModules: ["configuration"] });
    const sessionA = {
      executeSql: vi.fn(async <T>() => [{ source: "a" }] as T),
      close: async () => {},
    } as const;
    const sessionB = {
      executeSql: vi.fn(async <T>() => [{ source: "b" }] as T),
      close: async () => {},
    } as const;

    const bindProviders = (session: {
      executeSql: typeof sessionA.executeSql;
      close: () => Promise<void>;
    }) =>
      pack.buildCapabilityProviders!({
        config: testConfig,
        adapters: {
          supabaseReadSession: session as never,
          supabaseWriteSession: session as never,
        },
        runtimeAgentRepository: createRuntimeAgentRepositoryFake(),
        runtimeAgents,
        cronTargetAgentIds: deriveCronTargetAgentIds(runtimeAgents),
        cronJobRepository: createCronRepositoryFake(),
        skillCatalog,
      });

    const firstProviders = bindProviders(sessionA);
    const secondProviders = bindProviders(sessionB);

    const resolveExecSql = (providers: typeof firstProviders) => {
      const financeRead = providers.find(
        (provider) => provider.descriptor.id === "finance-domain-read",
      );
      const tool = financeRead?.resolveTools({}).find((entry) => entry.name === "exec_sql");
      if (!tool) {
        throw new Error("Expected finance-domain-read exec_sql tool");
      }
      return tool;
    };

    const oldTool = resolveExecSql(firstProviders);
    const newTool = resolveExecSql(secondProviders);

    await oldTool.invoke({ sql: "select 1" });
    await newTool.invoke({ sql: "select 1" });

    expect(sessionA.executeSql).toHaveBeenCalledTimes(1);
    expect(sessionB.executeSql).toHaveBeenCalledTimes(1);
    expect(sessionA.executeSql).toHaveBeenCalledWith("select 1");
    expect(sessionB.executeSql).toHaveBeenCalledWith("select 1");
  });
});

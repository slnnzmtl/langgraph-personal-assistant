import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  buildDefaultRuntimeExecution,
  createCapabilityCatalog,
  createCronJobRepositoryForConfig,
  createRuntimeAgentRepository,
  createSupervisorRuntime,
  isCronTargetRoute,
  NONE_CAPABILITY_PROVIDER,
  type RuntimeAgentDefinition,
  type RuntimeAgentRepository,
} from "@personal-assistant/supervisor-framework";
import { FakeLLMConnector } from "../helpers/fakes.js";

const baseResearcher: RuntimeAgentDefinition = {
  id: "researcher",
  name: "Researcher",
  description: "Answer factual questions.",
  systemPrompt: "You are a concise research assistant.",
  capabilityIds: ["none"],
  maxSteps: 6,
  enabled: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const buildPack = (options: {
  seedAgents: () => Promise<RuntimeAgentDefinition[]>;
  createCronJobRepository?: NonNullable<
    Parameters<typeof createSupervisorRuntime>[0]["createCronJobRepository"]
  >;
}) => {
  const catalog = createCapabilityCatalog([NONE_CAPABILITY_PROVIDER]);

  const runtimeAgentsFilePath = path.join(
    process.cwd(),
    ".tmp",
    `runtime-agents-${process.pid}-${Date.now()}.json`,
  );
  const cronJobsFilePath = path.join(
    process.cwd(),
    ".tmp",
    `cron-jobs-${process.pid}-${Date.now()}.json`,
  );

  return {
    pack: {
      config: {
        runtimeAgentsFilePath,
        cronJobsFilePath,
      },
      capabilityCatalog: catalog,
      supervisorLlm: new FakeLLMConnector(() => ({ next: "FINISH", reply: "ok" })),
      loadSupervisorPrompt: () => "Supervise requests.",
      createRuntimeAgentRepository: () =>
        createRuntimeAgentRepository(
          process.cwd(),
          path.relative(process.cwd(), runtimeAgentsFilePath),
        ),
      seedAgents: options.seedAgents,
      ...(options.createCronJobRepository
        ? { createCronJobRepository: options.createCronJobRepository }
        : {}),
      buildRuntimeExecution: (_agents, _skillCatalog, ctx) =>
        buildDefaultRuntimeExecution(ctx.capabilityCatalog, {
          loadPromptByKey: () => "prompt",
        }),
      buildModels: () => ({
        generic: new FakeLLMConnector(() => "ok").getModel(),
      }),
      buildCapabilityDeps: (ctx: { runtimeAgentRepository: RuntimeAgentRepository }) => ({
        runtimeAgentRepository: ctx.runtimeAgentRepository,
      }),
    },
    cronJobsFilePath,
  };
};

describe("createSupervisorRuntime", () => {
  it("reuses the same injected checkpointer across recompiles", async () => {
    const checkpointer = { kind: "mock-checkpointer" } as never;
    let createCheckpointerCalls = 0;
    let seedCalls = 0;

    const { pack } = buildPack({
      seedAgents: async () => {
        seedCalls += 1;
        return seedCalls === 1
          ? [baseResearcher]
          : [
              baseResearcher,
              {
                ...baseResearcher,
                id: "analyst",
                name: "Analyst",
                description: "Analyze data.",
              },
            ];
      },
    });

    const runtime = await createSupervisorRuntime({
      ...pack,
      createCheckpointer: async () => {
        createCheckpointerCalls += 1;
        return checkpointer;
      },
    });
    expect(runtime.getCheckpointer()).toBe(checkpointer);
    expect(createCheckpointerCalls).toBe(1);

    await runtime.recompile();

    expect(runtime.getCheckpointer()).toBe(checkpointer);
    expect(createCheckpointerCalls).toBe(1);
  });

  it("reuses one cron repository and dynamic target ids across recompiles", async () => {
    let seedCalls = 0;
    const { pack } = buildPack({
      seedAgents: async () => {
        seedCalls += 1;
        if (seedCalls === 1) {
          return [baseResearcher];
        }

        return [
          baseResearcher,
          {
            ...baseResearcher,
            id: "analyst",
            name: "Analyst",
            description: "Analyze data.",
          },
        ];
      },
      createCronJobRepository: (filePath, cronTargetAgentIds) =>
        createCronJobRepositoryForConfig(filePath, cronTargetAgentIds),
    });

    const runtime = await createSupervisorRuntime(pack);
    const initialRepository = runtime.getCronJobRepository();
    expect(isCronTargetRoute("analyst", runtime.getCronTargetAgentIds())).toBe(false);

    const changed = await runtime.recompile();

    expect(changed).toBe(true);
    expect(runtime.getCronJobRepository()).toBe(initialRepository);
    expect(isCronTargetRoute("analyst", runtime.getCronTargetAgentIds())).toBe(true);

    await runtime.getCronJobRepository().createJob({
      jobName: "analyst-report",
      schedule: "0 9 * * *",
      targetRoute: "analyst",
    });

    expect(await runtime.getCronJobRepository().loadJobs()).toEqual([
      expect.objectContaining({ jobName: "analyst-report", targetRoute: "analyst" }),
    ]);
  });

  it("serializes concurrent recompile calls", async () => {
    let seedCalls = 0;
    const { pack } = buildPack({
      seedAgents: async () => {
        seedCalls += 1;
        return seedCalls === 1
          ? [baseResearcher]
          : [
              baseResearcher,
              {
                ...baseResearcher,
                id: "writer",
                name: "Writer",
                description: "Write summaries.",
              },
            ];
      },
    });

    const runtime = await createSupervisorRuntime(pack);
    const [first, second] = await Promise.all([runtime.recompile(), runtime.recompile()]);

    expect([first, second]).toEqual([true, false]);
    expect(runtime.getCronTargetAgentIds()).toContain("writer");
  });

  it("invokes adapter lifecycle hooks", async () => {
    const onBeforeRecompile = vi.fn().mockResolvedValue(undefined);
    const onShutdownAdapters = vi.fn().mockResolvedValue(undefined);
    let seedCalls = 0;

    const { pack } = buildPack({
      seedAgents: async () => {
        seedCalls += 1;
        return seedCalls === 1
          ? [baseResearcher]
          : [
              baseResearcher,
              {
                ...baseResearcher,
                id: "editor",
                name: "Editor",
                description: "Edit drafts.",
              },
            ];
      },
    });

    const runtime = await createSupervisorRuntime(pack, {
      onBeforeRecompile,
      onShutdownAdapters,
    });

    await runtime.recompile();
    await runtime.shutdownAdapters();

    expect(onBeforeRecompile).toHaveBeenCalledTimes(1);
    expect(onShutdownAdapters).toHaveBeenCalledTimes(1);
  });

  it("skips recompile when the runtime agent fingerprint is unchanged", async () => {
    const onRecompiled = vi.fn();
    const { pack } = buildPack({
      seedAgents: async () => [baseResearcher],
    });

    const runtime = await createSupervisorRuntime(pack, { onRecompiled });
    const changed = await runtime.recompile();

    expect(changed).toBe(false);
    expect(onRecompiled).not.toHaveBeenCalled();
  });

  it("replaces the compiled graph and calls seedAgents once per successful recompile", async () => {
    const seedAgents = vi
      .fn<() => Promise<RuntimeAgentDefinition[]>>()
      .mockResolvedValueOnce([baseResearcher])
      .mockResolvedValueOnce([
        baseResearcher,
        {
          ...baseResearcher,
          id: "analyst",
          name: "Analyst",
          description: "Analyze data.",
        },
      ]);

    const { pack } = buildPack({ seedAgents });
    const runtime = await createSupervisorRuntime(pack);
    const graphBefore = runtime.getGraph();

    await runtime.recompile();

    expect(runtime.getGraph()).not.toBe(graphBefore);
    expect(seedAgents).toHaveBeenCalledTimes(2);
  });
});

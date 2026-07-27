import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { describe, expect, it, vi } from "vitest";

import {
  buildConfigurationCompletionSummary,
  CONFIGURATION_COMPLETION_FALLBACK,
  mapConfigurationSubAgentResult,
} from "@personal-assistant/supervisor-framework";
import { createTestRuntimeAgentNode, configurationRuntimeNodeConfig } from "../../helpers/policy-nodes.js";
import {
  createConfigurationTools,
  createCronRepositoryFake,
} from "../../helpers/configuration-tools.js";
import { getRuntimeAgentFixture } from "../../helpers/fakes.js";

const configurationDefinition = getRuntimeAgentFixture("configuration");

const defaultCronJobs = [
  {
    jobName: "sync-wise-transactions",
    schedule: "0 7 * * *",
    targetRoute: "finance",
    payload: "sync wise transactions for yesterday with supabase",
  },
];

describe("configuration runtime node hooks", () => {
  it("invokes the llm for cron list requests", async () => {
    const repository = createCronRepositoryFake(defaultCronJobs);
    const invokeSpy = vi.fn(async (_input: unknown) => new AIMessage({ content: "Here are your cron jobs." }));
    const runtimeCron = {
      addJob: vi.fn(),
      removeJob: vi.fn(),
      listActiveJobs: vi.fn(() => []),
    };

    const node = createTestRuntimeAgentNode(
      {
        invoke: async (input: unknown) => invokeSpy(input),
        bindTools: () => ({ invoke: async (input: unknown) => invokeSpy(input) }),
      } as never,
      configurationDefinition,
      createConfigurationTools(repository),
      configurationRuntimeNodeConfig(),
    );

    const result = await node({
      agentMessages: [new HumanMessage("list cron jobs")],
      stepCount: 0,
    });

    expect(result.agentMessages?.[0]).toBeInstanceOf(AIMessage);
    expect(result.agentMessages?.[0]?.content).toBe("Here are your cron jobs.");
    expect(invokeSpy).toHaveBeenCalledTimes(1);
    expect(runtimeCron.addJob).not.toHaveBeenCalled();
  });

  it("invokes the llm for configuration skill catalog requests", async () => {
    const repository = createCronRepositoryFake(defaultCronJobs);
    const invokeSpy = vi.fn(async (_input: unknown) => new AIMessage({ content: "Listed configuration skills." }));

    const node = createTestRuntimeAgentNode(
      {
        invoke: async (input: unknown) => invokeSpy(input),
        bindTools: () => ({ invoke: async (input: unknown) => invokeSpy(input) }),
      } as never,
      configurationDefinition,
      createConfigurationTools(repository),
      configurationRuntimeNodeConfig(),
    );

    const result = await node({
      agentMessages: [new HumanMessage("list available skills")],
      stepCount: 0,
    });

    expect(result.agentMessages?.[0]).toBeInstanceOf(AIMessage);
    expect(result.agentMessages?.[0]?.content).toBe("Listed configuration skills.");
    expect(invokeSpy).toHaveBeenCalledTimes(1);
  });

  it("delegates cross-owner skill list requests to the model", async () => {
    const repository = createCronRepositoryFake(defaultCronJobs);
    const invokeSpy = vi.fn(async (_input: unknown) =>
      new AIMessage({
        content: "",
        tool_calls: [
          {
            name: "read_skill",
            args: { name: "skill-management" },
            id: "read-1",
            type: "tool_call",
          },
        ],
      }),
    );

    const node = createTestRuntimeAgentNode(
      {
        invoke: async (input: any) => invokeSpy(input),
        bindTools: () => ({ invoke: async (input: any) => invokeSpy(input) }),
      } as never,
      configurationDefinition,
      createConfigurationTools(repository),
      configurationRuntimeNodeConfig(),
    );

    const result = await node({
      agentMessages: [new HumanMessage("list finance skills")],
      stepCount: 0,
    });

    expect(result.agentMessages?.[0]).toBeInstanceOf(AIMessage);
    expect(result.agentMessages?.[0]?.tool_calls?.[0]?.name).toBe("read_skill");
    expect(invokeSpy).toHaveBeenCalledTimes(1);
  });

  it("strips hallucinated tool calls that are not currently bound", async () => {
    const repository = createCronRepositoryFake(defaultCronJobs);
    const invokeSpy = vi.fn(async (_input: unknown) =>
      new AIMessage({
        content: "",
        tool_calls: [
          {
            name: "not_a_real_tool",
            args: {},
            id: "fake-1",
            type: "tool_call",
          },
        ],
      }),
    );

    const node = createTestRuntimeAgentNode(
      {
        invoke: async (input: any) => invokeSpy(input),
        bindTools: () => ({ invoke: async (input: any) => invokeSpy(input) }),
      } as never,
      configurationDefinition,
      createConfigurationTools(repository),
      configurationRuntimeNodeConfig(),
    );

    const result = await node({
      agentMessages: [new HumanMessage("do something with skills")],
      stepCount: 0,
    });

    expect(result.agentMessages?.[0]).toBeInstanceOf(AIMessage);
    expect(result.agentMessages?.[0]?.tool_calls ?? []).toHaveLength(0);
    expect(String(result.agentMessages?.[0]?.content)).toContain(
      "That tool is not available for this runtime agent.",
    );
    expect(invokeSpy).toHaveBeenCalledTimes(1);
  });

  it("invokes the llm after preview_skill tool results", async () => {
    const repository = createCronRepositoryFake(defaultCronJobs);
    const invokeSpy = vi.fn(async (_input: unknown) => new AIMessage({ content: "Here is the skill preview summary." }));
    const skillContent = "---\nname: sync-expenses\ndescription: Example\n---\n\n# Skill body";

    const node = createTestRuntimeAgentNode(
      {
        invoke: async (input: unknown) => invokeSpy(input),
        bindTools: () => ({ invoke: async (input: unknown) => invokeSpy(input) }),
      } as never,
      configurationDefinition,
      createConfigurationTools(repository),
      configurationRuntimeNodeConfig(),
    );

    const result = await node({
      agentMessages: [
        new HumanMessage("read sync-expenses"),
        new AIMessage({
          content: "",
          tool_calls: [
            {
              name: "preview_skill",
              args: { module: "finance", name: "sync-expenses" },
              id: "preview-1",
              type: "tool_call",
            },
          ],
        }),
        new ToolMessage({
          name: "preview_skill",
          tool_call_id: "preview-1",
          content: skillContent,
        }),
      ],
      stepCount: 0,
    });

    expect(result.agentMessages?.[0]).toBeInstanceOf(AIMessage);
    expect(result.agentMessages?.[0]?.content).toBe("Here is the skill preview summary.");
    expect(invokeSpy).toHaveBeenCalledTimes(1);
  });

  it("invokes the llm after list_skills tool results", async () => {
    const repository = createCronRepositoryFake(defaultCronJobs);
    const invokeSpy = vi.fn(async (_input: unknown) => new AIMessage({ content: "Listed finance skills." }));
    const listContent = "sync-expenses: Sync Wise transactions";

    const node = createTestRuntimeAgentNode(
      {
        invoke: async (input: unknown) => invokeSpy(input),
        bindTools: () => ({ invoke: async (input: unknown) => invokeSpy(input) }),
      } as never,
      configurationDefinition,
      createConfigurationTools(repository),
      configurationRuntimeNodeConfig(),
    );

    const result = await node({
      agentMessages: [
        new HumanMessage("list skills"),
        new AIMessage({
          content: "",
          tool_calls: [
            {
              name: "list_skills",
              args: { module: "finance" },
              id: "list-1",
              type: "tool_call",
            },
          ],
        }),
        new ToolMessage({
          name: "list_skills",
          tool_call_id: "list-1",
          content: listContent,
        }),
      ],
      stepCount: 0,
    });

    expect(result.agentMessages?.[0]).toBeInstanceOf(AIMessage);
    expect(result.agentMessages?.[0]?.content).toBe("Listed finance skills.");
    expect(invokeSpy).toHaveBeenCalledTimes(1);
  });

  it("continues to the model after list_skills during skill bootstrap enrichment", async () => {
    const repository = createCronRepositoryFake(defaultCronJobs);
    const invokeSpy = vi.fn(async (_input: unknown) => new AIMessage({ content: "Module: finance\nSkill Name: finance-summary\nStatus: Draft" }));
    const listContent = "Module: finance\nSkill Name: expense-sync\nStatus: Listed";

    const node = createTestRuntimeAgentNode(
      {
        invoke: async (input: any) => invokeSpy(input),
        bindTools: () => ({ invoke: async (input: any) => invokeSpy(input) }),
      } as never,
      configurationDefinition,
      createConfigurationTools(repository),
      configurationRuntimeNodeConfig(),
    );

    const result = await node({
      agentMessages: [
        new HumanMessage("Create a new skill named finance-summary for the finance agent."),
        new AIMessage({
          content: "",
          tool_calls: [{ name: "list_runtime_agents", args: {}, id: "agents-1", type: "tool_call" }],
        }),
        new ToolMessage({ name: "list_runtime_agents", tool_call_id: "agents-1", content: "Agent ID: finance" }),
        new AIMessage({
          content: "",
          tool_calls: [{ name: "list_capabilities", args: {}, id: "caps-1", type: "tool_call" }],
        }),
        new ToolMessage({ name: "list_capabilities", tool_call_id: "caps-1", content: "finance-domain" }),
        new AIMessage({
          content: "",
          tool_calls: [{ name: "list_skills", args: { module: "finance" }, id: "list-1", type: "tool_call" }],
        }),
        new ToolMessage({ name: "list_skills", tool_call_id: "list-1", content: listContent }),
      ],
      stepCount: 3,
    });

    expect(result.agentMessages?.[0]).toBeInstanceOf(AIMessage);
    expect(result.agentMessages?.[0]?.content).toContain("Status: Draft");
    expect(invokeSpy).toHaveBeenCalledTimes(1);
  });

  it("continues to the model after preview_skill so edit flows can proceed", async () => {
    const repository = createCronRepositoryFake(defaultCronJobs);
    const invokeSpy = vi.fn(async (_input: unknown) => new AIMessage({ content: "Ready to edit." }));
    const skillContent = "---\nname: sync-expenses\ndescription: Example\n---\n\n# Skill body";

    const node = createTestRuntimeAgentNode(
      {
        invoke: async (input: any) => invokeSpy(input),
        bindTools: () => ({ invoke: async (input: any) => invokeSpy(input) }),
      } as never,
      configurationDefinition,
      createConfigurationTools(repository),
      configurationRuntimeNodeConfig(),
    );

    const result = await node({
      agentMessages: [
        new HumanMessage("edit sync-expenses"),
        new AIMessage({
          content: "",
          tool_calls: [
            {
              name: "preview_skill",
              args: { module: "finance", name: "sync-expenses" },
              id: "read-1",
              type: "tool_call",
            },
          ],
        }),
        new ToolMessage({
          name: "preview_skill",
          tool_call_id: "read-1",
          content: skillContent,
        }),
      ],
      stepCount: 0,
    });

    expect(result.agentMessages?.[0]).toBeInstanceOf(AIMessage);
    expect(result.agentMessages?.[0]?.content).toBe("Ready to edit.");
    expect(invokeSpy).toHaveBeenCalledTimes(1);
  });

  it("falls back to a non-empty completion when the model returns blank text with no tools", async () => {
    const repository = createCronRepositoryFake(defaultCronJobs);
    const invokeSpy = vi.fn(async (_input: unknown) => new AIMessage(""));

    const node = createTestRuntimeAgentNode(
      {
        invoke: async (input: unknown) => invokeSpy(input),
        bindTools: () => ({ invoke: async (input: unknown) => invokeSpy(input) }),
      } as never,
      configurationDefinition,
      createConfigurationTools(repository),
      configurationRuntimeNodeConfig(),
    );

    const result = await node({
      agentMessages: [new HumanMessage("list cron jobs")],
      stepCount: 0,
    });

    expect(result.agentMessages?.[0]?.content).toBe(CONFIGURATION_COMPLETION_FALLBACK);
    expect(invokeSpy).toHaveBeenCalledTimes(1);
  });

  it("summarizes list_cron_jobs results when the model returns a blank final response", async () => {
    const repository = createCronRepositoryFake(defaultCronJobs);
    const cronListing = [
      "Job name: sync-wise-transactions",
      "Schedule: 0 7 * * *",
      "Target route: finance",
    ].join("\n");
    const invokeSpy = vi.fn(async (_input: unknown) => new AIMessage(""));

    const node = createTestRuntimeAgentNode(
      {
        invoke: async (input: unknown) => invokeSpy(input),
        bindTools: () => ({ invoke: async (input: unknown) => invokeSpy(input) }),
      } as never,
      configurationDefinition,
      createConfigurationTools(repository),
      configurationRuntimeNodeConfig(),
    );

    const result = await node({
      agentMessages: [
        new HumanMessage("list all cron jobs"),
        new AIMessage({
          content: "",
          tool_calls: [
            {
              name: "list_cron_jobs",
              args: {},
              id: "list-1",
              type: "tool_call",
            },
          ],
        }),
        new ToolMessage({
          name: "list_cron_jobs",
          tool_call_id: "list-1",
          content: cronListing,
        }),
      ],
      stepCount: 1,
    });

    expect(result.agentMessages?.[0]?.content).toContain("Job name: sync-wise-transactions");
    expect(result.agentMessages?.[0]?.content).not.toBe(CONFIGURATION_COMPLETION_FALLBACK);
    expect(invokeSpy).toHaveBeenCalledTimes(1);
  });
});

describe("buildConfigurationCompletionSummary", () => {
  it("returns the latest consumable tool body", () => {
    const summary = buildConfigurationCompletionSummary([
      new ToolMessage({
        name: "list_skills",
        tool_call_id: "list-1",
        content: "cron: Manage cron jobs",
      }),
      new ToolMessage({
        name: "list_cron_jobs",
        tool_call_id: "list-2",
        content: "Job name: daily-note\nSchedule: 0 6 * * *",
      }),
    ]);

    expect(summary).toContain("Job name: daily-note");
  });

  it("ignores consumed markers and error bodies", () => {
    const summary = buildConfigurationCompletionSummary([
      new ToolMessage({
        name: "read_skill",
        tool_call_id: "read-1",
        content: "[consumed: read_skill]",
      }),
      new ToolMessage({
        name: "create_cron_job",
        tool_call_id: "create-1",
        content: "Error: job already exists",
      }),
      new ToolMessage({
        name: "list_cron_jobs",
        tool_call_id: "list-1",
        content: "Job name: finance-sync",
      }),
    ]);

    expect(summary).toBe("Job name: finance-sync");
  });
});

describe("mapConfigurationSubAgentResult", () => {
  it("salvages tool output when the last reply is the generic fallback", () => {
    const cronListing = "Job name: finance-sync\nSchedule: 59 23 * * *";

    const result = mapConfigurationSubAgentResult(
      {
        agentMessages: [
          new HumanMessage("list cron jobs"),
          new ToolMessage({
            name: "list_cron_jobs",
            tool_call_id: "list-1",
            content: cronListing,
          }),
          new AIMessage(CONFIGURATION_COMPLETION_FALLBACK),
        ],
        stepCount: 2,
      },
      10,
      "Configuration",
    );

    expect(result.messages?.[0]?.content).toBe(cronListing);
  });
});

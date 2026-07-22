import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { describe, expect, it, vi } from "vitest";

import { createConfigurationNode } from "../../helpers/policy-nodes.js";
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

describe("createConfigurationNode", () => {
  it("lists cron jobs directly without invoking the llm or runtime scheduler", async () => {
    const repository = createCronRepositoryFake(defaultCronJobs);
    const invokeSpy = vi.fn(() => {
      throw new Error("LLM must not run for list requests");
    });
    const runtimeCron = {
      addJob: vi.fn(),
      removeJob: vi.fn(),
      listActiveJobs: vi.fn(() => []),
    };

    const node = createConfigurationNode(
      {
        invoke: async (input: any) => invokeSpy(input),
        bindTools: () => ({ invoke: async (input: any) => invokeSpy(input) }),
      } as never,
      createConfigurationTools(repository),
      {
        repository: repository as never,
        definition: configurationDefinition,
        runtimeCron: runtimeCron as never,
      },
    );

    const result = await node({
      agentMessages: [new HumanMessage("list cron jobs")],
      stepCount: 0,
    });

    expect(result.agentMessages?.[0]).toBeInstanceOf(AIMessage);
    expect(result.agentMessages?.[0]?.content).toContain("Job name: sync-wise-transactions");
    expect(result.agentMessages?.[0]?.content).toContain("Schedule: 0 7 * * *");
    expect(invokeSpy).not.toHaveBeenCalled();
    expect(runtimeCron.addJob).not.toHaveBeenCalled();
  });

  it("lists configuration skills directly without invoking the llm", async () => {
    const repository = createCronRepositoryFake(defaultCronJobs);
    const invokeSpy = vi.fn(() => {
      throw new Error("LLM must not run for configuration skill catalog requests");
    });

    const node = createConfigurationNode(
      {
        invoke: async (input: any) => invokeSpy(input),
        bindTools: () => ({ invoke: async (input: any) => invokeSpy(input) }),
      } as never,
      createConfigurationTools(repository),
      {
        repository: repository as never,
        definition: configurationDefinition,
      },
    );

    const result = await node({
      agentMessages: [new HumanMessage("list available skills")],
      stepCount: 0,
    });

    expect(result.agentMessages?.[0]).toBeInstanceOf(AIMessage);
    expect(result.agentMessages?.[0]?.content).toContain("Module: configuration");
    expect(result.agentMessages?.[0]?.content).toContain("Skill Name: cron");
    expect(result.agentMessages?.[0]?.content).toContain("Skill Name: skill-management");
    expect(result.agentMessages?.[0]?.content).toContain("Status: Listed");
    expect(invokeSpy).not.toHaveBeenCalled();
  });

  it("delegates cross-owner skill list requests to the model", async () => {
    const repository = createCronRepositoryFake(defaultCronJobs);
    const invokeSpy = vi.fn(async () =>
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

    const node = createConfigurationNode(
      {
        invoke: async (input: any) => invokeSpy(input),
        bindTools: () => ({ invoke: async (input: any) => invokeSpy(input) }),
      } as never,
      createConfigurationTools(repository),
      {
        repository: repository as never,
        definition: configurationDefinition,
      },
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
    const invokeSpy = vi.fn(async () =>
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

    const node = createConfigurationNode(
      {
        invoke: async (input: any) => invokeSpy(input),
        bindTools: () => ({ invoke: async (input: any) => invokeSpy(input) }),
      } as never,
      createConfigurationTools(repository),
      {
        repository: repository as never,
        definition: configurationDefinition,
      },
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

  it("returns preview_skill tool output directly without invoking the llm again", async () => {
    const repository = createCronRepositoryFake(defaultCronJobs);
    const invokeSpy = vi.fn(() => {
      throw new Error("LLM must not run after read-only skill tool results");
    });
    const skillContent = "---\nname: sync-expenses\ndescription: Example\n---\n\n# Skill body";

    const node = createConfigurationNode(
      {
        invoke: async (input: any) => invokeSpy(input),
        bindTools: () => ({ invoke: async (input: any) => invokeSpy(input) }),
      } as never,
      createConfigurationTools(repository),
      {
        repository: repository as never,
        definition: configurationDefinition,
      },
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
    expect(result.agentMessages?.[0]?.content).toBe(skillContent);
    expect(invokeSpy).not.toHaveBeenCalled();
  });

  it("returns list_skills tool output directly without invoking the llm again", async () => {
    const repository = createCronRepositoryFake(defaultCronJobs);
    const invokeSpy = vi.fn(() => {
      throw new Error("LLM must not run after read-only skill tool results");
    });
    const listContent = "sync-expenses: Sync Wise transactions";

    const node = createConfigurationNode(
      {
        invoke: async (input: any) => invokeSpy(input),
        bindTools: () => ({ invoke: async (input: any) => invokeSpy(input) }),
      } as never,
      createConfigurationTools(repository),
      {
        repository: repository as never,
        definition: configurationDefinition,
      },
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
    expect(result.agentMessages?.[0]?.content).toBe(listContent);
    expect(invokeSpy).not.toHaveBeenCalled();
  });

  it("continues to the model after list_skills during skill bootstrap enrichment", async () => {
    const repository = createCronRepositoryFake(defaultCronJobs);
    const invokeSpy = vi.fn(async () => new AIMessage({ content: "Module: finance\nSkill Name: finance-summary\nStatus: Draft" }));
    const listContent = "Module: finance\nSkill Name: expense-sync\nStatus: Listed";

    const node = createConfigurationNode(
      {
        invoke: async (input: any) => invokeSpy(input),
        bindTools: () => ({ invoke: async (input: any) => invokeSpy(input) }),
      } as never,
      createConfigurationTools(repository),
      {
        repository: repository as never,
        definition: configurationDefinition,
      },
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

  it("continues to the model after read_skill_for_edit so edit flows can proceed", async () => {
    const repository = createCronRepositoryFake(defaultCronJobs);
    const invokeSpy = vi.fn(async () => new AIMessage({ content: "Ready to edit." }));
    const skillContent = "---\nname: sync-expenses\ndescription: Example\n---\n\n# Skill body";

    const node = createConfigurationNode(
      {
        invoke: async (input: any) => invokeSpy(input),
        bindTools: () => ({ invoke: async (input: any) => invokeSpy(input) }),
      } as never,
      createConfigurationTools(repository),
      {
        repository: repository as never,
        definition: configurationDefinition,
      },
    );

    const result = await node({
      agentMessages: [
        new HumanMessage("edit sync-expenses"),
        new AIMessage({
          content: "",
          tool_calls: [
            {
              name: "read_skill_for_edit",
              args: { module: "finance", name: "sync-expenses" },
              id: "read-1",
              type: "tool_call",
            },
          ],
        }),
        new ToolMessage({
          name: "read_skill_for_edit",
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
});

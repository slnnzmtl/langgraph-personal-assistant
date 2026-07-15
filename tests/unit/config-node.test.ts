import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { describe, expect, it, vi } from "vitest";

import { createConfigurationNode } from "../../src/nodes/configuration/config-node.js";
import { createConfigurationSkillScopedTools } from "../../src/nodes/configuration/config-tools.js";

const createRepository = () => {
  const jobs = [
    {
      jobName: "sync-wise-transactions",
      schedule: "0 7 * * *",
      targetRoute: "Finance_SG",
      payload: "sync wise transactions for yesterday with supabase",
    },
  ];

  return {
    loadJobs: vi.fn(async () => jobs),
    saveJobs: vi.fn(),
  };
};

describe("createConfigurationNode", () => {
  it("lists cron jobs directly without invoking the llm or runtime scheduler", async () => {
    const repository = createRepository();
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
      createConfigurationSkillScopedTools(repository as never),
      {
        repository: repository as never,
        runtimeCron: runtimeCron as never,
      },
    );

    const result = await node({
      messages: [new HumanMessage("list cron jobs")],
      stepCount: 0,
    });

    expect(result.messages?.[0]).toBeInstanceOf(AIMessage);
    expect(result.messages?.[0]?.content).toContain("Job name: sync-wise-transactions");
    expect(result.messages?.[0]?.content).toContain("Schedule: 0 7 * * *");
    expect(invokeSpy).not.toHaveBeenCalled();
    expect(runtimeCron.addJob).not.toHaveBeenCalled();
  });

  it("lists configuration skills directly without invoking the llm", async () => {
    const repository = createRepository();
    const invokeSpy = vi.fn(() => {
      throw new Error("LLM must not run for configuration skill catalog requests");
    });

    const node = createConfigurationNode(
      {
        invoke: async (input: any) => invokeSpy(input),
        bindTools: () => ({ invoke: async (input: any) => invokeSpy(input) }),
      } as never,
      createConfigurationSkillScopedTools(repository as never),
      {
        repository: repository as never,
      },
    );

    const result = await node({
      messages: [new HumanMessage("list available skills")],
      stepCount: 0,
    });

    expect(result.messages?.[0]).toBeInstanceOf(AIMessage);
    expect(result.messages?.[0]?.content).toContain("Owner: configuration");
    expect(result.messages?.[0]?.content).toContain("Skill Name: cron");
    expect(result.messages?.[0]?.content).toContain("Skill Name: skill-management");
    expect(result.messages?.[0]?.content).toContain("Status: Listed");
    expect(invokeSpy).not.toHaveBeenCalled();
  });

  it("delegates cross-owner skill list requests to the model", async () => {
    const repository = createRepository();
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
      createConfigurationSkillScopedTools(repository as never),
      {
        repository: repository as never,
      },
    );

    const result = await node({
      messages: [new HumanMessage("list finance skills")],
      stepCount: 0,
    });

    expect(result.messages?.[0]).toBeInstanceOf(AIMessage);
    expect(result.messages?.[0]?.tool_calls?.[0]?.name).toBe("read_skill");
    expect(invokeSpy).toHaveBeenCalledTimes(1);
  });

  it("strips hallucinated tool calls that are not currently bound", async () => {
    const repository = createRepository();
    const invokeSpy = vi.fn(async () =>
      new AIMessage({
        content: "",
        tool_calls: [
          {
            name: "list_skills",
            args: {},
            id: "list-1",
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
      createConfigurationSkillScopedTools(repository as never),
      {
        repository: repository as never,
      },
    );

    const result = await node({
      messages: [new HumanMessage("do something with skills")],
      stepCount: 0,
    });

    expect(result.messages?.[0]).toBeInstanceOf(AIMessage);
    expect(result.messages?.[0]?.tool_calls ?? []).toHaveLength(0);
    expect(String(result.messages?.[0]?.content)).toContain("read_skill");
    expect(invokeSpy).toHaveBeenCalledTimes(1);
  });

  it("returns preview_skill tool output directly without invoking the llm again", async () => {
    const repository = createRepository();
    const invokeSpy = vi.fn(() => {
      throw new Error("LLM must not run after read-only skill tool results");
    });
    const skillContent = "---\nname: sync-expenses\ndescription: Example\n---\n\n# Skill body";

    const node = createConfigurationNode(
      {
        invoke: async (input: any) => invokeSpy(input),
        bindTools: () => ({ invoke: async (input: any) => invokeSpy(input) }),
      } as never,
      createConfigurationSkillScopedTools(repository as never),
      {
        repository: repository as never,
      },
    );

    const result = await node({
      messages: [
        new HumanMessage("read sync-expenses"),
        new AIMessage({
          content: "",
          tool_calls: [
            {
              name: "preview_skill",
              args: { owner: "finance", name: "sync-expenses" },
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

    expect(result.messages?.[0]).toBeInstanceOf(AIMessage);
    expect(result.messages?.[0]?.content).toBe(skillContent);
    expect(invokeSpy).not.toHaveBeenCalled();
  });

  it("returns list_skills tool output directly without invoking the llm again", async () => {
    const repository = createRepository();
    const invokeSpy = vi.fn(() => {
      throw new Error("LLM must not run after read-only skill tool results");
    });
    const listContent = "sync-expenses: Sync Wise transactions";

    const node = createConfigurationNode(
      {
        invoke: async (input: any) => invokeSpy(input),
        bindTools: () => ({ invoke: async (input: any) => invokeSpy(input) }),
      } as never,
      createConfigurationSkillScopedTools(repository as never),
      {
        repository: repository as never,
      },
    );

    const result = await node({
      messages: [
        new HumanMessage("list skills"),
        new AIMessage({
          content: "",
          tool_calls: [
            {
              name: "list_skills",
              args: { owner: "finance" },
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

    expect(result.messages?.[0]).toBeInstanceOf(AIMessage);
    expect(result.messages?.[0]?.content).toBe(listContent);
    expect(invokeSpy).not.toHaveBeenCalled();
  });

  it("continues to the model after read_skill_for_edit so edit flows can proceed", async () => {
    const repository = createRepository();
    const invokeSpy = vi.fn(async () => new AIMessage({ content: "Ready to edit." }));
    const skillContent = "---\nname: sync-expenses\ndescription: Example\n---\n\n# Skill body";

    const node = createConfigurationNode(
      {
        invoke: async (input: any) => invokeSpy(input),
        bindTools: () => ({ invoke: async (input: any) => invokeSpy(input) }),
      } as never,
      createConfigurationSkillScopedTools(repository as never),
      {
        repository: repository as never,
      },
    );

    const result = await node({
      messages: [
        new HumanMessage("edit sync-expenses"),
        new AIMessage({
          content: "",
          tool_calls: [
            {
              name: "read_skill_for_edit",
              args: { owner: "finance", name: "sync-expenses" },
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

    expect(result.messages?.[0]).toBeInstanceOf(AIMessage);
    expect(result.messages?.[0]?.content).toBe("Ready to edit.");
    expect(invokeSpy).toHaveBeenCalledTimes(1);
  });
});

import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { describe, expect, it, vi } from "vitest";

import { createConfigurationNode } from "../../src/nodes/configurator/config-node.js";
import { createCronConfigTools } from "../../src/nodes/configurator/config-tools.js";

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
      createCronConfigTools(repository as never),
      {
        repository: repository as never,
        runtimeCron: runtimeCron as never,
      },
    );

    const result = await node({
      messages: [new HumanMessage("list cron jobs")],
      context: {},
      next: undefined,
    });

    expect(result.messages?.[0]).toBeInstanceOf(AIMessage);
    expect(result.messages?.[0]?.content).toContain("Job name: sync-wise-transactions");
    expect(result.messages?.[0]?.content).toContain("Schedule: 0 7 * * *");
    expect(invokeSpy).not.toHaveBeenCalled();
    expect(runtimeCron.addJob).not.toHaveBeenCalled();
  });
});
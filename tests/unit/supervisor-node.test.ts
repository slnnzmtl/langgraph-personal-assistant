import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

import type { ILLMConnector } from "../../src/connectors/llm-connector.js";
import { createAppSupervisorNode, FakeLLMConnector, createRuntimeAgentRepositoryFake, firstStateUpdateMessage, getStateUpdateMessages, getStateUpdateRuntimeAgentId, makeHumanState } from "../helpers/fakes.js";
import { buildCronTriggerForJob } from "../../src/cron-triggers.js";
import { loadSupervisorSystemPrompt } from "../../src/prompts/load-system-prompt.js";
import { getEmptySubAgentHandoff } from "../../src/core/execution/empty-subagent-handoff.js";
import { MESSAGE_HISTORY_LIMIT, reduceAgentMessages, trimMessagesToLast } from "../../src/core/state.js";

describe("createSupervisorNode", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("loads the supervisor system prompt from the markdown file", () => {
    const prompt = loadSupervisorSystemPrompt();

    expect(prompt).toContain("You are the Root Supervisor for a private personal assistant.");
  });

  it("includes the current datetime in the shared system prompt", async () => {
    const currentInstant = new Date("2026-07-05T12:34:56.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(currentInstant);

    const connector = new FakeLLMConnector((input) => {
      expect(Array.isArray(input)).toBe(true);
      const promptMessages = input as HumanMessage[];

      expect(promptMessages[0]?.content).toContain("You are the Root Supervisor for a private personal assistant.");
      expect(promptMessages[0]?.content).toContain("CURRENT DATETIME: 2026-07-05T12:34:56 UTC");
      expect(promptMessages[0]?.content.indexOf("You are the Root Supervisor")).toBeLessThan(
        promptMessages[0]?.content.indexOf("<system_metadata>") ?? -1,
      );
      expect(promptMessages[1]?.content).toBe("hello");

      return {
        next: "FINISH",
        reply: "Datetime checked",
      };
    });
    const supervisorNode = createAppSupervisorNode(connector);

    const result = await supervisorNode(makeHumanState("hello"));

    expect(result.next).toBe("FINISH");
    expect(firstStateUpdateMessage(result)?.content).toBe("Datetime checked");
  });

  it("appends a direct AI reply for the FINISH path", async () => {
    const connector = new FakeLLMConnector(() => ({
      next: "FINISH",
      reply: "Direct answer",
    }));
    const supervisorNode = createAppSupervisorNode(connector);

    const result = await supervisorNode(makeHumanState("hello"));

    expect(result.next).toBe("FINISH");
    expect(getStateUpdateMessages(result)).toHaveLength(1);
    expect(firstStateUpdateMessage(result)?.content).toBe("Direct answer");
  });

  it("generates a model-written final reply when structured routing fails", async () => {
    const connector: ILLMConnector = {
      bindRoutingTools: () => ({
        invoke: async () => {
          throw new Error("schema parse failed");
        },
      }),
      getModel: () => ({
        invoke: async () => new AIMessage("Final explanatory answer"),
      } as unknown as BaseChatModel),
    };
    const supervisorNode = createAppSupervisorNode(connector);

    const result = await supervisorNode(makeHumanState("hello"));

    expect(result.next).toBe("FINISH");
    expect(firstStateUpdateMessage(result)?.content).toBe("Final explanatory answer");
  });

  it("generates a model-written final reply when FINISH omits a reply", async () => {
    const routingInvoke = vi.fn(async () => ({
      next: "FINISH",
    } as any));
    const modelInvoke = vi.fn(async () => new AIMessage("Final explanation for missing reply"));

    const connector: ILLMConnector = {
      bindRoutingTools: () => ({
        invoke: routingInvoke,
      }),
      getModel: () => ({
        invoke: modelInvoke,
      } as unknown as BaseChatModel),
    };
    const supervisorNode = createAppSupervisorNode(connector);

    const result = await supervisorNode(makeHumanState("hello"));

    expect(result.next).toBe("FINISH");
    expect(firstStateUpdateMessage(result)?.content).toBe("Final explanation for missing reply");
    expect(modelInvoke).toHaveBeenCalledTimes(1);
  });

  it("routes specialized branches even when the model returns a placeholder reply string", async () => {
    const connector = new FakeLLMConnector(() => ({
      next: "obsidian",
      reply: "null",
    }));
    const supervisorNode = createAppSupervisorNode(connector, {
      runtimeAgentRepository: createRuntimeAgentRepositoryFake(),
    });

    const result = await supervisorNode(makeHumanState("create today routine note"));

    expect(result.next).toBe("Runtime_SG");
    expect(getStateUpdateRuntimeAgentId(result)).toBe("obsidian");
    expect(result.messages).toBeUndefined();
  });

  it("does not treat the literal string null as a FINISH reply", async () => {
    const modelInvoke = vi.fn(async () => new AIMessage("Please rephrase your request."));
    const connector: ILLMConnector = {
      bindRoutingTools: () => ({
        invoke: async () => ({
          next: "FINISH",
          reply: "null",
        }),
      }),
      getModel: () => ({
        invoke: modelInvoke,
      } as unknown as BaseChatModel),
    };
    const supervisorNode = createAppSupervisorNode(connector);

    const result = await supervisorNode(makeHumanState("hello"));

    expect(result.next).toBe("FINISH");
    expect(firstStateUpdateMessage(result)?.content).toBe("Please rephrase your request.");
    expect(modelInvoke).toHaveBeenCalledTimes(1);
  });

  it("returns a route without appending a message for specialized branches", async () => {
    const connector = new FakeLLMConnector((input) => {
      expect(Array.isArray(input)).toBe(true);
      expect((input as HumanMessage[]).length).toBeGreaterThan(1);

      return { next: "finance" };
    });
    const supervisorNode = createAppSupervisorNode(connector, {
      runtimeAgentRepository: createRuntimeAgentRepositoryFake(),
    });

    const result = await supervisorNode(makeHumanState("log lunch expense"));

    expect(result.next).toBe("Runtime_SG");
    expect(getStateUpdateRuntimeAgentId(result)).toBe("finance");
  });

  it("receives at most the system prompt plus the last 10 state messages", async () => {
    const connector = new FakeLLMConnector((input) => {
      expect(Array.isArray(input)).toBe(true);
      expect((input as HumanMessage[])).toHaveLength(2);
      expect((input as HumanMessage[])[0]?.content).toContain("You are the Root Supervisor for a private personal assistant.");
      expect((input as HumanMessage[])[1]?.content).toContain("turn-5");
      expect((input as HumanMessage[])[1]?.content).toContain("turn-14");

      return { next: "FINISH", reply: "Trimmed reply" };
    });
    const supervisorNode = createAppSupervisorNode(connector);
    const history = trimMessagesToLast(
      Array.from({ length: MESSAGE_HISTORY_LIMIT + 4 }, (_, index) =>
        new HumanMessage(`turn-${index + 1}`),
      ),
    );

    const result = await supervisorNode({
      messages: history,
      context: {},
      next: undefined,
    });

    expect(result.next).toBe("FINISH");
    expect(firstStateUpdateMessage(result)?.content).toBe("Trimmed reply");
  });

  it("passes the raw latest user request through the sanitized history", async () => {
    const connector = new FakeLLMConnector((input) => {
      expect(Array.isArray(input)).toBe(true);
      const promptMessages = input as HumanMessage[];
      const latestMessage = promptMessages.at(-1);

      expect(typeof latestMessage?.content === "string" ? latestMessage.content : "").toBe(
        "where is the note?\ngive me a plan for yesterday",
      );

      return { next: "obsidian" };
    });
    const supervisorNode = createAppSupervisorNode(connector, {
      runtimeAgentRepository: createRuntimeAgentRepositoryFake(),
    });

    const result = await supervisorNode({
      messages: [
        new HumanMessage("where is the note?"),
        new HumanMessage("give me a plan for yesterday"),
      ],
      context: {},
      next: undefined,
    });

    expect(result.next).toBe("Runtime_SG");
    expect(getStateUpdateRuntimeAgentId(result)).toBe("obsidian");
  });

  it("can route scheduling requests to the configuration branch", async () => {
    const connector = new FakeLLMConnector((input) => {
      expect(Array.isArray(input)).toBe(true);

      return { next: "configuration" };
    });
    const supervisorNode = createAppSupervisorNode(connector, {
      runtimeAgentRepository: createRuntimeAgentRepositoryFake(),
    });

    const result = await supervisorNode(makeHumanState("set up a cron message every weekday at 9am"));

    expect(result.next).toBe("Runtime_SG");
    expect(getStateUpdateRuntimeAgentId(result)).toBe("configuration");
  });

  it("sanitizes prior tool messages before routing", async () => {
    const connector = new FakeLLMConnector((input) => {
      expect(Array.isArray(input)).toBe(true);
      const promptMessages = input as Array<HumanMessage | AIMessage>;

      expect(promptMessages.some((message) => message instanceof ToolMessage)).toBe(false);
      expect(promptMessages.some((message) => message instanceof AIMessage && Array.isArray(message.tool_calls) && message.tool_calls.length > 0)).toBe(false);

      return { next: "FINISH", reply: "Sanitized" };
    });
    const supervisorNode = createAppSupervisorNode(connector);

    const result = await supervisorNode({
      messages: [
        new HumanMessage("add go to shop"),
        new AIMessage({
          content: "",
          tool_calls: [
            {
              name: "write_file",
              args: { relativePath: "routine/2026-07-05.md" },
              id: "write-1",
              type: "tool_call",
            },
          ],
        }),
        new ToolMessage({
          tool_call_id: "write-1",
          content: "Success: saved note.",
        }),
      ],
      context: {},
      next: undefined,
    });

    expect(result.next).toBe("FINISH");
    expect(firstStateUpdateMessage(result)?.content).toBe("Sanitized");
  });

  it("summarizes instead of re-delegating when a runtime agent returns an empty reply", async () => {
    const routingInvoke = vi.fn(async () => ({
      next: "obsidian",
    }));
    const modelInvoke = vi.fn(async () =>
      new AIMessage("I couldn't finish that step cleanly. Please try again."),
    );
    const connector: ILLMConnector = {
      bindRoutingTools: () => ({
        invoke: routingInvoke,
      }),
      getModel: () => ({
        invoke: modelInvoke,
      } as unknown as BaseChatModel),
    };
    const supervisorNode = createAppSupervisorNode(connector, {
      runtimeAgentRepository: createRuntimeAgentRepositoryFake(),
    });

    const result = await supervisorNode({
      messages: [
        new HumanMessage("today's plan"),
        new AIMessage(""),
      ],
      context: {},
      next: undefined,
    });

    expect(result.next).toBe("FINISH");
    expect(firstStateUpdateMessage(result)?.content).toBe(
      "I couldn't finish that step cleanly. Please try again.",
    );
    expect(modelInvoke).toHaveBeenCalledOnce();
    expect(routingInvoke).not.toHaveBeenCalled();
  });

  it("includes tool context when summarizing an empty sub-agent handoff", async () => {
    const modelInvoke = vi.fn(async (input: unknown) => {
      const messages = input as Array<{ content?: unknown }>;
      const systemText = String(messages[0]?.content ?? "");
      expect(systemText).toContain("exec_sql:");
      expect(systemText).toContain("expenses");
      expect(systemText).toContain("does not exist");
      return new AIMessage("The query failed because the expenses table name was wrong.");
    });
    const connector: ILLMConnector = {
      bindRoutingTools: () => ({
        invoke: async () => ({ next: "finance" }),
      }),
      getModel: () => ({
        invoke: modelInvoke,
      } as unknown as BaseChatModel),
    };
    const supervisorNode = createAppSupervisorNode(connector, {
      runtimeAgentRepository: createRuntimeAgentRepositoryFake(),
    });

    const result = await supervisorNode({
      messages: [
        new HumanMessage("for yesterday only"),
        new AIMessage({
          content: "",
          additional_kwargs: {
            emptySubAgentHandoff: true,
            agentName: "Finance",
            toolContext: 'exec_sql: {"error":{"message":"relation \\"expenses\\" does not exist"}}',
          },
        }),
      ],
      context: {},
      next: undefined,
    });

    expect(result.next).toBe("FINISH");
    expect(firstStateUpdateMessage(result)?.content).toBe(
      "The query failed because the expenses table name was wrong.",
    );
    expect(modelInvoke).toHaveBeenCalledOnce();

    const mergedMessages = reduceAgentMessages(
      [
        new HumanMessage("for yesterday only"),
        new AIMessage({
          content: "",
          additional_kwargs: {
            emptySubAgentHandoff: true,
            agentName: "Finance",
            toolContext: 'exec_sql: {"error":{"message":"relation \\"expenses\\" does not exist"}}',
          },
        }),
      ],
      firstStateUpdateMessage(result)!,
    );
    const compactedHandoff = getEmptySubAgentHandoff(mergedMessages[1]);
    expect(compactedHandoff?.toolContext).toBe("[consumed: Finance tool results]");
    expect(compactedHandoff?.toolContext).not.toContain("expenses");
  });

  it("routes scheduler finance triggers without invoking the LLM", async () => {
    const invokeSpy = vi.fn(() => {
      throw new Error("LLM must not run for scheduler trigger");
    });
    const connector = new FakeLLMConnector(invokeSpy);
    const supervisorNode = createAppSupervisorNode(connector);

    const result = await supervisorNode(
      makeHumanState(buildCronTriggerForJob("finance", "finance-sync")),
    );

    expect(result.next).toBe("Runtime_SG");
    expect(getStateUpdateRuntimeAgentId(result)).toBe("finance");
    expect(result.messages).toBeUndefined();
    expect(invokeSpy).not.toHaveBeenCalled();
  });

  it("only treats the latest message as a scheduler trigger", async () => {
    const invokeSpy = vi.fn(() => ({ next: "FINISH", reply: "Handled by LLM" }));
    const connector = new FakeLLMConnector(invokeSpy);
    const supervisorNode = createAppSupervisorNode(connector);

    const result = await supervisorNode({
      messages: [
        new HumanMessage(buildCronTriggerForJob("finance", "finance-sync")),
        new HumanMessage("tell me what changed today"),
      ],
      context: {},
      next: undefined,
    });

    expect(result.next).toBe("FINISH");
    expect(firstStateUpdateMessage(result)?.content).toBe("Handled by LLM");
    expect(invokeSpy).toHaveBeenCalledTimes(1);
  });

  it("routes scheduler obsidian triggers without invoking the LLM", async () => {
    const invokeSpy = vi.fn(() => {
      throw new Error("LLM must not run for scheduler trigger");
    });
    const connector = new FakeLLMConnector(invokeSpy);
    const supervisorNode = createAppSupervisorNode(connector);

    const result = await supervisorNode(
      makeHumanState(buildCronTriggerForJob("obsidian", "obsidian-daily-note")),
    );

    expect(result.next).toBe("Runtime_SG");
    expect(getStateUpdateRuntimeAgentId(result)).toBe("obsidian");
    expect(result.messages).toBeUndefined();
    expect(invokeSpy).not.toHaveBeenCalled();
  });

  it("lets Supervise_SG scheduler triggers continue through normal LLM routing", async () => {
    const invokeSpy = vi.fn(() => ({
      next: "FINISH",
      reply: "Handled by the main supervisor",
    }));
    const connector = new FakeLLMConnector(invokeSpy);
    const supervisorNode = createAppSupervisorNode(connector);

    const result = await supervisorNode(
      makeHumanState("SYSTEM_CRON_TRIGGER:Supervise_SG:morning-review\n\nPayload:\nReview today's priorities."),
    );

    expect(result.next).toBe("FINISH");
    expect(firstStateUpdateMessage(result)?.content).toBe("Handled by the main supervisor");
    expect(invokeSpy).toHaveBeenCalledTimes(1);
  });

  it("routes scheduled triggers even when payload text is appended after the trigger line", async () => {
    const invokeSpy = vi.fn(() => {
      throw new Error("LLM must not run for scheduler trigger");
    });
    const connector = new FakeLLMConnector(invokeSpy);
    const supervisorNode = createAppSupervisorNode(connector);

    const result = await supervisorNode({
      messages: [
        new HumanMessage(buildCronTriggerForJob("finance", "finance-sync") + "\n\nPayload:\nSync the Wise transactions for yesterday."),
      ],
      context: {},
      next: undefined,
    });

    expect(result.next).toBe("Runtime_SG");
    expect(getStateUpdateRuntimeAgentId(result)).toBe("finance");
    expect(result.messages).toBeUndefined();
    expect(invokeSpy).not.toHaveBeenCalled();
  });

});
import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

import type { ILLMConnector } from "../../src/core/ports/llm-connector.js";
import { FakeLLMConnector } from "../helpers/fakes.js";
import {
  createTestSupervisorNode,
  asAgentState,
  createRuntimeAgentRepositoryFake,
  firstStateUpdateMessage,
  getStateUpdateMessages,
  getStateUpdateRuntimeAgentId,
  makeHumanState,
} from "../helpers/supervisor-node-fixtures.js";
import { buildCronTriggerForJob } from "../../src/index.js";
import type { RuntimeAgentHandoff } from "../../src/index.js";
import { EMPTY_REPLY_ROUTE, FAILURE_REPLY_ROUTE, POST_HANDOFF_FINISH_ROUTE } from "../../src/index.js";
import { trimMessagesToTokenBudgetSync } from "../../src/index.js";

const emptyHandoff = (
  agentName: string,
  agentId: string,
  toolContext = "",
): RuntimeAgentHandoff => ({
  kind: "runtime-agent-handoff",
  agentId,
  agentName,
  status: "empty",
  toolContext,
});

const completeHandoff = (
  agentName: string,
  agentId: string,
  status: RuntimeAgentHandoff["status"] = "ok",
): RuntimeAgentHandoff => ({
  kind: "runtime-agent-handoff",
  agentId,
  agentName,
  status,
});

describe("createSupervisorNode", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("appends a direct AI reply for the FINISH path", async () => {
    const connector = new FakeLLMConnector(() => ({
      next: "FINISH",
      reply: "Direct answer",
    }));
    const supervisorNode = createTestSupervisorNode(connector);

    const result = await supervisorNode(makeHumanState("hello"));

    expect(result.next).toBe("FINISH");
    expect(getStateUpdateMessages(result)).toHaveLength(1);
    expect(firstStateUpdateMessage(result)?.content).toBe("Direct answer");
  });

  it("routes to failure_reply when structured routing fails", async () => {
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
    const supervisorNode = createTestSupervisorNode(connector);

    const result = await supervisorNode(makeHumanState("hello"));

    expect(result.next).toBe(FAILURE_REPLY_ROUTE);
    expect(result.routingFailureContext).toContain("schema parse failed");
    expect(result.messages).toBeUndefined();
  });

  it("routes to failure_reply when FINISH omits a reply", async () => {
    const routingInvoke = vi.fn(async () => ({
      next: "FINISH",
    } as any));
    const modelInvoke = vi.fn(async () => new AIMessage("Final explanation for missing reply"));

    const connector: ILLMConnector = {
      bindRoutingTools: () => ({
        invoke: routingInvoke as never,
      }),
      getModel: () => ({
        invoke: modelInvoke,
      } as unknown as BaseChatModel),
    };
    const supervisorNode = createTestSupervisorNode(connector);

    const result = await supervisorNode(makeHumanState("hello"));

    expect(result.next).toBe(FAILURE_REPLY_ROUTE);
    expect(result.routingFailureContext).toContain("FINISH without a reply");
    expect(result.messages).toBeUndefined();
    expect(modelInvoke).not.toHaveBeenCalled();
  });

  it("routes specialized branches even when the model returns a placeholder reply string", async () => {
    const connector = new FakeLLMConnector(() => ({
      next: "obsidian",
      reply: "null",
    }));
    const supervisorNode = createTestSupervisorNode(connector, {
      runtimeAgentRepository: createRuntimeAgentRepositoryFake(),
    });

    const result = await supervisorNode(makeHumanState("create today routine note"));

    expect(result.next).toBe("obsidian");
    expect(getStateUpdateRuntimeAgentId(result)).toBe("obsidian");
    expect(result.messages).toBeUndefined();
  });

  it("routes to failure_reply when FINISH reply is the literal string null", async () => {
    const modelInvoke = vi.fn(async () => new AIMessage("Please rephrase your request."));
    const connector: ILLMConnector = {
      bindRoutingTools: () => ({
        invoke: (async () => ({
          next: "FINISH",
          reply: "null",
        })) as never,
      }),
      getModel: () => ({
        invoke: modelInvoke,
      } as unknown as BaseChatModel),
    };
    const supervisorNode = createTestSupervisorNode(connector);

    const result = await supervisorNode(makeHumanState("hello"));

    expect(result.next).toBe(FAILURE_REPLY_ROUTE);
    expect(result.routingFailureContext).toContain("FINISH without a reply");
    expect(result.messages).toBeUndefined();
    expect(modelInvoke).not.toHaveBeenCalled();
  });

  it("returns a route without appending a message for specialized branches", async () => {
    const connector = new FakeLLMConnector((input) => {
      expect(Array.isArray(input)).toBe(true);
      expect((input as HumanMessage[]).length).toBeGreaterThan(1);

      return { next: "finance" };
    });
    const supervisorNode = createTestSupervisorNode(connector, {
      runtimeAgentRepository: createRuntimeAgentRepositoryFake(),
    });

    const result = await supervisorNode(makeHumanState("log lunch expense"));

    expect(result.next).toBe("finance");
    expect(getStateUpdateRuntimeAgentId(result)).toBe("finance");
  });

  it("receives a token-bounded subset of state messages in the supervisor prompt", async () => {
    const connector = new FakeLLMConnector((input) => {
      expect(Array.isArray(input)).toBe(true);
      expect((input as HumanMessage[])).toHaveLength(2);
      expect((input as HumanMessage[])[0]?.content).toContain("You are the test supervisor for unit tests.");
      expect((input as HumanMessage[])[1]?.content).toContain("turn-12");
      expect((input as HumanMessage[])[1]?.content).toContain("turn-14");
      expect((input as HumanMessage[])[1]?.content).not.toContain("turn-01");

      return { next: "FINISH", reply: "Trimmed reply" };
    });
    const supervisorNode = createTestSupervisorNode(connector);
    const history = trimMessagesToTokenBudgetSync(
      Array.from({ length: 14 }, (_, index) =>
        new HumanMessage(`word `.repeat(20) + `turn-${String(index + 1).padStart(2, "0")}`),
      ),
      { maxTokens: 120 },
    );

    const result = await supervisorNode(asAgentState({
      messages: history,
      context: {},
      next: undefined,
    }));

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
    const supervisorNode = createTestSupervisorNode(connector, {
      runtimeAgentRepository: createRuntimeAgentRepositoryFake(),
    });

    const result = await supervisorNode(asAgentState({
      messages: [
        new HumanMessage("where is the note?"),
        new HumanMessage("give me a plan for yesterday"),
      ],
      context: {},
      next: undefined,
    }));

    expect(result.next).toBe("obsidian");
    expect(getStateUpdateRuntimeAgentId(result)).toBe("obsidian");
  });

  it("can route scheduling requests to the configuration branch", async () => {
    const connector = new FakeLLMConnector((input) => {
      expect(Array.isArray(input)).toBe(true);

      return { next: "configuration" };
    });
    const supervisorNode = createTestSupervisorNode(connector, {
      runtimeAgentRepository: createRuntimeAgentRepositoryFake(),
    });

    const result = await supervisorNode(makeHumanState("set up a cron message every weekday at 9am"));

    expect(result.next).toBe("configuration");
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
    const supervisorNode = createTestSupervisorNode(connector);

    const result = await supervisorNode(asAgentState({
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
    }));

    expect(result.next).toBe("FINISH");
    expect(firstStateUpdateMessage(result)?.content).toBe("Sanitized");
  });

  it("routes to empty_reply instead of re-delegating when a runtime agent returns an empty reply", async () => {
    const routingInvoke = vi.fn(async () => ({
      next: "obsidian",
    }));
    const connector: ILLMConnector = {
      bindRoutingTools: () => ({
        invoke: routingInvoke as never,
      }),
      getModel: () => ({
        invoke: async () => new AIMessage("unused"),
      } as unknown as BaseChatModel),
    };
    const supervisorNode = createTestSupervisorNode(connector, {
      runtimeAgentRepository: createRuntimeAgentRepositoryFake(),
    });

    const result = await supervisorNode(asAgentState({
      messages: [new HumanMessage("today's plan")],
      lastHandoff: emptyHandoff("Obsidian", "obsidian"),
      context: {},
      next: undefined,
    }));

    expect(result.next).toBe(EMPTY_REPLY_ROUTE);
    expect(result.messages).toBeUndefined();
    expect(routingInvoke).not.toHaveBeenCalled();
  });

  it("routes scheduler finance triggers without invoking the LLM", async () => {
    const invokeSpy = vi.fn(() => {
      throw new Error("LLM must not run for scheduler trigger");
    });
    const connector = new FakeLLMConnector(invokeSpy);
    const supervisorNode = createTestSupervisorNode(connector);

    const result = await supervisorNode(
      makeHumanState(buildCronTriggerForJob("finance", "finance-sync")),
    );

    expect(result.next).toBe("finance");
    expect(getStateUpdateRuntimeAgentId(result)).toBe("finance");
    expect(result.messages).toBeUndefined();
    expect(invokeSpy).not.toHaveBeenCalled();
  });

  it("only treats the latest message as a scheduler trigger", async () => {
    const invokeSpy = vi.fn(() => ({ next: "FINISH", reply: "Handled by LLM" }));
    const connector = new FakeLLMConnector(invokeSpy);
    const supervisorNode = createTestSupervisorNode(connector);

    const result = await supervisorNode(asAgentState({
      messages: [
        new HumanMessage(buildCronTriggerForJob("finance", "finance-sync")),
        new HumanMessage("tell me what changed today"),
      ],
      context: {},
      next: undefined,
    }));

    expect(result.next).toBe("FINISH");
    expect(firstStateUpdateMessage(result)?.content).toBe("Handled by LLM");
    expect(invokeSpy).toHaveBeenCalledTimes(1);
  });

  it("routes scheduler obsidian triggers without invoking the LLM", async () => {
    const invokeSpy = vi.fn(() => {
      throw new Error("LLM must not run for scheduler trigger");
    });
    const connector = new FakeLLMConnector(invokeSpy);
    const supervisorNode = createTestSupervisorNode(connector);

    const result = await supervisorNode(
      makeHumanState(buildCronTriggerForJob("obsidian", "obsidian-daily-note")),
    );

    expect(result.next).toBe("obsidian");
    expect(getStateUpdateRuntimeAgentId(result)).toBe("obsidian");
    expect(result.messages).toBeUndefined();
    expect(invokeSpy).not.toHaveBeenCalled();
  });

  it("lets supervisor scheduler triggers continue through normal LLM routing", async () => {
    const invokeSpy = vi.fn(() => ({
      next: "FINISH",
      reply: "Handled by the main supervisor",
    }));
    const connector = new FakeLLMConnector(invokeSpy);
    const supervisorNode = createTestSupervisorNode(connector);

    const result = await supervisorNode(
      makeHumanState("SYSTEM_CRON_TRIGGER:supervisor:morning-review\n\nPayload:\nReview today's priorities."),
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
    const supervisorNode = createTestSupervisorNode(connector);

    const result = await supervisorNode(asAgentState({
      messages: [
        new HumanMessage(buildCronTriggerForJob("finance", "finance-sync") + "\n\nPayload:\nSync the Wise transactions for yesterday."),
      ],
      context: {},
      next: undefined,
    }));

    expect(result.next).toBe("finance");
    expect(getStateUpdateRuntimeAgentId(result)).toBe("finance");
    expect(result.messages).toBeUndefined();
    expect(invokeSpy).not.toHaveBeenCalled();
  });

  it("starts the first queued agent and stores the remaining queue", async () => {
    const connector = new FakeLLMConnector(() => ({
      next: "finance",
      queue: [
        { agentId: "finance" },
        { agentId: "obsidian" },
      ],
    }));
    const supervisorNode = createTestSupervisorNode(connector, {
      runtimeAgentRepository: createRuntimeAgentRepositoryFake(),
    });

    const result = await supervisorNode(makeHumanState("sync expenses then write a note"));

    expect(result.next).toBe("finance");
    expect(result.executionQueue).toEqual([
      { agentId: "obsidian" },
    ]);
    expect(getStateUpdateRuntimeAgentId(result)).toBe("finance");
  });

  it("dequeues the next agent after a complete handoff without invoking the LLM", async () => {
    const routingInvoke = vi.fn(async () => ({
      next: "obsidian",
    }));
    const connector: ILLMConnector = {
      bindRoutingTools: () => ({
        invoke: routingInvoke as never,
      }),
      getModel: () => ({
        invoke: async () => new AIMessage("unused"),
      } as unknown as BaseChatModel),
    };
    const supervisorNode = createTestSupervisorNode(connector, {
      runtimeAgentRepository: createRuntimeAgentRepositoryFake(),
    });

    const result = await supervisorNode(asAgentState({
      messages: [new HumanMessage("sync expenses then write a note")],
      lastHandoff: completeHandoff("Finance", "finance"),
      executionQueue: [{ agentId: "obsidian" }],
      context: {},
      next: undefined,
    }));

    expect(result.next).toBe("obsidian");
    expect(result.executionQueue).toEqual([]);
    expect(getStateUpdateRuntimeAgentId(result)).toBe("obsidian");
    expect(result.lastHandoff).toBeNull();
    expect(routingInvoke).not.toHaveBeenCalled();
  });

  it("routes to post_handoff_finish after a specialist returns in the same turn", async () => {
    const routingInvoke = vi.fn(async () => ({
      next: "FINISH",
      reply: "I have listed the available agents and their descriptions.",
    }));
    const connector: ILLMConnector = {
      bindRoutingTools: () => ({
        invoke: routingInvoke as never,
      }),
      getModel: () => ({
        invoke: async () => new AIMessage("unused"),
      } as unknown as BaseChatModel),
    };
    const supervisorNode = createTestSupervisorNode(connector, {
      runtimeAgentRepository: createRuntimeAgentRepositoryFake(),
    });

    const result = await supervisorNode(asAgentState({
      messages: [
        new HumanMessage("list agents"),
        new AIMessage("Agent ID: finance\nName: Finance"),
      ],
      lastHandoff: completeHandoff("Configuration", "configuration"),
      executionQueue: [],
      context: {},
      next: undefined,
    }));

    expect(result.next).toBe(POST_HANDOFF_FINISH_ROUTE);
    expect(result.lastHandoff).toEqual(completeHandoff("Configuration", "configuration"));
    expect(result.messages).toBeUndefined();
    expect(routingInvoke).not.toHaveBeenCalled();
  });

  it("re-invokes the LLM after a complete handoff when the queue is empty", async () => {
    const routingInvoke = vi.fn(async () => ({
      next: "FINISH",
      reply: "All done.",
    }));
    const connector: ILLMConnector = {
      bindRoutingTools: () => ({
        invoke: routingInvoke as never,
      }),
      getModel: () => ({
        invoke: async () => new AIMessage("unused"),
      } as unknown as BaseChatModel),
    };
    const supervisorNode = createTestSupervisorNode(connector, {
      runtimeAgentRepository: createRuntimeAgentRepositoryFake(),
    });

    const result = await supervisorNode(asAgentState({
      messages: [
        new HumanMessage("sync expenses then write a note"),
        new AIMessage("Synced 5 transactions."),
      ],
      lastHandoff: completeHandoff("Finance", "finance"),
      executionQueue: [],
      context: {},
      next: undefined,
    }));

    expect(result.next).toBe("FINISH");
    expect(firstStateUpdateMessage(result)?.content).toBe("All done.");
    expect(routingInvoke).toHaveBeenCalledTimes(1);
  });

  it("re-invokes the LLM after configuration when the user sends a new message", async () => {
    const routingInvoke = vi.fn(async () => ({
      next: "FINISH",
      reply: "All done.",
    }));
    const connector: ILLMConnector = {
      bindRoutingTools: () => ({
        invoke: routingInvoke as never,
      }),
      getModel: () => ({
        invoke: async () => new AIMessage("unused"),
      } as unknown as BaseChatModel),
    };
    const supervisorNode = createTestSupervisorNode(connector, {
      runtimeAgentRepository: createRuntimeAgentRepositoryFake(),
    });

    const result = await supervisorNode(asAgentState({
      messages: [
        new HumanMessage("sync expenses then write a note"),
        new AIMessage("Synced 5 transactions."),
        new HumanMessage("thanks"),
      ],
      lastHandoff: completeHandoff("Finance", "finance"),
      executionQueue: [],
      context: {},
      next: undefined,
    }));

    expect(result.next).toBe("FINISH");
    expect(firstStateUpdateMessage(result)?.content).toBe("All done.");
    expect(routingInvoke).toHaveBeenCalledTimes(1);
  });

  it("clears the execution queue when routing to empty_reply", async () => {
    const routingInvoke = vi.fn(async () => ({
      next: "obsidian",
    }));
    const connector: ILLMConnector = {
      bindRoutingTools: () => ({
        invoke: routingInvoke as never,
      }),
      getModel: () => ({
        invoke: async () => new AIMessage("unused"),
      } as unknown as BaseChatModel),
    };
    const supervisorNode = createTestSupervisorNode(connector, {
      runtimeAgentRepository: createRuntimeAgentRepositoryFake(),
    });

    const result = await supervisorNode(asAgentState({
      messages: [new HumanMessage("today's plan")],
      lastHandoff: emptyHandoff("Obsidian", "obsidian"),
      executionQueue: [{ agentId: "finance" }],
      context: {},
      next: undefined,
    }));

    expect(result.next).toBe(EMPTY_REPLY_ROUTE);
    expect(result.executionQueue).toEqual([]);
    expect(routingInvoke).not.toHaveBeenCalled();
  });

  it("allows same-agent routing when the user accepts an offered action", async () => {
    const routingInvoke = vi.fn(async () => ({
      next: "finance",
    }));
    const connector: ILLMConnector = {
      bindRoutingTools: () => ({
        invoke: routingInvoke as never,
      }),
      getModel: () => ({
        invoke: async () => new AIMessage("Handled"),
      } as unknown as BaseChatModel),
    };
    const supervisorNode = createTestSupervisorNode(connector, {
      runtimeAgentRepository: createRuntimeAgentRepositoryFake(),
    });

    const result = await supervisorNode(asAgentState({
      messages: [
        new HumanMessage("show yesterday's expenses"),
        new AIMessage("No matching expenses were found for yesterday. Would you like to sync your expenses?"),
        new HumanMessage("yes"),
      ],
      lastHandoff: completeHandoff("Finance", "finance"),
      executionQueue: [],
      context: {},
      next: undefined,
    }));

    expect(result.next).toBe("finance");
    expect(result.lastHandoff).toBeNull();
    expect(result.routingFailureContext).toBeNull();
    expect(routingInvoke).toHaveBeenCalledTimes(1);
  });

  it("blocks an immediate non-affirmative repeat route to the same agent after handoff", async () => {
    const routingInvoke = vi.fn(async () => ({
      next: "finance",
    }));
    const connector: ILLMConnector = {
      bindRoutingTools: () => ({
        invoke: routingInvoke as never,
      }),
      getModel: () => ({
        invoke: async () => new AIMessage("Handled"),
      } as unknown as BaseChatModel),
    };
    const supervisorNode = createTestSupervisorNode(connector, {
      runtimeAgentRepository: createRuntimeAgentRepositoryFake(),
    });

    const result = await supervisorNode(asAgentState({
      messages: [
        new HumanMessage("show yesterday's expenses"),
        new AIMessage("No matching expenses were found for yesterday."),
      ],
      lastHandoff: completeHandoff("Finance", "finance"),
      executionQueue: [],
      context: {},
      next: undefined,
    }));

    expect(result.next).toBe(POST_HANDOFF_FINISH_ROUTE);
    expect(result.lastHandoff).toEqual(completeHandoff("Finance", "finance"));
    expect(result.routingFailureContext).toBeNull();
    expect(routingInvoke).toHaveBeenCalledTimes(1);
  });

  it("skips a blocked repeat head and starts the remaining queue tail", async () => {
    const routingInvoke = vi.fn(async () => ({
      next: "finance",
      queue: [
        { agentId: "finance" },
        { agentId: "obsidian" },
      ],
    }));
    const connector: ILLMConnector = {
      bindRoutingTools: () => ({
        invoke: routingInvoke as never,
      }),
      getModel: () => ({
        invoke: async () => new AIMessage("unused"),
      } as unknown as BaseChatModel),
    };
    const supervisorNode = createTestSupervisorNode(connector, {
      runtimeAgentRepository: createRuntimeAgentRepositoryFake(),
    });

    const result = await supervisorNode(asAgentState({
      messages: [new HumanMessage("sync expenses and write a note")],
      lastHandoff: completeHandoff("Finance", "finance"),
      executionQueue: [],
      context: {},
      next: undefined,
    }));

    expect(result.next).toBe("obsidian");
    expect(result.executionQueue).toEqual([]);
    expect(result.lastHandoff).toBeNull();
    expect(result.routingFailureContext).toBeNull();
    expect(routingInvoke).toHaveBeenCalledTimes(1);
  });

  it("allows repeat routing when the user explicitly asks to retry", async () => {
    const routingInvoke = vi.fn(async () => ({
      next: "finance",
    }));
    const connector: ILLMConnector = {
      bindRoutingTools: () => ({
        invoke: routingInvoke as never,
      }),
      getModel: () => ({
        invoke: async () => new AIMessage("unused"),
      } as unknown as BaseChatModel),
    };
    const supervisorNode = createTestSupervisorNode(connector, {
      runtimeAgentRepository: createRuntimeAgentRepositoryFake(),
    });

    const result = await supervisorNode(asAgentState({
      messages: [new HumanMessage("retry finance sync")],
      lastHandoff: completeHandoff("Finance", "finance"),
      executionQueue: [],
      context: {},
      next: undefined,
    }));

    expect(result.next).toBe("finance");
    expect(result.routingFailureContext).toBeNull();
    expect(routingInvoke).toHaveBeenCalledTimes(1);
  });

  it("re-invokes the LLM after configuration returns an error with retries remaining", async () => {
    const routingInvoke = vi.fn(async () => ({
      next: "configuration",
    }));
    const connector: ILLMConnector = {
      bindRoutingTools: () => ({
        invoke: routingInvoke as never,
      }),
      getModel: () => ({
        invoke: async () => new AIMessage("unused"),
      } as unknown as BaseChatModel),
    };
    const supervisorNode = createTestSupervisorNode(connector, {
      runtimeAgentRepository: createRuntimeAgentRepositoryFake(),
    });

    const result = await supervisorNode(asAgentState({
      messages: [
        new HumanMessage("create trainer"),
        new AIMessage("Invalid capability fitness-domain."),
      ],
      lastHandoff: completeHandoff("Configuration", "configuration", "error"),
      executionQueue: [],
      retryCount: 0,
      context: {},
      next: undefined,
    }));

    expect(result.next).toBe("configuration");
    expect(result.retryCount).toBe(1);
    expect(routingInvoke).toHaveBeenCalledTimes(1);
  });

  it("routes to post_handoff_finish after configuration error retries are exhausted", async () => {
    const routingInvoke = vi.fn(async () => ({
      next: "configuration",
    }));
    const connector: ILLMConnector = {
      bindRoutingTools: () => ({
        invoke: routingInvoke as never,
      }),
      getModel: () => ({
        invoke: async () => new AIMessage("unused"),
      } as unknown as BaseChatModel),
    };
    const supervisorNode = createTestSupervisorNode(connector, {
      runtimeAgentRepository: createRuntimeAgentRepositoryFake(),
    });

    const result = await supervisorNode(asAgentState({
      messages: [
        new HumanMessage("create trainer"),
        new AIMessage("Invalid capability fitness-domain."),
      ],
      lastHandoff: completeHandoff("Configuration", "configuration", "error"),
      executionQueue: [],
      retryCount: 2,
      context: {},
      next: undefined,
    }));

    expect(result.next).toBe(POST_HANDOFF_FINISH_ROUTE);
    expect(result.lastHandoff).toEqual(completeHandoff("Configuration", "configuration", "error"));
    expect(routingInvoke).not.toHaveBeenCalled();
  });

});
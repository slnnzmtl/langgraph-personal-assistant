import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

import type { ILLMConnector } from "../../src/connectors/llm-connector.js";
import { createAppSupervisorNode, FakeLLMConnector, asAgentState, createRuntimeAgentRepositoryFake, firstStateUpdateMessage, getMessageText, getStateUpdateMessages, getStateUpdateRuntimeAgentId, makeHumanState } from "../helpers/fakes.js";
import { buildCronTriggerForJob } from "../../src/cron/cron-triggers.js";
import { loadSupervisorSystemPrompt } from "../../src/prompts/load-system-prompt.js";
import type { RuntimeAgentHandoff } from "@personal-assistant/supervisor-framework";
import { EMPTY_REPLY_ROUTE, FAILURE_REPLY_ROUTE, POST_HANDOFF_FINISH_ROUTE } from "@personal-assistant/supervisor-framework";
import { trimMessagesToTokenBudgetSync } from "@personal-assistant/supervisor-framework";

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
): RuntimeAgentHandoff => ({
  kind: "runtime-agent-handoff",
  agentId,
  agentName,
  status: "ok",
});

describe("createSupervisorNode", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("loads the supervisor system prompt from the markdown file", () => {
    const prompt = loadSupervisorSystemPrompt();

    expect(prompt).toContain("You are the Root Supervisor for a private personal assistant.");
  });

  it("tells the supervisor not to transcribe screenshot images in delegation prompts", () => {
    const prompt = loadSupervisorSystemPrompt();

    expect(prompt).toContain("<delegation_rules>");
    expect(prompt).toContain("DO NOT summarize, describe, or transcribe attached images yourself");
    expect(prompt).toContain("pass the raw image context directly to the specialist");
  });

  it("includes the current datetime in the shared system prompt", async () => {
    const currentInstant = new Date("2026-07-05T12:34:56.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(currentInstant);

    const connector = new FakeLLMConnector((input) => {
      expect(Array.isArray(input)).toBe(true);
      const promptMessages = input as HumanMessage[];

      const firstPrompt = getMessageText(promptMessages[0]);
      expect(firstPrompt).toContain("You are the Root Supervisor for a private personal assistant.");
      expect(firstPrompt).toContain("CURRENT DATETIME: 2026-07-05T12:34:56 UTC");
      expect(firstPrompt.indexOf("You are the Root Supervisor")).toBeLessThan(
        firstPrompt.indexOf("<system_metadata>") ?? -1,
      );
      expect(getMessageText(promptMessages[1])).toBe("hello");

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
    const supervisorNode = createAppSupervisorNode(connector);

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
    const supervisorNode = createAppSupervisorNode(connector);

    const result = await supervisorNode(makeHumanState("hello"));

    expect(result.next).toBe(FAILURE_REPLY_ROUTE);
    expect(result.routingFailureContext).toContain("FINISH without a reply");
    expect(result.messages).toBeUndefined();
    expect(modelInvoke).not.toHaveBeenCalled();
  });

  it("routes specialized branches even when the model returns a placeholder reply string", async () => {
    const connector = new FakeLLMConnector(() => ({
      next: "obsidian",
      prompt: "Create today's routine note.",
      reply: "null",
    }));
    const supervisorNode = createAppSupervisorNode(connector, {
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
    const supervisorNode = createAppSupervisorNode(connector);

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

      return { next: "finance", prompt: "Log the lunch expense." };
    });
    const supervisorNode = createAppSupervisorNode(connector, {
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
      expect((input as HumanMessage[])[0]?.content).toContain("You are the Root Supervisor for a private personal assistant.");
      expect((input as HumanMessage[])[1]?.content).toContain("turn-12");
      expect((input as HumanMessage[])[1]?.content).toContain("turn-14");
      expect((input as HumanMessage[])[1]?.content).not.toContain("turn-01");

      return { next: "FINISH", reply: "Trimmed reply" };
    });
    const supervisorNode = createAppSupervisorNode(connector);
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

      return { next: "obsidian", prompt: "Give me a plan for yesterday." };
    });
    const supervisorNode = createAppSupervisorNode(connector, {
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

      return { next: "configuration", prompt: "Set up a cron message every weekday at 9am." };
    });
    const supervisorNode = createAppSupervisorNode(connector, {
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
    const supervisorNode = createAppSupervisorNode(connector);

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
    const supervisorNode = createAppSupervisorNode(connector, {
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
    const supervisorNode = createAppSupervisorNode(connector);

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
    const supervisorNode = createAppSupervisorNode(connector);

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
    const supervisorNode = createAppSupervisorNode(connector);

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
    const supervisorNode = createAppSupervisorNode(connector);

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
    const supervisorNode = createAppSupervisorNode(connector);

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
      prompt: "Sync expenses then write a note.",
      queue: [
        { agentId: "finance", prompt: "Sync yesterday's expenses." },
        { agentId: "obsidian", prompt: "Write a summary note." },
      ],
    }));
    const supervisorNode = createAppSupervisorNode(connector, {
      runtimeAgentRepository: createRuntimeAgentRepositoryFake(),
    });

    const result = await supervisorNode(makeHumanState("sync expenses then write a note"));

    expect(result.next).toBe("finance");
    expect(result.delegationPrompt).toBe("Sync yesterday's expenses.");
    expect(result.executionQueue).toEqual([
      { agentId: "obsidian", prompt: "Write a summary note." },
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
    const supervisorNode = createAppSupervisorNode(connector, {
      runtimeAgentRepository: createRuntimeAgentRepositoryFake(),
    });

    const result = await supervisorNode(asAgentState({
      messages: [new HumanMessage("sync expenses then write a note")],
      lastHandoff: completeHandoff("Finance", "finance"),
      executionQueue: [{ agentId: "obsidian", prompt: "Write a summary note." }],
      context: {},
      next: undefined,
    }));

    expect(result.next).toBe("obsidian");
    expect(result.delegationPrompt).toBe("Write a summary note.");
    expect(result.executionQueue).toEqual([]);
    expect(getStateUpdateRuntimeAgentId(result)).toBe("obsidian");
    expect(result.lastHandoff).toBeNull();
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
    const supervisorNode = createAppSupervisorNode(connector, {
      runtimeAgentRepository: createRuntimeAgentRepositoryFake(),
    });

    const result = await supervisorNode(asAgentState({
      messages: [new HumanMessage("sync expenses then write a note")],
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
    const supervisorNode = createAppSupervisorNode(connector, {
      runtimeAgentRepository: createRuntimeAgentRepositoryFake(),
    });

    const result = await supervisorNode(asAgentState({
      messages: [new HumanMessage("today's plan")],
      lastHandoff: emptyHandoff("Obsidian", "obsidian"),
      executionQueue: [{ agentId: "finance", prompt: "Sync expenses." }],
      context: {},
      next: undefined,
    }));

    expect(result.next).toBe(EMPTY_REPLY_ROUTE);
    expect(result.executionQueue).toEqual([]);
    expect(routingInvoke).not.toHaveBeenCalled();
  });

  it("injects post-handoff replan context when re-planning after a complete handoff", async () => {
    const routingInvoke = vi.fn(async (input) => {
      const systemContent = typeof input[0]?.content === "string" ? input[0].content : "";

      expect(systemContent).toContain("<post_handoff_replan_context>");
      expect(systemContent).toContain('runtime agent "finance" just completed');
      expect(systemContent).toContain("Latest user message: yes");

      return { next: "FINISH", reply: "Synced 5 transactions." };
    });
    const connector: ILLMConnector = {
      bindRoutingTools: () => ({
        invoke: routingInvoke as never,
      }),
      getModel: () => ({
        invoke: async () => new AIMessage("unused"),
      } as unknown as BaseChatModel),
    };
    const supervisorNode = createAppSupervisorNode(connector, {
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

    expect(result.next).toBe("FINISH");
    expect(firstStateUpdateMessage(result)?.content).toBe("Synced 5 transactions.");
    expect(routingInvoke).toHaveBeenCalledTimes(1);
  });

  it("blocks an immediate repeat route to the same agent after handoff", async () => {
    const routingInvoke = vi.fn(async () => ({
      next: "finance",
      prompt: "Sync expenses.",
    }));
    const connector: ILLMConnector = {
      bindRoutingTools: () => ({
        invoke: routingInvoke as never,
      }),
      getModel: () => ({
        invoke: async () => new AIMessage("Handled"),
      } as unknown as BaseChatModel),
    };
    const supervisorNode = createAppSupervisorNode(connector, {
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

    expect(result.next).toBe(POST_HANDOFF_FINISH_ROUTE);
    expect(result.lastHandoff).toEqual(completeHandoff("Finance", "finance"));
    expect(result.routingFailureContext).toBeNull();
    expect(routingInvoke).toHaveBeenCalledTimes(1);
  });

  it("skips a blocked repeat head and starts the remaining queue tail", async () => {
    const routingInvoke = vi.fn(async () => ({
      next: "finance",
      queue: [
        { agentId: "finance", prompt: "Sync expenses." },
        { agentId: "obsidian", prompt: "Write a summary note." },
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
    const supervisorNode = createAppSupervisorNode(connector, {
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
    expect(result.delegationPrompt).toBe("Write a summary note.");
    expect(result.executionQueue).toEqual([]);
    expect(result.lastHandoff).toBeNull();
    expect(result.routingFailureContext).toBeNull();
    expect(routingInvoke).toHaveBeenCalledTimes(1);
  });

  it("allows repeat routing when the user explicitly asks to retry", async () => {
    const routingInvoke = vi.fn(async () => ({
      next: "finance",
      prompt: "Retry the sync.",
    }));
    const connector: ILLMConnector = {
      bindRoutingTools: () => ({
        invoke: routingInvoke as never,
      }),
      getModel: () => ({
        invoke: async () => new AIMessage("unused"),
      } as unknown as BaseChatModel),
    };
    const supervisorNode = createAppSupervisorNode(connector, {
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
    expect(result.delegationPrompt).toBe("Retry the sync.");
    expect(result.routingFailureContext).toBeNull();
    expect(routingInvoke).toHaveBeenCalledTimes(1);
  });

});
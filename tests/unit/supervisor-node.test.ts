import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createSupervisorNode } from "../../src/nodes/supervisor-node.js";
import { loadSupervisorSystemPrompt } from "../../src/prompts/load-system-prompt.js";
import { MESSAGE_HISTORY_LIMIT, trimMessagesToLast } from "../../src/state.js";
import { FakeLLMConnector, makeHumanState } from "../helpers/fakes.js";

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
      expect(promptMessages[0]?.content).toContain("Current datetime: 2026-07-05T12:34:56 UTC");
      expect(promptMessages[1]?.content).toBe("hello");

      return {
        next: "FINISH",
        reply: "Datetime checked",
      };
    });
    const supervisorNode = createSupervisorNode(connector);

    const result = await supervisorNode(makeHumanState("hello"));

    expect(result.next).toBe("FINISH");
    expect(result.messages?.[0]?.content).toBe("Datetime checked");
  });

  it("appends a direct AI reply for the FINISH path", async () => {
    const connector = new FakeLLMConnector(() => ({
      next: "FINISH",
      reply: "Direct answer",
    }));
    const supervisorNode = createSupervisorNode(connector);

    const result = await supervisorNode(makeHumanState("hello"));

    expect(result.next).toBe("FINISH");
    expect(result.messages).toHaveLength(1);
    expect(result.messages?.[0]?.content).toBe("Direct answer");
  });

  it("returns a route without appending a message for specialized branches", async () => {
    const connector = new FakeLLMConnector((input) => {
      expect(Array.isArray(input)).toBe(true);
      expect((input as HumanMessage[]).length).toBeGreaterThan(1);

      return { next: "Finance_SG" };
    });
    const supervisorNode = createSupervisorNode(connector);

    const result = await supervisorNode(makeHumanState("log lunch expense"));

    expect(result.next).toBe("Finance_SG");
    expect(result.context).toBeUndefined();
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
    const supervisorNode = createSupervisorNode(connector);
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
    expect(result.messages?.[0]?.content).toBe("Trimmed reply");
  });

  it("passes the raw latest user request through the sanitized history", async () => {
    const connector = new FakeLLMConnector((input) => {
      expect(Array.isArray(input)).toBe(true);
      const promptMessages = input as HumanMessage[];
      const latestMessage = promptMessages.at(-1);

      expect(typeof latestMessage?.content === "string" ? latestMessage.content : "").toBe(
        "where is the note?\ngive me a plan for yesterday",
      );

      return { next: "Obsidian_SG" };
    });
    const supervisorNode = createSupervisorNode(connector);

    const result = await supervisorNode({
      messages: [
        new HumanMessage("where is the note?"),
        new HumanMessage("give me a plan for yesterday"),
      ],
      context: {},
      next: undefined,
    });

    expect(result.next).toBe("Obsidian_SG");
    expect(result.context).toBeUndefined();
  });

  it("can route scheduling requests to the configuration branch", async () => {
    const connector = new FakeLLMConnector((input) => {
      expect(Array.isArray(input)).toBe(true);

      return { next: "Config_SG" };
    });
    const supervisorNode = createSupervisorNode(connector);

    const result = await supervisorNode(makeHumanState("set up a cron message every weekday at 9am"));

    expect(result.next).toBe("Config_SG");
    expect(result.context).toBeUndefined();
  });

  it("sanitizes prior tool messages before routing", async () => {
    const connector = new FakeLLMConnector((input) => {
      expect(Array.isArray(input)).toBe(true);
      const promptMessages = input as Array<HumanMessage | AIMessage>;

      expect(promptMessages.some((message) => message instanceof ToolMessage)).toBe(false);
      expect(promptMessages.some((message) => message instanceof AIMessage && Array.isArray(message.tool_calls) && message.tool_calls.length > 0)).toBe(false);

      return { next: "FINISH", reply: "Sanitized" };
    });
    const supervisorNode = createSupervisorNode(connector);

    const result = await supervisorNode({
      messages: [
        new HumanMessage("add go to shop"),
        new AIMessage({
          content: "",
          tool_calls: [
            {
              name: "write_markdown_file",
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
    expect(result.messages?.[0]?.content).toBe("Sanitized");
  });

  it("routes reserved scheduler finance triggers without invoking the LLM", async () => {
    const invokeSpy = vi.fn(() => {
      throw new Error("LLM must not run for scheduler trigger");
    });
    const connector = new FakeLLMConnector(invokeSpy);
    const supervisorNode = createSupervisorNode(connector);

    const result = await supervisorNode(makeHumanState("SYSTEM_CRON_TRIGGER:finance-sync"));

    expect(result.next).toBe("Finance_SG");
    expect(result.messages).toBeUndefined();
    expect(invokeSpy).not.toHaveBeenCalled();
  });

  it("routes route-derived scheduler finance triggers without invoking the LLM", async () => {
    const invokeSpy = vi.fn(() => {
      throw new Error("LLM must not run for scheduler trigger");
    });
    const connector = new FakeLLMConnector(invokeSpy);
    const supervisorNode = createSupervisorNode(connector);

    const result = await supervisorNode(makeHumanState("SYSTEM_CRON_TRIGGER:Finance_SG:finance-sync"));

    expect(result.next).toBe("Finance_SG");
    expect(result.messages).toBeUndefined();
    expect(invokeSpy).not.toHaveBeenCalled();
  });

  it("only treats the latest message as a scheduler trigger", async () => {
    const invokeSpy = vi.fn(() => ({ next: "FINISH", reply: "Handled by LLM" }));
    const connector = new FakeLLMConnector(invokeSpy);
    const supervisorNode = createSupervisorNode(connector);

    const result = await supervisorNode({
      messages: [
        new HumanMessage("SYSTEM_CRON_TRIGGER:finance-sync"),
        new HumanMessage("tell me what changed today"),
      ],
      context: {},
      next: undefined,
    });

    expect(result.next).toBe("FINISH");
    expect(result.messages?.[0]?.content).toBe("Handled by LLM");
    expect(invokeSpy).toHaveBeenCalledTimes(1);
  });

  it("routes reserved scheduler obsidian triggers without invoking the LLM", async () => {
    const invokeSpy = vi.fn(() => {
      throw new Error("LLM must not run for scheduler trigger");
    });
    const connector = new FakeLLMConnector(invokeSpy);
    const supervisorNode = createSupervisorNode(connector);

    const result = await supervisorNode(makeHumanState("SYSTEM_CRON_TRIGGER:obsidian-daily-note"));

    expect(result.next).toBe("Obsidian_SG");
    expect(result.messages).toBeUndefined();
    expect(invokeSpy).not.toHaveBeenCalled();
  });

  it("routes scheduled triggers even when payload text is appended after the trigger line", async () => {
    const invokeSpy = vi.fn(() => {
      throw new Error("LLM must not run for scheduler trigger");
    });
    const connector = new FakeLLMConnector(invokeSpy);
    const supervisorNode = createSupervisorNode(connector);

    const result = await supervisorNode({
      messages: [
        new HumanMessage("SYSTEM_CRON_TRIGGER:Finance_SG:finance-sync\n\nPayload:\nSync the Wise transactions for yesterday."),
      ],
      context: {},
      next: undefined,
    });

    expect(result.next).toBe("Finance_SG");
    expect(result.messages).toBeUndefined();
    expect(invokeSpy).not.toHaveBeenCalled();
  });
});
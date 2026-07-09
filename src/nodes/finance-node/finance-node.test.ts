import { readFile, rm } from "node:fs/promises";
import path from "node:path";

import { AIMessage } from "@langchain/core/messages";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createFinanceNode } from "./agent.js";
import { loadFinanceSystemPrompt } from "../../prompts/load-system-prompt.js";
import { FakeLLMConnector, makeHumanState } from "../../../tests/helpers/fakes.js";

describe("createFinanceNode", () => {
  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    await rm(path.join(process.cwd(), "logs", "finance-system-prompt.txt"), { force: true });
  });

  it("loads the finance system prompt from markdown", () => {
    const prompt = loadFinanceSystemPrompt();

    expect(prompt).toContain("You are an intelligent Financial Data Assistant and Sync Agent.");
    expect(prompt).toContain("Current datetime:");
  });

  it("logs the finance system prompt before invoking the model", async () => {
    vi.stubEnv("ENABLE_PROMPT_LOGS", "true");

    const connector = new FakeLLMConnector((input) => {
      expect(Array.isArray(input)).toBe(true);
      return new AIMessage("Finance response");
    });

    const financeNode = createFinanceNode(connector.getModel(), []);

    const result = await financeNode(makeHumanState("sync yesterday transactions"));

    const logFilePath = path.join(process.cwd(), "logs", "finance-system-prompt.txt");
    const loggedContent = await readFile(logFilePath, "utf8");

    expect(loggedContent).toContain("=== ");
    expect(loggedContent).toContain("type=system");
    expect(loggedContent).toContain("You are an intelligent Financial Data Assistant and Sync Agent.");
    expect(result.messages?.[0]?.content).toBe("Finance response");
  });
});

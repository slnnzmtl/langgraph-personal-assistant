import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import type { BaseMessage } from "@langchain/core/messages";
import { HumanMessage } from "@langchain/core/messages";
import { extractMessageTextContent } from "@personal-assistant/supervisor-framework";

import type { MinimalSupervisorSystem } from "../supervisor.js";

const EXIT_COMMANDS = new Set(["exit", "quit", "q"]);

const isExitCommand = (text: string): boolean => EXIT_COMMANDS.has(text.toLowerCase());

const formatMessageContent = (content: BaseMessage["content"] | undefined): string => {
  if (content === undefined) {
    return "";
  }

  return extractMessageTextContent(content).trim();
};

export const runOneShot = async (
  graph: MinimalSupervisorSystem["graph"],
  question: string,
  threadId = "local",
): Promise<void> => {
  const result = await graph.invoke(
    { messages: [new HumanMessage(question)] },
    { configurable: { thread_id: threadId } },
  );

  const content = formatMessageContent(result.messages.at(-1)?.content);
  console.log(content || "No response.");
};

export const runTerminalChat = async (
  graph: MinimalSupervisorSystem["graph"],
  threadId = "terminal",
): Promise<void> => {
  const rl = readline.createInterface({ input, output });

  console.log("Minimal supervisor chat. Type exit, quit, or q to leave.\n");

  rl.on("SIGINT", () => {
    console.log("\nBye.");
    rl.close();
  });

  try {
    while (true) {
      const question = (await rl.question("You: ")).trim();
      if (!question || isExitCommand(question)) {
        break;
      }

      const result = await graph.invoke(
        { messages: [new HumanMessage(question)] },
        { configurable: { thread_id: threadId } },
      );

      const reply = formatMessageContent(result.messages.at(-1)?.content);
      console.log(`\nAssistant: ${reply || "(no response)"}\n`);
    }
  } finally {
    rl.close();
  }
};

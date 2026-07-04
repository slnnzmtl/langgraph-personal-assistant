import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";

import {
  MESSAGE_HISTORY_LIMIT,
  reduceAgentMessages,
  trimMessagesToLast,
} from "../../src/state.js";

const makeMessages = (count: number) =>
  Array.from({ length: count }, (_, index) => new HumanMessage(`message-${index + 1}`));

describe("state message window", () => {
  it("keeps message history intact below the limit", () => {
    const messages = makeMessages(4);

    expect(trimMessagesToLast(messages)).toEqual(messages);
  });

  it("caps message history at the last 10 messages", () => {
    const messages = makeMessages(MESSAGE_HISTORY_LIMIT + 2);
    const trimmed = trimMessagesToLast(messages);

    expect(trimmed).toHaveLength(MESSAGE_HISTORY_LIMIT);
    expect(trimmed[0]?.content).toBe("message-3");
    expect(trimmed.at(-1)?.content).toBe("message-12");
  });

  it("drops the oldest message when a new one is appended past the boundary", () => {
    const existing = makeMessages(MESSAGE_HISTORY_LIMIT);
    const updated = reduceAgentMessages(existing, new AIMessage("message-11"));

    expect(updated).toHaveLength(MESSAGE_HISTORY_LIMIT);
    expect(updated[0]?.content).toBe("message-2");
    expect(updated.at(-1)?.content).toBe("message-11");
  });
});
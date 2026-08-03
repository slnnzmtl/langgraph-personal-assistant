import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";

import {
  buildCachedRuntimePromptMessages,
  buildTurnContextMessage,
} from "../../src/core/supervisor/cache-prompt-messages.js";
import { stripToolsForSupervisor } from "../../src/core/supervisor/message-history.js";

describe("buildCachedRuntimePromptMessages", () => {
  it("returns history unchanged when dynamic context is empty", () => {
    const history = [new HumanMessage("hello")];
    expect(buildCachedRuntimePromptMessages("   ", history)).toEqual(history);
  });

  it("returns only turn_context when history is empty", () => {
    const messages = buildCachedRuntimePromptMessages("<system_metadata>now</system_metadata>", []);

    expect(messages).toHaveLength(1);
    expect(String(messages[0]?.content)).toContain("<turn_context>");
    expect(String(messages[0]?.content)).toContain("now");
  });

  it("does not fuse post-handoff turn_context onto a stale earlier human turn", () => {
    const history = stripToolsForSupervisor([
      new HumanMessage("list runtime agents"),
      new AIMessage("Agent ID: configuration\nAgent ID: finance"),
      new HumanMessage("sync expenses"),
      new AIMessage("I've synced yesterday's transactions (2026-07-31)."),
    ]);

    const dynamic = [
      "<system_metadata>",
      "CURRENT DATETIME: 2026-08-01T18:51:46 Asia/Ho_Chi_Minh",
      "</system_metadata>",
      "<post_handoff_replan_context>",
      'The runtime agent "finance" just completed with status "ok".',
      "Latest user message: sync expenses",
      "</post_handoff_replan_context>",
    ].join("\n");

    const promptMessages = buildCachedRuntimePromptMessages(dynamic, history);

    const turnContextMessage = promptMessages[promptMessages.length - 1];
    expect(turnContextMessage).toBeInstanceOf(HumanMessage);
    expect(String(turnContextMessage?.content)).toContain("<turn_context>");
    expect(String(turnContextMessage?.content)).toContain("Latest user message: sync expenses");
    expect(String(turnContextMessage?.content)).not.toContain("list runtime agents");

    const firstHuman = promptMessages[0];
    expect(String(firstHuman?.content)).toBe("list runtime agents");
    expect(String(firstHuman?.content)).not.toContain("<turn_context>");

    // Re-stripping must not glue turn_context back onto the oldest human.
    const restripped = stripToolsForSupervisor(promptMessages);
    expect(String(restripped[0]?.content)).toBe("list runtime agents");
    expect(String(restripped[0]?.content)).not.toContain("<turn_context>");
  });

  it("prefixes turn_context onto the latest human when the thread ends on the user", () => {
    const messages = buildCachedRuntimePromptMessages(
      "<system_metadata>now</system_metadata>",
      [
        new HumanMessage("list runtime agents"),
        new AIMessage("Agent ID: finance"),
        new HumanMessage("sync expenses"),
      ],
    );

    expect(messages).toHaveLength(3);
    expect(String(messages[0]?.content)).toBe("list runtime agents");
    expect(String(messages[0]?.content)).not.toContain("<turn_context>");
    expect(String(messages[2]?.content)).toContain("<turn_context>");
    expect(String(messages[2]?.content)).toContain("sync expenses");
  });

  it("preserves image_url parts when fusing turn_context onto a multimodal latest human", () => {
    const imagePart = {
      type: "image_url" as const,
      image_url: { url: "data:image/jpeg;base64,ZmFrZQ==" },
    };
    const messages = buildCachedRuntimePromptMessages(
      "<system_metadata>now</system_metadata>",
      [
        new HumanMessage("list runtime agents"),
        new AIMessage("Agent ID: obsidian"),
        new HumanMessage([
          { type: "text", text: "Summarize and save in note \"ideas for a startup\"" },
          imagePart,
        ]),
      ],
    );

    expect(messages).toHaveLength(3);
    expect(messages[2]?.content).toEqual([
      {
        type: "text",
        text: expect.stringMatching(/<turn_context>[\s\S]*Summarize and save in note "ideas for a startup"/),
      },
      imagePart,
    ]);
  });
});

describe("buildTurnContextMessage", () => {
  it("wraps trimmed dynamic context", () => {
    const message = buildTurnContextMessage("  meta  ");
    expect(message).toBeInstanceOf(HumanMessage);
    expect(String(message?.content)).toBe("<turn_context>\nmeta\n</turn_context>");
  });
});

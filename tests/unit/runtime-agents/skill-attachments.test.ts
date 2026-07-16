import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";

import {
  ROUTINE_SKILL_ATTACHMENTS,
  appendConfiguredSkillAttachments,
  extractTriggerUserText,
  formatAttachedSkillBlock,
  formatAttachedSkillsPrompt,
  matchesCronJobTrigger,
  matchesSkillAttachmentRule,
  resolveSkillAttachments,
} from "../../../src/runtime-agents/skill-attachments.js";
import { getBuiltinRuntimeAgentDefinition } from "../../helpers/fakes.js";

describe("matchesSkillAttachmentRule", () => {
  it.each([
    "create today's routine note",
    "move unchecked todos from yesterday",
    "carry forward tasks from yesterday into today",
    "today's plan",
    "give me a plan for today",
    "SYSTEM_CRON_TRIGGER:Obsidian_SG:routine-note-creation\n\nPayload:\nCreate today's routine note.",
  ])("matches routine attachment rules for %j", (text) => {
    expect(ROUTINE_SKILL_ATTACHMENTS.some((rule) => matchesSkillAttachmentRule(text, rule))).toBe(true);
  });

  it.each([
    "read my fitness log",
    "add a task to the project note",
    "sync expenses",
  ])("does not match routine attachment rules for %j", (text) => {
    expect(ROUTINE_SKILL_ATTACHMENTS.some((rule) => matchesSkillAttachmentRule(text, rule))).toBe(false);
  });

  it("matches weak task triggers only with routine context", () => {
    expect(ROUTINE_SKILL_ATTACHMENTS.some((rule) =>
      matchesSkillAttachmentRule("move tasks from yesterday into today", rule),
    )).toBe(true);
    expect(ROUTINE_SKILL_ATTACHMENTS.some((rule) =>
      matchesSkillAttachmentRule("update the project task list", rule),
    )).toBe(false);
  });
});

describe("matchesCronJobTrigger", () => {
  it("detects the routine-note-creation cron job", () => {
    expect(
      matchesCronJobTrigger(
        "SYSTEM_CRON_TRIGGER:Obsidian_SG:routine-note-creation\n\nPayload:\n{}",
        "routine-note-creation",
      ),
    ).toBe(true);
    expect(
      matchesCronJobTrigger("SYSTEM_CRON_TRIGGER:Obsidian_SG:sync-finance", "routine-note-creation"),
    ).toBe(false);
  });
});

describe("extractTriggerUserText", () => {
  it("returns the most recent human message when the latest message is a tool result", () => {
    const text = extractTriggerUserText([
      new HumanMessage("create today's routine note"),
      new AIMessage({ content: "", tool_calls: [{ name: "read_file", args: {}, id: "read-1", type: "tool_call" }] }),
      new ToolMessage({ content: "note body", tool_call_id: "read-1", name: "read_file" }),
    ]);

    expect(text).toBe("create today's routine note");
  });
});

describe("formatAttachedSkillBlock", () => {
  it("wraps skill content in an attached_skill block", () => {
    const block = formatAttachedSkillBlock("Routine", "Step 1: read yesterday");

    expect(block).toContain('<attached_skill name="Routine">');
    expect(block).toContain("Step 1: read yesterday");
    expect(block).toContain("</attached_skill>");
  });
});

describe("formatAttachedSkillsPrompt", () => {
  it("wraps multiple attachments and includes read_skill guidance", () => {
    const prompt = formatAttachedSkillsPrompt([
      { skillName: "Routine", content: "Step 1" },
    ]);

    expect(prompt).toContain("<attached_skills>");
    expect(prompt).toContain('<attached_skill name="Routine">');
    expect(prompt).toContain('read_skill for "Routine"');
  });
});

describe("resolveSkillAttachments", () => {
  it("loads the Routine skill body when intent matches", () => {
    const attachments = resolveSkillAttachments(ROUTINE_SKILL_ATTACHMENTS, [
      new HumanMessage("create today's routine note"),
    ]);

    expect(attachments).toHaveLength(1);
    expect(attachments[0]?.skillName).toBe("Routine");
    expect(attachments[0]?.content).toContain("Step 1: Read yesterday's note");
  });

  it("returns an empty list when intent does not match", () => {
    expect(resolveSkillAttachments(ROUTINE_SKILL_ATTACHMENTS, [
      new HumanMessage("read my fitness log"),
    ])).toEqual([]);
  });

  it("still attaches Routine after read_skill was called in the same turn history", () => {
    const attachments = resolveSkillAttachments(ROUTINE_SKILL_ATTACHMENTS, [
      new HumanMessage("create today's routine note"),
      new AIMessage({
        content: "",
        tool_calls: [{ name: "read_skill", args: { name: "Routine" }, id: "read-1", type: "tool_call" }],
      }),
      new ToolMessage({ name: "read_skill", tool_call_id: "read-1", content: "Routine skill body" }),
    ]);

    expect(attachments).toHaveLength(1);
    expect(attachments[0]?.skillName).toBe("Routine");
  });
});

describe("appendConfiguredSkillAttachments", () => {
  it("appends configured attachments to the base prompt", () => {
    const definition = getBuiltinRuntimeAgentDefinition("obsidian");
    const prompt = appendConfiguredSkillAttachments(
      "Base prompt",
      definition,
      [new HumanMessage("move unchecked todos from yesterday")],
    );

    expect(prompt).toContain("Base prompt");
    expect(prompt).toContain("<attached_skills>");
    expect(prompt).toContain('<attached_skill name="Routine">');
    expect(prompt).toContain("Step 1: Read yesterday's note");
  });

  it("returns the base prompt unchanged when intent does not match", () => {
    const definition = getBuiltinRuntimeAgentDefinition("obsidian");
    const prompt = appendConfiguredSkillAttachments(
      "Base prompt",
      definition,
      [new HumanMessage("read my fitness log")],
    );

    expect(prompt).toBe("Base prompt");
  });
});

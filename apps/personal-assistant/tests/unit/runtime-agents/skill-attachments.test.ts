import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";

import {
  appendConfiguredSkillAttachments,
  extractTriggerUserText,
  formatAttachedSkillBlock,
  formatAttachedSkillsPrompt,
  matchesCronJobTrigger,
  matchesSkillAttachmentRule,
  resolveSkillAttachmentRulesForModule,
  resolveSkillAttachments,
} from "../../../src/runtime-agents/skill-attachments.js";
import { getRuntimeAgentFixture } from "../../helpers/fakes.js";

const routineRules = () => resolveSkillAttachmentRulesForModule("obsidian");
const financeRules = () => resolveSkillAttachmentRulesForModule("finance");

describe("matchesSkillAttachmentRule", () => {
  it.each([
    "create today's routine note",
    "move unchecked todos from yesterday",
    "carry forward tasks from yesterday into today",
    "today's plan",
    "give me a plan for today",
    "SYSTEM_CRON_TRIGGER:obsidian:routine-note-creation\n\nPayload:\nCreate today's routine note.",
  ])("matches routine attachment rules for %j", (text) => {
    expect(routineRules().some((rule) => matchesSkillAttachmentRule(text, rule))).toBe(true);
  });

  it.each([
    "read my fitness log",
    "add a task to the project note",
    "sync expenses",
  ])("does not match routine attachment rules for %j", (text) => {
    expect(routineRules().some((rule) => matchesSkillAttachmentRule(text, rule))).toBe(false);
  });

  it.each([
    "what the last expense date in db?",
    "show me the last expense",
    "expense date in db",
    "sync expenses",
    "view expenses",
    "for yesterday",
    "for today",
    "uniqlo is clothes category",
    "change category for UNIQLO",
  ])("matches finance attachment rules for %j", (text) => {
    expect(financeRules().some((rule) => matchesSkillAttachmentRule(text, rule))).toBe(true);
  });

  it.each([
    "read my fitness log",
    "create today's routine note",
  ])("does not match finance attachment rules for %j", (text) => {
    expect(financeRules().some((rule) => matchesSkillAttachmentRule(text, rule))).toBe(false);
  });

  it("matches weak task triggers only with routine context", () => {
    expect(routineRules().some((rule) =>
      matchesSkillAttachmentRule("move tasks from yesterday into today", rule),
    )).toBe(true);
    expect(routineRules().some((rule) =>
      matchesSkillAttachmentRule("update the project task list", rule),
    )).toBe(false);
  });
});

describe("matchesCronJobTrigger", () => {
  it("detects the routine-note-creation cron job", () => {
    expect(
      matchesCronJobTrigger(
        "SYSTEM_CRON_TRIGGER:obsidian:routine-note-creation\n\nPayload:\n{}",
        "routine-note-creation",
      ),
    ).toBe(true);
    expect(
      matchesCronJobTrigger("SYSTEM_CRON_TRIGGER:obsidian:sync-finance", "routine-note-creation"),
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
    const block = formatAttachedSkillBlock("daily-routine-note-creation", "Step 1: read yesterday");

    expect(block).toContain('<attached_skill name="daily-routine-note-creation">');
    expect(block).toContain("Step 1: read yesterday");
    expect(block).toContain("</attached_skill>");
  });
});

describe("formatAttachedSkillsPrompt", () => {
  it("wraps multiple attachments and includes read_skill guidance", () => {
    const prompt = formatAttachedSkillsPrompt([
      { skillName: "daily-routine-note-creation", content: "Step 1" },
    ]);

    expect(prompt).toContain("<attached_skills>");
    expect(prompt).toContain('<attached_skill name="daily-routine-note-creation">');
    expect(prompt).toContain('read_skill for "daily-routine-note-creation"');
  });
});

describe("resolveSkillAttachments", () => {
  it("loads the Routine skill body when intent matches", () => {
    const attachments = resolveSkillAttachments(routineRules(), [
      new HumanMessage("create today's routine note"),
    ]);

    expect(attachments).toHaveLength(1);
    expect(attachments[0]?.skillName).toBe("daily-routine-note-creation");
    expect(attachments[0]?.content).toContain("First: `read_file` yesterday's note");
    expect(attachments[0]?.content).not.toContain("<skill_attachments>");
  });

  it("returns an empty list when intent does not match", () => {
    expect(resolveSkillAttachments(routineRules(), [
      new HumanMessage("read my fitness log"),
    ])).toEqual([]);
  });

  it("keeps expense-view attached on short follow-ups after a matching request", () => {
    const attachments = resolveSkillAttachments(financeRules(), [
      new HumanMessage("sync expenses"),
      new AIMessage("There were no transactions found for today."),
      new HumanMessage("for yesterday"),
    ]);

    expect(attachments.map((attachment) => attachment.skillName)).toEqual([
      "expense-ledger-schema",
      "expense-sync",
      "expense-view",
    ]);
  });

  it("attaches expense-update for category corrections", () => {
    const attachments = resolveSkillAttachments(financeRules(), [
      new HumanMessage("uniqlo is clothes category"),
    ]);

    expect(attachments.map((attachment) => attachment.skillName)).toEqual([
      "expense-ledger-schema",
      "expense-update",
    ]);
  });

  it("re-attaches a skill loaded via read_skill when follow-up phrasing does not match", () => {
    const attachments = resolveSkillAttachments(financeRules(), [
      new HumanMessage("thanks"),
      new AIMessage({
        content: "",
        tool_calls: [{ name: "read_skill", args: { name: "expense-update" }, id: "read-1", type: "tool_call" }],
      }),
      new ToolMessage({ name: "read_skill", tool_call_id: "read-1", content: "Update skill body" }),
      new HumanMessage("yes, all UNIQLO rows"),
    ]);

    expect(attachments.map((attachment) => attachment.skillName)).toEqual([
      "expense-ledger-schema",
      "expense-update",
    ]);
  });

  it("still attaches Routine after read_skill was called in the same turn history", () => {
    const attachments = resolveSkillAttachments(routineRules(), [
      new HumanMessage("create today's routine note"),
      new AIMessage({
        content: "",
        tool_calls: [{ name: "read_skill", args: { name: "daily-routine-note-creation" }, id: "read-1", type: "tool_call" }],
      }),
      new ToolMessage({ name: "read_skill", tool_call_id: "read-1", content: "Routine skill body" }),
    ]);

    expect(attachments).toHaveLength(1);
    expect(attachments[0]?.skillName).toBe("daily-routine-note-creation");
  });
});

describe("appendConfiguredSkillAttachments", () => {
  it("appends configured attachments to the base prompt", () => {
    const definition = getRuntimeAgentFixture("obsidian");
    const prompt = appendConfiguredSkillAttachments(
      "Base prompt",
      definition,
      [new HumanMessage("move unchecked todos from yesterday")],
    );

    expect(prompt).toContain("Base prompt");
    expect(prompt).toContain("<attached_skills>");
    expect(prompt).toContain('<attached_skill name="daily-routine-note-creation">');
    expect(prompt).toContain("First: `read_file` yesterday's note");
  });

  it("returns the base prompt unchanged when intent does not match", () => {
    const definition = getRuntimeAgentFixture("obsidian");
    const prompt = appendConfiguredSkillAttachments(
      "Base prompt",
      definition,
      [new HumanMessage("read my fitness log")],
    );

    expect(prompt).toBe("Base prompt");
  });

  it("appends expense-view for finance expense-db queries", () => {
    const definition = getRuntimeAgentFixture("finance");
    const prompt = appendConfiguredSkillAttachments(
      "Base prompt",
      definition,
      [new HumanMessage("what the last expense date in db?")],
    );

    expect(prompt).toContain("Base prompt");
    expect(prompt).toContain('<attached_skill name="expense-view">');
    expect(prompt).toContain('<attached_skill name="expense-ledger-schema">');
    expect(prompt).toContain("public.expense");
  });
});

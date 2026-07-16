import { loadSystemPromptByKey } from "../prompts/load-system-prompt.js";
import {
  CONFIGURATION_MAX_STEPS,
  FINANCE_MAX_STEPS,
  OBSIDIAN_MAX_STEPS,
} from "./constants.js";
import type { RuntimeAgentDefinition } from "../core/types/agent.js";
import { ROUTINE_SKILL_ATTACHMENTS } from "./skill-attachments.js";

const buildTimestamp = (): string => new Date().toISOString();

export const buildDefaultRuntimeAgents = (): RuntimeAgentDefinition[] => {
  const timestamp = buildTimestamp();

  return [
    {
      id: "finance",
      name: "Finance",
      description: "Track money, raw expenses, transaction logs, budgets, or banking queries.",
      systemPrompt: loadSystemPromptByKey("finance"),
      promptSourceKey: "finance",
      toolBundleIds: ["finance-domain"],
      skillAttachments: [],
      executor: "finance",
      maxSteps: FINANCE_MAX_STEPS,
      enabled: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      id: "obsidian",
      name: "Obsidian",
      description: "Manage notes, plans, task checklists, markdown vault edits, summaries, or task status updates.",
      systemPrompt: loadSystemPromptByKey("obsidian"),
      promptSourceKey: "obsidian",
      toolBundleIds: ["obsidian-vault"],
      skillAttachments: ROUTINE_SKILL_ATTACHMENTS,
      executor: "obsidian",
      maxSteps: OBSIDIAN_MAX_STEPS,
      enabled: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      id: "configuration",
      name: "Configuration",
      description: "Manage cron jobs, agent skills, and reusable runtime sub-agents.",
      systemPrompt: loadSystemPromptByKey("configuration"),
      promptSourceKey: "configuration",
      toolBundleIds: ["configuration"],
      skillAttachments: [],
      executor: "configuration",
      maxSteps: CONFIGURATION_MAX_STEPS,
      enabled: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ];
};

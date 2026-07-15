import {
  loadConfigurationSystemPrompt,
  loadFinanceSystemPrompt,
  loadObsidianSystemPrompt,
} from "../prompts/load-system-prompt.js";
import {
  CONFIGURATION_MAX_STEPS,
  FINANCE_MAX_STEPS,
  OBSIDIAN_MAX_STEPS,
} from "./constants.js";
import type { RuntimeAgentDefinition } from "./types.js";

const buildTimestamp = (): string => new Date().toISOString();

export const buildDefaultRuntimeAgents = (): RuntimeAgentDefinition[] => {
  const timestamp = buildTimestamp();

  return [
    {
      id: "finance",
      name: "Finance",
      description: "Track money, raw expenses, transaction logs, budgets, or banking queries.",
      systemPrompt: loadFinanceSystemPrompt(),
      promptSourceKey: "finance",
      toolBundleIds: ["finance-domain"],
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
      systemPrompt: loadObsidianSystemPrompt(),
      promptSourceKey: "obsidian",
      toolBundleIds: ["obsidian-vault"],
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
      systemPrompt: loadConfigurationSystemPrompt(),
      promptSourceKey: "configuration",
      toolBundleIds: ["configuration"],
      executor: "configuration",
      maxSteps: CONFIGURATION_MAX_STEPS,
      enabled: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ];
};

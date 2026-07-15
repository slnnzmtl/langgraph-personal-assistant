import {
  loadConfigurationSystemPrompt,
  loadFinanceSystemPrompt,
  loadObsidianSystemPrompt,
} from "../prompts/load-system-prompt.js";
import { CONFIGURATION_MAX_STEPS } from "../nodes/configuration/graph.js";
import { FINANCE_MAX_STEPS } from "../nodes/finance/graph.js";
import { OBSIDIAN_MAX_STEPS } from "../nodes/obsidian/graph.js";
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
      toolBundleIds: ["configuration"],
      executor: "configuration",
      maxSteps: CONFIGURATION_MAX_STEPS,
      enabled: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ];
};

import type { AppConfig } from "../config.js";
import { loadSystemPromptByKey } from "../prompts/load-system-prompt.js";
import type {
  RuntimeAgentDefinition,
  RuntimeToolBundleId,
  SkillAttachmentRule,
} from "../core/types/agent.js";
import {
  CONFIGURATION_MAX_STEPS,
  FINANCE_MAX_STEPS,
  OBSIDIAN_MAX_STEPS,
} from "./constants.js";
import { ROUTINE_SKILL_ATTACHMENTS } from "./skill-attachments.js";

type AppModelConfigKey = "financeModel" | "obsidianModel" | "configurationModel";

export type BuiltinDomainSpec = {
  id: string;
  name: string;
  description: string;
  executor: string;
  modelKey: string;
  promptSourceKey: string;
  toolBundleIds: RuntimeToolBundleId[];
  skillAttachments: SkillAttachmentRule[];
  maxSteps: number;
  configModelKey?: AppModelConfigKey;
  requiresSupabase?: boolean;
};

export const BUILTIN_DOMAIN_SPECS: BuiltinDomainSpec[] = [
  {
    id: "finance",
    name: "Finance",
    description: "Track money, raw expenses, transaction logs, budgets, or banking queries.",
    executor: "finance",
    modelKey: "finance",
    promptSourceKey: "finance",
    toolBundleIds: ["finance-domain"],
    skillAttachments: [],
    maxSteps: FINANCE_MAX_STEPS,
    configModelKey: "financeModel",
    requiresSupabase: true,
  },
  {
    id: "obsidian",
    name: "Obsidian",
    description: "Manage notes, plans, task checklists, markdown vault edits, summaries, or task status updates.",
    executor: "obsidian",
    modelKey: "obsidian",
    promptSourceKey: "obsidian",
    toolBundleIds: ["obsidian-vault"],
    skillAttachments: ROUTINE_SKILL_ATTACHMENTS,
    maxSteps: OBSIDIAN_MAX_STEPS,
    configModelKey: "obsidianModel",
  },
  {
    id: "configuration",
    name: "Configuration",
    description: "Manage cron jobs, agent skills, and reusable runtime sub-agents.",
    executor: "configuration",
    modelKey: "configuration",
    promptSourceKey: "configuration",
    toolBundleIds: ["configuration"],
    skillAttachments: [],
    maxSteps: CONFIGURATION_MAX_STEPS,
    configModelKey: "configurationModel",
  },
];

export const BUILTIN_DOMAIN_IDS = BUILTIN_DOMAIN_SPECS.map((spec) => spec.id) as [
  "finance",
  "obsidian",
  "configuration",
];

export const BUILTIN_DOMAIN_EXECUTORS = BUILTIN_DOMAIN_SPECS.map((spec) => spec.executor);

const buildTimestamp = (): string => new Date().toISOString();

export const buildDefaultRuntimeAgents = (): RuntimeAgentDefinition[] => {
  const timestamp = buildTimestamp();

  return BUILTIN_DOMAIN_SPECS.map((spec) => ({
    id: spec.id,
    name: spec.name,
    description: spec.description,
    systemPrompt: loadSystemPromptByKey(spec.promptSourceKey),
    promptSourceKey: spec.promptSourceKey,
    toolBundleIds: spec.toolBundleIds,
    skillAttachments: spec.skillAttachments,
    executor: spec.executor,
    modelKey: spec.modelKey,
    builtin: true,
    maxSteps: spec.maxSteps,
    enabled: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  }));
};

export const resolveBuiltinModelName = (config: AppConfig, modelKey: string): string => {
  if (modelKey === "generic") {
    return config.obsidianModel;
  }

  const spec = BUILTIN_DOMAIN_SPECS.find((entry) => entry.modelKey === modelKey);
  if (spec?.configModelKey) {
    return config[spec.configModelKey];
  }

  return config.geminiModel;
};

export type BuiltinDomainAvailabilityOptions = {
  financeAvailable?: boolean;
};

export const applyBuiltinDomainAvailability = (
  agent: RuntimeAgentDefinition,
  options: BuiltinDomainAvailabilityOptions = {},
): RuntimeAgentDefinition => {
  const spec = BUILTIN_DOMAIN_SPECS.find((entry) => entry.id === agent.id);

  if (spec?.requiresSupabase && spec.id === "finance") {
    return {
      ...agent,
      enabled: options.financeAvailable ?? agent.enabled,
    };
  }

  return agent;
};

export const buildBuiltinDomainOwnerPattern = (): RegExp => {
  const owners = BUILTIN_DOMAIN_IDS.map((owner) => owner.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`\\b(${owners.join("|")})\\b`);
};

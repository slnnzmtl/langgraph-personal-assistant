import { z } from "zod";

export const RUNTIME_AGENT_SCHEMA_VERSION = 1;

export const RUNTIME_AGENT_CONTEXT_KEY = "runtimeAgentId" as const;

export const RUNTIME_TOOL_BUNDLE_IDS = [
  "none",
  "obsidian-vault",
  "finance-domain",
  "configuration",
] as const;

export type RuntimeToolBundleId = (typeof RUNTIME_TOOL_BUNDLE_IDS)[number];

const RuntimeToolBundleIdSchema = z.enum(RUNTIME_TOOL_BUNDLE_IDS);

export const SkillAttachmentMatchSchema = z.object({
  anyPhrases: z.array(z.string().min(1)).optional(),
  allPhrases: z.array(z.string().min(1)).optional(),
});

export type SkillAttachmentMatch = z.infer<typeof SkillAttachmentMatchSchema>;

export const SkillAttachmentRuleSchema = z.object({
  owner: z.string().min(1),
  skillName: z.string().min(1),
  cronJobName: z.string().min(1).optional(),
  match: SkillAttachmentMatchSchema.optional(),
});

export type SkillAttachmentRule = z.infer<typeof SkillAttachmentRuleSchema>;

export const RuntimeAgentDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  systemPrompt: z.string().min(1),
  promptSourceKey: z.string().min(1).optional(),
  toolBundleIds: z.array(RuntimeToolBundleIdSchema).min(1),
  skillAttachments: z.array(SkillAttachmentRuleSchema).default([]),
  executor: z.string().min(1).default("generic"),
  modelKey: z.string().min(1).optional(),
  builtin: z.boolean().default(false),
  maxSteps: z.number().int().min(1).max(20).default(8),
  enabled: z.boolean().default(true),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

export type RuntimeAgentDefinition = z.infer<typeof RuntimeAgentDefinitionSchema>;

export const RuntimeAgentsDocumentSchema = z.object({
  version: z.literal(RUNTIME_AGENT_SCHEMA_VERSION),
  agents: z.array(RuntimeAgentDefinitionSchema),
});

export type RuntimeAgentsDocument = z.infer<typeof RuntimeAgentsDocumentSchema>;

export type CreateRuntimeAgentInput = {
  name: string;
  description: string;
  systemPrompt: string;
  toolBundleIds: RuntimeToolBundleId[];
  skillAttachments?: SkillAttachmentRule[];
  executor?: string;
  modelKey?: string;
  maxSteps?: number;
  enabled?: boolean;
};

export type UpdateRuntimeAgentInput = {
  name?: string;
  description?: string;
  systemPrompt?: string;
  toolBundleIds?: RuntimeToolBundleId[];
  skillAttachments?: SkillAttachmentRule[];
  executor?: string;
  modelKey?: string;
  enabled?: boolean;
};

export const toRuntimeAgentId = (name: string): string =>
  name
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "");

export const isRuntimeToolBundleId = (value: string): value is RuntimeToolBundleId =>
  (RUNTIME_TOOL_BUNDLE_IDS as readonly string[]).includes(value);

export const resolveRuntimeAgentId = (routeOrId: string): string =>
  routeOrId;

export const resolveAgentModelKey = (
  definition: RuntimeAgentDefinition,
  defaultModelKey = "generic",
): string => definition.modelKey ?? definition.executor ?? defaultModelKey;

export const isRuntimeAgentBuiltin = (definition: RuntimeAgentDefinition): boolean =>
  definition.builtin === true;

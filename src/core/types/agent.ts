import { z } from "zod";

export const RUNTIME_AGENT_SCHEMA_VERSION = 1;

export const RUNTIME_AGENT_CONTEXT_KEY = "runtimeAgentId" as const;

export const SkillAttachmentMatchSchema = z.object({
  anyPhrases: z.array(z.string().min(1)).optional(),
  allPhrases: z.array(z.string().min(1)).optional(),
});

export type SkillAttachmentMatch = z.infer<typeof SkillAttachmentMatchSchema>;

export const SkillAttachmentRuleSchema = z.object({
  module: z.string().min(1),
  skillName: z.string().min(1),
  cronJobName: z.string().min(1).optional(),
  match: SkillAttachmentMatchSchema.optional(),
});

export type SkillAttachmentRule = z.infer<typeof SkillAttachmentRuleSchema>;

const CapabilityIdListSchema = z.array(z.string().min(1)).min(1);

export type RuntimeAgentDefinition = {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  promptSourceKey?: string | undefined;
  capabilityIds: string[];
  toolBundleIds: string[];
  executor: string;
  modelKey?: string | undefined;
  builtin: boolean;
  maxSteps: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

const normalizeCapabilityFields = <
  T extends { capabilityIds?: string[] | undefined; toolBundleIds?: string[] | undefined },
>(
  agent: T,
): Omit<T, "capabilityIds" | "toolBundleIds"> & { capabilityIds: string[]; toolBundleIds: string[] } => {
  const capabilityIds = agent.capabilityIds ?? agent.toolBundleIds;

  if (!capabilityIds) {
    throw new Error("Runtime agent definitions require capabilityIds.");
  }

  return {
    ...agent,
    capabilityIds,
    toolBundleIds: capabilityIds,
  };
};

const RuntimeAgentDefinitionBaseSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  systemPrompt: z.string().min(1),
  promptSourceKey: z.string().min(1).optional(),
  capabilityIds: CapabilityIdListSchema.optional(),
  toolBundleIds: CapabilityIdListSchema.optional(),
  executor: z.string().min(1).default("generic"),
  modelKey: z.string().min(1).optional(),
  builtin: z.boolean().default(false),
  maxSteps: z.number().int().min(1).max(20).default(8),
  enabled: z.boolean().default(true),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

export const parseRuntimeAgentDefinition = (input: unknown): RuntimeAgentDefinition =>
  normalizeCapabilityFields(RuntimeAgentDefinitionBaseSchema.parse(input));

export const RuntimeAgentDefinitionSchema = z.custom<RuntimeAgentDefinition>((value) => {
  try {
    parseRuntimeAgentDefinition(value);
    return true;
  } catch {
    return false;
  }
});

export const RuntimeAgentsDocumentSchema = z.object({
  version: z.literal(RUNTIME_AGENT_SCHEMA_VERSION),
  agents: z.array(z.unknown()).transform((agents) => agents.map(parseRuntimeAgentDefinition)),
});

export type RuntimeAgentsDocument = z.infer<typeof RuntimeAgentsDocumentSchema>;

export type CreateRuntimeAgentInput = {
  name: string;
  description: string;
  systemPrompt: string;
  capabilityIds?: string[] | undefined;
  toolBundleIds?: string[] | undefined;
  executor?: string | undefined;
  modelKey?: string | undefined;
  maxSteps?: number | undefined;
  enabled?: boolean | undefined;
};

export type UpdateRuntimeAgentInput = Partial<CreateRuntimeAgentInput>;

const CreateRuntimeAgentInputBaseSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  systemPrompt: z.string().min(1),
  capabilityIds: CapabilityIdListSchema.optional(),
  toolBundleIds: CapabilityIdListSchema.optional(),
  executor: z.string().min(1).optional(),
  modelKey: z.string().min(1).optional(),
  maxSteps: z.number().int().min(1).max(20).optional(),
  enabled: z.boolean().optional(),
});

export const parseCreateRuntimeAgentInput = (input: unknown): CreateRuntimeAgentInput & {
  capabilityIds: string[];
  toolBundleIds: string[];
} => {
  const parsed = CreateRuntimeAgentInputBaseSchema.parse(input);

  if (!parsed.capabilityIds && !parsed.toolBundleIds) {
    throw new Error("capabilityIds are required");
  }

  return normalizeCapabilityFields(parsed);
};

export const CreateRuntimeAgentInputSchema = z.custom<
  CreateRuntimeAgentInput & { capabilityIds: string[]; toolBundleIds: string[] }
>((value) => {
  try {
    parseCreateRuntimeAgentInput(value);
    return true;
  } catch {
    return false;
  }
});

export const parseUpdateRuntimeAgentInput = (input: unknown): UpdateRuntimeAgentInput => {
  const parsed = CreateRuntimeAgentInputBaseSchema.partial().parse(input);

  if (!parsed.capabilityIds && !parsed.toolBundleIds) {
    return parsed as UpdateRuntimeAgentInput;
  }

  return normalizeCapabilityFields(parsed) as UpdateRuntimeAgentInput;
};

export const UpdateRuntimeAgentInputSchema = z.custom<UpdateRuntimeAgentInput>((value) => {
  try {
    parseUpdateRuntimeAgentInput(value);
    return true;
  } catch {
    return false;
  }
});

export const resolveAgentCapabilityIds = (
  definition: Pick<RuntimeAgentDefinition, "capabilityIds" | "toolBundleIds">,
): string[] => definition.capabilityIds ?? definition.toolBundleIds ?? [];

export const toRuntimeAgentId = (name: string): string =>
  name
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "");

export const resolveAgentModelKey = (
  definition: RuntimeAgentDefinition,
  defaultModelKey = "generic",
): string => definition.modelKey ?? definition.executor ?? defaultModelKey;

export const isRuntimeAgentBuiltin = (definition: RuntimeAgentDefinition): boolean =>
  definition.builtin === true;

export const resolveAgentSkillModule = (definition: RuntimeAgentDefinition): string =>
  definition.promptSourceKey ?? definition.id;

export const isLocalModuleAgent = (definition: RuntimeAgentDefinition): boolean =>
  !isRuntimeAgentBuiltin(definition) && (definition.executor ?? "generic") !== "generic";

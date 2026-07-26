import { z } from "zod";

export const RUNTIME_AGENT_SCHEMA_VERSION = 1;

export const RUNTIME_AGENT_CONTEXT_KEY = "runtimeAgentId" as const;

/** Virtual system admin agent id — the only non-generic runtime identity. */
export const CONFIGURATION_AGENT_ID = "configuration" as const;

/** Executor persisted on all product (non-configuration) runtime agents. */
export const DEFAULT_PRODUCT_EXECUTOR = "generic" as const;

/** Legacy executor values that implied a dedicated model before generic migration. */
const LEGACY_MODEL_EXECUTOR_KEYS = new Set(["finance", "obsidian"]);

const CapabilityIdListSchema = z.array(z.string().min(1)).min(1);

export type RuntimeAgentDefinition = {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  promptSourceKey?: string | undefined;
  capabilityIds: string[];
  executor: string;
  modelKey?: string | undefined;
  builtin: boolean;
  maxSteps: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

const RuntimeAgentDefinitionBaseSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  systemPrompt: z.string().min(1),
  promptSourceKey: z.string().min(1).optional(),
  capabilityIds: CapabilityIdListSchema,
  executor: z.string().min(1).default("generic"),
  modelKey: z.string().min(1).optional(),
  builtin: z.boolean().default(false),
  maxSteps: z.number().int().min(1).max(20).default(8),
  enabled: z.boolean().default(true),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

export const normalizeRuntimeAgentDefinition = (
  input: z.infer<typeof RuntimeAgentDefinitionBaseSchema>,
): RuntimeAgentDefinition => {
  const isConfiguration = input.id === CONFIGURATION_AGENT_ID;
  const rawExecutor = input.executor ?? DEFAULT_PRODUCT_EXECUTOR;
  let modelKey = input.modelKey;

  if (
    !isConfiguration
    && !modelKey
    && rawExecutor !== DEFAULT_PRODUCT_EXECUTOR
    && LEGACY_MODEL_EXECUTOR_KEYS.has(rawExecutor)
  ) {
    modelKey = rawExecutor;
  }

  const executor = isConfiguration ? CONFIGURATION_AGENT_ID : DEFAULT_PRODUCT_EXECUTOR;

  return {
    ...input,
    executor,
    ...(modelKey ? { modelKey } : {}),
  };
};

export const parseRuntimeAgentDefinition = (input: unknown): RuntimeAgentDefinition =>
  normalizeRuntimeAgentDefinition(RuntimeAgentDefinitionBaseSchema.parse(input));

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
  capabilityIds: string[];
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
  capabilityIds: CapabilityIdListSchema,
  executor: z.string().min(1).optional(),
  modelKey: z.string().min(1).optional(),
  maxSteps: z.number().int().min(1).max(20).optional(),
  enabled: z.boolean().optional(),
});

export const parseCreateRuntimeAgentInput = (input: unknown): CreateRuntimeAgentInput =>
  CreateRuntimeAgentInputBaseSchema.parse(input);

export const CreateRuntimeAgentInputSchema = z.custom<CreateRuntimeAgentInput>((value) => {
  try {
    parseCreateRuntimeAgentInput(value);
    return true;
  } catch {
    return false;
  }
});

export const parseUpdateRuntimeAgentInput = (input: unknown): UpdateRuntimeAgentInput =>
  CreateRuntimeAgentInputBaseSchema.partial().parse(input) as UpdateRuntimeAgentInput;

export const UpdateRuntimeAgentInputSchema = z.custom<UpdateRuntimeAgentInput>((value) => {
  try {
    parseUpdateRuntimeAgentInput(value);
    return true;
  } catch {
    return false;
  }
});

export const resolveAgentCapabilityIds = (
  definition: Pick<RuntimeAgentDefinition, "capabilityIds">,
): string[] => definition.capabilityIds;

export const toRuntimeAgentId = (name: string): string =>
  name
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "");

export const resolveAgentModelKey = (
  definition: RuntimeAgentDefinition,
  defaultModelKey: string = DEFAULT_PRODUCT_EXECUTOR,
): string => definition.modelKey ?? defaultModelKey;

export const isRuntimeAgentBuiltin = (definition: RuntimeAgentDefinition): boolean =>
  definition.builtin === true;

export const resolveAgentSkillModule = (definition: RuntimeAgentDefinition): string =>
  definition.promptSourceKey ?? definition.id;

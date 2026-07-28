import { z } from "zod";

export const RUNTIME_AGENT_SCHEMA_VERSION = 1;

export const RUNTIME_AGENT_CONTEXT_KEY = "runtimeAgentId" as const;

/** Virtual system admin agent id. */
export const CONFIGURATION_AGENT_ID = "configuration" as const;

/** Default model key for agents without an explicit modelKey. */
export const DEFAULT_MODEL_KEY = "generic" as const;

/** Legacy persisted executor values that implied a dedicated model before migration. */
const LEGACY_MODEL_EXECUTOR_KEYS = new Set(["finance", "obsidian"]);

const CapabilityIdListSchema = z.array(z.string().min(1)).min(1);

export type RuntimeAgentDefinition = {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  promptSourceKey?: string | undefined;
  capabilityIds: string[];
  modelKey?: string | undefined;
  maxSteps: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

const RuntimeAgentDefinitionParseSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  systemPrompt: z.string().min(1),
  promptSourceKey: z.string().min(1).optional(),
  capabilityIds: CapabilityIdListSchema,
  /** Legacy field — stripped on load after modelKey inference. */
  executor: z.string().min(1).optional(),
  modelKey: z.string().min(1).optional(),
  /** Legacy field — stripped on load. */
  builtin: z.boolean().optional(),
  maxSteps: z.number().int().min(1).max(20).default(8),
  enabled: z.boolean().default(true),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

export const normalizeRuntimeAgentDefinition = (
  input: z.infer<typeof RuntimeAgentDefinitionParseSchema>,
): RuntimeAgentDefinition => {
  const { executor: legacyExecutor, builtin: _legacyBuiltin, ...base } = input;
  let modelKey = input.modelKey;

  if (
    !modelKey
    && legacyExecutor
    && legacyExecutor !== DEFAULT_MODEL_KEY
    && LEGACY_MODEL_EXECUTOR_KEYS.has(legacyExecutor)
  ) {
    modelKey = legacyExecutor;
  }

  if (input.id === CONFIGURATION_AGENT_ID && !modelKey) {
    modelKey = CONFIGURATION_AGENT_ID;
  }

  return {
    ...base,
    ...(modelKey ? { modelKey } : {}),
  };
};

export const parseRuntimeAgentDefinition = (input: unknown): RuntimeAgentDefinition =>
  normalizeRuntimeAgentDefinition(RuntimeAgentDefinitionParseSchema.parse(input));

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
  defaultModelKey: string = DEFAULT_MODEL_KEY,
): string => definition.modelKey ?? defaultModelKey;

export const isRuntimeAgentBuiltin = (definition: Pick<RuntimeAgentDefinition, "id">): boolean =>
  definition.id === CONFIGURATION_AGENT_ID;

export const resolveAgentSkillModule = (definition: RuntimeAgentDefinition): string =>
  definition.promptSourceKey ?? definition.id;

import { z } from "zod";

export const RUNTIME_AGENT_SCHEMA_VERSION = 1;

export const BUILTIN_RUNTIME_AGENT_IDS = ["finance", "obsidian", "configuration"] as const;

export type BuiltinRuntimeAgentId = (typeof BUILTIN_RUNTIME_AGENT_IDS)[number];

export const RUNTIME_AGENT_EXECUTORS = [
  "generic",
  "finance",
  "obsidian",
  "configuration",
] as const;

export type RuntimeAgentExecutor = (typeof RUNTIME_AGENT_EXECUTORS)[number];

export const RUNTIME_TOOL_BUNDLE_IDS = [
  "none",
  "obsidian-vault",
  "finance-domain",
  "configuration",
] as const;

export type RuntimeToolBundleId = (typeof RUNTIME_TOOL_BUNDLE_IDS)[number];

const RuntimeToolBundleIdSchema = z.enum(RUNTIME_TOOL_BUNDLE_IDS);
const RuntimeAgentExecutorSchema = z.enum(RUNTIME_AGENT_EXECUTORS);

export const LEGACY_ROUTE_TO_AGENT_ID: Record<string, BuiltinRuntimeAgentId> = {
  Finance_SG: "finance",
  Obsidian_SG: "obsidian",
  Config_SG: "configuration",
};

export const RuntimeAgentDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  systemPrompt: z.string().min(1),
  toolBundleIds: z.array(RuntimeToolBundleIdSchema).min(1),
  executor: RuntimeAgentExecutorSchema.default("generic"),
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
  executor?: RuntimeAgentExecutor;
  maxSteps?: number;
  enabled?: boolean;
};

export type UpdateRuntimeAgentInput = {
  name?: string;
  description?: string;
  systemPrompt?: string;
  toolBundleIds?: RuntimeToolBundleId[];
  executor?: RuntimeAgentExecutor;
  maxSteps?: number;
  enabled?: boolean;
};

export const RUNTIME_AGENT_CONTEXT_KEY = "runtimeAgentId" as const;

export const toRuntimeAgentId = (name: string): string =>
  name
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "");

export const isRuntimeToolBundleId = (value: string): value is RuntimeToolBundleId =>
  (RUNTIME_TOOL_BUNDLE_IDS as readonly string[]).includes(value);

export const isBuiltinRuntimeAgentId = (value: string): value is BuiltinRuntimeAgentId =>
  (BUILTIN_RUNTIME_AGENT_IDS as readonly string[]).includes(value as BuiltinRuntimeAgentId);

export const resolveRuntimeAgentId = (routeOrId: string): string =>
  LEGACY_ROUTE_TO_AGENT_ID[routeOrId] ?? routeOrId;

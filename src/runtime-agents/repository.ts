import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import { fileExists, readTextFile, resolveSafePath } from "../utils/file-system.js";
import {
  RUNTIME_AGENT_SCHEMA_VERSION,
  RuntimeAgentDefinition,
  RuntimeAgentDefinitionSchema,
  RuntimeAgentsDocumentSchema,
  type CreateRuntimeAgentInput,
  type UpdateRuntimeAgentInput,
  isBuiltinRuntimeAgentId,
  toRuntimeAgentId,
} from "./types.js";

export type RuntimeAgentRepository = {
  loadAgents(): Promise<RuntimeAgentDefinition[]>;
  getAgent(id: string): Promise<RuntimeAgentDefinition | undefined>;
  saveAgents(agents: RuntimeAgentDefinition[]): Promise<void>;
  createAgent(input: CreateRuntimeAgentInput): Promise<RuntimeAgentDefinition>;
  updateAgent(id: string, input: UpdateRuntimeAgentInput): Promise<RuntimeAgentDefinition>;
  deleteAgent(id: string): Promise<RuntimeAgentDefinition>;
};

const CreateRuntimeAgentInputSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  systemPrompt: z.string().min(1),
  toolBundleIds: RuntimeAgentDefinitionSchema.shape.toolBundleIds,
  executor: RuntimeAgentDefinitionSchema.shape.executor.optional(),
  maxSteps: z.number().int().min(1).max(20).optional(),
  enabled: z.boolean().optional(),
});

const UpdateRuntimeAgentInputSchema = CreateRuntimeAgentInputSchema.partial();

const emptyDocument = (): { version: typeof RUNTIME_AGENT_SCHEMA_VERSION; agents: RuntimeAgentDefinition[] } => ({
  version: RUNTIME_AGENT_SCHEMA_VERSION,
  agents: [],
});

const parseDocument = (rawContent: string): { version: typeof RUNTIME_AGENT_SCHEMA_VERSION; agents: RuntimeAgentDefinition[] } => {
  const parsed = JSON.parse(rawContent) as unknown;
  const result = RuntimeAgentsDocumentSchema.safeParse(parsed);

  if (!result.success) {
    throw new Error("Invalid runtime agent data in persistence file");
  }

  return result.data;
};

const serializeDocument = (agents: RuntimeAgentDefinition[]): string =>
  `${JSON.stringify({ version: RUNTIME_AGENT_SCHEMA_VERSION, agents }, null, 2)}\n`;

const writeDocumentAtomically = async (
  rootDir: string,
  relativePath: string,
  agents: RuntimeAgentDefinition[],
): Promise<void> => {
  const targetPath = resolveSafePath(rootDir, relativePath);
  const tempPath = `${targetPath}.tmp`;
  const content = serializeDocument(agents);

  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(tempPath, content, "utf8");
  await rename(tempPath, targetPath);
};

const validateUniqueAgentId = (agents: RuntimeAgentDefinition[], id: string): void => {
  if (agents.some((agent) => agent.id === id)) {
    throw new Error(`Runtime agent already exists: ${id}`);
  }
};

export const createRuntimeAgentRepository = (
  rootDir: string,
  relativePath: string,
): RuntimeAgentRepository => ({
  async loadAgents(): Promise<RuntimeAgentDefinition[]> {
    if (!(await fileExists(rootDir, relativePath))) {
      return [];
    }

    const rawContent = await readTextFile(rootDir, relativePath);
    return parseDocument(rawContent).agents;
  },

  async getAgent(id: string): Promise<RuntimeAgentDefinition | undefined> {
    const agents = await this.loadAgents();
    return agents.find((agent) => agent.id === id);
  },

  async saveAgents(agents: RuntimeAgentDefinition[]): Promise<void> {
    const result = RuntimeAgentsDocumentSchema.safeParse({
      version: RUNTIME_AGENT_SCHEMA_VERSION,
      agents,
    });

    if (!result.success) {
      throw new Error("Invalid runtime agent data provided for persistence");
    }

    await writeDocumentAtomically(rootDir, relativePath, result.data.agents);
  },

  async createAgent(input: CreateRuntimeAgentInput): Promise<RuntimeAgentDefinition> {
    const parsed = CreateRuntimeAgentInputSchema.parse(input);
    const agents = await this.loadAgents();
    const id = toRuntimeAgentId(parsed.name);

    if (!id) {
      throw new Error("Runtime agent name must contain at least one alphanumeric character.");
    }

    validateUniqueAgentId(agents, id);

    const timestamp = new Date().toISOString();
    const nextAgent: RuntimeAgentDefinition = {
      id,
      name: parsed.name.trim(),
      description: parsed.description.trim(),
      systemPrompt: parsed.systemPrompt.trim(),
      toolBundleIds: parsed.toolBundleIds,
      executor: parsed.executor ?? "generic",
      maxSteps: parsed.maxSteps ?? 8,
      enabled: parsed.enabled ?? true,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    await this.saveAgents([...agents, nextAgent]);
    return nextAgent;
  },

  async updateAgent(id: string, input: UpdateRuntimeAgentInput): Promise<RuntimeAgentDefinition> {
    const parsed = UpdateRuntimeAgentInputSchema.parse(input);
    const agents = await this.loadAgents();
    const index = agents.findIndex((agent) => agent.id === id);

    if (index < 0) {
      throw new Error(`Runtime agent not found: ${id}`);
    }

    const current = agents[index]!;
    const updated: RuntimeAgentDefinition = {
      ...current,
      ...(parsed.name !== undefined ? { name: parsed.name.trim() } : {}),
      ...(parsed.description !== undefined ? { description: parsed.description.trim() } : {}),
      ...(parsed.systemPrompt !== undefined ? { systemPrompt: parsed.systemPrompt.trim() } : {}),
      ...(parsed.toolBundleIds !== undefined ? { toolBundleIds: parsed.toolBundleIds } : {}),
      ...(parsed.executor !== undefined ? { executor: parsed.executor } : {}),
      ...(parsed.maxSteps !== undefined ? { maxSteps: parsed.maxSteps } : {}),
      ...(parsed.enabled !== undefined ? { enabled: parsed.enabled } : {}),
      updatedAt: new Date().toISOString(),
    };

    const nextAgents = [...agents];
    nextAgents[index] = updated;
    await this.saveAgents(nextAgents);
    return updated;
  },

  async deleteAgent(id: string): Promise<RuntimeAgentDefinition> {
    if (isBuiltinRuntimeAgentId(id)) {
      throw new Error(`Cannot delete built-in runtime agent: ${id}`);
    }

    const agents = await this.loadAgents();
    const found = agents.find((agent) => agent.id === id);

    if (!found) {
      throw new Error(`Runtime agent not found: ${id}`);
    }

    await this.saveAgents(agents.filter((agent) => agent.id !== id));
    return found;
  },
});

export const createRuntimeAgentRepositoryForConfig = (
  runtimeAgentsFilePath: string,
  cwd = process.cwd(),
): RuntimeAgentRepository =>
  createRuntimeAgentRepository(cwd, path.relative(cwd, runtimeAgentsFilePath));

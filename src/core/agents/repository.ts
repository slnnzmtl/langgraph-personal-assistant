import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { fileExists, readTextFile, resolveSafePath } from "../../utils/file-system.js";
import { withSerializedFileWrite } from "../../utils/json-store.js";
import {
  RUNTIME_AGENT_SCHEMA_VERSION,
  parseCreateRuntimeAgentInput,
  parseRuntimeAgentDefinition,
  parseUpdateRuntimeAgentInput,
  RuntimeAgentsDocumentSchema,
  isRuntimeAgentBuiltin,
  toRuntimeAgentId,
  type CreateRuntimeAgentInput,
  type RuntimeAgentDefinition,
  type UpdateRuntimeAgentInput,
} from "../types/agent.js";

export type RuntimeAgentRepository = {
  loadAgents(): Promise<RuntimeAgentDefinition[]>;
  getAgent(id: string): Promise<RuntimeAgentDefinition | undefined>;
  saveAgents(agents: RuntimeAgentDefinition[]): Promise<void>;
  createAgent(input: CreateRuntimeAgentInput): Promise<RuntimeAgentDefinition>;
  updateAgent(id: string, input: UpdateRuntimeAgentInput): Promise<RuntimeAgentDefinition>;
  deleteAgent(id: string): Promise<RuntimeAgentDefinition>;
};

const emptyDocument = (): { version: typeof RUNTIME_AGENT_SCHEMA_VERSION; agents: RuntimeAgentDefinition[] } => ({
  version: RUNTIME_AGENT_SCHEMA_VERSION,
  agents: [],
});

const parseDocument = (rawContent: string): { version: typeof RUNTIME_AGENT_SCHEMA_VERSION; agents: RuntimeAgentDefinition[] } => {
  try {
    const parsed = JSON.parse(rawContent) as unknown;
    const result = RuntimeAgentsDocumentSchema.safeParse(parsed);

    if (!result.success) {
      throw new Error("Invalid runtime agent data in persistence file");
    }

    return result.data;
  } catch (error) {
    if (error instanceof Error && error.message.includes("Invalid runtime agent data")) {
      throw error;
    }

    throw new Error("Invalid runtime agent data in persistence file");
  }
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

export type RuntimeAgentRepositoryOptions = {
  transformAgent?: (agent: RuntimeAgentDefinition) => RuntimeAgentDefinition;
};

export const createRuntimeAgentRepository = (
  rootDir: string,
  relativePath: string,
  options: RuntimeAgentRepositoryOptions = {},
): RuntimeAgentRepository => {
  const fileKey = resolveSafePath(rootDir, relativePath);
  const transformAgent = options.transformAgent ?? ((agent) => agent);

  return {
    async loadAgents(): Promise<RuntimeAgentDefinition[]> {
      if (!(await fileExists(rootDir, relativePath))) {
        return [];
      }

      const rawContent = await readTextFile(rootDir, relativePath);
      return parseDocument(rawContent).agents.map(transformAgent);
    },

    async getAgent(id: string): Promise<RuntimeAgentDefinition | undefined> {
      const agents = await this.loadAgents();
      return agents.find((agent) => agent.id === id);
    },

    async saveAgents(agents: RuntimeAgentDefinition[]): Promise<void> {
      await withSerializedFileWrite(fileKey, async () => {
        const result = RuntimeAgentsDocumentSchema.safeParse({
          version: RUNTIME_AGENT_SCHEMA_VERSION,
          agents,
        });

        if (!result.success) {
          throw new Error("Invalid runtime agent data provided for persistence");
        }

        await writeDocumentAtomically(rootDir, relativePath, result.data.agents);
      });
    },

    async createAgent(input: CreateRuntimeAgentInput): Promise<RuntimeAgentDefinition> {
      return withSerializedFileWrite(fileKey, async () => {
        const parsed = parseCreateRuntimeAgentInput(input);
        const agents = await this.loadAgents();
        const id = toRuntimeAgentId(parsed.name);

        if (!id) {
          throw new Error("Runtime agent name must contain at least one alphanumeric character.");
        }

        validateUniqueAgentId(agents, id);

        if (parsed.executor && parsed.executor !== "generic") {
          throw new Error("Only generic runtime agents can be created through the configuration API.");
        }

        const timestamp = new Date().toISOString();
        const nextAgent = parseRuntimeAgentDefinition({
          id,
          name: parsed.name.trim(),
          description: parsed.description.trim(),
          systemPrompt: parsed.systemPrompt.trim(),
          capabilityIds: parsed.capabilityIds,
          executor: "generic",
          builtin: false,
          maxSteps: parsed.maxSteps ?? 8,
          enabled: parsed.enabled ?? true,
          createdAt: timestamp,
          updatedAt: timestamp,
        });

        await writeDocumentAtomically(rootDir, relativePath, [...agents, nextAgent]);
        return nextAgent;
      });
    },

    async updateAgent(id: string, input: UpdateRuntimeAgentInput): Promise<RuntimeAgentDefinition> {
      return withSerializedFileWrite(fileKey, async () => {
        const parsed = parseUpdateRuntimeAgentInput(input);
        const agents = await this.loadAgents();
        const index = agents.findIndex((agent) => agent.id === id);

        if (index < 0) {
          throw new Error(`Runtime agent not found: ${id}`);
        }

        const current = agents[index]!;
        const builtin = isRuntimeAgentBuiltin(current);

        if (builtin && parsed.executor !== undefined && parsed.executor !== current.executor) {
          throw new Error(`Cannot change executor for built-in runtime agent: ${id}`);
        }

        if (builtin && parsed.modelKey !== undefined && parsed.modelKey !== current.modelKey) {
          throw new Error(`Cannot change model key for built-in runtime agent: ${id}`);
        }

        if (builtin && parsed.systemPrompt !== undefined) {
          throw new Error(`Cannot change system prompt for built-in runtime agent: ${id}`);
        }

        const updated = parseRuntimeAgentDefinition({
          ...current,
          ...(parsed.name !== undefined ? { name: parsed.name.trim() } : {}),
          ...(parsed.description !== undefined ? { description: parsed.description.trim() } : {}),
          ...(parsed.systemPrompt !== undefined && !builtin ? { systemPrompt: parsed.systemPrompt.trim() } : {}),
          ...(parsed.capabilityIds !== undefined && !builtin
            ? { capabilityIds: parsed.capabilityIds }
            : {}),
          ...(parsed.executor !== undefined && !builtin ? { executor: parsed.executor } : {}),
          ...(parsed.modelKey !== undefined && !builtin ? { modelKey: parsed.modelKey } : {}),
          ...(parsed.maxSteps !== undefined ? { maxSteps: parsed.maxSteps } : {}),
          ...(parsed.enabled !== undefined ? { enabled: parsed.enabled } : {}),
          updatedAt: new Date().toISOString(),
        });

        const nextAgents = [...agents];
        nextAgents[index] = updated;
        await writeDocumentAtomically(rootDir, relativePath, nextAgents);
        return updated;
      });
    },

    async deleteAgent(id: string): Promise<RuntimeAgentDefinition> {
      return withSerializedFileWrite(fileKey, async () => {
        const agents = await this.loadAgents();
        const found = agents.find((agent) => agent.id === id);

        if (!found) {
          throw new Error(`Runtime agent not found: ${id}`);
        }

        if (isRuntimeAgentBuiltin(found)) {
          throw new Error(`Cannot delete built-in runtime agent: ${id}`);
        }

        await writeDocumentAtomically(rootDir, relativePath, agents.filter((agent) => agent.id !== id));
        return found;
      });
    },
  };
};


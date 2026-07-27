import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import type { RuntimeAgentPromptStore } from "@personal-assistant/supervisor-framework";

export const AGENT_PROMPTS_DATA_ROOT = path.resolve(process.cwd(), "data/agent-prompts");

const describeAgentPromptLocation = (id: string): string =>
  `data/agent-prompts/${id}.xml`;

const wrapPromptAsXml = (content: string): string => {
  const trimmed = content.trim();
  if (trimmed.startsWith("<")) {
    return `${trimmed}\n`;
  }

  return `<agent_prompt>\n${trimmed}\n</agent_prompt>\n`;
};

const resolveAgentPromptPath = (id: string): string =>
  path.join(AGENT_PROMPTS_DATA_ROOT, `${id}.xml`);

export const createDataAgentPromptStore = (): RuntimeAgentPromptStore => ({
  describeLocation: describeAgentPromptLocation,

  async write(id: string, content: string): Promise<void> {
    const targetPath = resolveAgentPromptPath(id);
    const tempPath = `${targetPath}.tmp`;

    await mkdir(AGENT_PROMPTS_DATA_ROOT, { recursive: true });
    await writeFile(tempPath, wrapPromptAsXml(content), "utf8");
    await rename(tempPath, targetPath);
  },

  async delete(id: string): Promise<void> {
    const targetPath = resolveAgentPromptPath(id);

    try {
      await unlink(targetPath);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return;
      }

      throw error;
    }
  },
});

export const resolveDataAgentPromptPath = (key: string): string =>
  resolveAgentPromptPath(key);

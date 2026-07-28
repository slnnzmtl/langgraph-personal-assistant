import { existsSync } from "node:fs";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import type { RuntimeAgentPromptStore } from "@personal-assistant/supervisor-framework";

export const PROMPTS_DATA_ROOT = path.resolve(process.cwd(), "data/prompts");

const describePromptLocation = (id: string): string => `data/prompts/${id}.xml`;

const wrapPromptAsXml = (content: string): string => {
  const trimmed = content.trim();
  if (trimmed.startsWith("<")) {
    return `${trimmed}\n`;
  }

  return `<agent_prompt>\n${trimmed}\n</agent_prompt>\n`;
};

const resolvePromptPath = (id: string): string =>
  path.join(PROMPTS_DATA_ROOT, `${id}.xml`);

export const createDataAgentPromptStore = (): RuntimeAgentPromptStore => ({
  describeLocation: describePromptLocation,

  async write(id: string, content: string): Promise<void> {
    const targetPath = resolvePromptPath(id);
    const tempPath = `${targetPath}.tmp`;

    await mkdir(PROMPTS_DATA_ROOT, { recursive: true });
    await writeFile(tempPath, wrapPromptAsXml(content), "utf8");
    await rename(tempPath, targetPath);
  },

  async delete(id: string): Promise<void> {
    const targetPath = resolvePromptPath(id);

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

export const resolvePromptDataPath = (key: string): string => resolvePromptPath(key);

export const promptFileExists = (key: string): boolean =>
  existsSync(resolvePromptPath(key));

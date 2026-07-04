import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { HumanMessage } from "@langchain/core/messages";
import { afterEach, describe, expect, it } from "vitest";

import {
  applyMarkdownWrite,
  createObsidianNode,
  resolveVaultPath,
} from "../../src/nodes/obsidian-node.js";
import { FakeLLMConnector } from "../helpers/fakes.js";

const tempPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempPaths.splice(0).map(async (tempPath) => {
      await import("node:fs/promises").then(({ rm }) =>
        rm(tempPath, { recursive: true, force: true }),
      );
    }),
  );
});

const createTempVault = async (): Promise<string> => {
  const { mkdtemp } = await import("node:fs/promises");
  const tempVault = await mkdtemp(path.join(os.tmpdir(), "pa-vault-"));
  tempPaths.push(tempVault);
  return tempVault;
};

describe("obsidian node helpers", () => {
  it("prevents path traversal outside the vault", () => {
    expect(() => resolveVaultPath("/tmp/vault", "../escape.md")).toThrow(
      "Markdown path must stay inside the local vault.",
    );
  });

  it("creates and appends markdown content safely", async () => {
    const vaultRoot = await createTempVault();

    await applyMarkdownWrite(vaultRoot, {
      relativePath: "daily/2024-05-15.md",
      operation: "create_new",
      content: "First entry",
      summary: "Created note",
    });

    await applyMarkdownWrite(vaultRoot, {
      relativePath: "daily/2024-05-15.md",
      operation: "append",
      content: "Second entry",
      summary: "Appended note",
    });

    const saved = await readFile(path.join(vaultRoot, "daily/2024-05-15.md"), "utf8");

    expect(saved).toBe("First entry\n\nSecond entry\n");
  });
});

describe("createObsidianNode", () => {
  it("writes the markdown file returned by the structured output chain", async () => {
    const vaultRoot = await createTempVault();
    const connector = new FakeLLMConnector(() => ({
      relativePath: "notes/test.md",
      operation: "create_new",
      content: "# Test\nBody",
      summary: "Saved the note",
    }));
    const obsidianNode = createObsidianNode(connector, vaultRoot);

    const result = await obsidianNode({
      messages: [new HumanMessage("save this note")],
      context: {},
      next: undefined,
    });

    const saved = await readFile(path.join(vaultRoot, "notes/test.md"), "utf8");

    expect(saved).toBe("# Test\nBody\n");
    expect(result.messages?.[0]?.content).toBe("Saved the note Saved to notes/test.md.");
  });
});
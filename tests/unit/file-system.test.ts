import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";

import { afterEach, describe, expect, it } from "vitest";

import { buildDirectoryTree, searchFilesByContent } from "../../src/core/persistence/file-system.js";
import { searchFiles } from "../../src/services/obsidian.js";

const tempPaths: string[] = [];

afterEach(async () => {
  await Promise.all(tempPaths.splice(0).map((tempPath) => rm(tempPath, { recursive: true, force: true })));
});

const createTempRoot = async (): Promise<string> => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "pa-file-system-"));
  tempPaths.push(tempRoot);
  return tempRoot;
};

describe("buildDirectoryTree", () => {
  it("renders a sorted directory-only tree", async () => {
    const rootDir = await createTempRoot();

    await mkdir(path.join(rootDir, "zeta"), { recursive: true });
    await mkdir(path.join(rootDir, "alpha", "nested"), { recursive: true });
    await writeFile(path.join(rootDir, "alpha", "note.md"), "# Note\n", "utf8");
    await writeFile(path.join(rootDir, "readme.md"), "# Root\n", "utf8");

    await expect(buildDirectoryTree(rootDir)).resolves.toBe([
      ".",
      "  alpha",
      "    alpha/nested",
      "  zeta",
    ].join("\n"));
  });

  it("returns the root marker when no directories exist", async () => {
    const rootDir = await createTempRoot();

    await writeFile(path.join(rootDir, "note.md"), "# Note\n", "utf8");

    await expect(buildDirectoryTree(rootDir)).resolves.toBe(".");
  });
});

describe("searchFilesByContent", () => {
  it("matches markdown files by content or vault-relative path", async () => {
    const rootDir = await createTempRoot();

    await mkdir(path.join(rootDir, "events", "potuzhno", "techno-yoga"), { recursive: true });
    await mkdir(path.join(rootDir, "notes"), { recursive: true });
    await writeFile(path.join(rootDir, "events", "potuzhno", "techno-yoga", "Places.md"), "Unrelated body text", "utf8");
    await writeFile(path.join(rootDir, "notes", "routine.md"), "techno yoga in the content", "utf8");

    await expect(searchFilesByContent(rootDir, ["techno yoga"], ".", { fileExtension: ".md" })).resolves.toEqual([
      "events/potuzhno/techno-yoga/Places.md",
      "notes/routine.md",
    ]);
  });
});

describe("searchFiles", () => {
  it("splits multi-word query phrases into atomic terms before searching", async () => {
    const rootDir = await createTempRoot();

    await mkdir(path.join(rootDir, "events", "potuzhno", "techno-yoga"), { recursive: true });
    await writeFile(path.join(rootDir, "events", "potuzhno", "techno-yoga", "Places.md"), "No matching keywords here", "utf8");

    await expect(searchFiles(rootDir, ["techno yoga places note"], ".")).resolves.toEqual([
      "events/potuzhno/techno-yoga/Places.md",
    ]);
  });
});
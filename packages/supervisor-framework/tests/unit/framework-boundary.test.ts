import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  createCapabilityCatalog,
} from "../../src/index.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const FRAMEWORK_ROOT = path.join(packageRoot, "src/framework");

const collectSourceFiles = (dir: string): string[] => {
  const entries = readdirSync(dir);
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry);
    const stats = statSync(fullPath);

    if (stats.isDirectory()) {
      files.push(...collectSourceFiles(fullPath));
      continue;
    }

    if (fullPath.endsWith(".ts")) {
      files.push(fullPath);
    }
  }

  return files;
};

const assertNoForbiddenImports = (
  rootDir: string,
  forbiddenPathSegments: readonly string[],
  forbiddenImportSubstrings: readonly string[] = [],
  options: { excludeSubdirs?: readonly string[] } = {},
): void => {
  for (const file of collectSourceFiles(rootDir)) {
    if (options.excludeSubdirs?.some((segment) => file.includes(segment))) {
      continue;
    }

    const content = readFileSync(file, "utf8");

    for (const segment of forbiddenPathSegments) {
      expect(content.includes(segment), `${file} must not import ${segment}`).toBe(false);
    }

    for (const importPath of forbiddenImportSubstrings) {
      expect(content.includes(importPath), `${file} must not import ${importPath}`).toBe(false);
    }
  }
};

describe("framework boundaries", () => {
  it("keeps cron kit free of app and Telegram imports", () => {
    assertNoForbiddenImports(path.join(FRAMEWORK_ROOT, "cron"), [], [
      "telegraf",
      "apps/personal-assistant",
    ]);
  });
});

describe("capability catalog", () => {
  it("deduplicates tools resolved from multiple capability ids", () => {
    const catalog = createCapabilityCatalog([
      {
        descriptor: { id: "alpha", description: "Alpha tools" },
        resolveTools: () => [{ name: "shared_tool" }, { name: "alpha_only" }] as never,
      },
      {
        descriptor: { id: "beta", description: "Beta tools" },
        resolveTools: () => [{ name: "shared_tool" }, { name: "beta_only" }] as never,
      },
    ]);

    const tools = catalog.resolveTools(["alpha", "beta"], {}, {});
    expect(tools.map((tool) => tool.name)).toEqual(["shared_tool", "alpha_only", "beta_only"]);
  });
});

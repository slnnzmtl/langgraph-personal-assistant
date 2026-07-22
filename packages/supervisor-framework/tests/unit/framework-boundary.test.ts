import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  createCapabilityCatalog,
  resolveAgentTools,
} from "../../src/index.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CORE_ROOT = path.join(packageRoot, "src/core");
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
): void => {
  for (const file of collectSourceFiles(rootDir)) {
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
  it("keeps core free of runtime-agents imports", () => {
    assertNoForbiddenImports(CORE_ROOT, [
      "runtime-agents/",
      "app/policies/",
      "integrations/",
      "../../tools/",
      "../../connectors/",
      "../../logging/",
      "../../utils/",
    ], ["utils/message-content.js"]);
  });

  it("keeps framework free of app, runtime-agents, cron, and product imports", () => {
    assertNoForbiddenImports(FRAMEWORK_ROOT, [
      "runtime-agents/",
      "app/",
      "integrations/",
      "connectors/",
      "telegram/",
      "tools/",
      "cron/",
      "../../logging/",
      "../../utils/",
    ]);
  });

  it("resolves tools through the framework catalog helper", () => {
    const catalog = createCapabilityCatalog([
      {
        descriptor: { id: "finance-domain", description: "Finance tools" },
        resolveTools: () => [{ name: "exec_sql" }] as never,
      },
    ]);

    const definition = {
      id: "finance",
      name: "Finance",
      description: "Finance",
      systemPrompt: "Finance",
      capabilityIds: ["finance-domain"],
      executor: "generic",
      builtin: false,
      maxSteps: 8,
      enabled: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };

    const tools = resolveAgentTools(definition, catalog, {}, {}).map((tool) => tool.name);

    expect(tools).toEqual(expect.arrayContaining(["exec_sql"]));
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

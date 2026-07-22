import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  createCapabilityCatalog,
  isCapabilityAvailable,
} from "../../src/capabilities/index.js";
import {
  BUILTIN_CAPABILITY_DESCRIPTORS,
  createDefaultCapabilityCatalog,
  createCapabilityDeps,
  resolveCapabilities,
} from "../../src/runtime-agents/builtin-capabilities.js";
import { resolveAgentTools } from "../../src/app/composition/resolve-agent-tools.js";
import { buildDefaultRuntimeAgents } from "../../src/app/composition/bootstrap-agents.js";
import { createCronRepositoryFake } from "../helpers/configuration-tools.js";
import { createRuntimeAgentRepositoryFake } from "../helpers/fakes.js";

const CORE_ROOT = path.resolve("src/core");

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

  it("keeps runtime-agents free of app composition and policy imports", () => {
    assertNoForbiddenImports(path.resolve("src/runtime-agents"), [
      "app/composition/",
      "app/policies/",
      "app/register-defaults",
    ]);
  });

  it("rejects unavailable capability grants", () => {
    const catalog = createDefaultCapabilityCatalog();

    expect(() =>
      catalog.validateIds(["finance-domain"], {
        supabaseAvailable: false,
        obsidianVaultPath: "/tmp/vault",
        configurationReposAvailable: false,
      }),
    ).toThrow(/unavailable/i);
  });

  it("resolves finance tools for generic executor agents with finance-domain capability", () => {
    const deps = createCapabilityDeps("/tmp/vault", {
      supabaseSession: { executeSql: async () => [] } as never,
    });

    const definition = {
      id: "finance",
      name: "Finance",
      description: "Finance",
      systemPrompt: "Finance",
      promptSourceKey: "finance",
      capabilityIds: ["finance-domain"],
      executor: "generic",
      modelKey: "finance",
      builtin: false,
      maxSteps: 8,
      enabled: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };

    const unified = resolveAgentTools(definition, deps).map((tool) => tool.name);
    const capabilityOnly = resolveCapabilities(["finance-domain"], deps).map((tool) => tool.name);

    expect(unified).toEqual(expect.arrayContaining(capabilityOnly));
    expect(unified).toContain("read_skill");
  });

  it("seeds only the configuration built-in from code", () => {
    expect(buildDefaultRuntimeAgents().map((agent) => agent.id)).toEqual(["configuration"]);
  });

  it("exposes read-only system configuration separately from write", () => {
    const deps = createCapabilityDeps("/tmp/vault", {
      cronJobRepository: createCronRepositoryFake(),
      runtimeAgentRepository: createRuntimeAgentRepositoryFake(),
    });

    const readTools = resolveCapabilities(["system-config-read"], deps).map((tool) => tool.name);
    const writeTools = resolveCapabilities(["system-config-write"], deps).map((tool) => tool.name);

    expect(readTools).toContain("list_cron_jobs");
    expect(readTools).not.toContain("create_cron_job");
    expect(writeTools).toContain("create_cron_job");
  });

  it("marks configurable capabilities in the catalog", () => {
    const configurable = BUILTIN_CAPABILITY_DESCRIPTORS.filter((entry) => entry.configurable);
    expect(configurable.map((entry) => entry.id)).toEqual(
      expect.arrayContaining(["none", "obsidian-vault", "finance-domain", "system-config-read"]),
    );
    expect(isCapabilityAvailable(BUILTIN_CAPABILITY_DESCRIPTORS[1]!, { obsidianVaultPath: "/vault" })).toBe(true);
    expect(isCapabilityAvailable(BUILTIN_CAPABILITY_DESCRIPTORS[1]!, {})).toBe(false);
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

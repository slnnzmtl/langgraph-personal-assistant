import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  createCapabilityCatalog,
  createSystemAgentDefinition,
  isCapabilityAvailable,
  mergeCapabilityCatalogs,
  SYSTEM_CONFIG_READ_CAPABILITY_ID,
} from "@personal-assistant/supervisor-framework";
import { createPersonalResolveTools } from "../../src/app/composition/personal-resolve-tools.js";
import {
  createCapabilityDeps,
  createDefaultCapabilityCatalog,
  createPersonalCapabilityProviders,
  PERSONAL_CAPABILITY_DESCRIPTORS,
  resolveCapabilities,
} from "../../src/runtime-agents/builtin-capabilities.js";
import { createCronRepositoryFake } from "../helpers/configuration-tools.js";
import { createRuntimeAgentRepositoryFake } from "../helpers/fakes.js";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const RUNTIME_AGENTS_ROOT = path.join(appRoot, "src/runtime-agents");
const AGENTS_ROOT = path.join(appRoot, "src/agents");

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
): void => {
  for (const file of collectSourceFiles(rootDir)) {
    const content = readFileSync(file, "utf8");

    for (const segment of forbiddenPathSegments) {
      expect(content.includes(segment), `${file} must not import ${segment}`).toBe(false);
    }
  }
};

describe("app boundaries", () => {
  it("keeps runtime-agents free of app composition and policy imports", () => {
    assertNoForbiddenImports(RUNTIME_AGENTS_ROOT, [
      "app/composition/",
      "app/policies/",
      "app/register-defaults",
    ]);
  });

  it("keeps agents free of runtime-agents imports", () => {
    assertNoForbiddenImports(AGENTS_ROOT, ["runtime-agents/"]);
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

  it("resolves finance tools for agents with finance-domain capability", () => {
    const catalog = createDefaultCapabilityCatalog();
    const resolveTools = createPersonalResolveTools(catalog);
    const deps = createCapabilityDeps("/tmp/vault", {
      supabaseSession: { executeSql: async () => [] } as never,
      capabilityCatalog: catalog,
    });

    const definition = {
      id: "finance",
      name: "Finance",
      description: "Finance",
      systemPrompt: "Finance",
      promptSourceKey: "finance",
      capabilityIds: ["finance-domain"],
      modelKey: "finance",
      maxSteps: 8,
      enabled: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };

    const unified = resolveTools(definition, deps).map((tool) => tool.name);
    const capabilityOnly = resolveCapabilities(["finance-domain"], deps).map((tool) => tool.name);

    expect(unified).toEqual(expect.arrayContaining(capabilityOnly));
    expect(unified).toContain("read_skill");
  });

  it("seeds only the configuration built-in from code", () => {
    const agent = createSystemAgentDefinition({
      modelKey: "configuration",
    });

    expect(agent.id).toBe("configuration");
  });

  it("exposes read-only system configuration separately from write", () => {
    const catalog = mergeCapabilityCatalogs(createPersonalCapabilityProviders() as never, true);
    const deps = createCapabilityDeps("/tmp/vault", {
      cronJobRepository: createCronRepositoryFake(),
      runtimeAgentRepository: createRuntimeAgentRepositoryFake(),
      capabilityCatalog: catalog,
    });

    const readTools = resolveCapabilities(["system-config-read"], deps).map((tool) => tool.name);
    const writeTools = resolveCapabilities(["system-config"], deps).map((tool) => tool.name);

    expect(readTools).toContain("list_cron_jobs");
    expect(readTools).toContain("list_runtime_agents");
    expect(readTools).not.toContain("preview_runtime_agent");
    expect(readTools).not.toContain("create_cron_job");
    expect(writeTools).toContain("create_cron_job");
    expect(writeTools).toContain("preview_runtime_agent");
  });

  it("marks configurable capabilities in the catalog", () => {
    const configurable = [
      ...PERSONAL_CAPABILITY_DESCRIPTORS.filter((entry) => entry.configurable),
      { id: SYSTEM_CONFIG_READ_CAPABILITY_ID, configurable: true },
    ];
    expect(configurable.map((entry) => entry.id)).toEqual(
      expect.arrayContaining(["none", "obsidian-vault", "finance-domain", "system-config-read"]),
    );
    expect(isCapabilityAvailable(PERSONAL_CAPABILITY_DESCRIPTORS[1]!, { obsidianVaultPath: "/vault" })).toBe(true);
    expect(isCapabilityAvailable(PERSONAL_CAPABILITY_DESCRIPTORS[1]!, {})).toBe(false);
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

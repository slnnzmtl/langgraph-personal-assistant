import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  createCapabilityCatalog,
  createSystemAgentDefinition,
  SYSTEM_CONFIG_READ_CAPABILITY_ID,
} from "@personal-assistant/supervisor-framework";
import { createPersonalCapabilityCatalog } from "../helpers/capability-catalog.js";
import { createPersonalResolveTools } from "../../src/runtime-agents/resolve-tools.js";
import { createObsidianVault } from "../../src/integrations/obsidian.js";
import { createFetchWiseTransactions } from "../../src/integrations/wise.js";
import type { SqlSession } from "../../src/ports/sql-session.js";
import {
  createCapabilityDeps,
  createDomainCapabilityCatalog,
  resolveCapabilities,
} from "../../src/runtime-agents/capabilities.js";
import { createCronRepositoryFake } from "../helpers/configuration-tools.js";
import { createRuntimeAgentRepositoryFake } from "../helpers/fakes.js";

const mockSqlSession: SqlSession = {
  executeSql: async <T>() => [] as T,
  close: async () => {},
};

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const RUNTIME_AGENTS_ROOT = path.join(appRoot, "src/runtime-agents");
const POLICIES_ROOT = path.join(appRoot, "src/policies");
const PROMPT_LAYER_FILES = [path.join(appRoot, "src/prompts/load.ts")];

const assertFilesAvoidImports = (
  files: readonly string[],
  forbiddenPathSegments: readonly string[],
): void => {
  for (const file of files) {
    const content = readFileSync(file, "utf8");

    for (const segment of forbiddenPathSegments) {
      expect(content.includes(segment), `${file} must not import ${segment}`).toBe(false);
    }
  }
};

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
      "composition/",
      "policies/",
    ]);
  });

  it("keeps policies free of composition imports", () => {
    assertNoForbiddenImports(POLICIES_ROOT, [
      "composition/",
    ]);
  });

  it("keeps runtime-agents free of telegram process imports", () => {
    assertNoForbiddenImports(RUNTIME_AGENTS_ROOT, [
      "telegram/",
    ]);
  });

  it("keeps runtime-agents free of integration imports", () => {
    assertNoForbiddenImports(RUNTIME_AGENTS_ROOT, [
      "integrations/",
    ]);
  });

  it("keeps prompt loading free of runtime-agents imports", () => {
    assertFilesAvoidImports(PROMPT_LAYER_FILES, ["runtime-agents/"]);
  });

  it("rejects unavailable capability grants", () => {
    const catalog = createDomainCapabilityCatalog();

    expect(() =>
      catalog.validateIds(["finance-domain"], {
        obsidianVault: createObsidianVault("/tmp/vault"),
      }),
    ).toThrow(/unavailable/i);
  });

  it("resolves finance tools for agents with finance-domain capability", () => {
    const catalog = createDomainCapabilityCatalog();
    const resolveTools = createPersonalResolveTools(catalog);
    const deps = createCapabilityDeps({
      obsidianVault: createObsidianVault("/tmp/vault"),
      supabaseWriteSession: mockSqlSession,
      fetchWiseTransactions: createFetchWiseTransactions({ wiseApiToken: "token", wiseProfileId: "profile" })!,
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
    expect(capabilityOnly).toContain("fetch_wise_transactions");
  });

  it("exposes read-only finance capabilities separately from write", () => {
    const catalog = createPersonalCapabilityCatalog();
    const deps = createCapabilityDeps({
      obsidianVault: createObsidianVault("/tmp/vault"),
      supabaseReadSession: mockSqlSession,
      supabaseWriteSession: mockSqlSession,
      fetchWiseTransactions: createFetchWiseTransactions({ wiseApiToken: "token", wiseProfileId: "profile" })!,
      capabilityCatalog: catalog,
    });

    const readTools = resolveCapabilities(["finance-domain-read"], deps).map((tool) => tool.name);
    const writeTools = resolveCapabilities(["finance-domain"], deps).map((tool) => tool.name);

    expect(readTools).toEqual(expect.arrayContaining(["exec_sql", "get_categories"]));
    expect(readTools).not.toContain("fetch_wise_transactions");
    expect(writeTools).toEqual(expect.arrayContaining(["exec_sql", "get_categories", "fetch_wise_transactions"]));
  });

  it("seeds only the configuration built-in from code", () => {
    const agent = createSystemAgentDefinition({
      modelKey: "configuration",
    });

    expect(agent.id).toBe("configuration");
  });

  it("exposes read-only system configuration separately from write", () => {
    const catalog = createPersonalCapabilityCatalog();
    const deps = createCapabilityDeps({
      obsidianVault: createObsidianVault("/tmp/vault"),
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

  it("marks grantable capabilities in the catalog", () => {
    const catalog = createDomainCapabilityCatalog();
    const deps = createCapabilityDeps({
      obsidianVault: createObsidianVault("/tmp/vault"),
      supabaseReadSession: mockSqlSession,
      supabaseWriteSession: mockSqlSession,
      fetchWiseTransactions: createFetchWiseTransactions({ wiseApiToken: "token", wiseProfileId: "profile" })!,
    });

    const grantableIds = catalog.listGrantable(deps).map((entry) => entry.id);

    expect(grantableIds).toEqual(
      expect.arrayContaining(["none", "obsidian-vault", "finance-domain-read"]),
    );
    expect(grantableIds).not.toContain("finance-domain");
    expect(grantableIds).not.toContain(SYSTEM_CONFIG_READ_CAPABILITY_ID);

    const withoutVault = createCapabilityDeps({});
    expect(catalog.listAvailable(withoutVault).map((entry) => entry.id)).not.toContain("obsidian-vault");
    expect(catalog.listAvailable(deps).map((entry) => entry.id)).toContain("obsidian-vault");
  });
});

describe("capability catalog", () => {
  it("deduplicates tools resolved from multiple capability ids", () => {
    const catalog = createCapabilityCatalog([
      {
        descriptor: { id: "alpha", description: "Alpha tools" },
        isAvailable: () => true,
        resolveTools: () => [{ name: "shared_tool" }, { name: "alpha_only" }] as never,
      },
      {
        descriptor: { id: "beta", description: "Beta tools" },
        isAvailable: () => true,
        resolveTools: () => [{ name: "shared_tool" }, { name: "beta_only" }] as never,
      },
    ]);

    const tools = catalog.resolveTools(["alpha", "beta"], {});
    expect(tools.map((tool) => tool.name)).toEqual(["shared_tool", "alpha_only", "beta_only"]);
  });
});

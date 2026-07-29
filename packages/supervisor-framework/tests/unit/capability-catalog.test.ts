import { describe, expect, it } from "vitest";

import { createCapabilityCatalog } from "../../src/capabilities/catalog.js";

const createTestCatalog = () =>
  createCapabilityCatalog([
    {
      descriptor: { id: "none", description: "Prompt-only agent.", grantable: true },
      isAvailable: () => true,
      resolveTools: () => [],
    },
    {
      descriptor: { id: "vault", description: "Vault tools.", grantable: true },
      isAvailable: (deps) => Boolean(deps.vaultPath),
      resolveTools: () => [{ name: "vault_tool" }] as never,
    },
    {
      descriptor: { id: "integration", description: "Integration tools.", grantable: true },
      isAvailable: (deps) => deps.integrationReady === true,
      resolveTools: () => [{ name: "integration_tool" }] as never,
    },
    {
      descriptor: { id: "builtin", description: "Built-in tools.", grantable: false },
      isAvailable: () => true,
      resolveTools: () => [{ name: "builtin_tool" }] as never,
    },
  ]);

describe("capability catalog", () => {
  it("always includes the framework none capability", () => {
    const catalog = createCapabilityCatalog([]);

    expect(catalog.listDescriptors().map((entry) => entry.id)).toEqual(["none"]);
    expect(catalog.listGrantable({}).map((entry) => entry.id)).toEqual(["none"]);
  });

  it("does not duplicate none when the caller already registers it", () => {
    const catalog = createCapabilityCatalog([
      {
        descriptor: { id: "none", description: "Caller-supplied none.", grantable: true },
        isAvailable: () => true,
        resolveTools: () => [],
      },
      {
        descriptor: { id: "vault", description: "Vault tools.", grantable: true },
        isAvailable: () => true,
        resolveTools: () => [],
      },
    ]);

    expect(catalog.listDescriptors().map((entry) => entry.id)).toEqual(["none", "vault"]);
    expect(catalog.listDescriptors()[0]?.description).toBe("Caller-supplied none.");
  });

  it("lists, validates, and schemas grantable capabilities from the same deps", () => {
    const catalog = createTestCatalog();
    const deps = { vaultPath: "/tmp/vault", integrationReady: true };

    const grantableIds = catalog.listGrantable(deps).map((entry) => entry.id);
    expect(grantableIds).toEqual(["none", "vault", "integration"]);

    expect(catalog.formatGrantableCatalog(deps)).toContain("vault");
    expect(catalog.formatGrantableCatalog(deps)).not.toContain("builtin");

    const schema = catalog.createGrantableIdSchema(deps);
    expect(schema.options).toEqual(grantableIds);

    expect(() => catalog.validateGrantableIds(["vault", "integration"], deps)).not.toThrow();
    expect(() => catalog.validateGrantableIds(["builtin"], deps)).toThrow(/cannot be granted/i);
  });

  it("omits unavailable capabilities from grantable discovery and validation", () => {
    const catalog = createTestCatalog();
    const deps = { vaultPath: "", integrationReady: false };

    const grantableIds = catalog.listGrantable(deps).map((entry) => entry.id);
    expect(grantableIds).toEqual(["none"]);

    expect(() => catalog.validateGrantableIds(["vault"], deps)).toThrow(/unavailable/i);
    expect(() => catalog.validateGrantableIds(["integration"], deps)).toThrow(/unavailable/i);
  });

  it("resolves tools using the same availability rules as validation", () => {
    const catalog = createTestCatalog();
    const deps = { vaultPath: "/tmp/vault", integrationReady: true };

    const tools = catalog.resolveTools(["vault", "integration"], deps).map((tool) => tool.name);
    expect(tools).toEqual(["vault_tool", "integration_tool"]);

    expect(() => catalog.resolveTools(["vault"], { vaultPath: "" })).toThrow(/unavailable/i);
  });
});

// ============================================================================
// TDD BLUEPRINT: MCP FINANCE SERVER PROTOCOL SPECIFICATION
// Architecture: Model Context Protocol (MCP) Server Protocol Bounds
// Testing Target: Vitest / Jest Unit Testing Suite
// Strategy: Test server capabilities registration, tool definitions declaration,
//           and parameter mapping schemas without spinning up live sockets or active DB connections.
// ============================================================================

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { createFinanceServer } from "./src/server.js";

// ---------------------------------------------------------------------------
// Shared setup: spin up a linked in-memory client/server pair per test
// ---------------------------------------------------------------------------

async function createTestClient(dbClient?: { query: (sql: string) => Promise<unknown> }) {
  const server = createFinanceServer(dbClient);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "1.0.0" });

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  return client;
}

// ---------------------------------------------------------------------------
// SPECIFICATION 1: Server Initialization & Tool Handshake
// ---------------------------------------------------------------------------

describe("Finance MCP Server – tool registration", () => {
  it("1.1 – advertises all three finance tools on ListTools", async () => {
    const client = await createTestClient();

    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);

    expect(names).toContain("supabase_get_last_paid_date");
    expect(names).toContain("supabase_insert_transaction");
    expect(names).toContain("wise_get_transactions");
  });

  it("1.2 – wise_get_transactions declares required 'since' and 'until' string properties in its input schema", async () => {
    const client = await createTestClient();

    const { tools } = await client.listTools();
    const wiseTool = tools.find((t) => t.name === "wise_get_transactions");

    expect(wiseTool).toBeDefined();

    const schema = wiseTool!.inputSchema as {
      properties: Record<string, { type: string }>;
      required: string[];
    };

    expect(schema.properties["since"]).toMatchObject({ type: "string" });
    expect(schema.properties["until"]).toMatchObject({ type: "string" });
    expect(schema.required).toContain("since");
    expect(schema.required).toContain("until");
  });
});

// ---------------------------------------------------------------------------
// SPECIFICATION 2: Tool Routing & Payload Mapping Contracts
// ---------------------------------------------------------------------------

describe("Finance MCP Server – tool routing", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    process.env["WISE_API_TOKEN"] = "test-token";
    process.env["WISE_PROFILE_ID"] = "profile-1";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    delete process.env["WISE_API_TOKEN"];
    delete process.env["WISE_PROFILE_ID"];
  });

  it("2.1 – wise_get_transactions maps nested Wise API response to a flat MCP text block", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        activities: [
          {
            id: "1",
            details: { merchantName: "Test" },
            amount: { value: -5 },
            createdTimestamp: "2026-07-05T10:00:00Z",
          },
        ],
      }),
    });

    const client = await createTestClient();
    const response = await client.callTool({
      name: "wise_get_transactions",
      arguments: { since: "2026-07-01", until: "2026-07-07" },
    });

    expect(response.content).toHaveLength(1);
    const block = response.content[0] as { type: string; text: string };
    expect(block.type).toBe("text");

    const parsed = JSON.parse(block.text) as Array<{
      id: string;
      name: string;
      amount: number;
      paid_date: string;
    }>;

    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      id: "1",
      name: "Test",
      amount: -5,
      paid_date: "2026-07-05",
    });
  });

  it("2.2 – supabase_get_last_paid_date falls back to 30 days ago when DB returns empty rows", async () => {
    const frozenNow = new Date("2026-07-07T00:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(frozenNow);

    const mockDbClient = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    };

    const client = await createTestClient(mockDbClient);
    const response = await client.callTool({
      name: "supabase_get_last_paid_date",
      arguments: {},
    });

    const block = response.content[0] as { type: string; text: string };
    expect(block.type).toBe("text");
    // 30 days before 2026-07-07 is 2026-06-07
    expect(block.text).toBe("2026-06-07");
  });

  it("2.3 – supabase_insert_transaction accepts a transactions array and returns inserted/skipped counts", async () => {
    const mockDbClient = {
      query: vi.fn()
        // first call: duplicate check for txA → no dup
        .mockResolvedValueOnce({ rows: [] })
        // second call: insert txA → inserted record
        .mockResolvedValueOnce({ rows: [{ title: "Coffee", amount: -3.5, date: "2026-07-01", db_id: 1 }] })
        // third call: duplicate check for txB → dup found
        .mockResolvedValueOnce({ rows: [{ title: "Lunch", date: "2026-07-02" }] }),
    };

    const client = await createTestClient(mockDbClient);
    const response = await client.callTool({
      name: "supabase_insert_transaction",
      arguments: {
        transactions: [
          { title: "Coffee", amount: -3.5, currency: "GBP", date: "2026-07-01" },
          { title: "Lunch",  amount: -12.0, currency: "GBP", date: "2026-07-02" },
        ],
      },
    });

    const block = response.content[0] as { type: string; text: string };
    expect(block.type).toBe("text");

    const parsed = JSON.parse(block.text) as { inserted: number; skipped: number; results: unknown[] };
    expect(parsed.inserted).toBe(1);
    expect(parsed.skipped).toBe(1);
    expect(parsed.results).toHaveLength(2);
  });
});
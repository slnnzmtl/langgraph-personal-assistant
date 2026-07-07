import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { FinanceRepository } from "../../../nodes/finance-node/src/index.js";
import type { Transaction as WiseTransaction } from "./tools/wise.js";
import { createFinanceServer } from "./server.js";
import type { DbClient } from "./server.js";

/**
 * Extract text content from MCP tool response.
 * @throws Error if response format is unexpected
 */
function extractTextFromToolResponse(response: any, toolName: string): string {
  const textBlock = (response.content as Array<{ type: string; text?: string }>).find((c) => c.type === "text");
  if (!textBlock || textBlock.type !== "text" || !textBlock.text) {
    throw new Error(`Unexpected response format from ${toolName} tool`);
  }
  return textBlock.text;
}

/**
 * Set up the finance MCP server and create an MCP client to access its tools.
 * 
 * This function:
 * 1. Creates an in-memory transport pair (client ↔ server)
 * 2. Instantiates the finance server with the provided database client
 * 3. Connects both server and client
 * 4. Returns a FinanceRepository adapter that wraps the MCP client calls
 * 
 * The bootstrap is isolated here so the transport can later be swapped to stdio
 * or a remote server without touching the graph or finance-node logic.
 * 
 * @param dbClient - Database client for Supabase queries
 * @returns A FinanceRepository that uses MCP tool calls to the finance server
 */
export async function bootstrapFinanceRuntime(dbClient: DbClient): Promise<FinanceRepository> {
  // Create an in-memory transport pair for local server-to-client communication
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  // Instantiate the finance MCP server with the database client
  const server = createFinanceServer(dbClient);

  // Connect the server to its transport
  await server.connect(serverTransport);

  // Create and connect the MCP client
  const client = new Client(
    { name: "finance-client", version: "1.0.0" },
    {
      capabilities: {},
    }
  );
  await client.connect(clientTransport);

  // Wrap the MCP client calls into a FinanceRepository adapter
  const repository: FinanceRepository = {
    async getLastPaidDate(): Promise<string> {
      const response = await client.callTool({
        name: "supabase_get_last_paid_date",
        arguments: {},
      });

      return extractTextFromToolResponse(response, "supabase_get_last_paid_date");
    },

    async fetchTransactions(since: string, until: string): Promise<WiseTransaction[]> {
      const response = await client.callTool({
        name: "wise_get_transactions",
        arguments: { since, until },
      });

      const text = extractTextFromToolResponse(response, "wise_get_transactions");
      return JSON.parse(text);
    },

    async insertTransactions(transactions: WiseTransaction[]): Promise<{ inserted: number; skipped: number }> {
      const response = await client.callTool({
        name: "supabase_insert_transaction",
        arguments: { transactions },
      });

      const text = extractTextFromToolResponse(response, "supabase_insert_transaction");
      return JSON.parse(text);
    },
  };

  return repository;
}

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, Tool } from "@modelcontextprotocol/sdk/types.js";
import { wiseGetTransactionsHandler } from "./tools/wise.js";
import { mcpGetLastPaidDateHandler, mcpInsertTransactionHandler } from "./tools/supabase.js";

interface DbClient {
  query: (sql: string, params?: unknown[]) => Promise<unknown>;
}

export function createFinanceServer(dbClient?: DbClient): Server {
  const server = new Server(
    {
      name: "finance-server",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Define the three finance tools
  const tools: Tool[] = [
    {
      name: "supabase_get_last_paid_date",
      description: "Get the last paid date from Supabase transactions table",
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
      },
    },
    {
      name: "supabase_insert_transaction",
      description: "Insert a transaction into Supabase",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string" },
          amount: { type: "number" },
          currency: { type: "string" },
          date: { type: "string" },
        },
        required: ["title", "date"],
      },
    },
    {
      name: "wise_get_transactions",
      description: "Get transactions from Wise API",
      inputSchema: {
        type: "object",
        properties: {
          since: { type: "string" },
          until: { type: "string" },
        },
        required: ["since", "until"],
      },
    },
  ];

  // Handle ListTools requests
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools };
  });

  // Handle CallTool requests
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (name === "wise_get_transactions") {
      const transactions = await wiseGetTransactionsHandler(args as { since: string; until: string });
      const mapped = transactions.map((t: any) => ({
        id: t.id,
        name: t.details?.merchantName,
        amount: t.amount?.value,
        paid_date: t.createdTimestamp?.split("T")[0],
      }));
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(mapped),
          },
        ],
      };
    }

    if (name === "supabase_get_last_paid_date") {
      let date: string;
      if (dbClient) {
        const adapter = {
          invoke: async (sql: string) => JSON.stringify(await dbClient.query(sql)),
        };
        date = await mcpGetLastPaidDateHandler(adapter);
      } else {
        const fallback = new Date();
        fallback.setDate(fallback.getDate() - 30);
        date = fallback.toISOString().slice(0, 10);
      }
      return {
        content: [
          {
            type: "text",
            text: date,
          },
        ],
      };
    }

    if (name === "supabase_insert_transaction") {
      if (!dbClient) {
        throw new Error("Database client is required for supabase_insert_transaction");
      }
      const adapter = {
        invoke: async (sql: string, params?: unknown[]) =>
          JSON.stringify(await dbClient.query(sql, params)),
      };
      const result = await mcpInsertTransactionHandler(
        adapter,
        adapter,
        args as { title: string; amount?: number; currency?: string; date: string }
      );
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result),
          },
        ],
      };
    }

    throw new Error(`Unknown tool: ${name}`);
  });

  return server;
}

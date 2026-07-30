import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SqlSession } from "../../../../src/ports/sql-session.js";
import { createTestRuntimeAgentNode, buildNodeConfigForTest } from "../../../helpers/policy-nodes.js";
import { resolveAgentSkillModule } from "@personal-assistant/supervisor-framework";
import { createFinanceTestTools, getFinanceDomainTool } from "../../../helpers/finance-tools.js";
import { FakeLLMConnector, getRuntimeAgentFixture } from "../../../helpers/fakes.js";

const financeDefinition = getRuntimeAgentFixture("finance");
const financeSkillModule = resolveAgentSkillModule(financeDefinition);

const wiseTransactions = [
  {
    name: "Mpos Kokojimart",
    amount: "0.47",
    status: "COMPLETED",
    createdOn: "2026-07-12T16:31:37.354Z",
  },
  {
    name: "Mpos Poke Sake Wow",
    amount: "9.19",
    status: "COMPLETED",
    createdOn: "2026-07-12T15:59:05.023Z",
  },
];

const categories = [
  { id: 1, name: "Debts", note: null },
  { id: 4, name: "Food", note: null },
  { id: 33, name: "Shop", note: null },
];

describe("finance tools", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("returns Wise transactions as a single JSON array string", async () => {
    vi.stubEnv("WISE_API_TOKEN", "token");
    vi.stubEnv("WISE_PROFILE_ID", "profile");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        activities: wiseTransactions.map((transaction) => ({
          title: transaction.name,
          secondaryAmount: transaction.amount,
          status: transaction.status,
          createdOn: transaction.createdOn,
        })),
      }),
    }));

    const session: SqlSession = {
      executeSql: vi.fn(),
      close: vi.fn(),
    };
    const fetchWiseTool = getFinanceDomainTool(session, "fetch_wise_transactions");

    const result = await fetchWiseTool?.invoke({
      since: "2026-07-12T00:00:00Z",
      until: "2026-07-13T00:00:00Z",
    });

    expect(JSON.parse(String(result))).toEqual(wiseTransactions);
  });

  it("returns SQL result wrappers as a single JSON array string", async () => {
    const session: SqlSession = {
      executeSql: vi.fn().mockResolvedValue({ result: JSON.stringify(categories) }),
      close: vi.fn(),
    };
    const execSqlTool = getFinanceDomainTool(session, "exec_sql");

    const result = await execSqlTool?.invoke({ sql: "SELECT id, name, note FROM public.category;" });

    expect(JSON.parse(String(result))).toEqual(categories);
  });

  it("serializes tool failures as structured error text", async () => {
    const session: SqlSession = {
      executeSql: vi.fn().mockRejectedValue(new Error("database unavailable")),
      close: vi.fn(),
    };
    const execSqlTool = getFinanceDomainTool(session, "exec_sql");

    const result = await execSqlTool?.invoke({ sql: "SELECT 1;" });

    expect(JSON.parse(String(result))).toEqual({ error: "database unavailable" });
  });

  it("returns all expense categories with a zero-argument tool", async () => {
    const session: SqlSession = {
      executeSql: vi.fn().mockResolvedValue({ result: JSON.stringify(categories) }),
      close: vi.fn(),
    };
    const getCategoriesTool = getFinanceDomainTool(session, "get_categories");

    const result = await getCategoriesTool?.invoke({});

    expect(JSON.parse(String(result))).toEqual(categories);
  });

  it("attaches all finance tools to the agent", () => {
    const session: SqlSession = {
      executeSql: vi.fn(),
      close: vi.fn(),
    };
    const tools = createFinanceTestTools(session, financeSkillModule);

    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "exec_sql",
      "fetch_wise_transactions",
      "get_categories",
      "read_skill",
    ]);
  });


  describe("step counter", () => {
    it("resets stepCount to 1 on initial entry (last message is HumanMessage)", async () => {
      const model = new FakeLLMConnector(() => new AIMessage("done")).getModel();
      const financeNode = createTestRuntimeAgentNode(model, financeDefinition, [], buildNodeConfigForTest(financeDefinition));

    const update = await financeNode({
      agentMessages: [new HumanMessage("sync finances")],
        stepCount: 7,
      });

      expect(update.stepCount).toBe(1);
    });

    it("increments stepCount when last message is a ToolMessage (loop continuation)", async () => {
      const model = new FakeLLMConnector(() => new AIMessage("done")).getModel();
      const financeNode = createTestRuntimeAgentNode(model, financeDefinition, [], buildNodeConfigForTest(financeDefinition));

    const update = await financeNode({
      agentMessages: [
          new HumanMessage("sync finances"),
          new ToolMessage({ tool_call_id: "t1", name: "exec_sql", content: "[]" }),
        ],
        stepCount: 3,
      });

      expect(update.stepCount).toBe(4);
    });

    it("starts stepCount at 1 from zero on first loop continuation", async () => {
      const model = new FakeLLMConnector(() => new AIMessage("done")).getModel();
      const financeNode = createTestRuntimeAgentNode(model, financeDefinition, [], buildNodeConfigForTest(financeDefinition));

    const update = await financeNode({
      agentMessages: [
          new HumanMessage("sync finances"),
          new ToolMessage({ tool_call_id: "t1", name: "exec_sql", content: "[]" }),
        ],
        stepCount: 0,
      });

      expect(update.stepCount).toBe(1);
    });
  });

  describe("tool output truncation", () => {
    it("truncates exec_sql output exceeding 8000 chars and appends a notice", async () => {
      const largeRows = Array.from({ length: 500 }, (_, i) => ({
        id: i,
        name: `expense-${i}`,
        paid_date: "2026-01-01",
      }));
      const largeJson = JSON.stringify(largeRows);

      const session: SqlSession = {
        executeSql: vi.fn().mockResolvedValue(largeRows),
        close: vi.fn(),
      };
      const execSqlTool = getFinanceDomainTool(session, "exec_sql");
      const result = String(await execSqlTool?.invoke({ sql: "SELECT * FROM expenses;" }));

      expect(result.length).toBeLessThanOrEqual(8_000 + 60); // truncated + notice overhead
      expect(result).toContain("[truncated,");
      expect(result.length).toBeLessThan(largeJson.length);
    });

    it("does not truncate exec_sql output within 8000 chars", async () => {
      const session: SqlSession = {
        executeSql: vi.fn().mockResolvedValue(categories),
        close: vi.fn(),
      };
      const execSqlTool = getFinanceDomainTool(session, "exec_sql");
      const result = String(await execSqlTool?.invoke({ sql: "SELECT * FROM category;" }));

      expect(result).not.toContain("[truncated,");
      expect(JSON.parse(result)).toEqual(categories);
    });
  });
});

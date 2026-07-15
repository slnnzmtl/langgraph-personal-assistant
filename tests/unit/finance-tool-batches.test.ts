import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";

import {
  financeToolBatchBindOptions,
  meetsFinanceToolBatchRequirement,
  resolveFinanceToolBatchPlan,
} from "../../src/nodes/finance/tool-batches.js";

describe("resolveFinanceToolBatchPlan", () => {
  it("requires a parallel fetch batch after read_skill", () => {
    const plan = resolveFinanceToolBatchPlan([
      new HumanMessage("sync finances"),
      new AIMessage({
        content: "",
        tool_calls: [{ name: "read_skill", args: { name: "sync-expenses" }, id: "read-1", type: "tool_call" }],
      }),
      new ToolMessage({ name: "read_skill", tool_call_id: "read-1", content: "skill body" }),
    ]);

    expect(plan).toEqual({
      allowedFunctionNames: ["get_categories", "fetch_wise_transactions"],
      requiredCount: 2,
      instruction: expect.stringContaining("get_categories AND fetch_wise_transactions"),
    });
    expect(financeToolBatchBindOptions(plan!)).toEqual({
      tool_choice: "any",
      allowedFunctionNames: ["get_categories", "fetch_wise_transactions"],
    });
  });

  it("requires exec_sql after categories and transactions are both present", () => {
    const plan = resolveFinanceToolBatchPlan([
      new HumanMessage("sync finances"),
      new AIMessage({
        content: "",
        tool_calls: [
          { name: "get_categories", args: {}, id: "cat-1", type: "tool_call" },
          { name: "fetch_wise_transactions", args: { since: "a", until: "b" }, id: "wise-1", type: "tool_call" },
        ],
      }),
      new ToolMessage({ name: "get_categories", tool_call_id: "cat-1", content: "[]" }),
      new ToolMessage({ name: "fetch_wise_transactions", tool_call_id: "wise-1", content: "[]" }),
    ]);

    expect(plan).toEqual({
      allowedFunctionNames: ["exec_sql"],
      requiredCount: 1,
      instruction: expect.stringContaining("exec_sql"),
    });
  });

  it("does not schedule another batch after exec_sql", () => {
    const plan = resolveFinanceToolBatchPlan([
      new HumanMessage("sync finances"),
      new ToolMessage({ name: "exec_sql", tool_call_id: "sql-1", content: "[]" }),
    ]);

    expect(plan).toBeUndefined();
  });
});

describe("meetsFinanceToolBatchRequirement", () => {
  it("accepts a full parallel batch", () => {
    expect(meetsFinanceToolBatchRequirement({
      allowedFunctionNames: ["get_categories", "fetch_wise_transactions"],
      requiredCount: 2,
      instruction: "batch",
    }, 2)).toBe(true);
  });

  it("rejects a partial parallel batch", () => {
    expect(meetsFinanceToolBatchRequirement({
      allowedFunctionNames: ["get_categories", "fetch_wise_transactions"],
      requiredCount: 2,
      instruction: "batch",
    }, 1)).toBe(false);
  });
});

import { describe, expect, it } from "vitest";

import { normalizeToolOutput } from "../../src/utils/exec-sql.js";

describe("normalizeToolOutput", () => {
  it("parses a JSON array encoded in a tool result wrapper", () => {
    const value = {
      result: JSON.stringify([
        {
          name: "Mpos Kokojimart",
          amount: "0.47 USD",
          status: "COMPLETED",
          createdOn: "2026-07-12T16:31:37.354Z",
        },
      ]),
    };

    expect(normalizeToolOutput(value)).toEqual([
      {
        name: "Mpos Kokojimart",
        amount: "0.47 USD",
        status: "COMPLETED",
        createdOn: "2026-07-12T16:31:37.354Z",
      },
    ]);
  });

  it("parses a category list encoded in a tool result wrapper", () => {
    const value = {
      result: JSON.stringify([
        { id: 1, name: "Debts", note: null },
        { id: 4, name: "Food", note: null },
        { id: 33, name: "Shop", note: null },
      ]),
    };

    expect(normalizeToolOutput(value)).toEqual([
      { id: 1, name: "Debts", note: null },
      { id: 4, name: "Food", note: null },
      { id: 33, name: "Shop", note: null },
    ]);
  });

  it("unwraps rows and nested JSON strings without double encoding", () => {
    expect(normalizeToolOutput({ rows: [{ id: 1 }] })).toEqual([{ id: 1 }]);
    expect(normalizeToolOutput(JSON.stringify(JSON.stringify([{ id: 2 }])))).toEqual([{ id: 2 }]);
  });

  it("preserves plain text and extracts untrusted JSON blocks", () => {
    expect(normalizeToolOutput(" query completed ")).toBe("query completed");
    expect(normalizeToolOutput("<untrusted-data-result>\n[{\"id\":3}]\n</untrusted-data-result>")).toEqual([
      { id: 3 },
    ]);
  });
});

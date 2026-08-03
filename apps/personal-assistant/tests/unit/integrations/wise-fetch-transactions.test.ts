import { afterEach, describe, expect, it, vi } from "vitest";

import { createFetchWiseTransactions } from "../../../src/integrations/wise.js";

describe("createFetchWiseTransactions", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("normalizes date boundaries to UTC midnight ISO strings", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ activities: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const fetchWiseTransactions = createFetchWiseTransactions({
      wiseApiToken: "token",
      wiseProfileId: "profile",
    });
    expect(fetchWiseTransactions).toBeDefined();

    await fetchWiseTransactions!({
      since: "2026-07-09",
      until: "2026-07-10",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.transferwise.com/v1/profiles/profile/activities?since=2026-07-09T00:00:00Z&until=2026-07-10T00:00:00Z",
      expect.objectContaining({
        headers: { Authorization: "Bearer token" },
      }),
    );
  });

  it("returns undefined when credentials are missing", () => {
    expect(createFetchWiseTransactions({})).toBeUndefined();
    expect(createFetchWiseTransactions({ wiseApiToken: "token" })).toBeUndefined();
    expect(createFetchWiseTransactions({ wiseProfileId: "profile" })).toBeUndefined();
  });
});

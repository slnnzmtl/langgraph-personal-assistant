import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchWiseTransactions } from "./wise-client.js";

describe("fetchWiseTransactions", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("normalizes date boundaries to UTC midnight ISO strings", async () => {
    vi.stubEnv("WISE_API_TOKEN", "token");
    vi.stubEnv("WISE_PROFILE_ID", "profile");

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ activities: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await fetchWiseTransactions({
      since: "2026-07-09",
      until: "2026-07-10",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.transferwise.com/v1/profiles/profile/activities?since=2026-07-09T00:00:00Z&until=2026-07-10T00:00:00Z",
      {
        headers: { Authorization: "Bearer token" },
      }
    );
  });
});
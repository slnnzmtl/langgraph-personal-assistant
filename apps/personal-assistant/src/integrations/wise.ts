import type { AppConfig } from "../config.js";
import type {
  FetchWiseTransactions,
  WiseTransaction,
  WiseTransactionParams,
} from "../runtime-agents/finance/types.js";

export type { WiseTransaction, WiseTransactionParams } from "../runtime-agents/finance/types.js";

type WiseClient = {
  fetchActivities(since: string, until: string): Promise<Response>;
};

const createWiseClient = (
  config: Pick<AppConfig, "wiseApiToken" | "wiseProfileId">,
): WiseClient | undefined => {
  const token = config.wiseApiToken;
  const profileId = config.wiseProfileId;

  if (!token || !profileId) {
    return undefined;
  }

  return {
    fetchActivities: (since, until) =>
      fetch(`https://api.transferwise.com/v1/profiles/${profileId}/activities?since=${since}&until=${until}`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
  };
};

function formatUtcIsoWithoutMilliseconds(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function normalizeToIso8601(dateString: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
    return `${dateString}T00:00:00Z`;
  }

  const parsedDate = new Date(dateString);
  if (Number.isNaN(parsedDate.getTime())) {
    throw new Error(`Invalid date format: ${dateString}. Expected YYYY-MM-DD or ISO 8601`);
  }

  return formatUtcIsoWithoutMilliseconds(parsedDate);
}

function extractNumericAmount(amountStr: string): string {
  const match = amountStr.match(/^[\d.]+/);
  return match ? match[0] : amountStr;
}

function normalizeWiseTransaction(raw: Record<string, unknown>): WiseTransaction {
  const name = String(raw.title).replace(/<[^>]*>/g, "");
  const rawAmount = raw.secondaryAmount ? String(raw.secondaryAmount) : String(raw.primaryAmount);

  return {
    name,
    amount: extractNumericAmount(rawAmount),
    status: String(raw.status),
    createdOn: String(raw.createdOn),
  };
}

async function fetchWiseTransactionsInternal(
  params: WiseTransactionParams,
  client: WiseClient,
): Promise<WiseTransaction[]> {
  if (!params.since || !params.until) {
    throw new Error("Validation error: both 'since' and 'until' are required");
  }

  const since = normalizeToIso8601(params.since);
  const until = normalizeToIso8601(params.until);

  console.debug(`Fetching Wise transactions: since=${since}, until=${until}`);

  const response = await client.fetchActivities(since, until);

  if (!response.ok) {
    console.warn(`Wise API error: ${response.status} ${response.statusText}; returning empty list`);
    return [];
  }

  const data = await response.json() as { activities?: unknown[] };
  const activities = data.activities ?? [];

  const normalized = activities.map((activity) => normalizeWiseTransaction(activity as Record<string, unknown>));

  console.debug(`Fetched and normalized ${normalized.length} Wise transactions`);
  return normalized;
}

export const createFetchWiseTransactions = (
  config: Pick<AppConfig, "wiseApiToken" | "wiseProfileId">,
): FetchWiseTransactions | undefined => {
  const client = createWiseClient(config);
  if (!client) {
    return undefined;
  }

  return (params) => fetchWiseTransactionsInternal(params, client);
};

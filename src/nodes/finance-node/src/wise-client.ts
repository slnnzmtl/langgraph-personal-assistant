/**
 * Wise API client for fetching transactions.
 * Relocated from finance-server (no longer wrapped in MCP).
 */

/**
 * Normalized Wise transaction for LLM consumption.
 * Only includes essential fields for financial sync logic.
 */
export interface WiseTransaction {
  name: string;
  amount: string;
  status: string;
  createdOn: string;
}

function normalizeToIso8601(dateString: string): string {
  // If already in ISO format with time, return as-is
  if (dateString.includes("T")) {
    return dateString;
  }
  // If just a date (YYYY-MM-DD), add start of day
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
    return `${dateString}T00:00:00Z`;
  }
  throw new Error(`Invalid date format: ${dateString}. Expected YYYY-MM-DD or ISO 8601`);
}

/**
 * Normalize raw Wise API response to clean transaction objects.
 * Extracts only: name, amount, status, createdOn
 */
function normalizeWiseTransaction(raw: Record<string, unknown>): WiseTransaction {
  let name = String(raw.title).replace(/<[^>]*>/g, ""); // Remove HTML tags

  console.log({...raw})
  
  return {
    name,
    amount: raw.secondaryAmount ? String(raw.secondaryAmount) : String(raw.primaryAmount),
    status: String(raw.status),
    createdOn: String(raw.createdOn)
  };
}

export async function fetchWiseTransactions(params: { since: string; until: string }): Promise<WiseTransaction[]> {
  if (!params.since || !params.until) {
    throw new Error("Validation error: both 'since' and 'until' are required");
  }

  const token = process.env["WISE_API_TOKEN"];
  const profileId = process.env["WISE_PROFILE_ID"];

  if (!token || !profileId) {
    console.warn("Wise API credentials missing; returning empty transaction list");
    return [];
  }

  // Normalize dates to ISO 8601 format
  const since = normalizeToIso8601(params.since);
  const until = normalizeToIso8601(params.until);

  console.debug(`Fetching Wise transactions: since=${since}, until=${until}`);

  const url = `https://api.transferwise.com/v1/profiles/${profileId}/activities?since=${since}&until=${until}`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    console.warn(`Wise API error: ${response.status} ${response.statusText}; returning empty list`);
    return [];
  }

  const data = await response.json() as { activities?: unknown[] };
  const activities = data.activities ?? [];

  const normalized = activities.map(activity => normalizeWiseTransaction(activity as Record<string, unknown>));
  
  console.debug(`Fetched and normalized ${normalized.length} Wise transactions`);
  return normalized;
}

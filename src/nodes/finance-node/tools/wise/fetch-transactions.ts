/**
 * Wise API client for fetching transactions.
 * Relocated from finance-server (no longer wrapped in MCP).
 */

import type { WiseClient, WiseTransaction, WiseTransactionParams } from "./types.js";

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

/**
 * Normalize raw Wise API response to clean transaction objects.
 * Extracts only: name, amount, status, createdOn
 */
function normalizeWiseTransaction(raw: Record<string, unknown>): WiseTransaction {
  let name = String(raw.title).replace(/<[^>]*>/g, ""); // Remove HTML tags

  return {
    name,
    amount: raw.secondaryAmount ? String(raw.secondaryAmount) : String(raw.primaryAmount),
    status: String(raw.status),
    createdOn: String(raw.createdOn)
  };
}

export async function fetchWiseTransactions(
  params: WiseTransactionParams,
  client: WiseClient
): Promise<WiseTransaction[]> {
  if (!params.since || !params.until) {
    throw new Error("Validation error: both 'since' and 'until' are required");
  }

  // Normalize dates to ISO 8601 format
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

  const normalized = activities.map(activity => normalizeWiseTransaction(activity as Record<string, unknown>));
  
  console.debug(`Fetched and normalized ${normalized.length} Wise transactions`);
  return normalized;
}

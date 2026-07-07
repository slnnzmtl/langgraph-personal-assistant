// Implementation of Wise API calls

export interface Transaction {
  id: string;
  title: string;
  amount: number;
  currency: string;
  date: string;
  [key: string]: unknown;
}

export async function wiseGetTransactionsHandler(params: { since: string; until: string }): Promise<Transaction[]> {
  if (!params.until) {
    throw new Error("Validation error: 'until' is required");
  }

  const token = process.env["WISE_API_TOKEN"];
  const profileId = process.env["WISE_PROFILE_ID"];

  if (!token || !profileId) {
    console.warn("Wise API credentials missing; returning empty transaction list");
    return [];
  }

  const url = `https://api.transferwise.com/v1/profiles/${profileId}/activities?since=${params.since}&until=${params.until}`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    console.warn(`Wise API error: ${response.status} ${response.statusText}; returning empty list`);
    return [];
  }

  const data = await response.json() as { activities?: Transaction[] };
  return data.activities ?? [];
}
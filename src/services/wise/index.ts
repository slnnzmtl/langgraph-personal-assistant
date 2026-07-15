import { createWiseClient } from "./client.js";
import { fetchWiseTransactions as fetchTransactions } from "./fetch-transactions.js";
import type { WiseTransaction, WiseTransactionParams } from "./types.js";

export async function fetchWiseTransactions(params: WiseTransactionParams): Promise<WiseTransaction[]> {
	const client = createWiseClient();

	if (!client) {
		console.warn("Wise API credentials missing; returning empty transaction list");
		return [];
	}

	return fetchTransactions(params, client);
}

export type { WiseClient, WiseTransaction, WiseTransactionParams } from "./types.js";
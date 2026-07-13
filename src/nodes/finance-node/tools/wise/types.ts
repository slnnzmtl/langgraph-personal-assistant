export interface WiseTransaction {
	name: string;
	amount: string;
	status: string;
	createdOn: string;
}

export interface WiseClient {
	fetchActivities(since: string, until: string): Promise<Response>;
}

export interface WiseTransactionParams {
	since: string;
	until: string;
}
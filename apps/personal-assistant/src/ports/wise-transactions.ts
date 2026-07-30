export type FetchWiseTransactions = (params: {
  since: string;
  until: string;
}) => Promise<unknown>;

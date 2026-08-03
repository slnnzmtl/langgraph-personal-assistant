export type WiseTransaction = {
  name: string;
  amount: string;
  status: string;
  createdOn: string;
};

export type WiseTransactionParams = {
  since: string;
  until: string;
};

export type FetchWiseTransactions = (params: WiseTransactionParams) => Promise<WiseTransaction[]>;

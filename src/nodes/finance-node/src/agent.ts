import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { mcpGetLastPaidDateHandler, mcpInsertTransactionHandler } from "../../../packages/finance-server/src/tools/supabase.js";
import { wiseGetTransactionsHandler } from "../../../packages/finance-server/src/tools/wise.js";

export const createFinanceNode = (
  llmConnector: { getModel(): BaseChatModel },
  config: { wiseToken: string, wiseProfileId: string }
) => {
  const model = llmConnector.getModel();

  
};

export interface SyncMetrics {
  processed: number;
  skipped: number;
  status: "success" | "failed";
}

export async function financeSyncPipelineHandler(): Promise<SyncMetrics> {
  const since = await mcpGetLastPaidDateHandler({ invoke: async () => "" } as never);
  const until = new Date().toISOString().slice(0, 10);

  const transactions = await wiseGetTransactionsHandler({ since, until });

  let processed = 0;
  let skipped = 0;

  for (const txn of transactions) {
    const result = await mcpInsertTransactionHandler(
      { invoke: async () => "" } as never,
      { invoke: async () => "" } as never,
      txn
    );
    if (typeof result === "object" && "status" in result && result.status === "skipped") {
      skipped++;
    } else {
      processed++;
    }
  }

  return { processed, skipped, status: "success" };
}
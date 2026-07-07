interface McpTool {
  invoke(query: string, params?: unknown[]): Promise<string>;
}

export interface Transaction {
  id?: string;
  title: string;
  amount?: number;
  currency?: string;
  date: string;
  category?: string;
  paid?: boolean;
  note?: string;
  [key: string]: unknown;
}

export async function mcpGetLastPaidDateHandler(mcpTool: McpTool): Promise<string> {
  const raw = await mcpTool.invoke("SELECT paid_date FROM public.expense ORDER BY paid_date DESC LIMIT 1");
  const data = JSON.parse(raw) as { rows: Array<{ paid_date: string }> };

  if (data.rows.length > 0) {
    return data.rows[0]!.paid_date;
  }

  const fallback = new Date();
  fallback.setDate(fallback.getDate() - 30);
  return fallback.toISOString().slice(0, 10);
}

export async function mcpInsertTransactionHandler(
  readTool: McpTool,
  insertTool: McpTool,
  transaction: Transaction
): Promise<Transaction | { status: string; message: string }> {
  const checkRaw = await readTool.invoke(
    "SELECT * FROM public.expense WHERE name = $1 AND paid_date = $2 LIMIT 1",
    [transaction.title, transaction.date]
  );
  const checkData = JSON.parse(checkRaw) as { rows: Transaction[] };

  if (checkData.rows.length > 0) {
    return { status: "skipped", message: "Duplicate transaction detected." };
  }

  const insertRaw = await insertTool.invoke(
    "INSERT INTO public.expense (name, amount, category, paid_date, paid, note) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *",
    [
      transaction.title,
      transaction.amount ?? null,
      transaction.category ?? null,
      transaction.date,
      transaction.paid ?? null,
      transaction.note ?? null,
    ]
  );
  const insertData = JSON.parse(insertRaw) as { rows: [Transaction] };
  return insertData.rows[0]!;
}

export interface BatchInsertResult {
  inserted: number;
  skipped: number;
  results: Array<Transaction | { status: string; message: string }>;
}

export async function mcpInsertTransactionsHandler(
  readTool: McpTool,
  insertTool: McpTool,
  transactions: Transaction[]
): Promise<BatchInsertResult> {
  const results: Array<Transaction | { status: string; message: string }> = [];
  let inserted = 0;
  let skipped = 0;

  // Deduplicate within the batch by (title, date)
  const seen = new Set<string>();
  const deduped = transactions.filter((t) => {
    const key = `${t.title}__${t.date}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  for (const transaction of deduped) {
    const result = await mcpInsertTransactionHandler(readTool, insertTool, transaction);
    results.push(result);
    if ("status" in result && result.status === "skipped") {
      skipped++;
    } else {
      inserted++;
    }
  }

  return { inserted, skipped, results };
}

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

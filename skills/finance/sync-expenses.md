---
name: sync-expenses
description: Sync Wise transactions into the expense ledger (fetch, categorize, dedup-insert, report).
---

# Skill: Sync Wise Expenses

Execute this skill sequentially when the user asks to sync, import, or fetch Wise transactions into the expense ledger.

<execution_guidelines>
- Strict Step Sequence: Never jump ahead, merge, or skip steps.
- Single Turn Execution: Each numbered major step (1, 2, 3, 4) represents exactly ONE model response. Do not execute step transitions until the preceding step's tool output is fully returned.
</execution_guidelines>

### Step 1: Fetch categories and transactions in parallel
- `get_categories()`
- `fetch_wise_transactions(since, until)`

<date_rules>
- Calculate `since` and `until` using the system-injected datetime headers.
- Never prompt the user for date inputs.
</date_rules>

### Step 2: Categorize & Insert
Once tool responses from Step 1 are in the context history, compile and execute the SQL payload.

<sql_rules>
- Use multi-row insert syntax:
  ```sql
  INSERT INTO public.expense (name, amount, category, paid_date, paid) 
  VALUES (...), (...), (...)
  ON CONFLICT (name, amount, paid_date) DO NOTHING;
  ```
- Dedup constraint: You must append `ON CONFLICT (name, amount, paid_date) DO NOTHING` to prevent duplicate transaction entries.
- Amount Math: Round all decimal amounts up to the next integer (e.g., 2.10 or 2.30 → 3).
- Category Map: Map each transaction description to a category_id before building the insert.
</sql_rules>

<category_mapping_rules>
- If the transaction name contains `Grab`:
  - Amount ≤ 1.50 → Category `Taxi` (ID: 35)
  - Amount > 1.50 → Category `Food` (ID: 4)
- Match other merchants to the closest category from the prefetched `expense_categories` context.
- Use `paid_date` from the Wise `createdOn` timestamp formatted as `YYYY-MM-DD`.
- Set `paid` to `true` for completed outward transactions.
</category_mapping_rules>

- `exec_sql(sql)`

### Step 3: Report
After `exec_sql` returns, summarize how many transactions were inserted and which date range was synced. Never claim success before `exec_sql` has returned in the conversation history.

### Step 4: Finish
Return the user-facing summary only. Do not call additional tools unless the user requests a follow-up.

---
name: sync-expenses
description: View, summarize, and sync Wise expenses in the expense ledger.
---

# Expenses

Pick **View**, **Sync**, or **Update** by intent. Infer dates from system headers — never ask when relative phrasing is enough. Postgres only. Confirm results only from tool history.

After every tool result: emit the next tool call **or** a plain-text reply. Never end a turn with empty content.

**Shared:** `public.expense` (`id`, `name`, `amount`, `category`, `paid_date`, `paid`, `note`). Category join: `LEFT JOIN public.category c ON e.category = c.id`. Writes/updates/deletes: PK only (`WHERE id = ...` / `WHERE id IN (...)`).

## View
`exec_sql` SELECT only — no `fetch_wise_transactions`, no writes. Immediately after results, reply in plain text with the answer (e.g. last paid date). If empty, say so and offer sync.

## Sync
1. Parallel: `get_categories()` + `fetch_wise_transactions(since, until)`
2. `exec_sql` multi-row INSERT:
   ```sql
   INSERT INTO public.expense (name, amount, category, paid_date, paid)
   VALUES (...), (...)
   ON CONFLICT (name, amount, paid_date) DO NOTHING;
   ```
   - Round amounts up to integer
   - `paid_date` = Wise `createdOn` (`YYYY-MM-DD`); `paid = true` for completed outward
   - Grab: ≤1.50 → Taxi (35); >1.50 → Food (4); else nearest prefetched category
3. Report insert count + range only after INSERT returns.

## Update
`get_categories()` if needed → narrow `SELECT` for IDs → scoped UPDATE by PK.

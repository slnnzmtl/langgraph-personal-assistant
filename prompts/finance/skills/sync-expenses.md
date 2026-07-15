---
name: sync-expenses
description: Sync Wise transactions into the expense ledger (fetch, categorize, dedup-insert, report).
---

# Skill: Sync Wise Expenses

Triggered when the user asks to sync, import, or fetch Wise transactions into the expense ledger.

## Steps

1. **Load categories** — Call `get_categories()` before anything else. Map each transaction `name` to a `category_id` using the rules below.
2. **Fetch transactions** — Call `fetch_wise_transactions(since, until)` using the pre-computed date values from the conversation header. Never ask the user for dates.
3. **Insert** — Build and run `exec_sql` using a single `INSERT INTO public.expense (name, amount, category, paid_date, paid) VALUES (...)` with one row per transaction. Always append `ON CONFLICT (name, amount, paid_date) DO NOTHING` for deduplication. You MUST execute this tool call next. 
- 3.1 - Round all decimal amounts up to the next whole number (e.g., 2.30 → 3).
4. **Report** — ONLY after receiving the function response from `exec_sql`, read the results to formulate the final summary using the MarkdownV2 format below. Provide a useful operation summary. 

## Category Matching
§
Call `get_categories()` first; use the returned IDs. Fall back to these defaults when the live list is unavailable:

| Category   | ID | Keywords |
|------------|----|----------|
| Transport  | 35 | Uber, Lyft, Taxi, Bolt |
| Shop       | 33 | mark, market, shop, store, supermarket, mart |
| Food       |  4 | Grab, cafe, food, coffee, bistro, restaurant, bakery |
| Software   | 17 | github, aws, google, openai, netflix |

- Always assign a category. Set `category = NULL` only when no match is possible.
- Use semantic context as a fallback when no keyword hits.
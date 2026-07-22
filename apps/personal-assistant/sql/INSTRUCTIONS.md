# Step-by-Step Instructions to Fix the exec_sql Error

## The Problem
The error `"there is no parameter $1"` occurs because the `exec_sql` function either:
1. Doesn't exist yet, OR
2. Is running an old/cached version

The error showing `SELECT jsonb_agg(t)` (without `COALESCE` and `row_to_json`) confirms you're running an old version.

## Solution - Follow These Steps EXACTLY

### Step 1: Drop the Old Function (if it exists)
In Supabase SQL Editor, run:

```sql
DROP FUNCTION IF EXISTS exec_sql(TEXT, JSONB);
```

### Step 2: Create the New Function
Copy the **ENTIRE** contents of `setup_exec_sql.sql` and run it in Supabase SQL Editor.

Make sure you see:
```
Success. No rows returned
```

### Step 3: Verify the Function Was Created
Run this verification query:

```sql
SELECT 
  proname as function_name,
  prosrc LIKE '%quote_literal%' as uses_quote_literal,
  prosrc LIKE '%RAISE NOTICE%' as has_debug_logging
FROM pg_proc 
WHERE proname = 'exec_sql';
```

**Expected result:**
- `function_name`: exec_sql
- `uses_quote_literal`: true
- `has_debug_logging`: true

If you don't see `true` for both columns, the function wasn't updated correctly.

### Step 4: Test the Function
Run this test query:

```sql
SELECT exec_sql(
  'SELECT COUNT(*) as total FROM expense', 
  '[]'::jsonb
);
```

**Expected result:** A JSONB array with one row containing the count.

### Step 5: Test with Parameters
```sql
SELECT exec_sql(
  'SELECT * FROM expense WHERE paid_date = $1 LIMIT 5', 
  '["2026-07-07"]'::jsonb
);
```

**Expected result:** A JSONB array with matching expense records (or empty array if none found).

### Step 6: Check Logs for Debug Output
Go to: **Supabase Dashboard → Logs → Postgres Logs**

You should see NOTICE messages like:
```
Original query: SELECT * FROM expense WHERE paid_date = $1 LIMIT 5
Prepared query: SELECT * FROM expense WHERE paid_date = '2026-07-07' LIMIT 5
Parameters: ["2026-07-07"]
```

This confirms the parameter replacement is working.

## If It Still Fails

1. **Clear your browser cache** and refresh Supabase dashboard
2. **Disconnect and reconnect** your Supabase client
3. **Check you have the correct permissions:**
   ```sql
   GRANT EXECUTE ON FUNCTION exec_sql(TEXT, JSONB) TO service_role;
   ```

## Alternative: Direct Supabase Client Approach

If the RPC function continues to cause issues, we can refactor the code to use direct Supabase queries instead. This would bypass the RPC entirely but requires code changes. Let me know if you'd like this alternative.

# Supabase Setup Guide

## Required Database Function: `exec_sql`

The finance sync pipeline requires a custom RPC function in your Supabase database to execute parameterized SQL queries.

### Setup Steps

⚠️ **IMPORTANT:** If you previously created this function, you MUST drop it first to ensure the new version is installed.

See [`sql/INSTRUCTIONS.md`](../sql/INSTRUCTIONS.md) for detailed step-by-step setup instructions.

**Quick Setup:**

1. **Drop existing function** (if any):
   ```sql
   DROP FUNCTION IF EXISTS exec_sql(TEXT, JSONB);
   ```

2. **Create the new function:**
   - Copy the contents of [`sql/setup_exec_sql.sql`](../sql/setup_exec_sql.sql)
   - Paste into Supabase SQL Editor
   - Click "Run"

3. **Verify installation:**
   ```sql
   SELECT 
     proname,
     prosrc LIKE '%quote_literal%' as correct_version
   FROM pg_proc 
   WHERE proname = 'exec_sql';
   ```
   
   Expected: `correct_version` should be `true`

4. **Test the function:**
   ```sql
   SELECT exec_sql('SELECT COUNT(*) as total FROM expense', '[]'::jsonb);
   ```

### Function Signature

```sql
exec_sql(sql_query TEXT, sql_params JSONB DEFAULT '[]'::JSONB) RETURNS JSONB
```

**Parameters:**
- `sql_query`: SQL query string with `$1`, `$2`, etc. placeholders
- `sql_params`: JSONB array of parameter values (e.g., `'["value1", "value2"]'::jsonb`)

**Returns:**
- JSONB array of result rows
- Empty array `[]` if no results
- Error object if query fails

### Security Notes

- The function uses `SECURITY DEFINER` to run with elevated privileges
- `search_path` is locked to `public` schema to prevent injection attacks
- Maximum 6 parameters supported (covers all current use cases)
- Authenticated and service_role users have execute permissions

### Troubleshooting

**Error: "there is no parameter $1"**
- The `exec_sql` function is missing or not accessible
- Re-run the setup script
- Check user permissions

**Error: "function exec_sql does not exist"**
- Function wasn't created successfully
- Verify you ran the script in the correct database
- Check for syntax errors in the SQL editor

**Error: "Too many parameters"**
- Query uses more than 6 parameters
- Refactor your query or extend the function's CASE statement

## Environment Variables

The finance MCP server requires:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
WISE_API_TOKEN=your-wise-token
WISE_PROFILE_ID=your-wise-profile-id
```

## Database Schema

The finance sync pipeline expects these tables:

```sql
-- Expense tracking table
CREATE TABLE public.expense (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  amount INTEGER,
  category TEXT,
  paid_date DATE NOT NULL,
  paid BOOLEAN DEFAULT true,
  note TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Category lookup table (optional, for categorization)
CREATE TABLE public.category (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL
);
```

> **Note:** The actual schema may have additional columns. Refer to your Supabase schema for the complete structure.

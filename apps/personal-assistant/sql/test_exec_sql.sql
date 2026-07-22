-- Test script for exec_sql function
-- Run this AFTER creating the exec_sql function

-- Test 1: Query with no parameters
SELECT 'Test 1: No parameters' as test_name;
SELECT exec_sql(
  'SELECT paid_date FROM expense ORDER BY paid_date DESC LIMIT 1', 
  '[]'::jsonb
) as result;

-- Test 2: Query with parameters
SELECT 'Test 2: With parameters' as test_name;
SELECT exec_sql(
  'SELECT * FROM expense WHERE name = $1 AND paid_date = $2 LIMIT 1', 
  '["Coffee", "2026-07-07"]'::jsonb
) as result;

-- Test 3: INSERT query with RETURNING
SELECT 'Test 3: INSERT with RETURNING' as test_name;
SELECT exec_sql(
  'INSERT INTO expense (name, amount, category, paid_date, paid) VALUES ($1, $2, $3, $4, $5) RETURNING *',
  '["Test Transaction", 100, "Food", "2026-07-08", true]'::jsonb
) as result;

-- Test 4: Verify the function exists and is the correct version
SELECT 'Test 4: Function metadata' as test_name;
SELECT 
  proname as function_name,
  prosrc LIKE '%RAISE NOTICE%' as has_debug_logging,
  prosrc LIKE '%quote_literal%' as uses_quote_literal
FROM pg_proc 
WHERE proname = 'exec_sql';

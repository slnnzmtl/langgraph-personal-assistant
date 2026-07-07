-- Supabase RPC function for executing parameterized SQL queries
-- Required by: src/packages/finance-server/src/supabase-adapter.ts

-- This function allows the finance MCP server to execute parameterized queries
-- with proper parameter substitution and JSON result formatting.

CREATE OR REPLACE FUNCTION exec_sql(sql_query TEXT, sql_params JSONB DEFAULT '[]'::JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER  -- Run with definer privileges (be careful with security)
SET search_path = public  -- Prevent search_path injection
AS $$
DECLARE
  result JSONB;
  param_count INTEGER;
  prepared_query TEXT;
  i INTEGER;
BEGIN
  -- Handle NULL or missing params
  IF sql_params IS NULL THEN
    sql_params := '[]'::JSONB;
  END IF;
  
  param_count := jsonb_array_length(sql_params);
  
  -- Build the query with parameter substitution using quote_literal
  prepared_query := sql_query;
  
  -- Replace $1, $2, etc. with actual quoted values
  FOR i IN 1..param_count LOOP
    prepared_query := replace(
      prepared_query, 
      '$' || i::text, 
      quote_literal(sql_params->>(i-1))
    );
  END LOOP;
  
  -- Debug: Log the prepared query
  RAISE NOTICE 'Original query: %', sql_query;
  RAISE NOTICE 'Prepared query: %', prepared_query;
  RAISE NOTICE 'Parameters: %', sql_params;
  
  -- Wrap in aggregation and execute
  EXECUTE format(
    'SELECT COALESCE(jsonb_agg(row_to_json(t)), ''[]''::jsonb) FROM (%s) t',
    prepared_query
  ) INTO result;
  
  RETURN result;
  
EXCEPTION
  WHEN OTHERS THEN
    -- Log and return error details
    RAISE WARNING 'exec_sql error: % (SQLSTATE: %) | Query: % | Params: %', SQLERRM, SQLSTATE, sql_query, sql_params;
    RETURN jsonb_build_object(
      'error', SQLERRM,
      'detail', SQLSTATE,
      'query', sql_query,
      'params', sql_params
    );
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION exec_sql(TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION exec_sql(TEXT, JSONB) TO service_role;

-- Example usage:
-- SELECT exec_sql('SELECT * FROM expense WHERE name = $1 AND paid_date = $2', '["Coffee", "2026-07-07"]'::jsonb);
-- SELECT exec_sql('SELECT paid_date FROM expense ORDER BY paid_date DESC LIMIT 1', '[]'::jsonb);

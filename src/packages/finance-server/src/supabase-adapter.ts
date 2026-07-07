import { createClient } from "@supabase/supabase-js";

interface DbClient {
  query: (sql: string, params?: unknown[]) => Promise<unknown>;
}

export function createSupabaseDbClient(
  supabaseUrl: string,
  supabaseServiceRoleKey: string,
): DbClient {
  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false } // Best practice for server environments
  });

  return {
    async query(sql: string, params?: unknown[]): Promise<unknown> {
      // 1. Post to the RPC we created in step 1
      const { data, error } = await supabase.rpc("exec_sql", {
        sql_query: sql,
        // If your SQL has placeholder params, map or sanitize them here
        sql_params: params || [], 
      });

      if (error) {
        throw new Error(`Supabase query error: ${error.message}`);
      }

      // 2. Align data output structures to match the finance-server { rows: [...] } contract
      if (Array.isArray(data)) {
        return { rows: data };
      }
      
      // If the function returns an aggregated JSONB array or an object
      if (data && typeof data === 'object' && 'rows' in data) {
         return data;
      }

      return { rows: data ? [data] : [] };
    },
  };
}
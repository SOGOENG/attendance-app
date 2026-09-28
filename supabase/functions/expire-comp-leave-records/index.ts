import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createHandler } from "./handler.ts";

Deno.serve(createHandler({
  secret: () => Deno.env.get("COMP_LEAVE_EXPIRATION_CRON_SECRET"),
  expire: async () => {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) throw new Error("Missing Supabase configuration");
    const supabase = createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await supabase.rpc("expire_comp_leave_records_automated");
    if (error) throw error;
    return data || [];
  },
}));

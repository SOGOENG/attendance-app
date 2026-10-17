import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";
import { createReceiptHandler } from "./handler.mjs";
const url = Deno.env.get("SUPABASE_URL");
const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
if (!url || !key) throw new Error("Missing Supabase server configuration");
Deno.serve(createReceiptHandler(createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
})));

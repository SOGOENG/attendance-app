// Based on the production source supplied on 2026-10-22.
import { createClient } from "npm:@supabase/supabase-js@2.49.8";
import { createHandler } from "./safe-registration-handler.mjs";
// DB protocol-2 rollout gate defaults OFF. Deploy only with compatible main UI.
Deno.serve(createHandler({ createClient, env: (key: string) => Deno.env.get(key) }));

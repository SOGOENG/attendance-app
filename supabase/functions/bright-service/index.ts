// Based on the production source supplied on 2026-10-22.
import { createClient } from "npm:@supabase/supabase-js@2";
import { createHandler } from "./paused-handler.mjs";
// Do not enable until orphan-Auth access and recovery have been reviewed.
Deno.serve(createHandler({ createClient, env: (key: string) => Deno.env.get(key) }));

import { createClient } from "@supabase/supabase-js";
import type { Config } from "../config.ts";

export function createDb(config: Config) { return createClient(config.env.SUPABASE_URL, config.env.SUPABASE_SECRET_KEY, { auth: { autoRefreshToken: false, persistSession: false } }); }
export type Db = ReturnType<typeof createDb>;

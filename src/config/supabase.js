import { createClient } from "@supabase/supabase-js";

let client = null;

export function getSupabase() {
  if (client) return client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Supabase credentials not found. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env"
    );
  }

  client = createClient(url, key, {
    auth: { persistSession: false },
  });

  return client;
}

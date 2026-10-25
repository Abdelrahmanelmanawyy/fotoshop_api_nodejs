import { getSupabase } from "../../config/supabase.js";

/**
 * Fail fast with 503 when the Supabase client cannot be created (missing env),
 * instead of every route repeating the same guard. Details go to the log only.
 */
export function requireSupabase(req, res, next) {
  try {
    getSupabase();
    next();
  } catch (err) {
    console.error(`[API] Supabase unavailable for ${req.method} ${req.originalUrl}: ${err.message}`);
    res.status(503).json({ error: "database_unavailable" });
  }
}

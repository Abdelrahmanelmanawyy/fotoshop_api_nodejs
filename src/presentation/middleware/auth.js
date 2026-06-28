import { getSupabase } from "../../config/supabase.js";

/**
 * Supabase JWT authentication middleware.
 *
 * Verifies the `Authorization: Bearer <access_token>` against Supabase Auth and
 * attaches `req.user = { id, email }`.
 *
 * Rollout safety: enforcement is gated by REQUIRE_AUTH so the backend can ship
 * BEFORE the mobile/web clients start sending tokens, then be flipped on.
 *   • REQUIRE_AUTH !== '1' (soft): verify the token if present (attach req.user),
 *     but allow the request through when it's missing/invalid — logs a warning.
 *   • REQUIRE_AUTH === '1' (hard): reject unauthenticated/invalid with 401.
 *
 * Flip REQUIRE_AUTH=1 only after the clients that call these routes are deployed
 * with the Authorization header (see PRODUCTION_READINESS_PLAN §2.1 / §8).
 */
function authRequired() {
  return process.env.REQUIRE_AUTH === "1";
}

function extractBearer(req) {
  const header = req.headers.authorization || req.headers.Authorization || "";
  const match = /^Bearer\s+(.+)$/i.exec(String(header).trim());
  return match ? match[1].trim() : null;
}

export async function authenticate(req, res, next) {
  const token = extractBearer(req);

  if (!token) {
    if (authRequired()) {
      return res.status(401).json({ error: "unauthorized", message: "Missing bearer token" });
    }
    console.warn(`[Auth] No token on ${req.method} ${req.originalUrl} (soft mode — allowing)`);
    return next();
  }

  try {
    const { data, error } = await getSupabase().auth.getUser(token);
    if (error || !data?.user) {
      if (authRequired()) {
        return res.status(401).json({ error: "unauthorized", message: "Invalid or expired token" });
      }
      console.warn(`[Auth] Invalid token on ${req.method} ${req.originalUrl} (soft mode — allowing)`);
      return next();
    }
    req.user = { id: data.user.id, email: data.user.email };
    return next();
  } catch (err) {
    if (authRequired()) {
      return res.status(401).json({ error: "unauthorized", message: "Auth verification failed" });
    }
    console.warn(`[Auth] Verification error on ${req.originalUrl}: ${err.message} (soft mode — allowing)`);
    return next();
  }
}

/**
 * Ownership guard factory: ensures the authenticated user owns the resource.
 * `resolveOwnerId(req)` returns the resource's owner uid (may be async).
 * In soft mode with no req.user, the check is skipped (paired with authenticate).
 */
export function requireOwnership(resolveOwnerId) {
  return async function ownershipGuard(req, res, next) {
    if (!req.user) {
      // Soft mode, unauthenticated — authenticate() already decided to allow.
      return next();
    }
    try {
      const ownerId = await resolveOwnerId(req);
      if (ownerId == null) {
        return res.status(404).json({ error: "not_found" });
      }
      if (ownerId !== req.user.id) {
        return res.status(403).json({ error: "forbidden", message: "Not your resource" });
      }
      return next();
    } catch (err) {
      return res.status(500).json({ error: "ownership_check_failed", message: err.message });
    }
  };
}

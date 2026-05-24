/**
 * Shared validation for API input (used from presentation layer).
 * Keep rules in one place — Section A: no duplication across routes.
 */

const ORDER_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * @param {unknown} value
 * @returns {string|null} trimmed id or null if invalid
 */
export function sanitizeOrderId(value) {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  if (!s || !ORDER_ID_PATTERN.test(s)) return null;
  return s;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
export function sanitizeCollectionName(value) {
  if (value === undefined || value === null) return "orders";
  const s = String(value).trim();
  if (!s || !/^[a-zA-Z0-9_-]{1,64}$/.test(s)) return "orders";
  return s;
}

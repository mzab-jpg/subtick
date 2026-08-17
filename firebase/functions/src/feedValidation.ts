// ============================================================
// Tangent — Feed Validation Helpers
// Pure helpers shared by protected feed administration and regression tests.
// ============================================================

export function normalizeFeedUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error('Feed URL must be a valid HTTPS URL.');
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('Feed URL must use HTTPS.');
  }
  parsed.hash = '';
  if (parsed.pathname.length > 1) parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  return parsed.toString();
}

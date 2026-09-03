// ============================================================
// Tangent — Canonical Category List (server side)
// ============================================================
// Single source of truth for the SERVER's known categories.
//
// CONTRACT: this list must stay in sync with the client copy in
// `src/utils/constants.ts` (`CATEGORIES`). A regression test enforces the
// contract: `npm run test:category-contract` (scripts/test-category-contract.js).
// If the two lists drift, that test fails loudly instead of silently
// mis-ranking or mis-filtering a category.
//
// FUTURE (when the Control Dashboard is reworked): the best long-term fix is
// to move this list into the `system/scoringConfig` Firestore document and have
// the client fetch it, so there is exactly ONE category list shared by the
// phone and the server. This module stays the canonical server copy until then.
// ============================================================

export const DASHBOARD_CATEGORIES_ARRAY: string[] = [
  'Politics', 'Business', 'Finance', 'Technology', 'Science',
  'History', 'Culture', 'Lifestyle', 'Entertainment',
];

export const DASHBOARD_CATEGORIES: Set<string> = new Set(DASHBOARD_CATEGORIES_ARRAY);
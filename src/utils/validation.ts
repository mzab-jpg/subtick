// ============================================================
// SubTick — Validation Utilities
// ============================================================

/**
 * Validates that the user has selected at least 3 categories as "Selected" (interested).
 * Required to proceed past onboarding.
 */
export function validateOnboardingSelection(
  selectedCategoryIds: string[],
  minRequired: number = 3
): {
  isValid: boolean;
  errorMessage?: string;
} {
  if (selectedCategoryIds.length < minRequired) {
    return {
      isValid: false,
      errorMessage: `Please select at least ${minRequired} categories to continue. You've selected ${selectedCategoryIds.length}.`,
    };
  }
  return { isValid: true };
}

/**
 * Basic URL validation for feed request submissions.
 */
export function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Validates a feed request input.
 */
export function validateFeedRequest(url: string, description?: string): {
  isValid: boolean;
  errorMessage?: string;
} {
  if (!url.trim()) {
    return { isValid: false, errorMessage: 'Please enter a feed URL.' };
  }
  if (!isValidUrl(url.trim())) {
    return { isValid: false, errorMessage: 'Please enter a valid URL (starting with http:// or https://).' };
  }
  if (description && description.length > 500) {
    return { isValid: false, errorMessage: 'Description must be 500 characters or fewer.' };
  }
  return { isValid: true };
}

/**
 * Generates a simple hash from a URL and title for article deduplication.
 * (Cloud Functions will use a more robust crypto hash.)
 */
export function generateArticleId(url: string, title: string): string {
  const combined = `${url}::${title}`;
  let hash = 0;
  for (let i = 0; i < combined.length; i++) {
    const char = combined.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0; // Convert to 32bit integer
  }
  return `article_${Math.abs(hash).toString(36)}`;
}
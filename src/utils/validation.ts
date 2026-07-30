// ============================================================
// SubTick — Validation Utilities
// ============================================================

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

// NOTE: Article ID generation is handled exclusively by the Cloud Function (rssCollector.ts)
// using SHA-256 hashing. Any client-side ID would use a different algorithm and would never
// match server-generated IDs, making client-side deduplication impossible. IDs should only
// be compared using values received from the server.

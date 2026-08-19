// ============================================================
// Tangent — Initial Dashboard Feed Handoff
// Shares one first-feed request between onboarding and Dashboard.
// ============================================================

import { RankedFeedResult } from '../types';

const requests = new Map<string, Promise<RankedFeedResult>>();
const completedResults = new Map<string, RankedFeedResult>();

export function requestInitialDashboardFeed(
  userId: string,
  createRequest: () => Promise<RankedFeedResult>
): Promise<RankedFeedResult> {
  const existing = requests.get(userId);
  if (existing) return existing;

  // Register the shared promise before even a local-storage read begins. This
  // closes the onboarding-to-Dashboard race that otherwise creates two feeds.
  const request = createRequest()
    .then((result) => {
      completedResults.set(userId, result);
      return result;
    })
    .finally(() => {
      requests.delete(userId);
    });
  requests.set(userId, request);
  return request;
}

export function getInitialDashboardFeedRequest(userId: string): Promise<RankedFeedResult> | null {
  return requests.get(userId) ?? null;
}

/** Consume a completed onboarding handoff result exactly once. */
export function takeInitialDashboardFeedResult(userId: string): RankedFeedResult | null {
  const result = completedResults.get(userId) ?? null;
  completedResults.delete(userId);
  return result;
}

export function clearInitialDashboardFeedRequest(userId?: string): void {
  if (userId) {
    requests.delete(userId);
    completedResults.delete(userId);
  } else {
    requests.clear();
    completedResults.clear();
  }
}

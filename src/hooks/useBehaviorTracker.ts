// ============================================================
// SubTick — useBehaviorTracker Hook
// Tracks scroll depth, dwell time, and dispatches behavior events.
// ============================================================

import { useRef, useCallback, useEffect } from 'react';
import { BehaviorEventType } from '../types';
import { queueBehaviorEvent } from '../services/behaviorSync';
import { DWELL_THRESHOLD_MS, QUICK_EXIT_MAX_DURATION_MS, QUICK_EXIT_MAX_SCROLL } from '../utils/constants';

interface UseBehaviorTrackerOptions {
  articleId: string;
  articleCategory: string;
  enabled: boolean;
}

interface UseBehaviorTrackerReturn {
  trackScrollDepth: (depth: number) => void;
  trackEvent: (eventType: BehaviorEventType, extraScrollDepth?: number) => void;
  sessionStartTime: number;
  getMaxScrollDepth: () => number;
  getSessionDuration: () => number;
}

export function useBehaviorTracker({
  articleId,
  articleCategory,
  enabled,
}: UseBehaviorTrackerOptions): UseBehaviorTrackerReturn {
  const sessionStartTime = useRef(Date.now()).current;
  const maxScrollDepth = useRef(0);
  const dwellNotified = useRef(false);
  const scrollMilestones = useRef(new Set<number>([0.2, 0.4, 0.8]));

  // Dwell timer: fire dwell_5min after 5 minutes
  useEffect(() => {
    if (!enabled) return;
    const timer = setTimeout(() => {
      if (!dwellNotified.current) {
        dwellNotified.current = true;
        queueBehaviorEvent(
          articleId,
          'dwell_5min',
          articleCategory,
          Date.now() - sessionStartTime,
          maxScrollDepth.current
        );
      }
    }, DWELL_THRESHOLD_MS);
    return () => clearTimeout(timer);
  }, [enabled, articleId, articleCategory, sessionStartTime]);

  // Quick exit detection on unmount
  useEffect(() => {
    return () => {
      if (enabled) {
        const duration = Date.now() - sessionStartTime;
        if (duration < QUICK_EXIT_MAX_DURATION_MS && maxScrollDepth.current < QUICK_EXIT_MAX_SCROLL) {
          queueBehaviorEvent(articleId, 'quick_exit', articleCategory, duration, maxScrollDepth.current);
        }
      }
    };
  }, [enabled, articleId, articleCategory, sessionStartTime]);

  const trackScrollDepth = useCallback(
    (depth: number) => {
      if (!enabled) return;
      maxScrollDepth.current = Math.max(maxScrollDepth.current, depth);

      // Fire scroll milestones
      for (const milestone of [0.2, 0.4, 0.8]) {
        if (depth >= milestone && scrollMilestones.current.has(milestone)) {
          scrollMilestones.current.delete(milestone);
          const eventType = milestone === 0.8 ? 'scroll_80' : milestone === 0.4 ? 'scroll_40' : 'scroll_20';
          queueBehaviorEvent(
            articleId,
            eventType as BehaviorEventType,
            articleCategory,
            Date.now() - sessionStartTime,
            depth
          );
        }
      }
    },
    [enabled, articleId, articleCategory, sessionStartTime]
  );

  const trackEvent = useCallback(
    (eventType: BehaviorEventType, extraScrollDepth?: number) => {
      if (!enabled) return;
      const depth = extraScrollDepth ?? maxScrollDepth.current;
      queueBehaviorEvent(
        articleId,
        eventType,
        articleCategory,
        Date.now() - sessionStartTime,
        depth
      );
    },
    [enabled, articleId, articleCategory, sessionStartTime]
  );

  const getMaxScrollDepth = useCallback(() => maxScrollDepth.current, []);
  const getSessionDuration = useCallback(() => Date.now() - sessionStartTime, [sessionStartTime]);

  return {
    trackScrollDepth,
    trackEvent,
    sessionStartTime,
    getMaxScrollDepth,
    getSessionDuration,
  };
}
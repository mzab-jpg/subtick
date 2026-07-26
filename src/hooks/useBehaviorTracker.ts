// ============================================================
// SubTick — useBehaviorTracker Hook
// Tracks scroll depth, session duration, and evaluates behavior.
// ============================================================

import { useRef, useCallback, useEffect } from 'react';
import { BehaviorEventType } from '../types';
import { queueBehaviorEvent } from '../services/behaviorSync';
import { QUICK_EXIT_MAX_DURATION_MS, QUICK_EXIT_MAX_SCROLL } from '../utils/constants';

interface UseBehaviorTrackerOptions {
  articleId: string;
  articleCategory: string;
  lengthStyle: string;
  publicationName?: string;
  enabled: boolean;
}

interface UseBehaviorTrackerReturn {
  trackScrollDepth: (depth: number) => void;
  trackEvent: (eventType: BehaviorEventType, extraScrollDepth?: number, actualWordCount?: number) => void;
  concludeSession: (expectedReadTimeMs: number, actualWordCount?: number) => void;
  sessionStartTime: number;
  getMaxScrollDepth: () => number;
  getSessionDuration: () => number;
}

export function useBehaviorTracker({
  articleId,
  articleCategory,
  lengthStyle,
  publicationName,
  enabled,
}: UseBehaviorTrackerOptions): UseBehaviorTrackerReturn {
  // Keep tracking state in a ref that resets when articleId changes
  const stateRef = useRef({
    articleId,
    startTime: Date.now(),
    maxDepth: 0,
    concluded: false,
  });

  // Synchronously reset state if articleId changes
  if (stateRef.current.articleId !== articleId) {
    stateRef.current = {
      articleId,
      startTime: Date.now(),
      maxDepth: 0,
      concluded: false,
    };
  }

  // B2 Fix: Use a ref to hold the per-article session snapshot so both the effect
  // cleanup and concludeSession() share the same mutable object. Previously the
  // snapshot was a plain value copy inside useEffect, so concludeSession() setting
  // stateRef.current.concluded = true was invisible to the cleanup — it still saw
  // concluded: false and fired a second quick_exit event.
  //
  // With a shared sessionSnapshotRef, concludeSession() writes
  // sessionSnapshotRef.current.concluded = true which the cleanup reads correctly,
  // preventing the double-fire without any extra complexity.
  const sessionSnapshotRef = useRef<{
    articleId: string;
    articleCategory: string;
    startTime: number;
    maxDepth: number;
    concluded: boolean;
  } | null>(null);

  // Fallback cleanup to ensure quick_exit is recorded if they unmount the reader quickly.
  useEffect(() => {
    if (!enabled) return;

    // Build the session snapshot for THIS article and store in the shared ref.
    // Both the cleanup below and concludeSession() will read/write this same object.
    sessionSnapshotRef.current = {
      articleId,
      articleCategory,
      startTime: stateRef.current.startTime,
      maxDepth: stateRef.current.maxDepth,
      concluded: stateRef.current.concluded,
    };

    const snapshot = sessionSnapshotRef.current;

    return () => {
      // Read concluded from the shared snapshot — concludeSession() will have set
      // snapshot.concluded = true if it already fired for this article.
      if (!snapshot.concluded) {
        const duration = Date.now() - snapshot.startTime;
        // F5 Fix: Use named constants instead of magic numbers
        if (duration < QUICK_EXIT_MAX_DURATION_MS && snapshot.maxDepth < QUICK_EXIT_MAX_SCROLL) {
          queueBehaviorEvent(
            snapshot.articleId,
            'quick_exit',
            snapshot.articleCategory,
            lengthStyle,
            publicationName,
            duration,
            snapshot.maxDepth
          );
        }
      }
    };
  }, [enabled, articleId, articleCategory]);

  const trackScrollDepth = useCallback(
    (depth: number) => {
      if (!enabled) return;
      stateRef.current.maxDepth = Math.max(stateRef.current.maxDepth, depth);
    },
    [enabled]
  );

  const trackEvent = useCallback(
    (eventType: BehaviorEventType, extraScrollDepth?: number, actualWordCount?: number) => {
      if (!enabled) return;
      const depth = extraScrollDepth ?? stateRef.current.maxDepth;
      queueBehaviorEvent(
        articleId,
        eventType,
        articleCategory,
        lengthStyle,
        publicationName,
        Date.now() - stateRef.current.startTime,
        depth,
        actualWordCount
      );
    },
    [enabled, articleId, articleCategory, lengthStyle, publicationName]
  );

  const concludeSession = useCallback(
    (expectedReadTimeMs: number, actualWordCount?: number) => {
      if (!enabled || stateRef.current.concluded) return;
      
      const duration = Date.now() - stateRef.current.startTime;
      const depth = stateRef.current.maxDepth;
      
      let eventType: BehaviorEventType = 'swipe_next';

      // F5 Fix: Use named constants instead of magic numbers
      if (depth < QUICK_EXIT_MAX_SCROLL && duration < QUICK_EXIT_MAX_DURATION_MS) {
        eventType = 'quick_exit';
      } else if (depth >= 0.8) {
        if (duration >= expectedReadTimeMs * 0.7) {
          eventType = 'read_thorough';
        } else {
          eventType = 'read_skim';
        }
      } else if (depth >= 0.4) {
        eventType = 'read_shallow';
      }

      queueBehaviorEvent(
        articleId,
        eventType,
        articleCategory,
        lengthStyle,
        publicationName,
        duration,
        depth,
        actualWordCount
      );
      
      stateRef.current.concluded = true;
      // B2 Fix: Also mark the shared sessionSnapshotRef so the effect cleanup
      // sees concluded=true and does not fire a redundant quick_exit event.
      if (sessionSnapshotRef.current && sessionSnapshotRef.current.articleId === articleId) {
        sessionSnapshotRef.current.concluded = true;
      }
    },
    [enabled, articleId, articleCategory, lengthStyle, publicationName]
  );

  const getMaxScrollDepth = useCallback(() => stateRef.current.maxDepth, []);
  const getSessionDuration = useCallback(() => Date.now() - stateRef.current.startTime, []);

  return {
    trackScrollDepth,
    trackEvent,
    concludeSession,
    sessionStartTime: stateRef.current.startTime,
    getMaxScrollDepth,
    getSessionDuration,
  };
}

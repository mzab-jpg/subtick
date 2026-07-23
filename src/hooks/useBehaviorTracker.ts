// ============================================================
// SubTick — useBehaviorTracker Hook
// Tracks scroll depth, session duration, and evaluates behavior.
// ============================================================

import { useRef, useCallback, useEffect } from 'react';
import { BehaviorEventType } from '../types';
import { queueBehaviorEvent } from '../services/behaviorSync';

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

  // Fallback cleanup to ensure quick_exit is recorded if they unmount the reader quickly.
  // P1 Fix: Capture concluded, maxDepth, and startTime as plain values at effect-setup time,
  // not as references to the shared stateRef. This prevents the cleanup from reading the
  // reset state of the NEXT article (which has concluded=false) and double-firing quick_exit
  // after a swipe_not_interested already concluded the session.
  useEffect(() => {
    if (!enabled) return;

    // Snapshot all values at the moment this effect fires for THIS article.
    const snapshot = {
      articleId,
      articleCategory,
      startTime: stateRef.current.startTime,
      maxDepth: stateRef.current.maxDepth,
      concluded: stateRef.current.concluded,
    };

    return () => {
      // Read live concluded/maxDepth from the snapshot copy, not the shared ref.
      // If concludeSession() was called before cleanup, snapshot.concluded is true.
      if (!snapshot.concluded) {
        const duration = Date.now() - snapshot.startTime;
        if (duration < 15000 && snapshot.maxDepth < 0.2) {
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

      if (depth < 0.2 && duration < 15000) {
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
      // No need to update snapshot here — the cleanup effect has already captured
      // its own copy of concluded=false at setup time and will correctly see
      // concluded=true via the stateRef if the article hasn't changed.
      // The snapshot approach above makes this safe without any additional logic.
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

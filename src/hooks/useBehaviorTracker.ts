// ============================================================
// SubTick — useBehaviorTracker Hook
// Tracks scroll depth, session duration, and evaluates behavior.
// ============================================================

import { useRef, useCallback, useEffect } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { BehaviorEventType, ReaderSessionSummary, RecommendationContext } from '../types';
import { queueBehaviorEvent } from '../services/behaviorSync';
import {
  createActiveSessionClock,
  getActiveSessionDuration,
  pauseActiveSession,
  resumeActiveSession,
} from '../utils/activeSessionTimer';

interface UseBehaviorTrackerOptions {
  articleId: string;
  articleCategory: string;
  lengthStyle: string;
  publicationName?: string;
  recommendationContext?: RecommendationContext;
  enabled: boolean;
}

interface UseBehaviorTrackerReturn {
  trackScrollDepth: (depth: number) => void;
  trackActualWordCount: (count: number) => void;
  trackEvent: (eventType: BehaviorEventType, extraScrollDepth?: number, actualWordCount?: number) => void;
  concludeSession: (actualWordCount?: number) => Promise<ReaderSessionSummary | null>;
  sessionStartTime: number;
}

export function useBehaviorTracker({
  articleId,
  articleCategory,
  lengthStyle,
  publicationName,
  recommendationContext,
  enabled,
}: UseBehaviorTrackerOptions): UseBehaviorTrackerReturn {
  // Keep tracking state in a ref that resets when articleId changes
  const stateRef = useRef({
    articleId,
    ...createActiveSessionClock(Date.now()),
    maxDepth: 0,
    actualWordCount: 0,
    concluded: false,
  });

  // Synchronously reset state if articleId changes
  if (stateRef.current.articleId !== articleId) {
    stateRef.current = {
      articleId,
      ...createActiveSessionClock(Date.now()),
      maxDepth: 0,
      actualWordCount: 0,
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
    pausedAt: number | null;
    maxDepth: number;
    actualWordCount: number;
    concluded: boolean;
  } | null>(null);

  // Fallback cleanup reports any unfinished session as raw telemetry. The server
  // applies the active classification rules, so no client-side quick-exit guess is made.
  useEffect(() => {
    if (!enabled) return;

    // Build the session snapshot for THIS article and store in the shared ref.
    // Both the cleanup below and concludeSession() will read/write this same object.
    sessionSnapshotRef.current = {
      articleId,
      articleCategory,
      startTime: stateRef.current.startTime,
      pausedAt: stateRef.current.pausedAt,
      maxDepth: stateRef.current.maxDepth,
      actualWordCount: stateRef.current.actualWordCount,
      concluded: stateRef.current.concluded,
    };

    const snapshot = sessionSnapshotRef.current;

    return () => {
      // Read concluded from the shared snapshot — concludeSession() will have set
      // snapshot.concluded = true if it already fired for this article.
      if (!snapshot.concluded) {
        const duration = getActiveSessionDuration(snapshot, Date.now());
        queueBehaviorEvent(
          snapshot.articleId,
          'read_session',
          snapshot.articleCategory,
          lengthStyle,
          publicationName,
          duration,
          snapshot.maxDepth,
          snapshot.actualWordCount || undefined,
          recommendationContext
        );
      }
    };
  }, [enabled, articleId, articleCategory]);

  // Only time while the Reader is foreground-active. React Native reports
  // inactive during transitions/calls and background after app switches/locks.
  useEffect(() => {
    if (!enabled) return;

    const subscription = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      const now = Date.now();
      if (nextState === 'active') {
        resumeActiveSession(stateRef.current, now);
        if (sessionSnapshotRef.current?.articleId === stateRef.current.articleId) {
          resumeActiveSession(sessionSnapshotRef.current, now);
        }
      } else if (nextState === 'inactive' || nextState === 'background') {
        pauseActiveSession(stateRef.current, now);
        if (sessionSnapshotRef.current?.articleId === stateRef.current.articleId) {
          pauseActiveSession(sessionSnapshotRef.current, now);
        }
      }
    });

    return () => subscription.remove();
  }, [enabled, articleId]);

  const trackScrollDepth = useCallback(
    (depth: number) => {
      if (!enabled) return;
      stateRef.current.maxDepth = Math.max(stateRef.current.maxDepth, depth);
      if (sessionSnapshotRef.current?.articleId === stateRef.current.articleId) {
        sessionSnapshotRef.current.maxDepth = stateRef.current.maxDepth;
      }
    },
    [enabled]
  );

  const trackActualWordCount = useCallback(
    (count: number) => {
      if (!enabled || !Number.isFinite(count) || count <= 0) return;
      stateRef.current.actualWordCount = Math.floor(count);
      if (sessionSnapshotRef.current?.articleId === stateRef.current.articleId) {
        sessionSnapshotRef.current.actualWordCount = stateRef.current.actualWordCount;
      }
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
        getActiveSessionDuration(stateRef.current, Date.now()),
        depth,
        actualWordCount,
        recommendationContext
      );
    },
    [enabled, articleId, articleCategory, lengthStyle, publicationName]
  );

  const concludeSession = useCallback(
    async (actualWordCount?: number) => {
      if (!enabled || stateRef.current.concluded) return null;

      const duration = getActiveSessionDuration(stateRef.current, Date.now());
      const depth = stateRef.current.maxDepth;
      const wordCount = actualWordCount || stateRef.current.actualWordCount || undefined;

      // Await the local write so callers can immediately flush the exact
      // concluded session before returning to Dashboard.
      await queueBehaviorEvent(
        articleId,
        'read_session',
        articleCategory,
        lengthStyle,
        publicationName,
        duration,
        depth,
        wordCount,
        recommendationContext
      );

      stateRef.current.concluded = true;
      // B2 Fix: Also mark the shared sessionSnapshotRef so the effect cleanup
      // sees concluded=true and does not fire a redundant quick_exit event.
      if (sessionSnapshotRef.current && sessionSnapshotRef.current.articleId === articleId) {
        sessionSnapshotRef.current.concluded = true;
      }
      return {
        timestamp: Date.now(),
        sessionDuration: duration,
        scrollDepth: depth,
        actualWordCount: wordCount,
        articleCategory,
      };
    },
    [enabled, articleId, articleCategory, lengthStyle, publicationName, recommendationContext]
  );

  return {
    trackScrollDepth,
    trackActualWordCount,
    trackEvent,
    concludeSession,
    sessionStartTime: stateRef.current.startTime,
  };
}

// ============================================================
// SubTick — Feed Service (barrel)
// The feed domain is split into single-purpose modules under
// ./feed/. This file re-exports the full surface so existing
// import sites (Reader, Dashboard, History, SavedReads, Onboarding,
// offlineManager) keep working unchanged.
// ============================================================

export * from './feed/articleMeta';
export * from './feed/htmlSanitizer';
export * from './feed/rankedFeed';
export * from './feed/rssParser';
export * from './feed/savedStore';
export * from './feed/seenStore';

// NOTE: totalArticlesRead is incremented exclusively by the weightUpdater Cloud Function
// (firebase/functions/src/weightUpdater.ts) whenever a read_thorough or read_skim event
// is processed. There is no client-side increment needed.

// ============================================================
// SubTick — Feed: Article Metadata Type
// Lightweight offline-list metadata shared by the seen and
// saved article stores for instant History/SavedReads rendering.
// ============================================================

export interface ArticleMeta {
  id: string;
  title: string;
  publicationName: string;
  category: string;
  estimatedReadMinutes: number;
  /** ms timestamp of when the article was marked seen (new entries only). */
  seenAt?: number;
  /** Completion depth 0.0–1.0 from the reader's scroll telemetry, when known. */
  depth?: number;
}

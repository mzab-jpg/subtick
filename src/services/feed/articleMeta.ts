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
}

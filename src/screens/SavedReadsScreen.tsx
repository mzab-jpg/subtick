// ============================================================
// SubTick — Saved Reads Screen
// Shows the user's saved articles using locally cached metadata.
// Fully offline — no Firestore or network needed for the list.
// ============================================================

import React from 'react';
import { ArticleListScreen } from '../components/ArticleListScreen';
import { getSavedArticleMetas } from '../services/feedService';
import { Bookmark } from 'lucide-react-native';

export default function SavedReadsScreen() {
  return (
    <ArticleListScreen
      title="Saved"
      loadFunction={getSavedArticleMetas}
      emptyIcon={Bookmark}
      emptyTitle="No saved articles"
      emptySubtitle="Articles you save will appear here, available offline."
      readerMode="saved"
      loadOnMount={true}
    />
  );
}
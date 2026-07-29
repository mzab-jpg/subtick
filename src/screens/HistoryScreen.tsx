// ============================================================
// SubTick — History Screen
// Shows the user's reading history using locally cached metadata.
// No Firestore reads — loads instantly from device storage.
// ============================================================

import React from 'react';
import { ArticleListScreen } from '../components/ArticleListScreen';
import { getSeenArticleMetas } from '../services/feedService';
import { Inbox } from 'lucide-react-native';

export default function HistoryScreen() {
  return (
    <ArticleListScreen
      title="History"
      loadFunction={() => getSeenArticleMetas(30)}
      emptyIcon={Inbox}
      emptyTitle="No history yet"
      emptySubtitle="Articles you've read will appear here."
      readerMode="history"
      loadOnMount={false}
    />
  );
}
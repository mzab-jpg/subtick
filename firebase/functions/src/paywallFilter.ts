// ============================================================
// SubTick — paywallFilter (Firestore onDocumentCreated trigger)
// Flags articles with paywall keywords/blocks as isPaywalled: true.
// ============================================================

import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import * as admin from 'firebase-admin';
import { PAYWALL_KEYWORDS } from './constants.js';

const db = admin.firestore();

export const paywallFilter = onDocumentCreated('articles/{articleId}', async (event) => {
  const snap = event.data;
  if (!snap) return;

  const article = snap.data();
  if (!article) return;

  const bodyHtml: string = article.bodyHtml || '';
  const description: string = article.description || '';
  const title: string = article.title || '';

  const contentToCheck = `${title} ${description} ${bodyHtml}`.toLowerCase();

  const isPaywalled = PAYWALL_KEYWORDS.some((keyword) =>
    contentToCheck.includes(keyword.toLowerCase())
  );

  const hasPaywallClass =
    /class="[^"]*paywall[^"]*"/i.test(bodyHtml) ||
    /class="[^"]*subscriber-only[^"]*"/i.test(bodyHtml) ||
    /class="[^"]*locked-content[^"]*"/i.test(bodyHtml);

  const hasPaywallScript = /paywall/i.test(bodyHtml) && /<script/i.test(bodyHtml);

  if (isPaywalled || hasPaywallClass || hasPaywallScript) {
    await db.collection('articles').doc(event.params.articleId).update({
      isPaywalled: true,
      cacheTimestamp: Date.now(),
    });
    console.log(`[paywallFilter] Paywalled: ${title.substring(0, 60)}`);
  }
});
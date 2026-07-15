// ============================================================
// SubTick — htmlSanitizer (Firestore onDocumentCreated trigger)
// Strips tracking pixels, inline styles, JS, promo wrappers.
// ============================================================

import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import * as admin from 'firebase-admin';
import sanitizeHtml from 'sanitize-html';

const db = admin.firestore();

export const htmlSanitizer = onDocumentCreated('articles/{articleId}', async (event) => {
  const snap = event.data;
  if (!snap) return;

  const article = snap.data();
  if (!article || !article.bodyHtml) return;

  const rawHtml: string = article.bodyHtml;
  const sanitized = sanitizeAndClean(rawHtml);

  if (sanitized !== rawHtml) {
    await db.collection('articles').doc(event.params.articleId).update({
      bodyHtml: sanitized,
      cacheTimestamp: Date.now(),
    });
    console.log(`[htmlSanitizer] Sanitized article: ${article.title?.substring(0, 60)}`);
  }
});

function sanitizeAndClean(html: string): string {
  let cleaned = sanitizeHtml(html, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img', 'h2', 'h3', 'h4']),
    allowedAttributes: {
      img: ['src', 'alt', 'width', 'height'],
      a: ['href', 'title'],
    },
    allowedStyles: {},
    allowedSchemes: ['http', 'https', 'mailto'],
    exclusiveFilter: (frame) => {
      if (frame.tag === 'img') {
        const src = frame.attribs.src || '';
        const width = parseInt(frame.attribs.width || '0');
        const height = parseInt(frame.attribs.height || '0');
        if (width <= 1 && height <= 1) return true;
        if (src.includes('analytics') || src.includes('pixel') || src.includes('track')) return true;
      }
      return false;
    },
  });

  cleaned = cleaned.replace(/<div[^>]*class="[^"]*subscribe[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '');
  cleaned = cleaned.replace(/<div[^>]*class="[^"]*paywall[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '');
  cleaned = cleaned.replace(/<div[^>]*class="[^"]*overlay[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '');
  cleaned = cleaned.replace(/\s*style="[^"]*"/gi, '');
  cleaned = cleaned.replace(/<script[\s\S]*?<\/script>/gi, '');
  cleaned = cleaned.replace(/<iframe[\s\S]*?<\/iframe>/gi, '');
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();

  return cleaned;
}
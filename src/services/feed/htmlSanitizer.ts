// ============================================================
// SubTick — Feed: HTML Sanitizer
// Replicates the server-side htmlSanitizer so article bodies
// are safe and clutter-free before display.
// ============================================================

import xss from 'xss';

export function sanitizeClientHtml(rawHtml: string): string {
  if (!rawHtml) return '';
  const defaultWhiteList = (xss as any).getDefaultWhiteList ? (xss as any).getDefaultWhiteList() : {};
  let cleaned = xss(rawHtml, {
    whiteList: {
      ...defaultWhiteList,
      img: ['src', 'alt', 'width', 'height'],
      a: ['href', 'title'],
      h1: [], h2: [], h3: [], h4: [], p: [],
      ul: [], ol: [], li: [], strong: [], em: [], blockquote: [], code: [], pre: [], br: [], hr: []
    },
    stripIgnoreTag: true,
    stripIgnoreTagBody: ['script', 'style', 'iframe'],
  });

  // Strip empty/tracking pixels
  cleaned = cleaned.replace(/<img[^>]*src=["'][^"']*(?:analytics|pixel|track)[^"']*["'][^>]*>/gi, '');
  cleaned = cleaned.replace(/<img[^>]*(?:width\s*=\s*["']?\s*[01]\s*["']?|height\s*=\s*["']?\s*[01]\s*["']?)[^>]*>/gi, '');

  cleaned = cleaned.replace(/<div[^>]*class="[^"]*subscribe[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '');
  cleaned = cleaned.replace(/<div[^>]*class="[^"]*paywall[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '');
  cleaned = cleaned.replace(/<div[^>]*class="[^"]*overlay[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '');
  cleaned = cleaned.replace(/\s*style="[^"]*"/gi, '');
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();

  return cleaned;
}

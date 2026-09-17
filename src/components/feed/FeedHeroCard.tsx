// ============================================================
// Tangent â€” Feed Hero Card (B1 â€” Feed & Algorithmic Stream)
// Full-bleed monograph: the cover photo fills the screen, text sits
// in a LEFT wedge over a long smooth scrim (top veil max 60% within
// the top 20%; text wedge feathers out by ~65% width; the photo stays
// visible top-half and lower-right down to the nav â€” frozen v4 scrim
// geometry from design/final/README.md). No-image fallback keeps the
// split layout. Advance: swipe up or tap the NEXT teaser.
// ============================================================

import React, { useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  TouchableOpacity,
  useWindowDimensions,
} from 'react-native';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import Svg, { Rect, Defs, LinearGradient as SvgGradient, Stop } from 'react-native-svg';
import { Bookmark } from 'lucide-react-native';
import { useTheme } from '../../contexts/ThemeContext';
import { Article } from '../../types';
import { monoLabel } from '../../utils/constants';

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** Strip HTML tags/entities and cut to the first sentence pair (~170 chars). */
function extractPullQuote(description?: string): string | null {
  if (!description) return null;
  const plain = description
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&rsquo;/g, 'â€™')
    .replace(/\s+/g, ' ')
    .trim();
  if (plain.length < 40) return null;
  const sentences = plain.match(/[^.!?]+[.!?]+/g) || [plain];
  let quote = '';
  for (const sentence of sentences) {
    if (quote.length + sentence.length > 170) break;
    quote += sentence;
    if (quote.length >= 60) break;
  }
  return quote.length >= 40 ? quote.trim() : null;
}

function formatDate(ms: number): string {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

interface FeedHeroCardProps {
  article: Article;
  userWpm: number;
  nextTitle: string | null;
  onRead: () => void;
  onBookmark: () => void;
  onAdvance: () => void;
  onSurprise: () => void;
}

export function FeedHeroCard({
  article,
  userWpm,
  nextTitle,
  onRead,
  onBookmark,
  onAdvance,
  onSurprise,
}: FeedHeroCardProps) {
  const { colors, fonts } = useTheme();
  const advancingRef = useRef(false);

  const readMinutes = Math.max(
    1,
    article.estimatedReadMinutes || Math.ceil((article.wordCount || 0) / Math.max(120, userWpm))
  );
  const pullQuote = extractPullQuote(article.description);
  const authorLine = article.author ? article.author.toUpperCase() : null;
  const coverUrl = article.headerImageUrl || null;

  // Frozen feed-image grade: cold obsidian tint. RN Image lacks CSS filters;
  // the tint overlay carries the grade.
  const gradeTint = 'rgba(12, 15, 21, 0.22)';

  // Swipe-up advances; long-press keeps the retired shuffle/discover affordance.
  const pan = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetY([-18, 18])
        .failOffsetX([-28, 28])
        .onEnd((event) => {
          const strongUp =
            event.velocityY < -700 &&
            Math.abs(event.velocityY) > Math.abs(event.velocityX) * 1.2;
          if (strongUp && !advancingRef.current) {
            advancingRef.current = true;
            onAdvance();
            setTimeout(() => {
              advancingRef.current = false;
            }, 600);
          }
        }),
    [onAdvance]
  );

  const longPress = useMemo(
    () => Gesture.LongPress().minDuration(550).onEnd(() => onSurprise()),
    [onSurprise]
  );

  const metaText = `${(article.publicationName || '').toUpperCase()} Â· ${readMinutes} MIN READ`;
  const bylineText = authorLine
    ? article.publishDate
      ? `${authorLine} Â· ${formatDate(article.publishDate)}`
      : authorLine
    : null;

  const actionRow = (
    <View style={styles.actionRow}>
      <TouchableOpacity
        onPress={onBookmark}
        activeOpacity={0.7}
        accessibilityLabel="Save to stack"
      >
        <Bookmark size={20} color={colors.textSecondary} strokeWidth={1.8} />
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.readCta, { backgroundColor: colors.primary }]}
        onPress={onRead}
        activeOpacity={0.85}
        accessibilityLabel={`Read essay, ${readMinutes} minutes`}
      >
        <Text
          style={[
            monoLabel(fonts),
            { fontFamily: fonts.mono, color: colors.onPrimary, fontSize: 12, letterSpacing: 1.2 },
          ]}
        >
          READ ESSAY  â†’
        </Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <GestureDetector gesture={Gesture.Race(pan, longPress)}>
      <View style={styles.screen}>
        {/* â”€â”€ Cover layers (full-bleed when a photo exists) â”€â”€ */}
        {coverUrl ? (
          <>
            <Image source={{ uri: coverUrl }} style={styles.coverImage} resizeMode="cover" />
            <View style={[styles.fillLayer, { backgroundColor: gradeTint }]} />
            {/* v3 grading — long top fade into the chrome */}
            <Svg style={styles.topGrading}>
              <Defs>
                <SvgGradient id="t2sTop" x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor="#0C0E12" stopOpacity="1" />
                  <Stop offset="0.18" stopColor="#0C0E12" stopOpacity="0.92" />
                  <Stop offset="0.4" stopColor="#0C0E12" stopOpacity="0.55" />
                  <Stop offset="0.7" stopColor="#0C0E12" stopOpacity="0.15" />
                  <Stop offset="1" stopColor="#0C0E12" stopOpacity="0" />
                </SvgGradient>
              </Defs>
              <Rect width="100%" height="100%" fill="url(#t2sTop)" />
            </Svg>
            {/* Soft horizontal wedge — gentle left-side darkening */}
            <Svg style={styles.softWedge}>
              <Defs>
                <SvgGradient id="t2sWedge" x1="0" y1="0" x2="1" y2="0">
                  <Stop offset="0" stopColor="#0C0E12" stopOpacity="0.76" />
                  <Stop offset="0.35" stopColor="#0C0E12" stopOpacity="0.62" />
                  <Stop offset="0.65" stopColor="#0C0E12" stopOpacity="0.35" />
                  <Stop offset="0.85" stopColor="#0C0E12" stopOpacity="0.1" />
                  <Stop offset="1" stopColor="#0C0E12" stopOpacity="0" />
                </SvgGradient>
              </Defs>
              <Rect width="100%" height="100%" fill="url(#t2sWedge)" />
            </Svg>
            {/* Bottom grounding fade toward the tab bar */}
            <Svg style={styles.bottomFade}>
              <Defs>
                <SvgGradient id="t2sBottom" x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor="#0C0E12" stopOpacity="0" />
                  <Stop offset="0.55" stopColor="#0C0E12" stopOpacity="0.75" />
                  <Stop offset="1" stopColor="#0C0E12" stopOpacity="1" />
                </SvgGradient>
              </Defs>
              <Rect width="100%" height="100%" fill="url(#t2sBottom)" />
            </Svg>
          </>
        ) : (
          <View style={[styles.fillLayer, styles.fallback, { backgroundColor: colors.surfaceRaised }]}>
            <Text
              style={[styles.fallbackInitial, { fontFamily: fonts.display, color: colors.borderStrong }]}
            >
              {(article.publicationName || '?').charAt(0).toUpperCase()}
            </Text>
          </View>
        )}

        {/* â”€â”€ Overlay column: text wedge anchored lower-left â”€â”€ */}
        <View style={styles.overlayColumn} pointerEvents="box-none">
          <View style={{ flex: 1 }} />
          <View style={styles.textWedge} pointerEvents="box-none">
            <Text style={[monoLabel(fonts), { color: colors.textSecondary }]} numberOfLines={1}>
              {metaText}
            </Text>
            <Text
              style={[styles.headline, styles.shadowHeavy, { fontFamily: fonts.headline, color: colors.text }]}
              numberOfLines={3}
            >
              {article.title}
            </Text>
            {pullQuote ? (
              <View style={[styles.quoteRow, { borderLeftColor: colors.accent }]}>
                <Text
                  style={[styles.quoteText, styles.shadowSubtle, { fontFamily: fonts.body, color: colors.textSecondary }]}
                  numberOfLines={3}
                >
                  {`â€œ${pullQuote}â€`}
                </Text>
              </View>
            ) : null}
            {bylineText ? (
              <Text style={[monoLabel(fonts), styles.shadowSubtle, { color: colors.textMuted }]} numberOfLines={1}>
                {bylineText}
              </Text>
            ) : null}
          </View>
          {actionRow}
          {nextTitle ? (
            <TouchableOpacity
              style={[styles.nextTeaser, { borderTopColor: colors.border }]}
              onPress={onAdvance}
              activeOpacity={0.8}
              accessibilityLabel="Next essay"
            >
              <Text style={[monoLabel(fonts), styles.shadowSubtle, { color: colors.textMuted }]} numberOfLines={1}>
                {`NEXT: ${nextTitle.toUpperCase()}  â†’`}
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    overflow: 'hidden',
  },
  fillLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  coverImage: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  topGrading: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '28%',
  },
  softWedge: {
    position: 'absolute',
    left: 0,
    bottom: 0,
    width: '85%',
    height: '52%'
  },
  bottomFade: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 96,
  },
  shadowSubtle: {
    textShadowColor: 'rgba(0, 0, 0, 0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  shadowHeavy: {
    textShadowColor: 'rgba(0, 0, 0, 0.85)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 10,
  },
  fallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  fallbackInitial: {
    fontSize: 96,
  },
  overlayColumn: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 24,
  },
  textWedge: {
    gap: 12,
    paddingRight: 24,
  },
  headline: {
    fontSize: 30,
    lineHeight: 36,
    letterSpacing: -0.3,
    fontWeight: '500',
  },
  quoteRow: {
    borderLeftWidth: 2,
    paddingLeft: 14,
    paddingVertical: 2,
  },
  quoteText: {
    fontSize: 15,
    lineHeight: 23,
    fontStyle: 'italic',
  },
  actionRow: {
    flexDirection: 'row',
    paddingTop: 22,
    gap: 12,
  },
  squareAction: {
    width: 48,
    height: 48,
    borderRadius: 4,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(12, 14, 18, 0.55)',
  },
  readCta: {
    flex: 1,
    height: 48,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nextTeaser: {
    borderTopWidth: 1,
    marginHorizontal: -24,
    paddingVertical: 12,
    paddingHorizontal: 24,
    backgroundColor: 'rgba(12, 14, 18, 0.88)',
  },
});




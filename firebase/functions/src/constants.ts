// ============================================================
// SubTick — Cloud Functions Constants
// ============================================================

import { FeedSource } from './types.js';

// --- 35 Curated Substack RSS Feeds ---
export const SUBSTACK_FEEDS: FeedSource[] = [
  // TECH (6)
  { url: 'https://www.platformer.news/feed', category: 'tech', publicationName: 'Platformer', qualityScore: 0.92 },
  { url: 'https://stratechery.com/feed/', category: 'tech', publicationName: 'Stratechery', qualityScore: 0.95 },
  { url: 'https://newsletter.pragmaticengineer.com/feed', category: 'tech', publicationName: 'The Pragmatic Engineer', qualityScore: 0.90 },
  { url: 'https://www.lennysnewsletter.com/feed', category: 'tech', publicationName: "Lenny's Newsletter", qualityScore: 0.88 },
  { url: 'https://thealgorithmicbridge.substack.com/feed', category: 'tech', publicationName: 'The Algorithmic Bridge', qualityScore: 0.78 },
  { url: 'https://aisupremacy.substack.com/feed', category: 'tech', publicationName: 'AI Supremacy', qualityScore: 0.72 },
  // POLITICS (6)
  { url: 'https://www.noahpinion.blog/feed', category: 'politics', publicationName: 'Noahpinion', qualityScore: 0.85 },
  { url: 'https://plus.thebulwark.com/feed', category: 'politics', publicationName: 'The Bulwark', qualityScore: 0.80 },
  { url: 'https://www.slowboring.com/feed', category: 'politics', publicationName: 'Slow Boring', qualityScore: 0.90 },
  { url: 'https://heathercoxrichardson.substack.com/feed', category: 'politics', publicationName: 'Heather Cox Richardson', qualityScore: 0.82 },
  { url: 'https://www.readtangle.com/feed', category: 'politics', publicationName: 'Tangle', qualityScore: 0.88 },
  { url: 'https://thedispatch.com/feed/', category: 'politics', publicationName: 'The Dispatch', qualityScore: 0.78 },
  // FINANCE (5)
  { url: 'https://kyla.substack.com/feed', category: 'finance', publicationName: "Kyla's Newsletter", qualityScore: 0.70 },
  { url: 'https://www.netinterest.co/feed', category: 'finance', publicationName: 'Net Interest', qualityScore: 0.85 },
  { url: 'https://newsletter.doomberg.com/feed', category: 'finance', publicationName: 'Doomberg', qualityScore: 0.80 },
  { url: 'https://thebearcave.substack.com/feed', category: 'finance', publicationName: 'The Bear Cave', qualityScore: 0.82 },
  { url: 'https://calculatedrisk.substack.com/feed', category: 'finance', publicationName: 'Calculated Risk', qualityScore: 0.75 },
  // CULTURE (7)
  { url: 'https://annehelen.substack.com/feed', category: 'culture', publicationName: 'Culture Study', qualityScore: 0.88 },
  { url: 'https://www.honest-broker.com/feed', category: 'culture', publicationName: 'The Honest Broker', qualityScore: 0.90 },
  { url: 'https://maybebaby.substack.com/feed', category: 'culture', publicationName: 'Maybe Baby', qualityScore: 0.72 },
  { url: 'https://freddiedeboer.substack.com/feed', category: 'culture', publicationName: 'Freddie deBoer', qualityScore: 0.78 },
  { url: 'https://www.blockedandreported.org/feed', category: 'culture', publicationName: 'Blocked and Reported', qualityScore: 0.75 },
  { url: 'https://nightcrawler.substack.com/feed', category: 'culture', publicationName: 'The Nightcrawler', qualityScore: 0.65 },
  { url: 'https://www.garbageday.email/feed', category: 'culture', publicationName: 'Garbage Day', qualityScore: 0.80 },
  // SCIENCE (5)
  { url: 'https://astralcodexten.substack.com/feed', category: 'science', publicationName: 'Astral Codex Ten', qualityScore: 0.95 },
  { url: 'https://worksinprogress.co/feed', category: 'science', publicationName: 'Works in Progress', qualityScore: 0.88 },
  { url: 'https://experimentalhistory.substack.com/feed', category: 'science', publicationName: 'Experimental History', qualityScore: 0.85 },
  { url: 'https://dynomight.substack.com/feed', category: 'science', publicationName: 'Dynomight', qualityScore: 0.82 },
  { url: 'https://mindthesciencegap.substack.com/feed', category: 'science', publicationName: 'Mind the Science Gap', qualityScore: 0.70 },
  // HEALTH (3)
  { url: 'https://yourlocalepidemiologist.substack.com/feed', category: 'health', publicationName: 'Your Local Epidemiologist', qualityScore: 0.88 },
  { url: 'https://examined.substack.com/feed', category: 'health', publicationName: 'Examined', qualityScore: 0.78 },
  { url: 'https://unsettledscience.substack.com/feed', category: 'health', publicationName: 'Unsettled Science', qualityScore: 0.65 },
  // MISC (3)
  { url: 'https://whyisthisinteresting.substack.com/feed', category: 'misc', publicationName: 'Why Is This Interesting?', qualityScore: 0.85 },
  { url: 'https://numlock.substack.com/feed', category: 'misc', publicationName: 'Numlock News', qualityScore: 0.75 },
  { url: 'https://www.thediff.co/feed', category: 'misc', publicationName: 'The Diff', qualityScore: 0.88 },
];

// --- Scoring Formula Weights ---
export const SCORE_WEIGHTS = {
  categoryBoost: 0.3,
  trendingBoost: 0.2,
  recencyBoost: 0.25,
  qualityBoost: 0.15,
  crossUserCollab: 0.1,
};

// --- Feedback Delta Multipliers ---
export const FEEDBACK_DELTAS: Record<string, number> = {
  swipe_next: 0.15,
  swipe_not_interested: -0.35,
  scroll_20: -0.05,
  scroll_40: 0.1,
  scroll_80: 0.25,
  like: 0.25,
  save: 0.25,
  dwell_5min: 0.1,
  quick_exit: -0.1,
};

// --- Learning Rate & Limits ---
export const LEARNING_RATE = 0.08;
export const MIN_CATEGORY_WEIGHT = 0.1;
export const MAX_CATEGORY_WEIGHT = 5.0;
export const DAILY_DECAY_RATE = 0.995;

// --- Feed Configuration ---
export const MAX_FEED_ARTICLES = 30;
export const CANDIDATE_POOL_SIZE = 200;

// --- Paywall Keywords ---
export const PAYWALL_KEYWORDS = [
  'To read this post, subscribe',
  'Paid subscription required',
  'This post is for paid subscribers',
  'Upgrade to paid',
  'Subscribe to continue reading',
  'Behind the paywall',
  'This content is for subscribers only',
  "You've reached the free preview",
  'Subscribe now to read the full post',
  'Continue reading with a paid subscription',
];

// --- Sanitization Allowed Tags ---
export const ALLOWED_HTML_TAGS = ['p', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'img', 'a', 'strong', 'em', 'blockquote', 'code', 'pre', 'br', 'hr'];
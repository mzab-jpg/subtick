// ============================================================
// SubTick — Cloud Functions Constants
// ============================================================

import { FeedSource } from './types.js';

// --- 42 Curated Full-RSS Feeds (9 new categories) ---
// All quality scores normalized to 0.80 — every publisher starts equal.
// Crowd-sourced publisher quality (syncBehaviorEvents) will diverge them over time.
export const SUBSTACK_FEEDS: FeedSource[] = [
  { url: "https://www.slowboring.com/feed", category: "Politics", publicationName: "Slow Boring", qualityScore: 0.80 },
  { url: "https://www.readtangle.com/feed", category: "Politics", publicationName: "Tangle", qualityScore: 0.80 },
  { url: "https://plus.thebulwark.com/feed", category: "Politics", publicationName: "The Bulwark", qualityScore: 0.80 },
  { url: "https://andrewsullivan.substack.com/feed", category: "Politics", publicationName: "Andrew Sullivan", qualityScore: 0.80 },
  { url: "https://heathercoxrichardson.substack.com/feed", category: "Politics", publicationName: "Heather Cox Richardson", qualityScore: 0.80 },
  { url: "https://www.noahpinion.blog/feed", category: "Politics", publicationName: "Noahpinion", qualityScore: 0.80 },
  { url: "https://theliberalpatriot.substack.com/feed", category: "Politics", publicationName: "The Liberal Patriot", qualityScore: 0.80 },
  { url: "https://reason.com/feed/", category: "Politics", publicationName: "Reason", qualityScore: 0.80 },
  { url: "https://www.thediff.co/feed", category: "Business", publicationName: "The Diff", qualityScore: 0.80 },
  { url: "https://thegeneralist.substack.com/feed", category: "Business", publicationName: "The Generalist", qualityScore: 0.80 },
  { url: "https://newsletter.doomberg.com/feed", category: "Business", publicationName: "Doomberg", qualityScore: 0.80 },
  { url: "https://kyla.substack.com/feed", category: "Business", publicationName: "Kyla's Newsletter", qualityScore: 0.80 },
  { url: "https://www.econlib.org/feed/", category: "Business", publicationName: "Econlib", qualityScore: 0.80 },
  { url: "https://www.netinterest.co/feed", category: "Finance", publicationName: "Net Interest", qualityScore: 0.80 },
  { url: "https://thebearcave.substack.com/feed", category: "Finance", publicationName: "The Bear Cave", qualityScore: 0.80 },
  { url: "https://calculatedrisk.substack.com/feed", category: "Finance", publicationName: "Calculated Risk", qualityScore: 0.80 },
  { url: "https://numlock.substack.com/feed", category: "Finance", publicationName: "Numlock News", qualityScore: 0.80 },
  { url: "https://www.platformer.news/feed", category: "Technology", publicationName: "Platformer", qualityScore: 0.80 },
  { url: "https://stratechery.com/feed/", category: "Technology", publicationName: "Stratechery", qualityScore: 0.80 },
  { url: "https://newsletter.pragmaticengineer.com/feed", category: "Technology", publicationName: "The Pragmatic Engineer", qualityScore: 0.80 },
  { url: "https://www.lennysnewsletter.com/feed", category: "Technology", publicationName: "Lenny's Newsletter", qualityScore: 0.80 },
  { url: "https://thealgorithmicbridge.substack.com/feed", category: "Technology", publicationName: "The Algorithmic Bridge", qualityScore: 0.80 },
  { url: "https://aisupremacy.substack.com/feed", category: "Technology", publicationName: "AI Supremacy", qualityScore: 0.80 },
  { url: "https://www.technologyreview.com/feed", category: "Technology", publicationName: "MIT Technology Review", qualityScore: 0.80 },
  { url: "https://danluu.com/atom.xml", category: "Technology", publicationName: "Dan Luu", qualityScore: 0.80 },
  { url: "https://astralcodexten.substack.com/feed", category: "Science", publicationName: "Astral Codex Ten", qualityScore: 0.80 },
  { url: "https://yourlocalepidemiologist.substack.com/feed", category: "Science", publicationName: "Your Local Epidemiologist", qualityScore: 0.80 },
  { url: "https://dynomight.substack.com/feed", category: "Science", publicationName: "Dynomight", qualityScore: 0.80 },
  { url: "https://experimentalhistory.substack.com/feed", category: "Science", publicationName: "Experimental History", qualityScore: 0.80 },
  { url: "https://statmodeling.stat.columbia.edu/feed/", category: "Science", publicationName: "Statistical Modeling", qualityScore: 0.80 },
  { url: "https://unsettledscience.substack.com/feed", category: "Science", publicationName: "Unsettled Science", qualityScore: 0.80 },
  { url: "https://acoup.blog/feed/", category: "History", publicationName: "ACOUP", qualityScore: 0.80 },
  { url: "https://unherd.com/feed/", category: "History", publicationName: "UnHerd", qualityScore: 0.80 },
  { url: "https://www.honest-broker.com/feed", category: "Culture", publicationName: "The Honest Broker", qualityScore: 0.80 },
  { url: "https://annehelen.substack.com/feed", category: "Culture", publicationName: "Culture Study", qualityScore: 0.80 },
  { url: "https://freddiedeboer.substack.com/feed", category: "Culture", publicationName: "Freddie deBoer", qualityScore: 0.80 },
  { url: "https://whyisthisinteresting.substack.com/feed", category: "Culture", publicationName: "Why Is This Interesting?", qualityScore: 0.80 },
  { url: "https://lithub.com/feed/", category: "Culture", publicationName: "Literary Hub", qualityScore: 0.80 },
  { url: "https://www.artofmanliness.com/feed/", category: "Lifestyle", publicationName: "Art of Manliness", qualityScore: 0.80 },
  { url: "https://www.theprepared.com/feed/", category: "Lifestyle", publicationName: "The Prepared", qualityScore: 0.80 },
  { url: "https://www.outsideonline.com/feed/", category: "Lifestyle", publicationName: "Outside Online", qualityScore: 0.80 },
  { url: "https://www.theankler.com/feed", category: "Entertainment", publicationName: "The Ankler", qualityScore: 0.80 },
];

// --- Scoring Formula Weights (High/Mid tranches — personalized) ---
// All components normalized to [0,1] so these weights are honest percentages.
// Diversity enforced by a hard per-publisher cap (5) during feed assembly,
// not as a scoring component. Weights must sum to 1.0.
export const SCORE_WEIGHTS = {
  personalization: 0.60, // P: how much you like this category × publisher
  trending: 0.15,        // T: crowd engagement (normalized, decays over time)
  recency: 0.10,         // R: how recently published (two-phase decay)
  quality: 0.15,         // Q: crowd-sourced publisher quality
};

// --- Scoring Formula Weights (Tail tranche — trending + recency only) ---
// No personalization or quality. Sorted by trending + recency after the full
// 4-component score places articles in the bottom tranche (fullScore ≤ 0.20).
// Weights must sum to 1.0.
export const SCORE_WEIGHTS_TAIL = {
  trending: 0.43,
  recency: 0.57,
};

// --- Feedback Delta Multipliers ---
// Controls how strongly each user action moves the personalization weights.
// Higher values = faster personalization.
export const FEEDBACK_DELTAS: Record<string, number> = {
  save: 0.55,
  unsave: -0.55,
  like: 0.40,
  unlike: -0.40,
  read_thorough: 0.30,
  read_skim: 0.10,
  read_shallow: 0.00,
  swipe_next: 0.00,
  quick_exit: 0,
  swipe_not_interested: -0.40,
};

// --- Learning Rate & Limits ---
export const LEARNING_RATE = 0.08;
export const MIN_CATEGORY_WEIGHT = 0.1;
export const MAX_CATEGORY_WEIGHT = 5.0;
export const DAILY_DECAY_RATE = 0.995; // User preference weights decay by 0.5% per day

// --- Trending Score Decay ---
// trendingScore decays daily at this rate: halves every 7 days.
// 2^(-1/7) ≈ 0.9057
export const TRENDING_DECAY_RATE = 0.9057;
export const MAX_TRENDING_SCORE = 50.0; // Cap for T normalization

export const DEFAULT_SELECTED_WEIGHT = 1.5;
export const DEFAULT_NOT_INTERESTED_WEIGHT = 0.2;
export const DEFAULT_NEUTRAL_WEIGHT = 1.0;

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
  'free preview',
  'start your 7-day free trial',
  'unlock this post',
  'read the rest of this',
  'upgrade your subscription',
  'exclusive to paid',
  'to read the rest',
  'keep reading with a 7-day',
  'keep reading with a free trial',
  'this is a free preview',
  'subscribe to read',
  'upgrade to read',
  'paid subscribers only',
  'this post is for paid',
];

// --- Sanitization Allowed Tags ---
export const ALLOWED_HTML_TAGS = ['p', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'img', 'a', 'strong', 'em', 'blockquote', 'code', 'pre', 'br', 'hr'];
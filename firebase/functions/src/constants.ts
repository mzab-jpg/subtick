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


// --- Scoring Formula Weights (single formula) ---
// One formula is used for BOTH bucketing (tranche label) and ordering. There is
// no separate tail formula. Weights must sum to 1.0.
export const SCORE_WEIGHTS = {
  personalization: 0.60, // P: how well it matches this user (latent sigmoid)
  trending: 0.15,        // T: crowd engagement (sigmoid S/(S+k))
  recency: 0.10,         // R: freshness (single monotone curve)
  quality: 0.15,         // Q: publisher quality (latent sigmoid)
};

// --- Sigmoid / latent parameters ---
export const TRENDING_HALF_SAT = 25;          // T = S/(S+k): half-saturation — 1% of active users to trend
export const RECENCY_DAYS_CONSTANT = 14;      // R = 1/(1 + daysOld/τ): single monotone curve
export const LATENT_CLAMP = 20;               // write-time clamp for latent x/y (±20)
export const LATENT_NIGHTLY_DECAY = 0.95;     // x *= λ toward 0 each full day
export const LATENT_DRIFT_FLOOR = 0.5;        // magnitude floor — latents never decay below ±this (configurable driftFloor)
export const DEFAULT_PUBLISHER_LATENT = 1.386; // σ(1.386)=0.8 optimistic publisher seed

// --- Feedback Delta Multipliers (latent steps δ) ---
// Read-session deltas are scaled by the Engagement Index E; explicit tap-actions
// (like/save/unlike/unsave/not-interested) ship unscaled at full strength.
// quick_exit uses the asymmetric rejection: -2.5 × read_thorough.
export const FEEDBACK_DELTAS: Record<string, number> = {
  save: 0.55,
  unsave: -0.55,
  like: 0.40,
  unlike: -0.40,
  read_thorough: 0.275,
  read_skim: 0.10,
  read_shallow: 0.10,
  swipe_next: 0.00,
  quick_exit: -0.6875,
  swipe_not_interested: -0.6875,
};

// --- Trending Score Decay ---
export const TRENDING_DECAY_RATE = 0.9057;

// --- Latent UI thresholds ---
export const DEFAULT_SELECTED_LATENT = 0.85;
export const DEFAULT_NOT_INTERESTED_LATENT = -0.85;
export const DEFAULT_NEUTRAL_LATENT = 0.0;

// --- Feed Configuration ---
export const MAX_FEED_ARTICLES = 30; // NOTE: client-side slice also uses 30 — see src/utils/constants.ts. Server feed size is `selection.feedSize`.

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
// RETIRED: the server never sanitizes HTML (article bodies are fetched live by the
// phone, which sanitizes with the `xss` package client-side). This list was never
// imported. Removed — re-introduce server-side only if server sanitization returns.

// --- WPM Calibration Guardrails (WPM Fix) ---
// Only sessions inside the human-plausibility band may recalibrate a user's
// stored reading speed. Skims and abandoned opens (which can compute absurd
// speeds like 10,000 WPM on long articles) are excluded from calibration so
// the baseline that read classification depends on stays honest.
export const MIN_PLAUSIBLE_WPM = 80;   // below: idle/paused screen, not reading
export const MAX_PLAUSIBLE_WPM = 600;  // above: scrolling/skimming, not reading
// Sessions consuming fewer words than this carry no reliable pace signal.
export const MIN_WPM_CALIBRATION_WORDS = 150;
// NOTE (retired FLING_WPM): the absolute 1750-WPM fling threshold was replaced by the
// relative pace model — `engagement.flingRatio` (× the user's personal averageWpm) —
// so absolute fling WPM is no longer read anywhere.
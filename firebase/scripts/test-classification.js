// Focused regression test for backend-authoritative read classification.
const admin = require('../functions/node_modules/firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp({ projectId: 'subtick-classification-test' });
}

const {
  DEFAULT_SCORING_CONFIG,
  classifyRead,
  prepareConfig,
} = require('../functions/lib/scoringConfig.js');
const { interleaveArticlesByCategory, spaceArticlesByPublisher, selectFeed } = require('../functions/lib/getRankedFeed.js');
const { normalizeFeedUrl } = require('../functions/lib/feedValidation.js');
const { applyLatentDrift, applyQuickExitRejection, computeAttentionFactor } = require('../functions/lib/weightUpdater.js');
const rankedFeedSource = require('fs').readFileSync(require('path').join(__dirname, '..', 'functions', 'src', 'getRankedFeed.ts'), 'utf8');

let failed = false;
function check(label, actual, expected) {
  const pass = actual === expected;
  console.log(`${pass ? '✓' : '✗'} ${label}: ${actual}${pass ? '' : ` (expected ${expected})`}`);
  if (!pass) failed = true;
}

function checkClose(label, actual, expected) {
  const pass = Math.abs(actual - expected) < 1e-12;
  console.log(`${pass ? '✓' : '✗'} ${label}: ${actual}${pass ? '' : ` (expected ${expected})`}`);
  if (!pass) failed = true;
}

check('feed timing logs cover configuration, profile, pool, publisher, selection, response, and total',
  rankedFeedSource.includes('[Feed Timing] config=')
    && rankedFeedSource.includes('profile=')
    && rankedFeedSource.includes('pool=')
    && rankedFeedSource.includes('publisher=')
    && rankedFeedSource.includes('selection=')
    && rankedFeedSource.includes('response=')
    && rankedFeedSource.includes('total=')
    && rankedFeedSource.includes('poolWarm=')
    && rankedFeedSource.includes('publisherWarm='),
  true);

const cfg = prepareConfig({
  classification: {
    thoroughDepth: 0.7,
    thoroughTimeFraction: 0.6, // retired: pace no longer influences labels
    quickExitDepth: 0.2,
    quickExitTimeoutSec: 15,
    shallowDepth: 0.4,
  },
});

// Stats spec: Finished = 70%+, weekly reads = 40%+, hours/WPM always counted.
// Pace plays no role in labelling — the WPM plausibility band in
// weightUpdater guards speed calibration separately.
check('70 percent depth is finished-tier regardless of pace', classifyRead(cfg, 0.8, 5_000, 5_000, 450), 'read_thorough');
check('long-article regression: 60 percent of a big read earns weekly-tier shallow (previously nothing)', classifyRead(cfg, 0.6, 20_000, 200, 450), 'read_shallow');
check('fast finish still counts as finished (pace judged by WPM band, not labels)', classifyRead(cfg, 1.0, 4_000, 3_000, 900), 'read_thorough');
check('quick-exit boundary', classifyRead(cfg, 0.19, 14_999, 200, 450), 'quick_exit');
check('just past quick-exit but under the weekly bar is not-interested', classifyRead(cfg, 0.25, 16_000, 200, 450), 'swipe_next');

// Engagement-Credit Model — attention factor (continuous pace interpolation vs the
// user's personal average; E = depth × pacePenalty). Session WPM is COMPUTED from
// consumed words ÷ active time, so durations are derived to hit the target speeds.
const A_CFG = DEFAULT_SCORING_CONFIG;
check('attention: genuine pace (matches personal average) earns full depth credit', computeAttentionFactor(0.8, 600_000, 5_000, A_CFG, 400), 0.8);
checkClose('attention: double-speed read is discounted to half credit', computeAttentionFactor(0.8, 300_000, 5_000, A_CFG, 400), 0.4);
check('attention: fling is inert', computeAttentionFactor(0.8, 125_000, 5_000, A_CFG, 400), 0);
check('attention: missing word count defaults to depth-only credit (raw-webpage edge)', computeAttentionFactor(0.8, 30_000, undefined, A_CFG, 400), 0.8);
check('attention: sub-floor consumption defaults to depth-only credit (no pace signal)', computeAttentionFactor(0.3, 30_000, 100, A_CFG, 400), 0.3);

const normalized = prepareConfig({
  scoring: {
    publisherColdStartCategoryWeight: 0.8,
    publisherColdStartPublisherWeight: 0.2,
  },
});
checkClose('cold-start category share remains normalized', normalized.scoring.publisherColdStartCategoryWeight, 0.8);
checkClose('cold-start publisher share remains normalized', normalized.scoring.publisherColdStartPublisherWeight, 0.2);
check('default cold-start category share', DEFAULT_SCORING_CONFIG.scoring.publisherColdStartCategoryWeight, 0.9);
check('feed URL removes fragment and trailing slash', normalizeFeedUrl('https://example.com/feed/#section'), 'https://example.com/feed');
let rejectedHttpFeed = false;
try { normalizeFeedUrl('http://example.com/feed'); } catch { rejectedHttpFeed = true; }
check('feed URL rejects non-HTTPS input', rejectedHttpFeed, true);

function hasAvoidableThirdRun(feed) {
  for (let index = 2; index < feed.length; index += 1) {
    const category = feed[index].category;
    if (feed[index - 1].category !== category || feed[index - 2].category !== category) continue;
    if (feed.slice(index).some((article) => article.category !== category)) return true;
  }
  return false;
}

function hasPublisherSpacingViolation(feed, spacing = 3) {
  for (let index = 0; index < feed.length; index += 1) {
    const recentPublishers = new Set(
      feed.slice(Math.max(0, index - spacing), index).map((article) => article.publicationName)
    );
    if (recentPublishers.has(feed[index].publicationName)) return true;
  }
  return false;
}

const mixedTopics = [
  ...Array.from({ length: 8 }, (_, id) => ({ id: `tech_${id}`, category: 'Technology' })),
  ...Array.from({ length: 5 }, (_, id) => ({ id: `science_${id}`, category: 'Science' })),
  ...Array.from({ length: 4 }, (_, id) => ({ id: `culture_${id}`, category: 'Culture' })),
];
const interleavedMixedTopics = interleaveArticlesByCategory(mixedTopics);
check('category interleave preserves every selected article', new Set(interleavedMixedTopics.map((article) => article.id)).size, mixedTopics.length);
check('category interleave prevents avoidable third runs', hasAvoidableThirdRun(interleavedMixedTopics), false);

const unavoidableSkew = [
  ...Array.from({ length: 7 }, (_, id) => ({ id: `tech_skew_${id}`, category: 'Technology' })),
  { id: 'science_only', category: 'Science' },
];
const interleavedSkew = interleaveArticlesByCategory(unavoidableSkew);
check('skewed interleave preserves every selected article', new Set(interleavedSkew.map((article) => article.id)).size, unavoidableSkew.length);
check('skewed interleave only exceeds two after alternatives are exhausted', hasAvoidableThirdRun(interleavedSkew), false);

const publisherMixedFeed = [
  { id: 'a_1', publicationName: 'Alpha' },
  { id: 'a_2', publicationName: 'Alpha' },
  { id: 'a_3', publicationName: 'Alpha' },
  { id: 'b_1', publicationName: 'Beta' },
  { id: 'c_1', publicationName: 'Charlie' },
  { id: 'd_1', publicationName: 'Delta' },
  { id: 'e_1', publicationName: 'Echo' },
  { id: 'f_1', publicationName: 'Foxtrot' },
  { id: 'g_1', publicationName: 'Golf' },
];
const publisherSpacedFeed = spaceArticlesByPublisher(publisherMixedFeed, 3, 'a_1');
check('publisher spacing preserves the hero article', publisherSpacedFeed[0].id, 'a_1');
check('publisher spacing preserves every selected article', new Set(publisherSpacedFeed.map((article) => article.id)).size, publisherMixedFeed.length);
check('publisher spacing prevents repeats within three cards when alternatives exist', hasPublisherSpacingViolation(publisherSpacedFeed), false);

const publisherSkewedFeed = [
  { id: 'a_1', publicationName: 'Alpha' },
  { id: 'a_2', publicationName: 'Alpha' },
  { id: 'a_3', publicationName: 'Alpha' },
  { id: 'a_4', publicationName: 'Alpha' },
  { id: 'b_1', publicationName: 'Beta' },
];
const publisherSkewedResult = spaceArticlesByPublisher(publisherSkewedFeed, 3, 'a_1');
check('publisher-skewed feed still preserves every article', new Set(publisherSkewedResult.map((article) => article.id)).size, publisherSkewedFeed.length);
check('publisher-skewed feed completes when spacing is unavoidable', publisherSkewedResult.length, publisherSkewedFeed.length);

// Drift floor — latents decay toward the floor, never past it, sign preserved.
checkClose('one-day drift scales magnitude by rate', applyLatentDrift({ Technology: 2 }, 0.95, 0).Technology, 1.9);
checkClose('thirty-day drift applies rate thirty times', applyLatentDrift({ Technology: 2 }, Math.pow(0.95, 30), 0).Technology, 2 * Math.pow(0.95, 30));
checkClose('positive latent never decays below the floor', applyLatentDrift({ Technology: 3 }, Math.pow(0.95, 60), 0.5).Technology, 0.5);
checkClose('negative latent never decays below floor (sign preserved)', applyLatentDrift({ Culture: -3 }, Math.pow(0.95, 60), 0.5).Culture, -0.5);
checkClose('latents already below the floor are untouched', applyLatentDrift({ Finance: 0.2 }, 0.1, 0.5).Finance, 0.2);

// Threshold-based quick-exit rejection — a single quick exit is a no-op.
const rejectionCfg = DEFAULT_SCORING_CONFIG;
const evidence = {};
const qeLatents = {};
const qeDeltas = {};
const qeEvent = {
  articleCategory: 'Politics',
  lengthStyle: 'short',
  publicationName: 'Alpha',
  timestamp: Date.now(),
};
applyQuickExitRejection(qeEvent, rejectionCfg, evidence, qeLatents, qeDeltas, 0);
check('a single quick exit applies no penalty', qeLatents.Politics === undefined && qeLatents['pub::Alpha'] === undefined, true);
applyQuickExitRejection(qeEvent, rejectionCfg, evidence, qeLatents, qeDeltas, 0);
check('threshold crossing applies one capped penalty to category', qeLatents.Politics, -0.6875);
check('threshold crossing applies one capped penalty to publisher axis', qeLatents['pub::Alpha'], -0.6875);
check('threshold crossing applies one capped penalty to length axis', qeLatents['short'], -0.6875);
applyQuickExitRejection(qeEvent, rejectionCfg, evidence, qeLatents, qeDeltas, 0);
check('further quick exits in the window are capped (no stacking)', qeLatents.Politics, -0.6875);

// Window expiry — stale evidence restarts, so old exits can't combine with new.
const windowExpiredEvidence = { Politics: { count: 1, windowStart: Date.now() - 3 * 24 * 60 * 60 * 1000 } };
const expiredLatents = {};
applyQuickExitRejection({ articleCategory: 'Politics', timestamp: Date.now() }, rejectionCfg, windowExpiredEvidence, expiredLatents, {}, 0);
check('evidence outside the window does not combine with a new quick exit', expiredLatents.Politics, undefined);

function scoredArticle(id, category, score) {
  return {
    article: { id, category, publicationName: `Publisher ${id}` },
    fullScore: score,
    tailScore: score,
  };
}
const categoryLimitedFeed = selectFeed([
  ...Array.from({ length: 5 }, (_, id) => scoredArticle(`tech_cap_${id}`, 'Technology', 0.8)),
  ...Array.from({ length: 3 }, (_, id) => scoredArticle(`science_cap_${id}`, 'Science', 0.75)),
  ...Array.from({ length: 3 }, (_, id) => scoredArticle(`culture_cap_${id}`, 'Culture', 0.7)),
  ...Array.from({ length: 3 }, (_, id) => scoredArticle(`history_cap_${id}`, 'History', 0.65)),
], 6, 0, {
  maxArticlesPerCategory: 2, minDistinctCategories: 3,
});
const categoryCounts = categoryLimitedFeed.reduce((counts, article) => ({ ...counts, [article.category]: (counts[article.category] || 0) + 1 }), {});
check('category cap is respected when alternatives exist', categoryCounts.Technology <= 2, true);
check('minimum distinct categories is reached when alternatives exist', Object.keys(categoryCounts).length >= 3, true);
check('category limits preserve requested feed size', categoryLimitedFeed.length, 6);

const anchoredStartupFeed = selectFeed([
  scoredArticle('high_best', 'Technology', 0.95),
  scoredArticle('high_other', 'Science', 0.80),
  scoredArticle('high_third', 'Culture', 0.70),
  scoredArticle('mid_discovery', 'History', 0.30),
  scoredArticle('tail_discovery', 'Business', 0.10),
], 5, 0, {
  maxArticlesPerCategory: 5, minDistinctCategories: 1,
});
check('highest-scoring article anchors the startup card', anchoredStartupFeed[0].id, 'high_best');
check('startup anchor preserves all selected articles', new Set(anchoredStartupFeed.map((article) => article.id)).size, 5);

const midOnlyStartupFeed = selectFeed([
  scoredArticle('mid_best', 'Technology', 0.39),
  scoredArticle('mid_other', 'Science', 0.30),
  scoredArticle('tail_only', 'Culture', 0.10),
], 3, 0, {
  maxArticlesPerCategory: 5, minDistinctCategories: 1,
});
check('highest-scoring article anchors startup when the pool is mid-tier only', midOnlyStartupFeed[0].id, 'mid_best');

const tailOnlyStartupFeed = selectFeed([
  scoredArticle('tail_best', 'Technology', 0.19),
  scoredArticle('tail_other', 'Science', 0.10),
], 2, 0, {
  maxArticlesPerCategory: 5, minDistinctCategories: 1,
});
check('highest-scoring article anchors startup when the pool is tail-tier only', tailOnlyStartupFeed[0].id, 'tail_best');

const scarceCategoryFeed = selectFeed([
  ...Array.from({ length: 6 }, (_, id) => scoredArticle(`tech_scarce_${id}`, 'Technology', 0.8)),
  scoredArticle('science_scarce', 'Science', 0.7),
], 6, 0, {
  maxArticlesPerCategory: 2, minDistinctCategories: 4,
});
check('scarce category pool still fills the feed', scarceCategoryFeed.length, 6);
check('scarce category pool keeps all selected articles unique', new Set(scarceCategoryFeed.map((article) => article.id)).size, 6);

process.exitCode = failed ? 1 : 0;

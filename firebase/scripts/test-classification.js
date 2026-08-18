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
const { interleaveArticlesByCategory, spaceArticlesByPublisher, assembleFeedWithTranches } = require('../functions/lib/getRankedFeed.js');
const { normalizeFeedUrl } = require('../functions/lib/feedValidation.js');
const { applyDecay } = require('../functions/lib/weightUpdater.js');

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

const cfg = prepareConfig({
  classification: {
    thoroughDepth: 0.7,
    thoroughTimeFraction: 0.6,
    quickExitDepth: 0.2,
    quickExitTimeoutSec: 15,
    shallowDepth: 0.4,
  },
});

// 200 words at 450 WPM has a 26.67s expected duration; 60% is 16s.
check('450 WPM deep 35s session is thorough', classifyRead(cfg, 0.8, 35_000, 200, 450), 'read_thorough');
// At 200 WPM the same session needs 36s for thorough, proving WPM affects outcome.
check('200 WPM equivalent session is skim', classifyRead(cfg, 0.8, 35_000, 200, 200), 'read_skim');
check('quick-exit boundary', classifyRead(cfg, 0.19, 14_999, 200, 450), 'quick_exit');
check('shallow boundary', classifyRead(cfg, 0.4, 20_000, 200, 450), 'read_shallow');

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

checkClose('one-day decay preserves existing rate', applyDecay({ Technology: 2 }, 0.995).Technology, 1.995);
checkClose('thirty-day decay applies rate thirty times', applyDecay({ Technology: 2 }, Math.pow(0.995, 30)).Technology, 1 + Math.pow(0.995, 30));

function scoredArticle(id, category, score) {
  return {
    article: { id, category, publicationName: `Publisher ${id}` },
    fullScore: score,
    tailScore: score,
  };
}
const categoryLimitedFeed = assembleFeedWithTranches([
  ...Array.from({ length: 5 }, (_, id) => scoredArticle(`tech_cap_${id}`, 'Technology', 0.8)),
  ...Array.from({ length: 3 }, (_, id) => scoredArticle(`science_cap_${id}`, 'Science', 0.75)),
  ...Array.from({ length: 3 }, (_, id) => scoredArticle(`culture_cap_${id}`, 'Culture', 0.7)),
  ...Array.from({ length: 3 }, (_, id) => scoredArticle(`history_cap_${id}`, 'History', 0.65)),
], 6, 50, {
  highThreshold: 0.4, midThreshold: 0.2, highSize: 6, midSize: 0, tailSize: 0,
  publisherCap: 5, maxArticlesPerCategory: 2, minDistinctCategories: 3,
});
const categoryCounts = categoryLimitedFeed.reduce((counts, article) => ({ ...counts, [article.category]: (counts[article.category] || 0) + 1 }), {});
check('category cap is respected when alternatives exist', categoryCounts.Technology <= 2, true);
check('minimum distinct categories is reached when alternatives exist', Object.keys(categoryCounts).length >= 3, true);
check('category limits preserve requested feed size', categoryLimitedFeed.length, 6);

const anchoredStartupFeed = assembleFeedWithTranches([
  scoredArticle('high_best', 'Technology', 0.95),
  scoredArticle('high_other', 'Science', 0.80),
  scoredArticle('high_third', 'Culture', 0.70),
  scoredArticle('mid_discovery', 'History', 0.30),
  scoredArticle('tail_discovery', 'Business', 0.10),
], 5, 50, {
  highThreshold: 0.4, midThreshold: 0.2, highSize: 3, midSize: 1, tailSize: 1,
  publisherCap: 5, maxArticlesPerCategory: 5, minDistinctCategories: 1,
});
check('highest High-tranche article anchors the startup card', anchoredStartupFeed[0].id, 'high_best');
check('startup anchor preserves all selected articles', new Set(anchoredStartupFeed.map((article) => article.id)).size, 5);

const midOnlyStartupFeed = assembleFeedWithTranches([
  scoredArticle('mid_best', 'Technology', 0.39),
  scoredArticle('mid_other', 'Science', 0.30),
  scoredArticle('tail_only', 'Culture', 0.10),
], 3, 50, {
  highThreshold: 0.4, midThreshold: 0.2, highSize: 1, midSize: 1, tailSize: 1,
  publisherCap: 5, maxArticlesPerCategory: 5, minDistinctCategories: 1,
});
check('highest Mid-tranche article anchors startup when High is empty', midOnlyStartupFeed[0].id, 'mid_best');

const tailOnlyStartupFeed = assembleFeedWithTranches([
  scoredArticle('tail_best', 'Technology', 0.19),
  scoredArticle('tail_other', 'Science', 0.10),
], 2, 50, {
  highThreshold: 0.4, midThreshold: 0.2, highSize: 0, midSize: 0, tailSize: 2,
  publisherCap: 5, maxArticlesPerCategory: 5, minDistinctCategories: 1,
});
check('highest Tail-tranche article anchors startup when High and Mid are empty', tailOnlyStartupFeed[0].id, 'tail_best');

const scarceCategoryFeed = assembleFeedWithTranches([
  ...Array.from({ length: 6 }, (_, id) => scoredArticle(`tech_scarce_${id}`, 'Technology', 0.8)),
  scoredArticle('science_scarce', 'Science', 0.7),
], 6, 50, {
  highThreshold: 0.4, midThreshold: 0.2, highSize: 6, midSize: 0, tailSize: 0,
  publisherCap: 5, maxArticlesPerCategory: 2, minDistinctCategories: 4,
});
check('scarce category pool still fills the feed', scarceCategoryFeed.length, 6);
check('scarce category pool keeps all selected articles unique', new Set(scarceCategoryFeed.map((article) => article.id)).size, 6);

process.exitCode = failed ? 1 : 0;

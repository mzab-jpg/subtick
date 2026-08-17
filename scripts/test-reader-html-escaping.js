// Focused regression test for RSS metadata escaping in the Reader WebView.
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'screens', 'ReaderScreen.tsx'), 'utf8');
const loaderSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'features', 'reader', 'useArticleLoader.ts'), 'utf8');
const dashboardSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'screens', 'DashboardScreen.tsx'), 'utf8');
const settingsSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'screens', 'SettingsScreen.tsx'), 'utf8');
const toggleSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'TangentToggle.tsx'), 'utf8');
const statsSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'screens', 'DashboardStatsScreen.tsx'), 'utf8');
const feedServiceSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'feedService.ts'), 'utf8');
const dashboardCacheSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'dashboardFeedCache.ts'), 'utf8');
const requiredMappings = [
  [".replace(/&/g, '&amp;')", 'ampersand'],
  [".replace(/</g, '&lt;')", 'less-than'],
  [".replace(/>/g, '&gt;')", 'greater-than'],
  [".replace(/\"/g, '&quot;')", 'double-quote'],
  [".replace(/'/g, '&#39;')", 'single-quote'],
];

let failed = false;
for (const [mapping, label] of requiredMappings) {
  const pass = source.includes(mapping);
  console.log(`${pass ? '✓' : '✗'} Reader escapes ${label}`);
  if (!pass) failed = true;
}

const readerCloseRecordsHistory = source.includes('const handleCloseReader = useCallback')
  && source.includes('markArticleSeen(article.id, article);');
console.log(`${readerCloseRecordsHistory ? '✓' : '✗'} Reader close records the opened article in History`);
if (!readerCloseRecordsHistory) failed = true;

const themeUpdatesDoNotReload = source.includes('webViewRef.current.injectJavaScript(cssUpdateScript);')
  && !source.includes('webViewRef.current.reload()');
console.log(`${themeUpdatesDoNotReload ? '✓' : '✗'} Theme CSS updates do not reload the WebView`);
if (!themeUpdatesDoNotReload) failed = true;

const archivePreferenceIsRespected = loaderSource.includes('allowArchivedFallback: boolean;')
  && loaderSource.includes("data.rssStatus === 'archived'")
  && loaderSource.includes('if (!allowArchivedFallback)')
  && loaderSource.includes('setUnavailableFromRss(true);')
  && source.includes('unavailableFromRss')
  && source.includes('contextProfile?.includeArchivedArticles === true && archivedArticleUrl');
console.log(`${archivePreferenceIsRespected ? '✓' : '✗'} RSS-unavailable articles silently skip when Archived Articles is off`);
if (!archivePreferenceIsRespected) failed = true;

const dashboardCardsUpdateOnlyForOpenedArticles = dashboardSource.includes('subscribeToCachedDashboardFeed')
  && feedServiceSource.includes('removeArticleFromCachedDashboardFeed(cachedUserId, articleId);')
  && dashboardCacheSource.includes('removeArticleFromCachedDashboardFeed')
  && dashboardSource.includes('const merged = [...previous, ...additions');
console.log(`${dashboardCardsUpdateOnlyForOpenedArticles ? '✓' : '✗'} Reader removes opened Dashboard cards and preserves unread-card order`);
if (!dashboardCardsUpdateOnlyForOpenedArticles) failed = true;

const rawRssCacheIsWarmedForTheAppProcess = !loaderSource.includes('preparedContentRef')
  && loaderSource.includes('await warmFeed(data.feedUrl);')
  && loaderSource.includes('pendingPrefetchIdsRef.current = upcomingIds;')
  && loaderSource.includes('if (pendingIds) void prefetchArticles(pendingIds);')
  && source.includes('activeQueueIds.slice(currentIndex + 1, currentIndex + 3)')
  && source.includes('currentIndex, activeQueueIds, prefetchArticles')
  && !source.includes('clearFeedSessionCache')
  && feedServiceSource.includes('export async function warmFeed')
  && feedServiceSource.includes('const feedSessionCache = new Map')
  && feedServiceSource.includes('sanitizeClientHtml(matchedItem.rawHtml)');
console.log(`${rawRssCacheIsWarmedForTheAppProcess ? '✓' : '✗'} Reader warms raw publisher RSS without caching cleaned HTML until app close`);
if (!rawRssCacheIsWarmedForTheAppProcess) failed = true;

const animatedToggleIsUsed = settingsSource.includes("import { TangentToggle } from '../components/TangentToggle';")
  && settingsSource.includes('<TangentToggle')
  && !settingsSource.includes('<Switch')
  && toggleSource.includes('Animated.timing')
  && toggleSource.includes('accessibilityRole="switch"');
console.log(`${animatedToggleIsUsed ? '✓' : '✗'} Archived Articles uses Tangent's accessible animated toggle`);
if (!animatedToggleIsUsed) failed = true;

const dashboardStatsFollowCategoryRows = statsSource.includes("stateLabel = isSelected ? 'Shown on Dashboard'")
  && statsSource.includes('backgroundColor: rowBackground')
  && !statsSource.includes('styles.checkbox')
  && !statsSource.includes('<Check');
console.log(`${dashboardStatsFollowCategoryRows ? '✓' : '✗'} Dashboard metric selection follows the category-row visual model`);
if (!dashboardStatsFollowCategoryRows) failed = true;

process.exitCode = failed ? 1 : 0;

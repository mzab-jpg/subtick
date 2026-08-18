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
const behaviorSyncSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'behaviorSync.ts'), 'utf8');
const navigationQueueSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'features', 'reader', 'useNavigationQueue.ts'), 'utf8');
const dashboardCacheSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'dashboardFeedCache.ts'), 'utf8');
const nativeModuleSource = fs.readFileSync(path.join(__dirname, '..', 'modules', 'tangent-rss-parser', 'android', 'src', 'main', 'java', 'expo', 'modules', 'tangentrssparser', 'TangentRssParserModule.kt'), 'utf8');
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
  && loaderSource.includes('error instanceof RssArticleNotFoundError')
  && loaderSource.includes('setUnavailableFromRss(true);')
  && source.includes('unavailableFromRss')
  && source.includes('markArticleSeen(article.id, article).finally(() => goToNext())');
console.log(`${archivePreferenceIsRespected ? '✓' : '✗'} Confirmed absent RSS articles silently skip when Archived Articles is off`);
if (!archivePreferenceIsRespected) failed = true;

const dashboardCardsUpdateOnlyForOpenedArticles = dashboardSource.includes('subscribeToCachedDashboardFeed')
  && feedServiceSource.includes('removeArticleFromCachedDashboardFeed(cachedUserId, articleId);')
  && dashboardCacheSource.includes('removeArticleFromCachedDashboardFeed')
  && dashboardSource.includes('const merged = [...previous, ...additions');
console.log(`${dashboardCardsUpdateOnlyForOpenedArticles ? '✓' : '✗'} Reader removes opened Dashboard cards and preserves unread-card order`);
if (!dashboardCardsUpdateOnlyForOpenedArticles) failed = true;

const nativeModuleFilesExist = fs.existsSync(path.join(__dirname, '..', 'modules', 'tangent-rss-parser', 'expo-module.config.json'))
  && fs.existsSync(path.join(__dirname, '..', 'modules', 'tangent-rss-parser', 'index.ts'))
  && fs.existsSync(path.join(__dirname, '..', 'modules', 'tangent-rss-parser', 'android', 'src', 'main', 'java', 'expo', 'modules', 'tangentrssparser', 'TangentRssParserModule.kt'));
console.log(`${nativeModuleFilesExist ? '✓' : '✗'} Android native RSS module source is present`);
if (!nativeModuleFilesExist) failed = true;

const androidNativeFiveArticleBuffer = !loaderSource.includes('preparedContentRef')
  && loaderSource.includes('await prepareArticle(data.feedUrl, data.guid, data.publicationUrl);')
  && loaderSource.includes('Promise.all([prepareNextTarget(), prepareNextTarget()])')
  && loaderSource.includes('sameTargets')
  && navigationQueueSource.includes('preparedArticleIdsRef')
  && navigationQueueSource.includes('const windowStart = currentIndex + 1;')
  && navigationQueueSource.includes('windowStart + 5')
  && navigationQueueSource.includes('const ready = futureWindow.filter')
  && source.includes('prioritizePreparedArticleRef')
  && source.includes('activeQueueIds.slice(currentIndex + 1, currentIndex + 6)')
  && source.includes('prefetchArticles(upcomingIds)')
  && source.includes('cancelPrefetch();')
  && feedServiceSource.includes("import NativeRssParser from '../../modules/tangent-rss-parser';")
  && feedServiceSource.includes("Platform.OS === 'android' && NativeRssParser !== null")
  && feedServiceSource.includes('NativeRssParser!.preloadFeed(feedUrl)')
  && feedServiceSource.includes('NativeRssParser!.prepareArticle(feedUrl, guid, articleUrl)')
  && feedServiceSource.includes('NativeRssParser!.findArticle(feedUrl, guid, articleUrl)')
  && feedServiceSource.includes('RssArticleNotFoundError')
  && feedServiceSource.includes('sanitizeClientHtml(matchedItem.rawHtml)')
  && nativeModuleSource.includes('activeExecutor')
  && nativeModuleSource.includes('preloadExecutor')
  && nativeModuleSource.includes('LinkedHashMap<String, ByteArray>')
  && nativeModuleSource.includes('downloadCacheableRawFeed')
  && nativeModuleSource.includes('prepareSelectedArticle')
  && nativeModuleSource.includes('MAX_PREPARED_ARTICLES = 5')
  && nativeModuleSource.includes('preparedArticles.remove(key)')
  && nativeModuleSource.includes('prepared article hit')
  && nativeModuleSource.includes('prepareSelectedArticle')
  && nativeModuleSource.includes('findSelectedArticle')
  && nativeModuleSource.includes('findItemInFeed')
  && nativeModuleSource.includes('CacheLimitReachedException')
  && !nativeModuleSource.includes('RSS feed exceeds the 5 MB safety limit.');
console.log(`${androidNativeFiveArticleBuffer ? '✓' : '✗'} Android native RSS parser maintains a rolling five-article raw-feed buffer`);
if (!androidNativeFiveArticleBuffer) failed = true;

const readerTransitionReliability = source.includes('const SWIPE_PAUSE_THRESHOLD_MS = 200;')
  && source.includes('onPanResponderMove:')
  && source.includes('const timeSinceLastMove = Date.now() - swipeLastMoveTimeRef.current;')
  && source.includes('if (timeSinceLastMove > SWIPE_PAUSE_THRESHOLD_MS) return;')
  && loaderSource.includes('setTimeout(() => {')
  && loaderSource.includes('}, 180);')
  && source.includes('slowLoading &&')
  && source.includes('...StyleSheet.absoluteFill')
  && loaderSource.includes('loadGenerationRef')
  && !behaviorSyncSource.includes('if (unsynced >= SYNC_BATCH_SIZE)')
  && !navigationQueueSource.includes('flushBehaviorQueue()')
  && loaderSource.includes('error instanceof RssArticleNotFoundError')
  && loaderSource.includes('Do not trust legacy device-persisted RSS failure flags')
  && !loaderSource.includes('await markRssFailed(id)')
  && !loaderSource.includes('catch {\n              needsFallback = true;')
  && source.includes('onPress={() => void loadArticle(activeArticleId)}')
  && loaderSource.includes('[Reader Timing] content state ready')
  && feedServiceSource.includes('[Reader Timing] HTML sanitisation')
  && source.includes('[Reader Timing] WebView load complete');
console.log(`${readerTransitionReliability ? '✓' : '✗'} Reader keeps pause-to-cancel swipes, avoids fast-load spinner flashes, and defers sync during reading`);
if (!readerTransitionReliability) failed = true;

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

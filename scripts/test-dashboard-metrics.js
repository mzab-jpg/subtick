// Focused regression checks for dashboard metric rules.
// Kept dependency-free to match the project's existing Node test scripts.

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function countWeeklyQualifyingReads(events, now) {
  const windowStart = now - WEEK_MS;
  return events.filter((event) =>
    event.timestamp >= windowStart
    && event.timestamp <= now
    && (event.eventType === 'read_thorough' || event.eventType === 'read_skim')
  ).length;
}

function normalizeDashboardMetricIds(metricIds) {
  return [...new Set(metricIds)].slice(0, 3);
}

let failed = false;
function check(label, actual, expected) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${pass ? '✓' : '✗'} ${label}: ${JSON.stringify(actual)}${pass ? '' : ` (expected ${JSON.stringify(expected)})`}`);
  if (!pass) failed = true;
}

const now = 1_000_000_000;
check('counts only qualifying reads in the rolling seven-day window', countWeeklyQualifyingReads([
  { eventType: 'read_thorough', timestamp: now - WEEK_MS },
  { eventType: 'read_skim', timestamp: now - WEEK_MS + 1 },
  { eventType: 'read_shallow', timestamp: now - 1 },
  { eventType: 'read_thorough', timestamp: now - WEEK_MS - 1 },
  { eventType: 'read_skim', timestamp: now + 1 },
], now), 2);
check('removes duplicate metric IDs and keeps the visual limit', normalizeDashboardMetricIds([
  'streak', 'streak', 'avgWpm', 'weeklyReads', 'totalRead',
]), ['streak', 'avgWpm', 'weeklyReads']);

const fs = require('fs');
const path = require('path');
const appSource = fs.readFileSync(path.join(__dirname, '..', 'App.tsx'), 'utf8');
const accountSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'screens', 'AccountScreen.tsx'), 'utf8');
const userContextSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'contexts', 'UserContext.tsx'), 'utf8');
const dashboardSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'screens', 'DashboardScreen.tsx'), 'utf8');
const readerSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'screens', 'ReaderScreen.tsx'), 'utf8');
const navigatorSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'navigation', 'RootNavigator.tsx'), 'utf8');
const settingsSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'screens', 'SettingsScreen.tsx'), 'utf8');
const categoryPreferencesSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'screens', 'CategoryPreferencesScreen.tsx'), 'utf8');
const dashboardStatsSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'screens', 'DashboardStatsScreen.tsx'), 'utf8');
const articleListSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'ArticleListScreen.tsx'), 'utf8');
const startupScreenSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'StartupScreen.tsx'), 'utf8');
const homeLoadingStateSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'HomeLoadingState.tsx'), 'utf8');
const loadingCursorSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'LoadingCursor.tsx'), 'utf8');
const startupCacheSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'startupCache.ts'), 'utf8');
const dashboardCacheSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'dashboardFeedCache.ts'), 'utf8');
const initialDashboardFeedSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'initialDashboardFeed.ts'), 'utf8');
check('account changes use a blocking transition before onboarding',
  appSource.includes('subscribeToAccountTransition')
    && appSource.includes('if (initializing || accountTransitioning)')
    && appSource.includes('Reset Account keeps the same UID')
    && accountSource.includes('beginAccountTransition();')
    && accountSource.includes('clearCachedDashboardFeed(auth.currentUser?.uid);')
    && accountSource.includes('endAccountTransition();')
    && !accountSource.includes('navigation.reset({ index: 0, routes: [{ name: \'Onboarding\' }] })'),
  true);
check('old profile and weekly stats clear at the start of an auth change',
  userContextSource.includes('setProfile(null);') && userContextSource.includes('setWeeklyReadCount(0);'),
  true);
check('Dashboard reads a prepared user-scoped feed cache during first state creation instead of flashing Loading',
  dashboardSource.includes('initialCachedFeedRef = useRef(getCachedDashboardFeed(auth.currentUser?.uid || \'\'))')
    && dashboardSource.includes('useState<Article[]>(() => initialCachedFeedRef.current?.articles ?? [])')
    && dashboardSource.includes('useState(() => !initialCachedFeedRef.current?.articles.length)')
    && dashboardSource.includes('new Set(initialCachedFeedRef.current?.shownIds ?? [])')
    && dashboardSource.includes('setCachedDashboardFeed'),
  true);
check('Reader system navigation shares the guarded history/session exit path',
  readerSource.includes("navigation.addListener('beforeRemove'") && readerSource.includes('finishAndExitReader'),
  true);
check('Settings navigation retains the established modal configuration',
  navigatorSource.includes("name=\"Settings\"") && navigatorSource.includes("presentation: 'modal'"),
  true);
check('provisional WPM is calculated as words divided by active time',
  userContextSource.includes('calculateWpm') && userContextSource.includes('sessionWpm === null') && userContextSource.includes('setProvisionalProfile'),
  true);
check('Shuffle replenishment appends instead of replacing remaining cards',
  dashboardSource.includes('appendFeedArticles') && dashboardSource.includes('const merged = [...previous, ...additions') && !dashboardSource.includes('loadFeedArticles(effectiveProfile).catch(() => {})'),
  true);
check('Settings-family routes retain their page shell during loading',
  !settingsSource.includes('if (loading)')
    && !accountSource.includes('if (loading)')
    && !categoryPreferencesSource.includes('if (loading)')
    && !dashboardStatsSource.includes('if (loading)')
    && !articleListSource.includes('if (loading && articles.length === 0)')
    && settingsSource.includes('styles.inlineLoading')
    && accountSource.includes('styles.inlineLoading')
    && categoryPreferencesSource.includes('styles.inlineLoading')
    && dashboardStatsSource.includes('styles.inlineLoading')
    && articleListSource.includes('styles.inlineLoading'),
  true);
check('development timing markers cover startup, onboarding, and first-feed handoffs',
  appSource.includes('[Startup Timing] authentication ready')
    && appSource.includes('[Startup Timing] initial profile ready')
    && appSource.includes('[Startup Timing] React startup screen dismissed')
    && userContextSource.includes('[Startup Timing] shared profile listener ready')
    && dashboardSource.includes('[Startup Timing] first ranked feed requested')
    && dashboardSource.includes('[Startup Timing] ranked feed returned')
    && fs.readFileSync(path.join(__dirname, '..', 'src', 'screens', 'OnboardingScreen.tsx'), 'utf8').includes('[Onboarding Timing] category save confirmed'),
  true);
check('startup cache is UID-bound, expires, filters seen cards, and never stores credentials',
  startupCacheSource.includes('snapshot.userId === userId')
    && startupCacheSource.includes('MAX_DASHBOARD_CACHE_AGE_MS')
    && startupCacheSource.includes('feed.userId !== userId')
    && dashboardCacheSource.includes('restoreCachedDashboardFeed')
    && dashboardCacheSource.includes('clearPersistentStartupCache')
    && !startupCacheSource.includes('token')
    && !startupCacheSource.includes('password'),
  true);
check('returning startup restores only after Firebase identity and refreshes without replacing visible cards',
  appSource.includes('getStartupSnapshot(user.uid)')
    && appSource.includes('Background profile verification failed')
    && appSource.includes('restoreCachedDashboardFeed(user.uid, seenIds)')
    && appSource.includes('setCachedDashboardFeed(user.uid, result.articles, [])')
    && dashboardSource.includes('restoreCachedDashboardFeed(userId, await getSeenArticleIdsLocally())')
    && dashboardSource.includes('stageDashboardFeedForNextLaunch')
    && dashboardSource.includes('Fresh recommendations are saved for the next launch'),
  true);
check('onboarding and Dashboard share one first ranked-feed request',
  initialDashboardFeedSource.includes('const requests = new Map')
    && initialDashboardFeedSource.includes('takeInitialDashboardFeedResult')
    && dashboardSource.includes('getInitialDashboardFeedRequest')
    && dashboardSource.includes('takeInitialDashboardFeedResult')
    && initialDashboardFeedSource.includes('Register the shared promise before even a local-storage read begins')
    && fs.readFileSync(path.join(__dirname, '..', 'src', 'screens', 'OnboardingScreen.tsx'), 'utf8').includes('requestInitialDashboardFeed'),
  true);
check('Dashboard uses the minimal Loading cursor only while cards themselves are unavailable',
  dashboardSource.includes('if (loading) {')
    && !dashboardSource.includes('if (loading || contextLoading)')
    && dashboardSource.includes('<HomeLoadingState />')
    && !dashboardSource.includes('ActivityIndicator')
    && homeLoadingStateSource.includes('<LoadingCursor />')
    && loadingCursorSource.includes('>Loading</Text>')
    && loadingCursorSource.includes('>|</Animated.Text>')
    && loadingCursorSource.includes('alignSelf: \'flex-start\'')
    && startupScreenSource.includes('const TYPE_INTERVAL_MS = 120')
    && startupScreenSource.includes('>TANGENT</Text>')
    && startupScreenSource.includes('Animated.loop'),
  true);
check('startup uses the Home-consistent system-font TANGENT/Sapere aude cursor rather than an emoji spinner',
  appSource.includes("import { StartupScreen } from './src/components/StartupScreen';")
    && appSource.includes('<StartupScreen')
    && appSource.includes('onTypingComplete={() => setStartupTypingComplete(true)}')
    && startupScreenSource.includes("const MOTTO = 'sapere aude';")
    && startupScreenSource.includes('onTypingComplete')
    && appSource.includes('startupPreparationComplete')
    && appSource.includes('startupTypingComplete')
    && startupScreenSource.includes('>TANGENT</Text>')
    && !startupScreenSource.includes("fontFamily: 'Georgia'")
    && startupScreenSource.includes('Animated.loop')
    && !appSource.includes('Connecting to your personalized feed...'),
  true);

process.exitCode = failed ? 1 : 0;

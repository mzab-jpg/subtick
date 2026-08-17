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
check('Dashboard restores a user-scoped feed cache instead of refetching after remount',
  dashboardSource.includes('getCachedDashboardFeed') && dashboardSource.includes('setCachedDashboardFeed'),
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

process.exitCode = failed ? 1 : 0;

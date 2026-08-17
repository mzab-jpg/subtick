// Focused regression test for RSS metadata escaping in the Reader WebView.
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'screens', 'ReaderScreen.tsx'), 'utf8');
const loaderSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'features', 'reader', 'useArticleLoader.ts'), 'utf8');
const dashboardSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'screens', 'DashboardScreen.tsx'), 'utf8');
const settingsSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'screens', 'SettingsScreen.tsx'), 'utf8');
const toggleSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'TangentToggle.tsx'), 'utf8');
const statsSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'screens', 'DashboardStatsScreen.tsx'), 'utf8');
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
  && loaderSource.includes('setFetchError(true);')
  && source.includes('allowArchivedFallback: contextProfile?.includeArchivedArticles === true');
console.log(`${archivePreferenceIsRespected ? '✓' : '✗'} RSS failure respects Archived Articles being off`);
if (!archivePreferenceIsRespected) failed = true;

const dashboardCardsStayStableAfterReaderClose = !dashboardSource.includes('consumedIdsRef')
  && dashboardSource.includes('sessionShownIds.current.add(articleId);')
  && !dashboardSource.includes('shuffledQueue.forEach(id => sessionShownIds.current.add(id));');
console.log(`${dashboardCardsStayStableAfterReaderClose ? '✓' : '✗'} Reader close does not silently replace unread Dashboard cards`);
if (!dashboardCardsStayStableAfterReaderClose) failed = true;

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

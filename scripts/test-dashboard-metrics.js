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

process.exitCode = failed ? 1 : 0;

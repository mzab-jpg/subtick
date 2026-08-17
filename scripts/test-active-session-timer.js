// Focused regression test for foreground-only reader session duration.
const {
  createActiveSessionClock,
  pauseActiveSession,
  resumeActiveSession,
  getActiveSessionDuration,
} = require('../src/utils/activeSessionTimer.js');

let failed = false;
function check(label, actual, expected) {
  const pass = actual === expected;
  console.log(`${pass ? '✓' : '✗'} ${label}: ${actual}${pass ? '' : ` (expected ${expected})`}`);
  if (!pass) failed = true;
}

const singlePause = createActiveSessionClock(0);
pauseActiveSession(singlePause, 30_000);
check('ongoing background time is excluded before resume', getActiveSessionDuration(singlePause, 150_000), 30_000);
resumeActiveSession(singlePause, 150_000);
check('30s active + 120s background + 30s active is 60s', getActiveSessionDuration(singlePause, 180_000), 60_000);

const multiplePauses = createActiveSessionClock(0);
pauseActiveSession(multiplePauses, 10_000);
resumeActiveSession(multiplePauses, 30_000);
pauseActiveSession(multiplePauses, 50_000);
resumeActiveSession(multiplePauses, 80_000);
check('multiple pauses are all excluded', getActiveSessionDuration(multiplePauses, 100_000), 50_000);

const activeOnly = createActiveSessionClock(1_000);
check('active-only session retains wall-clock duration', getActiveSessionDuration(activeOnly, 26_000), 25_000);

const fs = require('fs');
const path = require('path');
const trackerSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'hooks', 'useBehaviorTracker.ts'), 'utf8');
const readerSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'screens', 'ReaderScreen.tsx'), 'utf8');
const immediateExitWithBackgroundSync = trackerSource.includes('await queueBehaviorEvent(')
  && readerSource.includes('const wordCountForSession = actualWordCountRef.current || article.wordCount || 0;')
  && readerSource.includes('await behaviorTracker.concludeSession(wordCountForSession);')
  && readerSource.includes('await markArticleSeen(article.id, article);')
  && readerSource.includes('void flushBehaviorQueue();')
  && !readerSource.includes('await flushBehaviorQueue();');
check('closing Reader persists local history before immediate exit and syncs in background', immediateExitWithBackgroundSync, true);
check('Reader supplies stored article words when WebView count has not arrived',
  readerSource.includes('actualWordCountRef.current || article.wordCount || 0'), true);

process.exitCode = failed ? 1 : 0;

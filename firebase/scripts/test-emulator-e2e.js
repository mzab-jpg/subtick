// End-to-end test: anonymous sign-in + getRankedFeed on the EMULATORS.
// Mirrors exactly what high_fidelity_matrix.html does at runtime.
const base = {
  auth: 'http://127.0.0.1:9099',
  func: 'http://127.0.0.1:5001/subtick-bbd55/us-central1',
};

(async () => {
  // 1. Anonymous sign-up via Auth emulator REST
  const signRes = await fetch(
    `${base.auth}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ returnSecureToken: true }),
    }
  );
  const signData = await signRes.json();
  if (!signData.idToken) {
    console.error('SIGN-IN FAILED:', JSON.stringify(signData));
    process.exit(1);
  }
  console.log('Signed in anonymously as', signData.localId);

  // 2. Call getRankedFeed (callable HTTPS protocol)
  const feedRes = await fetch(`${base.func}/getRankedFeed`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${signData.idToken}`,
    },
    body: JSON.stringify({
      data: { seenArticleIds: [], includeScores: true },
    }),
  });
  const feedData = await feedRes.json();
  if (feedData.error) {
    console.error('getRankedFeed FAILED:', JSON.stringify(feedData.error));
    process.exit(1);
  }
  const articles = (feedData.result && feedData.result.articles) || [];
  console.log('getRankedFeed returned', articles.length, 'articles');
  if (articles.length) {
    const sample = articles[0];
    console.log('Sample article:', sample.title.slice(0, 60));
    console.log('  category:', sample.category, '| pub:', sample.publicationName);
    console.log('  _score:', JSON.stringify(sample._score || 'MISSING'));
  }

  // 3. Call getScoringConfig (config read the dashboard does)
  const cfgRes = await fetch(`${base.func}/getScoringConfig`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${signData.idToken}`,
    },
    body: JSON.stringify({ data: {} }),
  });
  const cfgData = await cfgRes.json();
  if (cfgData.error) {
    console.error('getScoringConfig FAILED:', JSON.stringify(cfgData.error));
    process.exit(1);
  }
  console.log('getScoringConfig OK — source:', cfgData.result && cfgData.result.source);

  console.log('\n✅ ALL EMULATOR CHECKS PASSED');
  // Small delay lets undici's sockets close before exit (avoids a Windows
  // libuv teardown assertion that otherwise occurs after process.exit).
  setTimeout(() => process.exit(0), 100);
})().catch((e) => {
  console.error('TEST CRASHED:', e.message);
  setTimeout(() => process.exit(1), 100);
});
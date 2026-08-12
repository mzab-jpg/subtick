const admin = require('../functions/node_modules/firebase-admin');
const app = admin.initializeApp({ projectId: 'subtick-bbd55' }, 'probe');
const db = admin.firestore(app);
db.settings({ host: '127.0.0.1:8080', ssl: false });

(async () => {
  const arts = await db.collection('articles').limit(3).get();
  console.log('articles total:', (await db.collection('articles').get()).size);
  arts.forEach(doc => {
    const d = doc.data();
    console.log('---', doc.id);
    console.log('  title:', (d.title || '').slice(0, 50));
    console.log('  random_score:', d.random_score, '| isPaywalled:', d.isPaywalled, '| wordCount:', d.wordCount, '| publishDate:', d.publishDate);
    console.log('  category:', d.category, '| lengthStyle:', d.lengthStyle, '| trendingScore:', d.trendingScore);
  });
  const feeds = await db.collection('feeds').get();
  console.log('feeds total:', feeds.size);
  const pubs = await db.collection('publishers').get();
  console.log('publishers total:', pubs.size);
  pubs.docs.slice(0, 2).forEach(doc => console.log('  pub:', doc.id, JSON.stringify(doc.data())));
  const cfg = await db.collection('system').doc('scoringConfig').get();
  console.log('scoringConfig exists:', cfg.exists);
  if (cfg.exists) console.log('  personalization:', cfg.data().scoring && cfg.data().scoring.personalization);
  setTimeout(() => process.exit(0), 100);
})().catch(e => { console.error('PROBE FAILED:', e.message); setTimeout(() => process.exit(1), 100); });
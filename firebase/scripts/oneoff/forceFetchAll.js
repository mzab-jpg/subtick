const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const Parser = require('rss-parser');
const { createHash } = require('crypto');

initializeApp({ projectId: 'subtick-bbd55' });
const db = getFirestore();
const parser = new Parser({ timeout: 15000, headers: { 'User-Agent': 'SubTick/1.0 Reset' } });

// Match constants from the backend (ALL 35 FEEDS)
const SUBSTACK_FEEDS = [
  { url: "https://www.platformer.news/feed", category: "Technology & Innovation", publicationName: "Platformer", qualityScore: 0.92 },
  { url: "https://stratechery.com/feed/", category: "Technology & Innovation", publicationName: "Stratechery", qualityScore: 0.95 },
  { url: "https://newsletter.pragmaticengineer.com/feed", category: "Technology & Innovation", publicationName: "The Pragmatic Engineer", qualityScore: 0.90 },
  { url: "https://www.lennysnewsletter.com/feed", category: "Technology & Innovation", publicationName: "Lenny's Newsletter", qualityScore: 0.88 },
  { url: "https://thealgorithmicbridge.substack.com/feed", category: "Technology & Innovation", publicationName: "The Algorithmic Bridge", qualityScore: 0.78 },
  { url: "https://aisupremacy.substack.com/feed", category: "Technology & Innovation", publicationName: "AI Supremacy", qualityScore: 0.72 },
  { url: "https://www.noahpinion.blog/feed", category: "Business & Finance", publicationName: "Noahpinion", qualityScore: 0.85 },
  { url: "https://plus.thebulwark.com/feed", category: "Politics & Global Affairs", publicationName: "The Bulwark", qualityScore: 0.80 },
  { url: "https://www.slowboring.com/feed", category: "Politics & Global Affairs", publicationName: "Slow Boring", qualityScore: 0.90 },
  { url: "https://heathercoxrichardson.substack.com/feed", category: "Politics & Global Affairs", publicationName: "Heather Cox Richardson", qualityScore: 0.82 },
  { url: "https://www.readtangle.com/feed", category: "Politics & Global Affairs", publicationName: "Tangle", qualityScore: 0.88 },
  { url: "https://thedispatch.com/feed/", category: "Politics & Global Affairs", publicationName: "The Dispatch", qualityScore: 0.78 },
  { url: "https://kyla.substack.com/feed", category: "Business & Finance", publicationName: "Kyla's Newsletter", qualityScore: 0.70 },
  { url: "https://www.netinterest.co/feed", category: "Business & Finance", publicationName: "Net Interest", qualityScore: 0.85 },
  { url: "https://newsletter.doomberg.com/feed", category: "Business & Finance", publicationName: "Doomberg", qualityScore: 0.80 },
  { url: "https://thebearcave.substack.com/feed", category: "Business & Finance", publicationName: "The Bear Cave", qualityScore: 0.82 },
  { url: "https://calculatedrisk.substack.com/feed", category: "Business & Finance", publicationName: "Calculated Risk", qualityScore: 0.75 },
  { url: "https://annehelen.substack.com/feed", category: "Arts & Culture", publicationName: "Culture Study", qualityScore: 0.88 },
  { url: "https://www.honest-broker.com/feed", category: "Arts & Culture", publicationName: "The Honest Broker", qualityScore: 0.90 },
  { url: "https://maybebaby.substack.com/feed", category: "Arts & Culture", publicationName: "Maybe Baby", qualityScore: 0.72 },
  { url: "https://freddiedeboer.substack.com/feed", category: "Philosophy & Human Behavior", publicationName: "Freddie deBoer", qualityScore: 0.78 },
  { url: "https://www.blockedandreported.org/feed", category: "Arts & Culture", publicationName: "Blocked and Reported", qualityScore: 0.75 },
  { url: "https://nightcrawler.substack.com/feed", category: "Arts & Culture", publicationName: "The Nightcrawler", qualityScore: 0.65 },
  { url: "https://www.garbageday.email/feed", category: "Arts & Culture", publicationName: "Garbage Day", qualityScore: 0.80 },
  { url: "https://astralcodexten.substack.com/feed", category: "Philosophy & Human Behavior", publicationName: "Astral Codex Ten", qualityScore: 0.95 },
  { url: "https://worksinprogress.co/feed", category: "Science & Health", publicationName: "Works in Progress", qualityScore: 0.88 },
  { url: "https://experimentalhistory.substack.com/feed", category: "Philosophy & Human Behavior", publicationName: "Experimental History", qualityScore: 0.85 },
  { url: "https://dynomight.substack.com/feed", category: "Science & Health", publicationName: "Dynomight", qualityScore: 0.82 },
  { url: "https://mindthesciencegap.substack.com/feed", category: "Science & Health", publicationName: "Mind the Science Gap", qualityScore: 0.70 },
  { url: "https://yourlocalepidemiologist.substack.com/feed", category: "Science & Health", publicationName: "Your Local Epidemiologist", qualityScore: 0.88 },
  { url: "https://examined.substack.com/feed", category: "Science & Health", publicationName: "Examined", qualityScore: 0.78 },
  { url: "https://unsettledscience.substack.com/feed", category: "Science & Health", publicationName: "Unsettled Science", qualityScore: 0.65 },
  { url: "https://whyisthisinteresting.substack.com/feed", category: "Arts & Culture", publicationName: "Why Is This Interesting?", qualityScore: 0.85 },
  { url: "https://numlock.substack.com/feed", category: "Business & Finance", publicationName: "Numlock News", qualityScore: 0.75 },
  { url: "https://www.thediff.co/feed", category: "Business & Finance", publicationName: "The Diff", qualityScore: 0.88 }
];

const PAYWALL_KEYWORDS = [
  'To read this post, subscribe', 'Paid subscription required', 'This post is for paid subscribers',
  'Upgrade to paid', 'Subscribe to continue reading', 'Behind the paywall', 'free preview', 'start your 7-day free trial'
];

function generateArticleId(url, title) {
  const hash = createHash('sha256').update(`${url}::${title}`).digest('hex');
  return `article_${hash.substring(0, 16)}`;
}

function calculateWordCount(htmlContent) {
  if (!htmlContent) return 0;
  let text = htmlContent.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&[a-z]+;/gi, '').replace(/\s+/g, ' ').trim();
  return text.length === 0 ? 0 : text.split(' ').length;
}

function extractGuid(item) {
  if (!item) return '';
  if (typeof item.guid === 'object' && item.guid !== null) {
    return item.guid['#text'] || item.guid['_'] || item.guid.value || '';
  }
  return item.guid || item.link || '';
}

function checkIsPaywalled(title, description, bodyHtml) {
  const contentToCheck = `${title} ${description} ${bodyHtml}`.toLowerCase();
  return PAYWALL_KEYWORDS.some(k => contentToCheck.includes(k.toLowerCase())) || /class="[^"]*paywall[^"]*"/i.test(bodyHtml);
}

async function run() {
  console.log('1. Wiping old articles...');
  const snapshot = await db.collection('articles').get();
  const batchDelete = db.batch();
  let count = 0;
  
  // Firestore batch has a limit of 500 operations.
  const batches = [];
  let currentBatch = db.batch();
  
  snapshot.docs.forEach(doc => {
    currentBatch.delete(doc.ref);
    count++;
    if (count % 400 === 0) {
      batches.push(currentBatch.commit());
      currentBatch = db.batch();
    }
  });
  batches.push(currentBatch.commit());
  await Promise.all(batches);
  console.log(`Deleted ${snapshot.size} articles.`);

  console.log('2. Fetching fresh articles from ALL 35 feeds...');
  let totalNew = 0;

  for (const feed of SUBSTACK_FEEDS) {
    try {
      const feedData = await parser.parseURL(feed.url);
      const batchWrite = db.batch();
      
      // Removed the .slice(0, 5) limit. This parses the entire feed (up to 20-50 articles each)
      for (const item of (feedData.items || [])) { 
        const title = item.title || 'Untitled';
        const link = item.link || '';
        const articleId = generateArticleId(link, title);
        
        const bodyHtml = item['content:encoded'] || item.content || item.description || '';
        const description = (item.contentSnippet || item.description || '').substring(0, 300);
        const guid = extractGuid(item);
        const wordCount = calculateWordCount(bodyHtml);
        const isPaywalled = checkIsPaywalled(title, description, bodyHtml);
        const isTruncatedFeed = bodyHtml.length > 0 && description.length / bodyHtml.length > 0.9;
        
        let lengthStyle = 'medium';
        if (wordCount < 800) lengthStyle = 'short';
        else if (wordCount > 2000) lengthStyle = 'long';

        const article = {
          id: articleId,
          title,
          author: item.creator || item['dc:creator'] || 'Unknown',
          publicationName: feed.publicationName,
          publicationUrl: feedData.link || feed.url,
          feedUrl: feed.url,
          category: feed.category,
          lengthStyle,
          guid,
          isTruncatedFeed,
          description,
          publishDate: item.pubDate ? new Date(item.pubDate).getTime() : Date.now(),
          cacheTimestamp: Date.now(),
          isPaywalled,
          wordCount,
          estimatedReadMinutes: Math.max(1, Math.ceil(wordCount / 250)),
          trendingScore: 0,
          qualityScore: feed.qualityScore,
          isSeed: false,
        };

        const match = bodyHtml.match(/<img[^>]+src=["']([^"']+)["']/i);
        if (match && match[1]) article.headerImageUrl = match[1];

        batchWrite.set(db.collection('articles').doc(articleId), article);
        totalNew++;
      }
      await batchWrite.commit();
      console.log(`Success: ${feed.publicationName} (${(feedData.items || []).length} articles)`);
    } catch (err) {
      console.error(`Failed ${feed.publicationName}:`, err.message);
    }
  }

  console.log(`\nDONE! Fully populated database with ${totalNew} highly compliant, guid-equipped articles.`);
}

run().catch(console.error);
const Parser = require('./node_modules/rss-parser');

const parser = new Parser();
const TEST_FEED_URL = 'https://feeds.arstechnica.com/arstechnica/index'; // Replace with any feed URL you want to test!

async function runTest() {
  console.log(`[Test] Parsing feed: ${TEST_FEED_URL}...`);
  try {
    const feed = await parser.parseURL(TEST_FEED_URL);
    
    if (!feed.items || feed.items.length === 0) {
      console.log('❌ Error: No articles found in this feed.');
      return;
    }

    const firstItem = feed.items[0];
    const title = firstItem.title || 'Untitled';
    const publicationUrl = firstItem.link || '';
    const bodyHtml = firstItem['content:encoded'] || firstItem.content || firstItem.description || '';
    const description = (firstItem.contentSnippet || firstItem.description || '').substring(0, 300);

    // 1. Calculate word count (from your backend logic)
    let cleanText = bodyHtml.replace(/<[^>]*>/g, ' ');
    cleanText = cleanText.replace(/\s+/g, ' ').trim();
    const wordCount = cleanText.split(' ').length;

    // 2. Self-check for truncated feed (if description is suspiciously close to full body)
    const isTruncatedFeed = bodyHtml.length > 0 && (description.length / bodyHtml.length) > 0.9;

    console.log('\n--- 📋 TEST RESULTS ---');
    console.log(`Title:              ${title}`);
    console.log(`URL to User:        ${publicationUrl}`);
    console.log(`Word Count:         ${wordCount} words`);
    console.log(`Is Truncated Feed?: ${isTruncatedFeed ? '⚠️ YES (Only a preview in RSS!)' : '✅ NO (Full text is available!)'}`);
    console.log(`HTML Length:        ${bodyHtml.length} characters`);
    console.log('----------------------\n');

    // 3. Decide: Clean RSS vs Full Article Webpage
    if (isTruncatedFeed || wordCount < 150) {
      console.log('💡 RECOMMENDATION: Always load the FULL WEBPAGE (Archived Mode) for this publication.');
      console.log('Reason: The RSS feed is truncated. If the user loads this, they will only see a 1-sentence preview.');
    } else {
      console.log('💡 RECOMMENDATION: Use CLEAN RSS (Standard Mode).');
      console.log('Reason: The RSS feed contains the full-length article content.');
    }

  } catch (error) {
    console.error('❌ Error testing feed:', error.message);
  }
}

runTest();

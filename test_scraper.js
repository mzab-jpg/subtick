/**
 * ============================================================
 * SubTick — test_scraper.js
 * Sandbox script testing our Open Graph Metadata Web-Scraper Fallback.
 *
 * Usage:
 *   node test_scraper.js [url]
 * ============================================================
 */

const Parser = require('./node_modules/rss-parser');
const parser = new Parser();

const DEFAULT_FEED_URL = 'https://feeds.arstechnica.com/arstechnica/index';

async function fetchOgMetadata(url) {
  console.log(`\n🔍 [Scraper] Initiating fetch for: ${url}`);
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      }
    });

    if (!response.ok) {
      console.log(`❌ HTTP Error: ${response.status} ${response.statusText}`);
      return null;
    }

    const html = await response.text();
    console.log(`📥 [Scraper] Downloaded HTML (${(html.length / 1024).toFixed(2)} KB). Parsing tags...`);

    const metadata = {};

    // 1. og:image
    const ogImageMatch = 
      html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i);
    if (ogImageMatch && ogImageMatch[1]) {
      metadata.headerImageUrl = ogImageMatch[1];
    }

    // 2. og:description / twitter:description
    const ogDescMatch = 
      html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:description["']/i) ||
      html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']description["']/i);
    if (ogDescMatch && ogDescMatch[1]) {
      metadata.description = ogDescMatch[1]
        .replace(/"/g, '"')
        .replace(/&/g, '&')
        .replace(/</g, '<')
        .replace(/>/g, '>')
        .replace(/&#39;/g, "'")
        .substring(0, 300);
    }

    // 3. Author
    const authorMatch = 
      html.match(/<meta[^>]*name=["']author["'][^>]*content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']author["']/i) ||
      html.match(/<meta[^>]*property=["']article:author["'][^>]*content=["']([^"']+)["']/i);
    if (authorMatch && authorMatch[1]) {
      metadata.author = authorMatch[1];
    }

    // 4. Title
    const ogTitleMatch = 
      html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:title["']/i) ||
      html.match(/<title>([^<]+)<\/title>/i);
    if (ogTitleMatch && ogTitleMatch[1]) {
      metadata.title = ogTitleMatch[1].replace(/"/g, '"').replace(/&/g, '&').trim();
    }

    return metadata;
  } catch (error) {
    console.error('❌ Scraping error:', error.message);
    return null;
  }
}

async function run() {
  console.log('============================================================');
  console.log('🍁 SUBTICK OPEN GRAPH METADATA SCRAPER TESTER');
  console.log('============================================================');
  
  let targetUrl = process.argv[2];
  
  if (!targetUrl) {
    console.log(`📡 Fetching live feed to extract an active URL: ${DEFAULT_FEED_URL}...`);
    try {
      const feed = await parser.parseURL(DEFAULT_FEED_URL);
      if (feed.items && feed.items.length > 0) {
        targetUrl = feed.items[0].link;
        console.log(`🔗 Found active article: "${feed.items[0].title}"`);
      }
    } catch (feedErr) {
      console.log(`⚠️ Could not parse feed. Defaulting to standard fallback URL:`, feedErr.message);
    }
  }
  
  if (!targetUrl) {
    targetUrl = 'https://arstechnica.com/';
  }
  
  const result = await fetchOgMetadata(targetUrl);
  
  if (result) {
    console.log('\n--- 📋 SCRAPED METADATA ---');
    console.log(`Title:          ${result.title || '⚠️ [Not Found]'}`);
    console.log(`Author:         ${result.author || '⚠️ [Not Found]'}`);
    console.log(`Cover Image:    ${result.headerImageUrl || '⚠️ [Not Found]'}`);
    console.log(`Description:    ${result.description || '⚠️ [Not Found]'}`);
    console.log('---------------------------\n');
    console.log('✅ TEST PASSED: Successfully fallback-scraped metadata natively!');
  } else {
    console.log('❌ TEST FAILED: Could not retrieve or parse URL metadata.');
  }
}

run();

const Parser = require('./node_modules/rss-parser');

const PAYWALL_KEYWORDS = [
  'To read this post, subscribe',
  'Paid subscription required',
  'This post is for paid subscribers',
  'Upgrade to paid',
  'Subscribe to continue reading',
  'Behind the paywall',
  'This content is for subscribers only',
  "You've reached the free preview",
  'Subscribe now to read the full post',
  'Continue reading with a paid subscription',
  'free preview',
  'start your 7-day free trial',
  'unlock this post',
  'read the rest of this',
  'upgrade your subscription',
  'exclusive to paid',
  'to read the rest',
  'keep reading with a 7-day',
  'keep reading with a free trial',
  'this is a free preview',
  'subscribe to read',
  'upgrade to read',
  'paid subscribers only',
  'this post is for paid',
];

function checkIsPaywalled(title, description, bodyHtml) {
  const contentToCheck = `${title} ${description} ${bodyHtml}`.toLowerCase();
  
  const isPaywalled = PAYWALL_KEYWORDS.some((keyword) =>
    contentToCheck.includes(keyword.toLowerCase())
  );

  const hasPaywallClass =
    /class="[^"]*paywall[^"]*"/i.test(bodyHtml) ||
    /class="[^"]*subscriber-only[^"]*"/i.test(bodyHtml) ||
    /class="[^"]*locked-content[^"]*"/i.test(bodyHtml);

  const hasPaywallScript = /paywall/i.test(bodyHtml) && /<script/i.test(bodyHtml);

  if (isPaywalled) {
      console.log('Matched Keyword:', PAYWALL_KEYWORDS.find(k => contentToCheck.includes(k.toLowerCase())));
  }

  return isPaywalled || hasPaywallClass || hasPaywallScript;
}

const parser = new Parser();
parser.parseURL('https://worksinprogress.co/rss.xml').then(feed => {
    const item = feed.items[0];
    const title = item.title || '';
    const description = item.contentSnippet || item.description || '';
    const bodyHtml = item['content:encoded'] || item.content || item.description || '';
    
    console.log('Result:', checkIsPaywalled(title, description, bodyHtml));
});

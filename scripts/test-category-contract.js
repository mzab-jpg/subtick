// Category-contract regression test.
// The phone's category list (src/utils/constants.ts `CATEGORIES`) and the
// server's canonical list (firebase/functions/src/categories.ts
// `DASHBOARD_CATEGORIES_ARRAY`) MUST stay identical. If they drift, a category
// the phone lets a user pick could be silently unrecognised (or mis-ranked)
// by the server — this test fails loudly instead.
// Run: npm run test:category-contract
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function extractBetween(source, startMarker) {
  const start = source.indexOf(startMarker);
  if (start < 0) throw new Error(`marker not found: ${startMarker}`);
  const end = source.indexOf('];', start);
  if (end < 0) throw new Error(`closing '];' not found after: ${startMarker}`);
  return source.slice(start, end);
}

function extractQuotedStrings(block) {
  const out = [];
  const re = /'([^']+)'/g;
  let m;
  while ((m = re.exec(block))) out.push(m[1]);
  return out;
}

let failed = false;
function check(label, actual, expected) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${pass ? '✓' : '✗'} ${label}: ${JSON.stringify(actual)}${pass ? '' : ` (expected ${JSON.stringify(expected)})`}`);
  if (!pass) failed = true;
}

// 1. Client categories — the `id:` fields inside `export const CATEGORIES`.
const clientSource = fs.readFileSync(path.join(root, 'src', 'utils', 'constants.ts'), 'utf8');
const clientBlock = extractBetween(clientSource, 'export const CATEGORIES');
const clientIds = [];
{
  const re = /id:\s*'([^']+)'/g;
  let m;
  while ((m = re.exec(clientBlock))) clientIds.push(m[1]);
}

// 2. Server categories — the array block in categories.ts.
const serverSource = fs.readFileSync(path.join(root, 'firebase', 'functions', 'src', 'categories.ts'), 'utf8');
const serverBlock = extractBetween(serverSource, 'DASHBOARD_CATEGORIES_ARRAY');
const serverIds = extractQuotedStrings(serverBlock);

// 3. Compare — order-insensitive, case-sensitive (ids are exact).
const clientSorted = [...clientIds].sort();
const serverSorted = [...serverIds].sort();
check('client category count matches server category count', clientSorted.length, serverSorted.length);
check('client category ids match server category ids', clientSorted, serverSorted);
check('category list is non-empty', serverSorted.length > 0, true);

if (failed) {
  console.error('\nCATEGORY CONTRACT BROKEN — update BOTH lists together:');
  console.error('  client: src/utils/constants.ts (CATEGORIES)');
  console.error('  server: firebase/functions/src/categories.ts (DASHBOARD_CATEGORIES_ARRAY)');
  process.exit(1);
}
console.log('\n✓ Category contract intact.');
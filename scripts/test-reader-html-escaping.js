// Focused regression test for RSS metadata escaping in the Reader WebView.
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'screens', 'ReaderScreen.tsx'), 'utf8');
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

process.exitCode = failed ? 1 : 0;

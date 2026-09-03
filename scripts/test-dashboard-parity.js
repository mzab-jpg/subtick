// Dashboard↔config parity test.
// Guarantees: (1) EVERY leaf key in DEFAULT_SCORING_CONFIG has a dashboard
// control (override entry or list section), and (2) EVERY dashboard override
// entry points at a REAL config key — no dead controls, no missing controls.
// Requires the functions build (lib/) — run via `npm run typecheck`.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

const { DEFAULT_SCORING_CONFIG } = require(path.join(root, 'firebase', 'functions', 'lib', 'scoringConfig.js'));
const html = fs.readFileSync(path.join(root, 'scripts', 'control_dashboard.html'), 'utf8');

let failed = false;
function check(label, pass) {
  console.log(`${pass ? '✓' : '✗'} ${label}`);
  if (!pass) failed = true;
}

// Collect all leaf paths from the server defaults (schemaVersion is an internal
// marker, not a tunable knob — excluded from parity). Array-valued groups
// (e.g. paywallKeywords) are tracked separately as LIST groups.
const configPaths = [];
const listGroups = new Set();
(function walk(node, prefix) {
  for (const [key, value] of Object.entries(node)) {
    const p = prefix ? `${prefix}.${key}` : key;
    if (Array.isArray(value)) {
      listGroups.add(p);
      if (p !== 'schemaVersion') configPaths.push(p);
    } else if (typeof value !== 'object' || value === null) {
      if (p !== 'schemaVersion') configPaths.push(p);
    } else {
      walk(value, p);
    }
  }
})(DEFAULT_SCORING_CONFIG, '');

// Collect every override entry ` 'group.key': [` from the dashboard.
// Keys may contain underscores (read_thorough, quick_exit, …).
const overridePaths = [...html.matchAll(/'([a-zA-Z_]+\.[a-zA-Z_]+)':\s*\[/g)].map((m) => m[1]);

// 1. Every config key has a dashboard control: either a per-key override entry
//    or a list-group editor (for array-valued groups).
const covered = (p) => overridePaths.includes(p) || (listGroups.has(p) && html.includes('data-list='));
const missing = configPaths.filter((p) => !covered(p));
check(`every server config key has a dashboard control (missing: ${missing.length})`, missing.length === 0);
if (missing.length) console.error('  missing controls for: ' + missing.join(', '));

// 2. Every dashboard override entry points at a real config key (no dead controls).
const configSet = new Set(configPaths);
const dead = overridePaths.filter((p) => !configSet.has(p));
check(`every dashboard control points at a live config key (dead: ${dead.length})`, dead.length === 0);
if (dead.length) console.error('  dead controls for: ' + dead.join(', '));

// 2b. Every config key has a HELP entry — a missing tooltip fails the build.
const tipsStart = html.indexOf('const TIPS = {');
let tipKeys = [];
if (tipsStart >= 0) {
  let depth = 0, tipsEnd = -1, inStr = null;
  for (let i = tipsStart + 'const TIPS = '.length; i < html.length; i++) {
    const ch = html[i];
    if (inStr) { if (ch === '\\') i++; else if (ch === inStr) inStr = null; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; continue; }
    if (ch === '{') depth++;
    if (ch === '}') { depth--; if (depth === 0) { tipsEnd = i; break; } }
  }
  if (tipsEnd > 0) {
    const tipSrc = html.slice(tipsStart, tipsEnd);
    tipKeys = [...tipSrc.matchAll(/'([a-zA-Z_.]+)':/g)].map((m) => m[1]);
  }
}
const noHelp = configPaths.filter((p) => !tipKeys.includes(p));
check(`every config key has a help entry (missing help: ${noHelp.length})`, noHelp.length === 0);
if (noHelp.length) console.error('  missing help for: ' + noHelp.join(', '));

// 3. Every rendered section has a title.
const sectionOrderMatch = /SECTION_ORDER = \[([^\]]+)\]/.exec(html);
const sections = sectionOrderMatch
  ? sectionOrderMatch[1].split(',').map((s) => s.trim().replace(/'/g, '')).filter(Boolean)
  : [];
const untitled = sections.filter((s) => !html.includes(`${s}: ['`));
check('every dashboard section has a title', untitled.length === 0);
if (untitled.length) console.error('  untitled sections: ' + untitled.join(', '));

// 4. No stale groups are rendered.
const stale = sections.filter((s) => !(s in DEFAULT_SCORING_CONFIG));
check('no stale sections render for removed features', stale.length === 0);
if (stale.length) console.error('  stale sections: ' + stale.join(', '));

if (failed) {
  console.error('\nDASHBOARD PARITY BROKEN — sync scripts/control_dashboard.html with DEFAULT_SCORING_CONFIG.');
  process.exit(1);
}
console.log('\n✓ Dashboard↔config parity intact.');
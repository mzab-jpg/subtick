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

// Shared helpers: pull a balanced {...} block after a marker, and read a
// dotted leaf path from a nested object.
function extractBraced(src, marker) {
  const start = src.indexOf(marker);
  if (start < 0) return null;
  const brace = src.indexOf('{', start);
  let depth = 0, inStr = null, end = -1;
  for (let i = brace; i < src.length; i++) {
    const ch = src[i];
    if (inStr) { if (ch === '\\') { i++; continue; } if (ch === inStr) inStr = null; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; continue; }
    if (ch === '{') depth++;
    if (ch === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  return end > 0 ? src.slice(brace, end + 1) : null;
}
function valAt(obj, p) {
  return p.split('.').reduce((cur, k) => (cur == null ? undefined : cur[k]), obj);
}
function leafPaths(node, prefix, out) {
  for (const k of Object.keys(node)) {
    const p = prefix ? `${prefix}.${k}` : k;
    const v = node[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) leafPaths(v, p, out);
    else if (p !== 'schemaVersion') out.push(p);
  }
  return out;
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

// ============================================================
// 5. Mockup↔server contract (archived exploration mockup).
// The redesign mockup must be an exact mirror of the backend config:
// every server key present as a dial (no gaps, no dead dials), every
// default value identical, help coverage complete, and every dial also
// present on the production dashboard. Lives in the same gate so drift
// fails the build the moment either side changes.
// NOTE: the exploration mockups were archived (design/archive/explorations/);
// the path below tracks the moved file so the gate keeps guarding drift.
// ============================================================
const mockPath = path.join(root, 'design', 'archive', 'explorations', 'dashboard-redesign-mockup.html');
if (fs.existsSync(mockPath)) {
  const mock = fs.readFileSync(mockPath, 'utf8');
  const mockDefSrc = extractBraced(mock, 'const DEFAULTS');
  const MOCK_DEFAULTS = mockDefSrc ? new Function('return (' + mockDefSrc + ');')() : null;
  const mockPaths = MOCK_DEFAULTS ? leafPaths(MOCK_DEFAULTS, '', []) : [];
  const mockLbl = [...new Set([...mock.matchAll(/'([a-zA-Z_]+(?:\.[a-zA-Z_]+)?)':\s*\[/g)].map((m) => m[1]))];
  const mockHelpSrc = extractBraced(mock, 'const HELP = ');
  const MOCK_HELP = mockHelpSrc ? JSON.parse(mockHelpSrc) : {};
  const serverSet = new Set(configPaths);

  // 5a. Every server key has a mockup dial (scalar or list).
  const noMockDial = configPaths.filter((p) => !mockLbl.includes(p));
  check(`every server config key has a mockup dial (missing: ${noMockDial.length})`, noMockDial.length === 0);
  if (noMockDial.length) console.error('  missing mockup dials for: ' + noMockDial.join(', '));

  // 5b. Every mockup dial points at a real server key.
  const deadMock = mockLbl.filter((p) => !serverSet.has(p));
  check(`every mockup dial points at a live config key (dead: ${deadMock.length})`, deadMock.length === 0);
  if (deadMock.length) console.error('  dead mockup dials: ' + deadMock.join(', '));

  // 5c. Mockup defaults are value-identical to the server defaults.
  const drift = [];
  if (MOCK_DEFAULTS) {
    for (const p of configPaths) {
      const sv = valAt(DEFAULT_SCORING_CONFIG, p);
      const mv = valAt(MOCK_DEFAULTS, p);
      if (JSON.stringify(sv) !== JSON.stringify(mv)) drift.push(`${p} server=${JSON.stringify(sv)} mockup=${JSON.stringify(mv)}`);
    }
  } else drift.push('mockup DEFAULTS block not found');
  check(`mockup defaults are value-identical to server defaults (drift: ${drift.length})`, drift.length === 0);
  if (drift.length) console.error('  value drift: ' + drift.join(' | '));

  // 5d. Mockup help covers every server key (and nothing else).
  const noMockHelp = configPaths.filter((p) => !(p in MOCK_HELP));
  check(`every config key has a mockup help entry (missing: ${noMockHelp.length})`, noMockHelp.length === 0);
  if (noMockHelp.length) console.error('  missing mockup help for: ' + noMockHelp.join(', '));
  const deadMockHelp = Object.keys(MOCK_HELP).filter((p) => !serverSet.has(p));
  check(`every mockup help entry points at a live config key (dead: ${deadMockHelp.length})`, deadMockHelp.length === 0);
  if (deadMockHelp.length) console.error('  dead mockup help: ' + deadMockHelp.join(', '));

  // 5e. Three-way: every mockup dial also exists on the production dashboard
  // (as an override entry, or as a list editor for array-valued groups).
  const coveredInDash = (p) => overridePaths.includes(p) || (listGroups.has(p) && html.includes('data-list='));
  const noDashControl = mockLbl.filter((p) => !coveredInDash(p));
  check(`every mockup dial has a production dashboard control (missing: ${noDashControl.length})`, noDashControl.length === 0);
  if (noDashControl.length) console.error('  mockup dials with no production control: ' + noDashControl.join(', '));
} else {
  check('mockup file present for parity checks (design/dashboard-redesign-mockup.html)', false);
}

// ============================================================
// 6. Tooltip truth check. A tooltip that states the wrong default is a
// lie shown to every admin. Parse each production-dashboard tooltip for
// a numeric "Default X" claim and compare it with DEFAULT_SCORING_CONFIG.
// ============================================================
{
  const dashTipsSrc = extractBraced(html, 'const TIPS = {');
  const tipText = {};
  if (dashTipsSrc) {
    for (const m of dashTipsSrc.matchAll(/'([a-zA-Z_.]+)':\s*"((?:[^"\\]|\\.)*)"/g)) {
      try { tipText[m[1]] = JSON.parse('"' + m[2].replace(/\\'/g, "'") + '"'); } catch { /* unparseable tip: covered by key checks */ }
    }
  }
  const claimRe = /[Dd]efault:?\s*([+-]?\d+(?:\.\d+)?)/;
  const UNIT_MULT = { 'rejection.windowMs': 24 * 60 * 60 * 1000 }; // tooltip says days, config stores ms
  const lies = [];
  for (const p of configPaths) {
    const tip = tipText[p];
    if (!tip) continue;
    const m = claimRe.exec(tip);
    if (!m) continue; // tooltip makes no numeric default claim
    const claim = parseFloat(m[1]);
    const val = valAt(DEFAULT_SCORING_CONFIG, p);
    const actual = Array.isArray(val) ? val.length : val;
    const expected = UNIT_MULT[p] ? claim * UNIT_MULT[p] : claim;
    if (typeof actual !== 'number' || Math.abs(expected - actual) > Math.max(1e-9, Math.abs(actual) * 1e-9)) {
      lies.push(`${p} tooltip says ${m[1]} but server default is ${JSON.stringify(val)}`);
    }
  }
  check(`every tooltip default claim matches the server default (wrong: ${lies.length})`, lies.length === 0);
  if (lies.length) console.error('  wrong defaults: ' + lies.join(' | '));
}

if (failed) {
  console.error('\nDASHBOARD PARITY BROKEN — sync the dashboard/mockup with DEFAULT_SCORING_CONFIG.');
  process.exit(1);
}
console.log('\n✓ Dashboard↔config parity intact (dashboard, mockup, tooltips).');
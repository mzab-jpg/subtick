/**
 * Generates 4 Tangent UI mockup HTML files.
 * Run: node design/mockups/generate-mockups.mjs
 */
import { writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
mkdirSync(__dir, { recursive: true });

const CATEGORIES = [
  ['Politics', '🏛️'], ['Business', '💼'], ['Finance', '📈'],
  ['Technology', '💻'], ['Science', '🔬'], ['History', '📜'],
  ['Culture', '🎨'], ['Lifestyle', '🌿'], ['Entertainment', '🎬'],
];

const METRICS = [
  ['streak', 'Streak Days', '🔥', '12'],
  ['weeklyReads', 'Weekly Reads', '📊', '8'],
  ['totalReadTime', 'Hours Read', '⏳', '4.2'],
  ['avgWpm', 'Avg WPM', '⏱️', '245'],
  ['totalRead', 'Finished', '📚', '47'],
  ['topCategory', 'Top Category', '📈', 'Tech'],
];

const ARTICLES = [
  { pub: 'The Diff', cat: 'Business', title: 'Why Software Margins Are Collapsing', excerpt: 'Platform economics and the new cost structure of AI-native products…' },
  { pub: 'Stratechery', cat: 'Technology', title: 'The AI Integration Question', excerpt: 'How incumbents absorb disruptive capability without losing their moat…' },
  { pub: 'Astral Codex Ten', cat: 'Science', title: 'Book Review: The Scout Mindset', excerpt: 'A field guide to updating beliefs under uncertainty…' },
  { pub: 'Culture Study', cat: 'Culture', title: 'The Performance of Exhaustion', excerpt: 'Burnout as aesthetic, identity, and economic signal…' },
];

const SCREENS = [
  'startup', 'onboarding', 'dashboard', 'reader',
  'settings', 'account', 'history', 'saved',
  'categories', 'stats', 'feedback', 'feedrequest', 'developer',
];

function phonePair(id, lightHtml, darkHtml, theme) {
  return `
<section class="screen-block" id="${id}">
  <h2 class="screen-title">${label(id)}</h2>
  <div class="pair">
    <div class="phone-wrap"><span class="mode-tag">Light</span>
      <div class="phone ${theme}-light">${lightHtml}</div>
    </div>
    <div class="phone-wrap"><span class="mode-tag">Dark</span>
      <div class="phone ${theme}-dark">${darkHtml}</div>
    </div>
  </div>
</section>`;
}

function label(id) {
  const map = {
    startup: 'Startup', onboarding: 'Onboarding', dashboard: 'Dashboard',
    reader: 'Reader', settings: 'Settings', account: 'Account',
    history: 'History', saved: 'Saved Reads', categories: 'Category Preferences',
    stats: 'Dashboard Stats', feedback: 'Feedback', feedrequest: 'Feed Request',
    developer: 'Developer Options',
  };
  return map[id] || id;
}

function shell(content, status = true) {
  return `<div class="status-bar">${status ? '9:41' : ''}</div><div class="screen-body">${content}</div><div class="home-indicator"></div>`;
}

function backHeader(title, theme, mode) {
  return `<header class="nav-header"><button class="back" aria-label="Back">←</button><span>${title}</span><span class="spacer"></span></header>`;
}

function articleBody() {
  return `<article class="reader-article"><h1>${ARTICLES[0].title}</h1><p class="byline">${ARTICLES[0].pub} · ${ARTICLES[0].cat}</p><p>${ARTICLES[0].excerpt}</p><p>Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam.</p><p>Quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit.</p></article>`;
}

function readerHud() {
  return `<div class="hud"><button class="hud-x">✕</button><span class="hud-title">${ARTICLES[0].title}</span><div class="hud-actions"><span class="heart">♥</span><span class="save">🔖</span></div></div><div class="progress"><div class="progress-fill" style="width:42%"></div></div>`;
}

function chipGrid(theme, mode, variant = 'onboarding') {
  const states = ['sel', 'neu', 'not', 'sel', 'neu', 'neu', 'not', 'sel', 'neu'];
  return CATEGORIES.map(([name, emoji], i) =>
    `<button class="chip chip-${states[i]}">${emoji} ${name}</button>`
  ).join('');
}

function metricPill(active = ['streak', 'totalReadTime', 'avgWpm']) {
  return active.map(id => {
    const m = METRICS.find(x => x[0] === id);
    return `<span class="metric">${m[2]} ${m[3]}</span>`;
  }).join('<span class="metric-sep">·</span>');
}

function articleList() {
  return ARTICLES.map(a =>
    `<div class="list-item"><div class="list-title">${a.title}</div><div class="list-meta">${a.pub} · ${a.cat}</div></div>`
  ).join('');
}

function settingsRows() {
  return `
<div class="section-label">ACCOUNT</div>
<div class="card"><div class="row"><span>👤 Account</span><span class="muted">Anonymous →</span></div></div>
<div class="section-label">LIBRARY</div>
<div class="card split"><div class="cell">📜 History</div><div class="cell">🔖 Saved Reads</div></div>
<div class="section-label">PREFERENCES</div>
<div class="card">
  <div class="row"><span>🎨 Theme</span><div class="segment"><span>Auto</span><span class="on">Light</span><span>Dark</span></div></div>
  <div class="row"><span>🏷 Categories</span><span class="muted">4 selected →</span></div>
  <div class="row"><span>📊 Dashboard Stats</span><span class="muted">3 active →</span></div>
  <div class="row"><span>📦 Archived Articles</span><div class="toggle on"></div></div>
</div>
<div class="section-label">SUPPORT</div>
<div class="card">
  <div class="row"><span>💬 Feedback</span><span>→</span></div>
  <div class="row"><span>📡 Request a Feed</span><span>→</span></div>
</div>
<div class="section-label">DEVELOPER</div>
<div class="card"><div class="row"><span>⌨ Developer Options</span><span>→</span></div></div>`;
}

function accountRows() {
  return `
<div class="card">
  <div class="row"><span>Status</span><span class="muted">Anonymous</span></div>
  <div class="row"><span>Link Google Account</span><span>→</span></div>
</div>
<div class="card danger-zone">
  <div class="row"><span>Sign Out</span></div>
  <div class="row"><span>Reset Reading Data</span></div>
  <div class="row danger"><span>Delete Account</span></div>
</div>`;
}

function statsGrid() {
  const active = new Set(['streak', 'weeklyReads', 'avgWpm']);
  return METRICS.map(([id, label, emoji]) =>
    `<button class="stat-chip ${active.has(id) ? 'on' : ''}">${emoji} ${label}</button>`
  ).join('');
}

function modalForm(title, placeholder, btn) {
  return `<div class="modal-scrim"><div class="modal"><div class="modal-handle"></div><h3>${title}</h3><textarea placeholder="${placeholder}"></textarea><button class="primary-btn">${btn}</button></div></div>`;
}

function devOptions() {
  return `<div class="card"><div class="row"><span>Sandbox Reader</span><span>→</span></div><div class="row danger"><span>Clear Local Data</span></div></div>`;
}

// ── Theme renderers ──────────────────────────────────────────

const themes = {
  measure: {
    name: 'Measure',
    tagline: 'Editorial compositor — baseline grid, visible rulers, 1.62 modular scale',
    fonts: 'https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap',
    fontFamily: "'IBM Plex Sans', sans-serif",
    serif: "'DM Serif Display', serif",
    mono: "'IBM Plex Mono', monospace",
    css: `
:root { --accent: #C23B22; }
.page-header { background: linear-gradient(135deg, #F4F0E8, #E8E2D6); }
.page-header h1 { font-family: var(--serif); }
.measure-light { --bg:#F4F0E8; --surface:#FFFDF9; --text:#1A1A1A; --muted:#6B6560; --border:#D4CEC4; --accent:#C23B22; background:var(--bg); color:var(--text); font-family:var(--sans); position:relative; }
.measure-light::before { content:''; position:absolute; inset:0; background: repeating-linear-gradient(0deg, transparent, transparent 7px, rgba(194,59,34,.06) 7px, rgba(194,59,34,.06) 8px); pointer-events:none; }
.measure-dark { --bg:#141210; --surface:#1E1C19; --text:#F0EBE3; --muted:#9A948C; --border:#3A3530; --accent:#E04E35; background:var(--bg); color:var(--text); font-family:var(--sans); }
.brand { font-family:var(--serif); letter-spacing:.18em; font-size:11px; }
.startup-motto { font-family:var(--mono); font-size:13px; color:var(--accent); }
.startup-motto .cursor { animation:blink 1s step-end infinite; }
.hero-card { border-left:3px solid var(--accent); padding-left:10px; }
.stats-pill { font-family:var(--mono); font-size:10px; border:1px solid var(--border); border-radius:2px; padding:6px 10px; }
.chip { font-size:10px; border:1px solid var(--border); padding:6px 8px; border-radius:2px; background:var(--surface); }
.chip-sel { background:var(--text); color:var(--bg); border-color:var(--text); }
.chip-not { opacity:.45; text-decoration:line-through; }
.row-card { display:grid; grid-template-columns:1fr 1fr; gap:6px; }
.row-card .mini { font-size:9px; border-top:2px solid var(--accent); padding-top:6px; }
.discover-row { display:flex; gap:6px; margin-top:auto; }
.pill-btn { flex:1; font-family:var(--mono); font-size:9px; padding:8px; border:1px solid var(--border); text-align:center; border-radius:2px; }
.hud { backdrop-filter:blur(8px); background:rgba(255,253,249,.88); border-bottom:1px solid var(--border); padding:8px; display:flex; align-items:center; gap:6px; font-size:10px; }
.measure-dark .hud { background:rgba(30,28,25,.9); }
.reader-article h1 { font-family:var(--serif); font-size:16px; line-height:1.2; }
.grid-ruler { position:absolute; right:4px; top:40px; bottom:30px; width:1px; background:var(--accent); opacity:.3; }`,
    screens: {
      startup: (m) => shell(`<div style="padding:16px;height:100%;display:flex;flex-direction:column"><div class="brand">TANGENT</div><div style="flex:1;display:flex;align-items:center"><div class="startup-motto">sapere aude<span class="cursor">|</span></div></div></div>`),
      onboarding: (m) => shell(`<div style="padding:14px"><div class="brand">TANGENT</div><h2 style="font-family:var(--serif);font-size:18px;margin:20px 0 12px">What do you want to read?</h2><div style="display:flex;flex-wrap:wrap;gap:5px">${chipGrid('measure')}</div><button class="primary-btn" style="margin-top:auto;width:100%">Start Reading</button></div>`),
      dashboard: (m) => shell(`<div style="padding:12px;display:flex;flex-direction:column;height:100%"><div style="display:flex;justify-content:space-between;align-items:center"><div class="brand">TANGENT</div><span>⚙</span></div><div class="stats-pill" style="margin:10px 0">${metricPill()}</div><div class="hero-card" style="flex:1.2;margin-bottom:8px"><div style="font-size:9px;color:var(--muted)">${ARTICLES[0].pub}</div><div style="font-family:var(--serif);font-size:15px;line-height:1.2">${ARTICLES[0].title}</div></div><div class="row-card" style="flex:1"><div class="mini"><div style="color:var(--muted);font-size:8px">${ARTICLES[1].pub}</div>${ARTICLES[1].title}</div><div class="mini"><div style="color:var(--muted);font-size:8px">${ARTICLES[2].pub}</div>${ARTICLES[2].title}</div></div><div class="discover-row"><div class="pill-btn">Discover</div><div class="pill-btn">Shuffle</div></div><div class="grid-ruler"></div></div>`),
      reader: (m) => shell(`${readerHud()}${articleBody()}`, false),
      settings: (m) => shell(`${backHeader('Settings')}${settingsRows()}`),
      account: (m) => shell(`${backHeader('Account')}${accountRows()}`),
      history: (m) => shell(`${backHeader('History')}${articleList()}`),
      saved: (m) => shell(`${backHeader('Saved Reads')}${articleList()}`),
      categories: (m) => shell(`${backHeader('Categories')}<p style="font-size:10px;color:var(--muted);margin-bottom:8px">Tap to cycle: interested → neutral → not interested</p><div style="display:flex;flex-wrap:wrap;gap:5px">${chipGrid()}</div>`),
      stats: (m) => shell(`${backHeader('Dashboard Stats')}<p style="font-size:10px;color:var(--muted)">Choose up to 3</p><div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px">${statsGrid()}</div>`),
      feedback: (m) => shell(`${backHeader('Settings')}${settingsRows()}${modalForm('Send Feedback', 'Tell us what you think…', 'Submit')}`),
      feedrequest: (m) => shell(`${backHeader('Settings')}${settingsRows()}${modalForm('Request a Feed', 'https://newsletter.example.com/feed', 'Submit URL')}`),
      developer: (m) => shell(`${backHeader('Developer Options')}${devOptions()}`),
    },
  },

  ink: {
    name: 'Ink Index',
    tagline: 'Library card catalog — sumi ink washes, vertical spine labels, lunar rhythm',
    fonts: 'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,700;1,500&family=Noto+Serif+JP:wght@400;600&display=swap',
    fontFamily: "'Cormorant Garamond', serif",
    serif: "'Cormorant Garamond', serif",
    mono: "'Noto Serif JP', serif",
    css: `
:root { --accent: #B91C1C; }
.page-header { background: radial-gradient(ellipse at 20% 30%, #3D5A8044, transparent), #FAF6EF; }
.ink-light { --bg:#FAF6EF; --surface:#FFF; --text:#2C2416; --muted:#7A6F5E; --border:#E5DDD0; --accent:#3D5A80; --seal:#B91C1C; background:var(--bg); color:var(--text); font-family:var(--sans); }
.ink-dark { --bg:#1A1814; --surface:#252219; --text:#EDE6DA; --muted:#A89E8E; --border:#3D3830; --accent:#7BA3C9; --seal:#E05555; background:var(--bg); color:var(--text); font-family:var(--sans); }
.brand { writing-mode:vertical-rl; font-size:10px; letter-spacing:.3em; color:var(--seal); position:absolute; left:6px; top:50px; }
.ink-blob { position:absolute; width:80px; height:80px; border-radius:50%; background:radial-gradient(circle, var(--accent)22, transparent 70%); top:20%; right:-20px; filter:blur(2px); }
.catalog-card { background:var(--surface); border:1px solid var(--border); padding:10px; margin-bottom:6px; box-shadow:2px 2px 0 var(--border); position:relative; }
.catalog-card::before { content:''; position:absolute; left:0;top:0;bottom:0;width:3px;background:var(--seal); }
.catalog-id { font-size:8px; font-family:var(--mono); color:var(--muted); }
.chip { font-size:10px; border:1px dashed var(--border); padding:5px 8px; background:var(--surface); }
.chip-sel { border-style:solid; border-color:var(--seal); background:var(--seal); color:#fff; }
.spine-label { font-family:var(--mono); font-size:9px; color:var(--accent); }
.stats-pill { border:1px dashed var(--border); padding:6px; font-size:10px; }
.hud { background:var(--surface); border-bottom:2px solid var(--seal); padding:8px; font-size:10px; display:flex; gap:6px; align-items:center; }
.reader-article h1 { font-size:17px; font-style:italic; }`,
    screens: {
      startup: (m) => shell(`<div class="ink-blob"></div><div class="brand">TANGENT</div><div style="padding:30px 20px 20px 28px;height:100%;display:flex;flex-direction:column;justify-content:center"><div style="font-size:22px;font-style:italic;color:var(--seal)">sapere aude</div><div style="font-size:10px;color:var(--muted);margin-top:8px">dare to know</div></div>`),
      onboarding: (m) => shell(`<div style="padding:20px 14px 14px 24px"><h2 style="font-size:20px;margin-bottom:4px">Index your interests</h2><p style="font-size:10px;color:var(--muted);margin-bottom:12px">File cards into your reading catalog</p><div style="display:flex;flex-wrap:wrap;gap:5px">${chipGrid()}</div><button class="primary-btn" style="margin-top:16px;width:100%;background:var(--seal);color:#fff;border:none">Begin Reading</button></div>`),
      dashboard: (m) => shell(`<div style="padding:12px 12px 12px 22px"><div style="display:flex;justify-content:flex-end;margin-bottom:8px"><span>⚙</span></div><div class="stats-pill">${metricPill(['weeklyReads','streak','topCategory'])}</div><div class="catalog-card" style="margin-top:10px;flex:1.3"><div class="catalog-id">CAT-BIZ · 001</div><div style="font-size:16px;margin:4px 0">${ARTICLES[0].title}</div><div class="spine-label">${ARTICLES[0].pub}</div></div><div class="catalog-card"><div class="catalog-id">CAT-TEC · 002</div><div style="font-size:13px">${ARTICLES[1].title}</div></div><div class="catalog-card"><div class="catalog-id">CAT-SCI · 003</div><div style="font-size:13px">${ARTICLES[2].title}</div></div><div style="display:flex;gap:6px;margin-top:8px"><div class="pill-btn" style="flex:1;border:1px dashed var(--border);padding:8px;text-align:center;font-size:10px">Discover</div><div class="pill-btn" style="flex:1;border:1px dashed var(--border);padding:8px;text-align:center;font-size:10px">Shuffle</div></div></div>`),
      reader: (m) => shell(`${readerHud()}${articleBody()}`, false),
      settings: (m) => shell(`${backHeader('Settings')}${settingsRows()}`),
      account: (m) => shell(`${backHeader('Account')}${accountRows()}`),
      history: (m) => shell(`${backHeader('History')}<div class="catalog-card"><div class="catalog-id">READ · 2026-09-02</div><div>${ARTICLES[0].title}</div></div>${articleList()}`),
      saved: (m) => shell(`${backHeader('Saved Reads')}<div style="font-size:10px;color:var(--muted);margin-bottom:8px">Offline copies available</div>${articleList()}`),
      categories: (m) => shell(`${backHeader('Categories')}<div style="display:flex;flex-wrap:wrap;gap:5px;padding:8px">${chipGrid()}</div>`),
      stats: (m) => shell(`${backHeader('Dashboard Stats')}<div style="display:flex;flex-wrap:wrap;gap:6px;padding:8px">${statsGrid()}</div>`),
      feedback: (m) => shell(`${modalForm('Send Feedback', 'Your note to the librarians…', 'Send')}`),
      feedrequest: (m) => shell(`${modalForm('Request a Feed', 'Paste RSS/Atom URL', 'Add to queue')}`),
      developer: (m) => shell(`${backHeader('Developer Options')}${devOptions()}`),
    },
  },

  recital: {
    name: 'Recital',
    tagline: 'Concert hall — velvet darkness, gold trim, spotlight hero, 35mm framing',
    fonts: 'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@500;700&family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&display=swap',
    fontFamily: "'Libre Baskerville', serif",
    serif: "'Playfair Display', serif",
    mono: "'Libre Baskerville', serif",
    css: `
:root { --gold: #D4AF37; }
.page-header { background: radial-gradient(ellipse at center, #6B1D2A, #0D0D12); color:#FFF8E7; }
.recital-light { --bg:#FFF8E7; --surface:#FFFFFF; --text:#1A0F0F; --muted:#6B5B5B; --border:#E8D5B5; --accent:#6B1D2A; --gold:#B8860B; background:var(--bg); color:var(--text); font-family:var(--sans); }
.recital-dark { --bg:#0D0D12; --surface:#16161F; --text:#FFF8E7; --muted:#A89888; --border:#2A2430; --accent:#6B1D2A; --gold:#D4AF37; background:var(--bg); color:var(--text); font-family:var(--sans); }
.brand { font-family:var(--serif); font-size:13px; color:var(--gold); letter-spacing:.25em; }
.stage { background: radial-gradient(ellipse 80% 60% at 50% 0%, rgba(212,175,55,.15), transparent); border:1px solid var(--gold); padding:14px; text-align:center; position:relative; }
.stage::after { content:'★'; position:absolute; top:6px; right:8px; color:var(--gold); font-size:10px; }
.ensemble { display:flex; flex-direction:column; gap:5px; opacity:.85; }
.ensemble .seat { font-size:10px; padding:8px; border:1px solid var(--border); background:var(--surface); }
.stats-pill { border:1px solid var(--gold); color:var(--gold); padding:6px 10px; font-size:10px; text-align:center; }
.chip { border:1px solid var(--border); padding:6px 10px; font-size:10px; background:var(--surface); }
.chip-sel { background:var(--accent); color:#FFF8E7; border-color:var(--accent); }
.hud { background:linear-gradient(180deg, rgba(13,13,18,.95), transparent); color:#FFF8E7; padding:10px; display:flex; gap:6px; font-size:10px; }
.recital-light .hud { background:linear-gradient(180deg, rgba(255,248,231,.95), transparent); color:var(--text); }
.curtain { height:4px; background: repeating-linear-gradient(90deg, var(--accent), var(--accent) 8px, var(--gold) 8px, var(--gold) 16px); }
.reader-article h1 { font-family:var(--serif); font-size:17px; text-align:center; }`,
    screens: {
      startup: (m) => shell(`<div class="curtain"></div><div style="padding:20px;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center"><div class="brand">TANGENT</div><div style="font-family:var(--serif);font-size:20px;margin-top:40px;font-style:italic">sapere aude</div><div style="font-size:9px;color:var(--muted);margin-top:12px">— tonight's program —</div></div>`),
      onboarding: (m) => shell(`<div style="padding:16px;text-align:center"><div class="brand">TANGENT</div><h2 style="font-family:var(--serif);font-size:18px;margin:16px 0">Choose your repertoire</h2><div style="display:flex;flex-wrap:wrap;gap:5px;justify-content:center">${chipGrid()}</div><button class="primary-btn" style="margin-top:16px;background:var(--accent);color:#FFF8E7;border:none;width:80%">Take the Stage</button></div>`),
      dashboard: (m) => shell(`<div style="padding:12px"><div style="display:flex;justify-content:space-between"><div class="brand">TANGENT</div><span style="color:var(--gold)">⚙</span></div><div class="stats-pill" style="margin:10px 0">🔥 12 nights · ⏳ 4.2h · ⏱️ 245 WPM</div><div class="stage" style="margin-bottom:8px"><div style="font-size:9px;color:var(--muted)">HEADLINER</div><div style="font-family:var(--serif);font-size:15px;margin-top:4px">${ARTICLES[0].title}</div><div style="font-size:9px;margin-top:6px;color:var(--gold)">${ARTICLES[0].pub}</div></div><div class="ensemble"><div class="seat">${ARTICLES[1].title}</div><div class="seat">${ARTICLES[2].title}</div></div><div style="display:flex;gap:8px;margin-top:10px"><div class="pill-btn" style="flex:1;border:1px solid var(--gold);padding:8px;text-align:center;font-size:10px;color:var(--gold)">Discover</div><div class="pill-btn" style="flex:1;border:1px solid var(--gold);padding:8px;text-align:center;font-size:10px;color:var(--gold)">Shuffle</div></div></div>`),
      reader: (m) => shell(`${readerHud()}<div style="padding:12px">${articleBody()}</div>`, false),
      settings: (m) => shell(`${backHeader('Settings')}${settingsRows()}`),
      account: (m) => shell(`${backHeader('Account')}${accountRows()}`),
      history: (m) => shell(`${backHeader('History')}${articleList()}`),
      saved: (m) => shell(`${backHeader('Saved Reads')}${articleList()}`),
      categories: (m) => shell(`${backHeader('Categories')}<div style="display:flex;flex-wrap:wrap;gap:5px;padding:8px">${chipGrid()}</div>`),
      stats: (m) => shell(`${backHeader('Dashboard Stats')}<div style="display:flex;flex-wrap:wrap;gap:6px;padding:8px">${statsGrid()}</div>`),
      feedback: (m) => shell(`${modalForm('Send Feedback', 'Encore requests & notes…', 'Send')}`),
      feedrequest: (m) => shell(`${modalForm('Request a Feed', 'Suggest a new performer (RSS URL)', 'Submit')}`),
      developer: (m) => shell(`${backHeader('Developer Options')}${devOptions()}`),
    },
  },

  instrument: {
    name: 'Instrument',
    tagline: 'Signal laboratory — phosphor traces, orbital belts, nine-band frequency panel',
    fonts: 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&family=Space+Grotesk:wght@400;500;600&display=swap',
    fontFamily: "'Space Grotesk', sans-serif",
    serif: "'Space Grotesk', sans-serif",
    mono: "'JetBrains Mono', monospace",
    css: `
:root { --phosphor: #39FF14; --amber: #FFB000; }
.page-header { background: #0A1628; color: var(--phosphor); font-family: var(--mono); }
.instrument-light { --bg:#E8EEF4; --surface:#F4F8FC; --text:#0A1628; --muted:#5A6B7D; --border:#C5D3E0; --accent:#0066CC; --phosphor:#00875A; --amber:#CC7700; background:var(--bg); color:var(--text); font-family:var(--sans); }
.instrument-dark { --bg:#0A1628; --surface:#0F1F35; --text:#C8E6FF; --muted:#6B8FAD; --border:#1E3A5F; --accent:#4DA6FF; --phosphor:#39FF14; --amber:#FFB000; background:var(--bg); color:var(--text); font-family:var(--sans); }
.brand { font-family:var(--mono); font-size:10px; color:var(--phosphor); letter-spacing:.2em; }
.panel { border:1px solid var(--border); background:var(--surface); padding:8px; font-family:var(--mono); font-size:9px; position:relative; }
.panel::before { content:''; position:absolute; top:0;left:0;right:0;height:2px; background:linear-gradient(90deg, var(--phosphor), var(--amber)); }
.gauge-row { display:flex; gap:4px; margin:8px 0; }
.gauge { flex:1; border:1px solid var(--border); padding:4px; text-align:center; font-size:8px; font-family:var(--mono); }
.gauge .val { font-size:12px; color:var(--phosphor); display:block; }
.signal-hero { border:1px solid var(--phosphor); box-shadow:0 0 12px rgba(57,255,20,.15); padding:10px; }
.waveform { height:24px; background: repeating-linear-gradient(90deg, var(--phosphor) 0 2px, transparent 2px 6px); opacity:.4; margin:6px 0; }
.chip { font-family:var(--mono); font-size:8px; border:1px solid var(--border); padding:5px 6px; background:var(--surface); }
.chip-sel { border-color:var(--phosphor); color:var(--phosphor); box-shadow:0 0 6px rgba(57,255,20,.2); }
.hud { background:var(--surface); border-bottom:1px solid var(--phosphor); padding:8px; font-family:var(--mono); font-size:9px; display:flex; gap:6px; align-items:center; }
.progress { background:var(--border); height:3px; }
.progress-fill { background:var(--phosphor); height:100%; box-shadow:0 0 6px var(--phosphor); }
.reader-article h1 { font-family:var(--mono); font-size:14px; }
.orbit-ring { position:absolute; width:100px; height:100px; border:1px dashed var(--border); border-radius:50%; top:30%; right:-30px; opacity:.3; }`,
    screens: {
      startup: (m) => shell(`<div class="orbit-ring"></div><div style="padding:16px;font-family:var(--mono)"><div class="brand">TANGENT</div><div style="margin-top:60px;font-size:11px;color:var(--phosphor)">&gt; initializing reader<span class="cursor">_</span></div><div style="margin-top:20px;font-size:10px;color:var(--muted)">sapere aude</div><div class="waveform" style="margin-top:40px"></div></div>`),
      onboarding: (m) => shell(`<div style="padding:12px"><div class="brand">TANGENT</div><div class="panel" style="margin:12px 0">CALIBRATE · 9-BAND FILTER</div><div style="display:flex;flex-wrap:wrap;gap:4px">${chipGrid()}</div><button class="primary-btn" style="margin-top:12px;width:100%;font-family:var(--mono);background:var(--phosphor);color:#0A1628;border:none">ENGAGE FEED</button></div>`),
      dashboard: (m) => shell(`<div style="padding:10px"><div style="display:flex;justify-content:space-between;font-family:var(--mono);font-size:9px"><div class="brand">TANGENT</div><span>[CFG]</span></div><div class="gauge-row"><div class="gauge"><span class="val">12</span>STREAK</div><div class="gauge"><span class="val">4.2</span>HRS</div><div class="gauge"><span class="val">245</span>WPM</div></div><div class="signal-hero panel"><div style="color:var(--amber)">SIG-001 · RANK 0.94</div><div style="font-size:12px;margin:4px 0">${ARTICLES[0].title}</div><div class="waveform"></div><div style="color:var(--muted)">${ARTICLES[0].pub}</div></div><div class="panel" style="margin-top:6px">${ARTICLES[1].title}</div><div class="panel" style="margin-top:4px">${ARTICLES[2].title}</div><div style="display:flex;gap:4px;margin-top:8px"><div class="pill-btn" style="flex:1;font-family:var(--mono);font-size:8px;border:1px solid var(--border);padding:6px;text-align:center">DISCOVER</div><div class="pill-btn" style="flex:1;font-family:var(--mono);font-size:8px;border:1px solid var(--border);padding:6px;text-align:center">SHUFFLE</div></div></div>`),
      reader: (m) => shell(`${readerHud()}<div class="waveform" style="margin:0"></div>${articleBody()}`, false),
      settings: (m) => shell(`${backHeader('Settings')}${settingsRows()}`),
      account: (m) => shell(`${backHeader('Account')}${accountRows()}`),
      history: (m) => shell(`${backHeader('History')}<div class="panel">LOG · ${ARTICLES.length} entries</div>${articleList()}`),
      saved: (m) => shell(`${backHeader('Saved Reads')}<div class="panel">CACHE · offline HTML</div>${articleList()}`),
      categories: (m) => shell(`${backHeader('Categories')}<div style="display:flex;flex-wrap:wrap;gap:4px;padding:8px">${chipGrid()}</div>`),
      stats: (m) => shell(`${backHeader('Dashboard Stats')}<div style="display:flex;flex-wrap:wrap;gap:4px;padding:8px">${statsGrid()}</div>`),
      feedback: (m) => shell(`${modalForm('TX · Feedback', 'Input signal…', 'TRANSMIT')}`),
      feedrequest: (m) => shell(`${modalForm('RX · Feed Request', 'URL endpoint', 'REGISTER')}`),
      developer: (m) => shell(`${backHeader('DEV · Options')}${devOptions()}`),
    },
  },
};

function baseCss(theme) {
  return `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth}
body{font-family:${theme.fontFamily};background:#888;color:#222;line-height:1.4}
.page-header{padding:32px 40px 24px}
.page-header h1{font-size:2rem;margin-bottom:6px}
.page-header p{max-width:640px;opacity:.85}
.nav-sticky{position:sticky;top:0;z-index:100;background:#333;color:#fff;padding:10px 40px;display:flex;flex-wrap:wrap;gap:8px;font-size:12px}
.nav-sticky a{color:#fff;text-decoration:none;padding:4px 8px;border-radius:4px;background:#444}
.nav-sticky a:hover{background:#555}
.screen-block{padding:32px 40px;border-bottom:1px solid #ccc;background:#ddd}
.screen-title{font-size:1.1rem;margin-bottom:16px;text-transform:uppercase;letter-spacing:.1em;color:#444}
.pair{display:flex;flex-wrap:wrap;gap:24px;justify-content:center}
.phone-wrap{display:flex;flex-direction:column;align-items:center;gap:8px}
.mode-tag{font-size:11px;font-weight:600;color:#555;text-transform:uppercase;letter-spacing:.08em}
.phone{width:280px;height:580px;border-radius:32px;overflow:hidden;box-shadow:0 12px 40px rgba(0,0,0,.35);border:6px solid #1a1a1a;display:flex;flex-direction:column;position:relative}
.status-bar{height:28px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;flex-shrink:0}
.screen-body{flex:1;overflow:hidden;display:flex;flex-direction:column;padding:0;font-size:11px;position:relative}
.home-indicator{height:20px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.home-indicator::after{content:'';width:100px;height:4px;background:currentColor;opacity:.25;border-radius:2px}
.nav-header{display:flex;align-items:center;padding:10px 12px;gap:8px;font-weight:600;font-size:12px;border-bottom:1px solid var(--border)}
.back{background:none;border:none;font-size:16px;cursor:pointer;color:inherit}
.spacer{flex:1}
.section-label{font-size:8px;letter-spacing:.12em;color:var(--muted);padding:10px 12px 4px}
.card{background:var(--surface);border:1px solid var(--border);margin:0 12px 8px;border-radius:8px;overflow:hidden}
.row{display:flex;justify-content:space-between;align-items:center;padding:10px 12px;border-bottom:1px solid var(--border);font-size:11px}
.row:last-child{border-bottom:none}
.muted{color:var(--muted);font-size:10px}
.split{display:flex;padding:0}
.cell{flex:1;padding:12px;text-align:center;font-size:11px;border-right:1px solid var(--border)}
.segment{display:flex;gap:2px;font-size:9px}
.segment span{padding:3px 6px;border-radius:4px;background:var(--border)}
.segment .on{background:var(--bg);font-weight:600}
.toggle{width:36px;height:20px;border-radius:10px;background:var(--border);position:relative}
.toggle.on{background:var(--accent)}
.toggle.on::after{content:'';position:absolute;right:3px;top:3px;width:14px;height:14px;border-radius:50%;background:#fff}
.list-item{padding:10px 12px;border-bottom:1px solid var(--border)}
.list-title{font-size:11px;font-weight:500}
.list-meta{font-size:9px;color:var(--muted);margin-top:2px}
.stat-chip{padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-size:10px;background:var(--surface)}
.stat-chip.on{border-color:var(--accent);background:var(--accent);color:var(--bg)}
.primary-btn{padding:12px;border-radius:8px;font-weight:600;font-size:12px;margin:12px}
.modal-scrim{position:absolute;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:flex-end}
.modal{background:var(--surface);width:100%;padding:16px;border-radius:16px 16px 0 0}
.modal-handle{width:36px;height:4px;background:var(--border);border-radius:2px;margin:0 auto 12px}
.modal h3{font-size:14px;margin-bottom:10px}
.modal textarea{width:100%;height:80px;border:1px solid var(--border);border-radius:8px;padding:8px;font-family:inherit;font-size:11px;background:var(--bg);color:var(--text);resize:none}
.modal .primary-btn{width:calc(100% - 24px)}
.danger-zone .danger{color:var(--accent)}
.hud-title{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.progress{height:3px;background:var(--border);flex-shrink:0}
.progress-fill{height:100%;background:var(--accent)}
.reader-article{padding:12px}
.reader-article .byline{font-size:10px;color:var(--muted);margin:4px 0 10px}
.reader-article p{font-size:11px;margin-bottom:10px;line-height:1.5}
@keyframes blink{50%{opacity:0}}
.fit-section{padding:32px 40px;background:#eee}
.fit-section h2{margin-bottom:12px}
.fit-section ul{max-width:720px;padding-left:20px}
.fit-section li{margin-bottom:8px}
`;
}

function buildHtml(key, theme) {
  const sections = SCREENS.map(id => {
    const render = theme.screens[id];
    const light = render('light');
    const dark = render('dark');
    return phonePair(id, light, dark, key);
  }).join('\n');

  const nav = SCREENS.map(id => `<a href="#${id}">${label(id)}</a>`).join('');

  const fitNotes = {
    measure: `<ul>
<li><strong>Startup typewriter + "sapere aude"</strong> — matches StartupScreen's staged motto before Dashboard cards appear.</li>
<li><strong>Hero + 2-row grid + stats pill</strong> — mirrors Dashboard's hero-at-0, two secondary cards, and ≤3 configurable metrics with layout-stable placeholder.</li>
<li><strong>Discover / Shuffle pills</strong> — both trigger fresh ranked-feed requests excluding seen + on-screen IDs (real callable behavior).</li>
<li><strong>3-state category chips</strong> — interested / neutral / not-interested maps to onboarding and CategoryPreferences auto-save weights.</li>
<li><strong>Reader HUD + progress bar</strong> — scroll-up reveals HUD; bottom bar tracks article depth from WebView postMessage.</li>
<li><strong>Settings decomposition</strong> — Account, Library, Preferences, Support, Dev — same navigation graph as RootNavigator.</li>
</ul>`,
    ink: `<ul>
<li><strong>Catalog cards with IDs</strong> — each article is a ranked object with category, publication, and server-assigned score; the card metaphor makes the feed feel browsable without changing swipe-to-read flow.</li>
<li><strong>Vertical TANGENT spine</strong> — preserves the app's top-left brand anchor from StartupScreen and Dashboard.</li>
<li><strong>Saved Reads "offline copies"</strong> — reflects getSavedArticleHtml local cache capability.</li>
<li><strong>History timestamps</strong> — seen-article metadata stored in AsyncStorage for offline list rendering.</li>
<li><strong>Modal bottom sheets</strong> — Feedback and Feed Request use vertical modal presentation per navigator config.</li>
</ul>`,
    recital: `<ul>
<li><strong>Spotlight hero</strong> — position-0 article is server-locked highest scorer; staging it as "headliner" respects ranking without new UI logic.</li>
<li><strong>Ensemble rows</strong> — secondary feed cards remain tappable queue entries for Reader's 5-up prefetch buffer.</li>
<li><strong>Stats as "program notes"</strong> — streak, hours, WPM are real DASHBOARD_METRIC_DEFS; max 3 enforced on DashboardStatsScreen.</li>
<li><strong>Curtain + gold trim</strong> — pure visual drama; Reader gestures (edge swipe 45px zones) and HUD auto-hide unchanged underneath.</li>
<li><strong>Theme tri-segment in Settings</strong> — system/light/dark persisted to Firestore themePreference field.</li>
</ul>`,
    instrument: `<ul>
<li><strong>Signal rank display</strong> — surfaces the v2 sigmoid score (P/T/R/Q) metaphorically; no new data needed — score already drives order.</li>
<li><strong>9-band filter onboarding</strong> — 9 CATEGORIES from constants.ts contract; 3-state chips calibrate catLatent weights.</li>
<li><strong>Gauge metrics</strong> — streak/hours/WPM map to behavior-synced profile stats with placeholder-until-verified pattern.</li>
<li><strong>Waveform progress</strong> — scroll-depth percentage from useBehaviorTracker, same value driving ReaderProgressBar width.</li>
<li><strong>DISCOVER/SHUFFLE as channel switches</strong> — both call getRankedFeed with session exclusion set — identical to production.</li>
<li><strong>DEV panel</strong> — __DEV__ DeveloperOptionsScreen: sandbox reader + local data clear.</li>
</ul>`,
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Tangent Mockup — ${theme.name}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="${theme.fonts}" rel="stylesheet">
<style>
:root { --sans: ${theme.fontFamily}; --serif: ${theme.serif}; --mono: ${theme.mono}; }
${baseCss(theme)}
${theme.css}
</style>
</head>
<body>
<header class="page-header">
  <h1>Mockup ${key === 'measure' ? 'I' : key === 'ink' ? 'II' : key === 'recital' ? 'III' : 'IV'} — ${theme.name}</h1>
  <p>${theme.tagline}</p>
</header>
<nav class="nav-sticky">${nav}</nav>
${sections}
<section class="fit-section">
  <h2>How this design fits Tangent's capabilities</h2>
  ${fitNotes[key]}
</section>
</body>
</html>`;
}

const files = [
  ['mockup-i-measure.html', 'measure'],
  ['mockup-ii-ink-index.html', 'ink'],
  ['mockup-iii-recital.html', 'recital'],
  ['mockup-iv-instrument.html', 'instrument'],
];

for (const [filename, key] of files) {
  const html = buildHtml(key, themes[key]);
  const path = join(__dir, filename);
  writeFileSync(path, html, 'utf8');
  console.log('Wrote', path);
}

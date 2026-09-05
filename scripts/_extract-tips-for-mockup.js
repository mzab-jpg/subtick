// Extracts TIPS from the production dashboard and embeds them as HELP in the mockup.
const fs = require('fs');
const dash = fs.readFileSync('c:/2SubTick/scripts/control_dashboard.html', 'utf8');
const mock = 'c:/2SubTick/design/dashboard-redesign-mockup.html';
const html = fs.readFileSync(mock, 'utf8');
const start = dash.indexOf('const TIPS = {');
let depth = 0, end = -1, inStr = null;
for (let i = start + 'const TIPS = '.length; i < dash.length; i++) {
  const ch = dash[i];
  if (inStr) { if (ch === '\\') { i++; continue; } if (ch === inStr) inStr = null; continue; }
  if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; continue; }
  if (ch === '{') depth++;
  if (ch === '}') { depth--; if (depth === 0) { end = i; break; } }
}
const tipsSrc = dash.slice(start, end);
const map = {};
const re = /'([a-zA-Z_.]+)':\s*"((?:[^"\\]|\\.)*)"/g;
for (const m of tipsSrc.matchAll(re)) {
  try { map[m[1]] = JSON.parse('"' + m[2].replace(/\\'/g, "'") + '"'); } catch (e) { console.log('parse fail:', m[1]); }
}
const keys = [];
const kre = /'([a-zA-Z_.]+)':\[/g;
for (const m of html.matchAll(kre)) keys.push(m[1]);
const HELP = {}; const missing = [];
keys.forEach(k => { if (map[k]) HELP[k] = map[k]; else missing.push(k); });
console.log('mockup dials:', keys.length, '| covered:', keys.length - missing.length, '| missing:', missing.join(',') || 'none');
if (missing.length) console.log('NOTE: missing keys get a fallback sentence.');
const block = '\n// ===== Help texts (ported verbatim from the production dashboard TIPS) =====\nconst HELP = ' + JSON.stringify(HELP) + ';\n';
if (html.indexOf('const HELP =') >= 0) {
  const reBlock = /\/\/ ===== Help texts[\s\S]*?^const HELP = .*?;$/m;
  if (!reBlock.test(html)) throw new Error('existing HELP block found but could not be matched');
  fs.writeFileSync(mock, html.replace(reBlock, block.trim().replace(/^\/\/ ===== Help texts[^\n]*\n/, '// ===== Help texts (ported verbatim from the production dashboard TIPS) =====\n')));
  console.log('HELP block rebuilt:', Object.keys(HELP).length, 'entries');
} else {
  const anchor = "const getVal=p=>{const i=p.indexOf('.'); if(i<0) return CFG[p]; return CFG[p.slice(0,i)][p.slice(i+1)];};";
  if (!html.includes(anchor)) throw new Error('anchor not found');
  fs.writeFileSync(mock, html.replace(anchor, anchor + block));
  console.log('HELP block inserted:', Object.keys(HELP).length, 'entries,', block.length, 'chars');
}

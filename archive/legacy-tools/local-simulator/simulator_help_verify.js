// Verify showHelp() renders rich HTML (not "undefined") for plain-string HELP entries.
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, 'simulator.html'), 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
let js = m[1].replace(/loadPersonas\(\);\s*renderPersonaEditor\(\);\s*renderTabs\(\);\s*/, '');

// Stub DOM with a real tooltip element we can inspect
const tooltipState = { title: '', body: '', display: 'none', left: '', top: '' };
global.tooltipState = tooltipState;
js = `
global.document = {
  getElementById: (id) => {
    if (id === 'tooltip') return {
      style: {},
      querySelector(sel) {
        if (sel === '.tip-title') return { set innerHTML(v) { global.tooltipState.title = v; } };
        if (sel === '.tip-body') return { set innerHTML(v) { global.tooltipState.body = v; } };
        return null;
      },
    };
    return { value: '0', style: {}, textContent: '', innerHTML: '',
      classList: { toggle(){}, add(){}, remove(){} },
      addEventListener(){}, appendChild(){}, setAttribute(){}, focus(){}, blur(){}
    };
  },
  addEventListener(){},
  createElement: () => ({ className:'', innerHTML:'', appendChild(){}, style:{}, getContext:()=>null }),
  querySelectorAll: () => [],
};
global.window = { innerWidth: 1920, innerHeight: 1080 };
global.localStorage = { getItem(){ return null; }, setItem(){} };
global.setTimeout = (fn) => { fn(); return 0; };
` + '\n' + js + `
module.exports = { showHelp, HELP };
`;

const tmp = path.join(__dirname, '_help_mod.js');
fs.writeFileSync(tmp, js);
let mod;
try { mod = require(tmp); }
catch (e) { console.error('Module load failed:', e.message); fs.unlinkSync(tmp); process.exit(1); }

// Test 1: fdSave (Feedback Deltas) — the reported bug
mod.showHelp('fdSave', { getBoundingClientRect: () => ({ right: 100, top: 100, left: 50 }) });
const t1 = tooltipState;
console.log('fdSave title:', JSON.stringify(t1.title));
console.log('fdSave body starts:', JSON.stringify(t1.body.slice(0, 60)));
if (t1.title === 'undefined' || t1.body === 'undefined' || t1.body.includes('undefined')) {
  console.error('FAIL: fdSave still shows undefined');
  process.exit(1);
}
if (!t1.body.includes('What it is') || !t1.body.includes('tip-formula')) {
  console.error('FAIL: fdSave body missing rich HTML');
  process.exit(1);
}
console.log('  ✓ PASS  fdSave renders rich HTML (no undefined)');

// Test 2: a persona rate entry (readThorough)
mod.showHelp('readThorough', { getBoundingClientRect: () => ({ right: 100, top: 100, left: 50 }) });
if (tooltipState.title === 'undefined' || tooltipState.body === 'undefined' || tooltipState.body.includes('undefined')) {
  console.error('FAIL: readThorough still shows undefined');
  process.exit(1);
}
if (!tooltipState.body.includes('What it is') || !tooltipState.body.includes('tip-formula')) {
  console.error('FAIL: readThorough body missing rich HTML');
  process.exit(1);
}
console.log('  ✓ PASS  readThorough renders rich HTML (no undefined)');

// Test 3: a Mode B chart entry (scoreComp)
mod.showHelp('scoreComp', { getBoundingClientRect: () => ({ right: 100, top: 100, left: 50 }) });
if (tooltipState.title === 'undefined' || tooltipState.body === 'undefined' || tooltipState.body.includes('undefined')) {
  console.error('FAIL: scoreComp still shows undefined');
  process.exit(1);
}
if (!tooltipState.body.includes('tip-formula')) {
  console.error('FAIL: scoreComp body missing rich HTML');
  process.exit(1);
}
console.log('  ✓ PASS  scoreComp renders rich HTML (no undefined)');

// Test 4: a Trending entry (tiSave)
mod.showHelp('tiSave', { getBoundingClientRect: () => ({ right: 100, top: 100, left: 50 }) });
if (tooltipState.title === 'undefined' || tooltipState.body === 'undefined' || tooltipState.body.includes('undefined')) {
  console.error('FAIL: tiSave still shows undefined');
  process.exit(1);
}
console.log('  ✓ PASS  tiSave renders rich HTML (no undefined)');

// Test 5: a Quality entry (qiQE)
mod.showHelp('qiQE', { getBoundingClientRect: () => ({ right: 100, top: 100, left: 50 }) });
if (tooltipState.title === 'undefined' || tooltipState.body === 'undefined' || tooltipState.body.includes('undefined')) {
  console.error('FAIL: qiQE still shows undefined');
  process.exit(1);
}
console.log('  ✓ PASS  qiQE renders rich HTML (no undefined)');

// Test 6: unknown key returns silently (no crash)
mod.showHelp('nonexistent_key', { getBoundingClientRect: () => ({ right: 100, top: 100, left: 50 }) });
console.log('  ✓ PASS  unknown key handled gracefully');

// Test 7: every literal data-help key in the HTML has a HELP entry (coverage)
// Exclude template-literal placeholders like ${rk.key} (runtime-generated, not literal attributes)
const dataHelpKeys = [...html.matchAll(/data-help="([^"]+)"/g)].map(x => x[1]).filter(k => !k.includes('${'));
const missing = [...new Set(dataHelpKeys)].filter(k => !mod.HELP[k]);
if (missing.length) {
  console.error('FAIL: data-help keys missing from HELP:', missing.join(', '));
  process.exit(1);
}
console.log(`  ✓ PASS  all ${new Set(dataHelpKeys).size} literal data-help keys have HELP entries`);

fs.unlinkSync(tmp);
console.log('\n✓ ALL HELP CHECKS PASSED');
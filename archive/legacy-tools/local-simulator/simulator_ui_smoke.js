// UI smoke test: exercise the render/orchestration functions with a fuller DOM stub.
// Catches runtime errors in template-literal HTML builders that node --check cannot.
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, 'simulator.html'), 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
let js = m[1].replace(/loadPersonas\(\);\s*renderPersonaEditor\(\);\s*renderTabs\(\);\s*/, '');

// --- Fuller DOM stub (defined INSIDE the generated module so it's in scope) ---
js = `
const elements = {};
function makeCtx() {
  return new Proxy({}, {
    get: (t, prop) => { if (!(prop in t)) t[prop] = () => {}; return t[prop]; },
    set: (t, prop, v) => { t[prop] = v; return true; }
  });
}
function makeEl(id) {
  return {
    id, value: '0', checked: false, style: {}, textContent: '', innerHTML: '',
    className: '', classList: { toggle(){}, add(){}, remove(){} },
    addEventListener(){},
    appendChild(child){ this.innerHTML += (child && (child.innerHTML || child.textContent)) || ''; return child; },
    setAttribute(){}, focus(){}, blur(){},
    getContext: () => makeCtx(), querySelector: () => makeEl(id+'_q'), querySelectorAll: () => [],
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 }),
    closest: () => null, tagName: 'DIV', nextElementSibling: null, previousElementSibling: null,
    removeEventListener(){}, getAttribute(){ return ''; }
  };
}
global.document = {
  getElementById: (id) => { if (!elements[id]) elements[id] = makeEl(id); return elements[id]; },
  addEventListener(){},
  createElement: () => makeEl('created'),
  querySelectorAll: () => [],
};
global.window = { innerWidth: 1920, innerHeight: 1080 };
global.localStorage = { getItem(){ return null; }, setItem(){} };
global.setTimeout = (fn) => { fn(); return 0; };
global.alert = (msg) => { throw new Error('alert called: ' + msg); };
` + '\n' + js + `
module.exports = { runPersonaSim, getAppConfig, getSimSize, personaToUserSlice, DEFAULT_PERSONAS, extractMetric, METRICS, renderPersonaEditor, renderTabs, renderTabContent, openCompare, closeCompare, setMode, selectDetailPersona, selectInspectorUser, switchTab, configTabs, activeTabId, tabCounter, personas, loadPersonas, __elements: elements };
`;

const tmp = path.join(__dirname, '_ui_smoke_mod.js');
fs.writeFileSync(tmp, js);
let mod;
try { mod = require(tmp); }
catch (e) { console.error('Module load failed:', e.message); fs.unlinkSync(tmp); process.exit(1); }

let pass = true;
function check(label, cond, detail) {
  console.log(`  ${cond ? '\u2713 PASS' : '\u2717 FAIL'}  ${label}${detail ? ' (' + detail + ')' : ''}`);
  if (!cond) pass = false;
}

(async () => {
  console.log('=== UI RENDER SMOKE TEST ===\n');

  // 1. Persona editor renders 5 default personas
  mod.loadPersonas();
  mod.renderPersonaEditor();
  const ed = mod.__elements['personaEditor'];
  check('personaEditor populated', ed.innerHTML.length > 0, `${ed.innerHTML.length} chars`);
  check('personaEditor contains Engaged Power User', ed.innerHTML.includes('Engaged Power User'));
  check('personaEditor contains all 5 personas',
    ['Engaged Power User','Casual Skimmer','Restless Quick-Exitter','Hostile / Critical','New User']
      .every(n => ed.innerHTML.includes(n)));

  // 2. Tab strip renders empty state
  mod.renderTabs();
  const strip = mod.__elements['tabStrip'];
  check('tabStrip empty state', strip.innerHTML.includes('No configs yet'));

  // 3. Build a fake tab with real persona results and render Mode A grid
  const appConfig = {
    sw:{P:0.6,T:0.15,R:0.1,Q:0.15}, swt:{T:0.43,R:0.57},
    fd:{save:0.55,unsave:-0.55,like:0.40,unlike:-0.40,read_thorough:0.30,read_skim:0.10,read_shallow:0,swipe_next:0,quick_exit:0,swipe_not_interested:-0.40},
    lr:{category:0.08,length:0.12,publisher:0.16},
    minW:0.1,maxW:5.0,decayRate:0.995,
    maxTS:50,tDecay:0.9057,
    ti:{save:3,unsave:-3,like:2,unlike:-2,read_thorough:1.5,read_skim:0.5,read_shallow:0.2,quick_exit:0,swipe_next:0,swipe_not_interested:0},
    qi:{save:0.010,unsave:-0.010,like:0.005,unlike:-0.005,read_thorough:0.005,read_skim:0.001,swipe_not_interested:-0.010,quick_exit:-0.005,read_shallow:0,swipe_next:0},
    tranche:{highThresh:0.40,midThresh:0.20,highSize:12,midSize:8,tailSize:10,pubCap:5,newUserThresh:30}
  };
  const simSize = {numUsers:200,numDays:7,feedsPerDay:2,articlesPerFeed:30,numArticles:300,newArticlesPerDay:20,articleAgeRange:60};

  function runOne(persona) {
    return new Promise(resolve => {
      mod.runPersonaSim(appConfig, simSize, persona, ()=>{}, (sd) => resolve(sd));
    });
  }

  const personaResults = {};
  for (const p of mod.DEFAULT_PERSONAS) {
    personaResults[p.name] = await runOne(p);
  }

  mod.configTabs.length = 0;
  mod.configTabs.push({ id:'tab_1', name:'Config 1', appConfig, simSize, fastMode:true, personaResults, mode:'grid', detailPersona:'Engaged Power User' });
  mod.switchTab('tab_1');

  // 4. Tab strip renders with 1 tab
  mod.renderTabs();
  check('tabStrip has Config 1', strip.innerHTML.includes('Config 1'));
  check('tabStrip has Compare button', strip.innerHTML.includes('Compare All'));

  // 5. Mode A grid renders
  mod.renderTabContent();
  const content = mod.__elements['resultsContent'];
  check('Mode A grid rendered', content.innerHTML.includes('Persona Comparison'));
  check('Mode A has persona pills', content.innerHTML.includes('persona-pill'));
  check('Mode A has metric rows', content.innerHTML.includes('Avg P-Score (final)'));
  check('Mode A has sparkline canvases', content.innerHTML.includes('spark-canvas'));
  check('Mode A has all 5 personas',
    ['Engaged Power User','Casual Skimmer','Restless Quick-Exitter','Hostile / Critical','New User']
      .every(n => content.innerHTML.includes(n)));

  // 6. Mode B detail renders
  mod.setMode('detail');
  check('Mode B rendered', content.innerHTML.includes('Persona Detail'));
  mod.selectInspectorUser(3);
  check('Mode B inspector switched user', content.innerHTML.includes('Inspect user'));
  check('Mode B has summary cards', content.innerHTML.includes('summary-card'));
  check('Mode B has chart containers', content.innerHTML.includes('chart-container'));
  check('Mode B has pScoreChart canvas', content.innerHTML.includes('pScoreChart_Engaged_Power_User'));
  check('Mode B has pubQChart canvas', content.innerHTML.includes('pubQChart_Engaged_Power_User'));
  check('Mode B has scoreCompChart canvas', content.innerHTML.includes('scoreCompChart_Engaged_Power_User'));
  check('Mode B has trendingChart canvas', content.innerHTML.includes('trendingChart_Engaged_Power_User'));
  check('Mode B has day table', content.innerHTML.includes('dayTable_Engaged_Power_User'));
  check('Mode B has User Inspector section', content.innerHTML.includes('Individual User Inspector'));
  check('Mode B has user category chart', content.innerHTML.includes('userCatChart_Engaged_Power_User'));
  check('Mode B has user final weights chart', content.innerHTML.includes('userFinalChart_Engaged_Power_User'));
  check('Mode B has user config table', content.innerHTML.includes('userConfigTable_Engaged_Power_User'));

  // 7. Switch detail persona
  mod.selectDetailPersona('New User');
  check('Mode B switched persona', content.innerHTML.includes('pScoreChart_New_User'));

  // 8. Back to grid, add a 2nd tab, render Compare overlay
  mod.setMode('grid');
  mod.configTabs.push({ id:'tab_2', name:'Config 2', appConfig:{...appConfig, sw:{P:0.5,T:0.2,R:0.1,Q:0.2}}, simSize, fastMode:true, personaResults, mode:'grid', detailPersona:'Engaged Power User' });
  mod.renderTabs();
  check('tabStrip has 2 tabs', strip.innerHTML.includes('Config 1') && strip.innerHTML.includes('Config 2'));

  mod.openCompare();
  const ov = mod.__elements['compareOverlay'];
  check('Compare overlay visible', ov.style.display === 'block');
  check('Compare has both config columns', ov.innerHTML.includes('Config 1') && ov.innerHTML.includes('Config 2'));
  check('Compare has metric blocks', ov.innerHTML.includes('Avg P-Score (final)'));
  check('Compare has App Config Differences', ov.innerHTML.includes('App Config Differences'));
  check('Compare has color-coded cells', ov.innerHTML.includes('cmp-cell'));

  mod.closeCompare();
  check('Compare overlay hidden', ov.style.display === 'none');

  console.log(`\n${pass ? '\u2713 ALL UI CHECKS PASSED' : '\u2717 SOME UI CHECKS FAILED'}`);
  fs.unlinkSync(tmp);
  process.exit(pass ? 0 : 1);
})().catch(e => {
  console.error('FATAL:', e.message);
  console.error(e.stack);
  fs.unlinkSync(tmp);
  process.exit(1);
});
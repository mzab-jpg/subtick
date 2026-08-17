// Verify runUnifiedSim: one shared world, mixed population, per-persona metrics.
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, 'simulator.html'), 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
let js = m[1].replace(/loadPersonas\(\);\s*renderPersonaEditor\(\);\s*renderTabs\(\);\s*/, '');

js = `
global.document = {
  getElementById: () => ({ value: '0', style: {}, textContent: '', innerHTML: '',
    classList: { toggle(){}, add(){}, remove(){} },
    addEventListener(){}, appendChild(){}, setAttribute(){}, focus(){}, blur(){}
  }),
  addEventListener(){},
  createElement: () => ({ className:'', innerHTML:'', appendChild(){}, style:{}, getContext:()=>null }),
  querySelectorAll: () => [],
};
global.window = { innerWidth: 1920, innerHeight: 1080 };
global.localStorage = { getItem(){ return null; }, setItem(){} };
global.setTimeout = (fn) => { fn(); return 0; };
` + '\n' + js + `
module.exports = { runUnifiedSim, DEFAULT_PERSONAS };
`;

const tmp = path.join(__dirname, '_unified_mod.js');
fs.writeFileSync(tmp, js);
const mod = require(tmp);

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
const simSize = {numUsers:100,numDays:5,feedsPerDay:2,articlesPerFeed:30,numArticles:200,newArticlesPerDay:10,articleAgeRange:60};
const enabled = mod.DEFAULT_PERSONAS;

function run() {
  return new Promise(resolve => mod.runUnifiedSim(appConfig, simSize, enabled, ()=>{}, resolve));
}

(async () => {
  console.log('=== UNIFIED SIM TEST ===\n');
  const results = await run();
  const names = Object.keys(results);
  let pass = true;
  function check(label, cond, detail) {
    console.log(`  ${cond ? '\u2713 PASS' : '\u2717 FAIL'}  ${label}${detail ? ' (' + detail + ')' : ''}`);
    if (!cond) pass = false;
  }

  check('all 5 personas present', names.length === 5, names.join(', '));

  // Shared world: every persona sees the SAME article pool and SAME pubQual map
  const first = results[names[0]];
  check('shared articles pool', names.every(n => results[n].articles === first.articles));
  check('shared pubQual map', names.every(n => results[n].pubQual === first.pubQual));
  check('shared sampledArticleIds', names.every(n => JSON.stringify(results[n].sampledArticleIds) === JSON.stringify(first.sampledArticleIds)));
  check('shared sampledPublishers', names.every(n => JSON.stringify(results[n].sampledPublishers) === JSON.stringify(first.sampledPublishers)));

  // Population split: equal weights (100 each) => roughly equal user counts summing to numUsers
  const totalUsers = names.reduce((s,n)=>s+results[n].users.length,0);
  const userCounts = names.map(n=>results[n].users.length);
  check('population split sums to numUsers', totalUsers === simSize.numUsers, `sum=${totalUsers}, counts=${userCounts.join(',')}`);
  check('roughly equal split (min>=10)', Math.min(...userCounts) >= Math.max(1, Math.floor(simSize.numUsers/names.length*0.5)), `min=${Math.min(...userCounts)}`);

  // Per-persona metrics MUST differ (Engaged learns P, Quick-Exitter doesn't)
  const eng = results['Engaged Power User'].dailyMetrics;
  const qe = results['Restless Quick-Exitter'].dailyMetrics;
  const dE = eng[eng.length-1], dQ = qe[qe.length-1];
  check('Engaged avgP > Quick-Exitter avgP (unified system)', dE.avgP > dQ.avgP,
    `Engaged=${dE.avgP.toFixed(3)} vs QE=${dQ.avgP.toFixed(3)}`);
  check('persona dailyMetrics differ', JSON.stringify(eng) !== JSON.stringify(qe));

  // Unified signal: user counts per persona reflect equal weights; check P grows for Engaged across days
  const engD1 = eng[0].avgP;
  check('Engaged P learns in unified system', dE.avgP > engD1, `${engD1.toFixed(3)} -> ${dE.avgP.toFixed(3)}`);

  // Sane ranges
  const allAP = names.map(n=>{const dm=results[n].dailyMetrics;return dm[dm.length-1].avgP;});
  check('all avgP in [0.05, 0.45]', allAP.every(v=>v>0.05&&v<0.45), `min=${Math.min(...allAP).toFixed(3)} max=${Math.max(...allAP).toFixed(3)}`);

  console.log('\nPer-persona final stats (unified shared system):');
  names.forEach(n=>{
    const dm=results[n].dailyMetrics;const d=dm[dm.length-1];
    console.log(`  ${n.padEnd(28)} users=${String(results[n].users.length).padStart(4)} avgP=${d.avgP.toFixed(3)} avgFS=${d.avgFS.toFixed(3)} high%=${(d.trancheCounts.high/Math.max(1,d.count)*100).toFixed(1)} tail%=${(d.trancheCounts.tail/Math.max(1,d.count)*100).toFixed(1)}`);
  });

  console.log(`\n${pass ? '\u2713 ALL UNIFIED CHECKS PASSED' : '\u2717 SOME UNIFIED CHECKS FAILED'}`);
  fs.unlinkSync(tmp);
  process.exit(pass ? 0 : 1);
})().catch(e => { console.error('FATAL:', e.message); console.error(e.stack); fs.unlinkSync(tmp); process.exit(1); });
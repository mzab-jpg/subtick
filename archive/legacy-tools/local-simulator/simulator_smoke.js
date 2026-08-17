// Smoke test: extract engine from simulator.html, run per-persona sims, verify differentiation.
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, 'simulator.html'), 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
let js = m[1].replace(/loadPersonas\(\);\s*renderPersonaEditor\(\);\s*renderTabs\(\);\s*/, '');

// Stub DOM for Node execution
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
// Make setTimeout synchronous for testing
global.setTimeout = (fn) => { fn(); return 0; };
` + '\n' + js + `
module.exports = { runPersonaSim, getAppConfig, getSimSize, personaToUserSlice, DEFAULT_PERSONAS, extractMetric, METRICS };
`;

const tmp = path.join(__dirname, '_smoke_mod.js');
fs.writeFileSync(tmp, js);
let mod;
try { mod = require(tmp); }
catch (e) { console.error('Module load failed:', e.message); fs.unlinkSync(tmp); process.exit(1); }

function makeAppConfig() {
  const p=0.60,t=0.15,r=0.10,q=0.15;const s1=p+t+r+q;
  const tt=0.43,tr=0.57;const s2=tt+tr;
  const lrBase=0.08;
  return {
    sw:{P:p/s1,T:t/s1,R:r/s1,Q:q/s1}, swt:{T:tt/s2,R:tr/s2},
    fd:{save:0.55,unsave:-0.55,like:0.40,unlike:-0.40,read_thorough:0.30,read_skim:0.10,read_shallow:0,swipe_next:0,quick_exit:0,swipe_not_interested:-0.40},
    lr:{category:lrBase*1.0,length:lrBase*1.5,publisher:lrBase*2.0},
    minW:0.1,maxW:5.0,decayRate:0.995,
    maxTS:50,tDecay:0.9057,
    ti:{save:3,unsave:-3,like:2,unlike:-2,read_thorough:1.5,read_skim:0.5,read_shallow:0.2,quick_exit:0,swipe_next:0,swipe_not_interested:0},
    qi:{save:0.010,unsave:-0.010,like:0.005,unlike:-0.005,read_thorough:0.005,read_skim:0.001,swipe_not_interested:-0.010,quick_exit:-0.005,read_shallow:0,swipe_next:0},
    tranche:{highThresh:0.40,midThresh:0.20,highSize:12,midSize:8,tailSize:10,pubCap:5,newUserThresh:30}
  };
}
const appConfig = makeAppConfig();
const simSize = {numUsers:200,numDays:7,feedsPerDay:2,articlesPerFeed:30,numArticles:300,newArticlesPerDay:20,articleAgeRange:60};

function runOne(persona) {
  return new Promise(resolve => {
    mod.runPersonaSim(appConfig, simSize, persona, ()=>{}, (simData) => resolve(simData));
  });
}

(async () => {
  console.log('=== ENGINE SMOKE TEST ===\n');
  const results = {};
  for (const persona of mod.DEFAULT_PERSONAS) {
    const sd = await runOne(persona);
    const dN = sd.dailyMetrics[sd.dailyMetrics.length-1];
    const d1 = sd.dailyMetrics[0];
    results[persona.name] = {
      avgP: dN.avgP, avgP_d1: d1.avgP, avgFS: dN.avgFS,
      pDom: dN.count>0 ? dN.dom.P/dN.count : 0,
      highPct: dN.count>0 ? dN.trancheCounts.high/dN.count : 0,
      tailPct: dN.count>0 ? dN.trancheCounts.tail/dN.count : 0,
      avgPubs: dN.avgPubs, users: sd.users.length, days: sd.dailyMetrics.length
    };
  }

  console.log('Per-persona results (final day):');
  console.log('Persona'.padEnd(28),'avgP'.padStart(7),'d1'.padStart(7),'avgFS'.padStart(7),'pDom%'.padStart(7),'high%'.padStart(6),'tail%'.padStart(6),'pubs');
  for (const [name, r] of Object.entries(results)) {
    console.log(name.padEnd(28),
      r.avgP.toFixed(3).padStart(7), r.avgP_d1.toFixed(3).padStart(7), r.avgFS.toFixed(3).padStart(7),
      (r.pDom*100).toFixed(1).padStart(7), (r.highPct*100).toFixed(1).padStart(6),
      (r.tailPct*100).toFixed(1).padStart(6), r.avgPubs.toFixed(1));
  }

  let pass = true;
  function check(label, cond, detail) {
    console.log(`  ${cond?'\u2713 PASS':'\u2717 FAIL'}  ${label}${detail?' ('+detail+')':''}`);
    if (!cond) pass = false;
  }

  const eng = results['Engaged Power User'];
  const qe  = results['Restless Quick-Exitter'];
  const hos = results['Hostile / Critical'];

  check('Engaged: avgP rises (personalization learns)', eng.avgP > eng.avgP_d1,
    `${eng.avgP_d1.toFixed(3)} -> ${eng.avgP.toFixed(3)}`);
  check('Engaged avgP > Quick-Exitter avgP', eng.avgP > qe.avgP,
    `${eng.avgP.toFixed(3)} vs ${qe.avgP.toFixed(3)}`);
  check('Quick-Exitter tail% >= Engaged tail%', qe.tailPct >= eng.tailPct,
    `${(qe.tailPct*100).toFixed(1)}% vs ${(eng.tailPct*100).toFixed(1)}%`);
  check('Hostile avgFS <= Engaged avgFS', hos.avgFS <= eng.avgFS + 0.02,
    `${hos.avgFS.toFixed(3)} vs ${eng.avgFS.toFixed(3)}`);
  const allP = Object.values(results).map(r=>r.avgP);
  check('All avgP in sane range [0.05, 0.45]', allP.every(v=>v>0.05&&v<0.45),
    `min=${Math.min(...allP).toFixed(3)} max=${Math.max(...allP).toFixed(3)}`);
  check('appConfig not mutated', appConfig.sw.P===0.6, `sw.P=${appConfig.sw.P}`);
  check('dailyMetrics length == numDays', eng.days===simSize.numDays, `days=${eng.days}`);
  check('users length == numUsers', eng.users===simSize.numUsers, `users=${eng.users}`);

  console.log(`\n${pass ? '\u2713 ALL CHECKS PASSED' : '\u2717 SOME CHECKS FAILED'}`);
  fs.unlinkSync(tmp);
  process.exit(pass ? 0 : 1);
})();

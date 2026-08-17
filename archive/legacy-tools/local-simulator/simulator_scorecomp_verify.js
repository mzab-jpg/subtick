// Verify the Score Comp fix: weighted contributions must sum to avgFS, and swT=0 => T contribution exactly 0.
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

const tmp = path.join(__dirname, '_scorecomp_mod.js');
fs.writeFileSync(tmp, js);
const mod = require(tmp);

function makeConfig(swT) {
  const p=0.6,t=swT,r=0.1,q=0.15;const s1=p+t+r+q;
  return {
    sw:{P:p/s1,T:t/s1,R:r/s1,Q:q/s1}, swt:{T:0.43,R:0.57},
    fd:{save:0.55,unsave:-0.55,like:0.40,unlike:-0.40,read_thorough:0.30,read_skim:0.10,read_shallow:0,swipe_next:0,quick_exit:0,swipe_not_interested:-0.40},
    lr:{category:0.08,length:0.12,publisher:0.16},
    minW:0.1,maxW:5.0,decayRate:0.995,
    maxTS:50,tDecay:0.9057,
    ti:{save:3,unsave:-3,like:2,unlike:-2,read_thorough:1.5,read_skim:0.5,read_shallow:0.2,quick_exit:0,swipe_next:0,swipe_not_interested:0},
    qi:{save:0.010,unsave:-0.010,like:0.005,unlike:-0.005,read_thorough:0.005,read_skim:0.001,swipe_not_interested:-0.010,quick_exit:-0.005,read_shallow:0,swipe_next:0},
    tranche:{highThresh:0.40,midThresh:0.20,highSize:12,midSize:8,tailSize:10,pubCap:5,newUserThresh:30}
  };
}
const simSize = {numUsers:100,numDays:5,feedsPerDay:2,articlesPerFeed:30,numArticles:200,newArticlesPerDay:10,articleAgeRange:60};

function run(appConfig) {
  return new Promise(resolve => mod.runUnifiedSim(appConfig, simSize, mod.DEFAULT_PERSONAS, ()=>{}, resolve));
}

(async () => {
  console.log('=== SCORE COMP VERIFY ===\n');
  let pass = true;
  function check(label, cond, detail) {
    console.log(`  ${cond ? '\u2713 PASS' : '\u2717 FAIL'}  ${label}${detail ? ' (' + detail + ')' : ''}`);
    if (!cond) pass = false;
  }

  // Test 1: default weights (swT=0.15)
  const r1 = await run(makeConfig(0.15));
  let wvSumOk = true, worstDiff = 0;
  for (const n of Object.keys(r1)) {
    for (const d of r1[n].dailyMetrics) {
      const sum = d.avgP*r1[n].config.sw.P + d.avgT*r1[n].config.sw.T + d.avgR*r1[n].config.sw.R + d.avgQ*r1[n].config.sw.Q;
      const diff = Math.abs(sum - d.avgFS);
      worstDiff = Math.max(worstDiff, diff);
      if (diff > 1e-9) wvSumOk = false;
    }
  }
  check('weighted sum == avgFS (default swT=0.15)', wvSumOk, `worst diff=${worstDiff.toExponential(2)}`);

  // Test 2: swT=0.0 — T weighted contribution must be exactly 0, still sum to avgFS
  const r2 = await run(makeConfig(0.0));
  let tZero = true, sumOk = true, rawTmax = 0;
  for (const n of Object.keys(r2)) {
    for (const d of r2[n].dailyMetrics) {
      rawTmax = Math.max(rawTmax, d.avgT);
      const wT = d.avgT * r2[n].config.sw.T;
      if (wT !== 0) tZero = false;
      const sum = d.avgP*r2[n].config.sw.P + d.avgT*r2[n].config.sw.T + d.avgR*r2[n].config.sw.R + d.avgQ*r2[n].config.sw.Q;
      if (Math.abs(sum - d.avgFS) > 1e-9) sumOk = false;
    }
  }
  check('raw avgT still builds up (confirms root cause)', rawTmax > 0.1, `max avgT=${rawTmax.toFixed(3)}`);
  check('swT=0 => weighted T contribution exactly 0', tZero, 'no phantom T segment');
  check('weighted sum == avgFS (swT=0.0)', sumOk, 'stacked total equals avg final score');

  // Test 3: chart must retain the shared absolute [0, 1] score scale, not scale to each persona's maximum.
  check('chart uses fixed 0–1 score scale',
    html.includes('const scoreMax=1') && !html.includes('const maxFS=Math.max(0.5,...dm.map(d=>d.avgInitFS||0));'),
    'cross-persona bar heights use the same y-axis');
  check('chart displays absolute y-axis ticks',
    html.includes("ctx.fillText(value.toFixed(2),p-5,y+3)"),
    '0.00, 0.25, 0.50, 0.75, 1.00');

  console.log(`\n${pass ? '\u2713 ALL SCORE COMP CHECKS PASSED' : '\u2717 SOME SCORE COMP CHECKS FAILED'}`);
  fs.unlinkSync(tmp);
  process.exit(pass ? 0 : 1);
})().catch(e => { console.error('FATAL:', e.message); console.error(e.stack); fs.unlinkSync(tmp); process.exit(1); });
/* reproduce.js — run the model headlessly and print the key numbers reported in
 * the whitepaper (§10). No dependencies; requires only Node.
 *
 *   node reproduce.js
 *
 * Both engines export a { createModel, step } API and are pure (seeded PRNG), so a
 * given (seed, parameters) pair reproduces bit-for-bit. This harness is the
 * verifiable counterpart to the whitepaper's results section: a reviewer can read
 * the model in engine_multi.js and confirm its behaviour here in ~30 seconds.
 */
const MULTI  = require('./engine_multi.js');   // deployed multi-domain model
const SINGLE = require('./engine.js');          // single-asset EFE variant (§6.3)

const SEEDS = [5, 2024, 42];                     // small set for a quick run
const STEPS = 2000, WARM = 200;

const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
const sd   = a => { const m = mean(a); return Math.sqrt(mean(a.map(x => (x - m) ** 2))); };

function runMulti(cfg) { const m = MULTI.createModel(cfg); for (let i = 0; i < STEPS; i++) MULTI.step(m); return m.history; }
function runSingle(cfg){ const m = SINGLE.createModel(cfg); const h = []; for (let i = 0; i < STEPS; i++) h.push(SINGLE.step(m)); return h; }
const tail = h => h.slice(WARM);
const avgOverSeeds = fn => mean(SEEDS.map(fn));

function xcorr(a, b, lag) {
  const ma = mean(a), mb = mean(b), sa = sd(a), sb = sd(b);
  let c = 0; for (let i = 0; i < a.length - lag; i++) c += (a[i] - ma) * (b[i + lag] - mb);
  return (c / (a.length - lag)) / (sa * sb);
}

console.log('\n=== Believing Markets — reproduction of whitepaper §10 (seeds ' + SEEDS.join(',') + ', ' + STEPS + ' steps) ===\n');

// 10.1 baseline (K=3)
{
  const pMin = avgOverSeeds(s => Math.min(...tail(runMulti({seed:s})).flatMap(r => r.prices)));
  const pMean= avgOverSeeds(s => mean(tail(runMulti({seed:s})).flatMap(r => r.prices)));
  const pMax = avgOverSeeds(s => Math.max(...tail(runMulti({seed:s})).flatMap(r => r.prices)));
  const lev  = avgOverSeeds(s => mean(tail(runMulti({seed:s})).map(r => r.leverage)));
  const ponziT = avgOverSeeds(s => tail(runMulti({seed:s})).filter(r => r.ponzi > 0.1).length / (STEPS - WARM));
  const bk   = avgOverSeeds(s => runMulti({seed:s}).reduce((a, r) => a + r.bankruptcies, 0));
  console.log('10.1 Baseline (K=3)');
  console.log('     price  min/mean/max : ' + pMin.toFixed(1) + ' / ' + pMean.toFixed(1) + ' / ' + pMax.toFixed(1) + '   (F = 100)');
  console.log('     mean leverage       : ' + lev.toFixed(2) + '×');
  console.log('     time in Ponzi (>0.1): ' + (ponziT*100).toFixed(0) + '%');
  console.log('     insolvencies / run  : ' + bk.toFixed(0));
}

// 10.2 belief leads leverage
{
  let bestLag = 0, bestC = -2;
  for (let lag = 0; lag <= 10; lag++) {
    const c = avgOverSeeds(s => {
      const h = runMulti({seed:s});
      return xcorr(h.map(r => mean(r.apprec)), h.map(r => r.leverage), lag);
    });
    if (c > bestC) { bestC = c; bestLag = lag; }
  }
  console.log('\n10.2 Belief leads leverage');
  console.log('     peak cross-correlation at lag +' + bestLag + ' (corr ' + bestC.toFixed(2) + ')');
}

// 10.3 capital concentration
{
  const topShare = h => h.map(r => { const t = r.capital.reduce((a,b)=>a+b,0) + r.cash; return Math.max(...r.capital) / t; });
  const meanShare = avgOverSeeds(s => mean(topShare(tail(runMulti({seed:s})))));
  const peakShare = avgOverSeeds(s => Math.max(...topShare(tail(runMulti({seed:s})))));
  console.log('\n10.3 Capital displacement (K=3)');
  console.log('     top-domain capital share  mean/peak : ' + (meanShare*100).toFixed(0) + '% / ' + (peakShare*100).toFixed(0) + '%');
}

// 10.4 K dampening
{
  console.log('\n10.4 More domains damp bubbles (mean peak price)');
  const row = [1,2,3,4,5].map(K => 'K=' + K + ':' + avgOverSeeds(s => Math.max(...tail(runMulti({nAssets:K,seed:s})).flatMap(r => r.prices))).toFixed(0));
  console.log('     ' + row.join('   '));
}

// 10.5 debt aversion -> leverage
{
  console.log('\n10.5 Preference against debt is a lever (mean leverage)');
  const row = [0.05,0.19,0.35,0.55].map(d => 'dA=' + d + ':' + avgOverSeeds(s => mean(tail(runMulti({debtAversion:d,seed:s})).map(r => r.leverage))).toFixed(2) + '×');
  console.log('     ' + row.join('   '));
}

// 10.6 emotion, both engines
{
  console.log('\n10.6 Emotional memory is engine-dependent (mean peak price)');
  const multi  = [0,0.15,0.35].map(e => 'e=' + e + ':' + avgOverSeeds(s => Math.max(...tail(runMulti({emotion:e,seed:s})).flatMap(r => r.prices))).toFixed(0));
  const single = [0.05,0.15,0.35].map(e => 'e=' + e + ':' + avgOverSeeds(s => Math.max(...tail(runSingle({emotion:e,seed:s})).map(r => r.price))).toFixed(0));
  console.log('     multi-domain (bounded)      : ' + multi.join('   '));
  console.log('     single-asset EFE (runs away): ' + single.join('   '));
}

console.log('\n(These are stylized, non-calibrated results — see whitepaper §11-12 for scope.)\n');

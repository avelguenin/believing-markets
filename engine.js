/* ============================================================================
   Active Inference reconstruction of Minskyian macroeconomics
   Engine implementing the model outlined in Guénin--Carlut & Benazouz (2024),
   "Modelling the social construction of preferences in financial economics".

   Each agent is a discrete Active Inference (POMDP) agent in the PyMDP style:
   it infers a hidden MARKET REGIME from price/wealth observations, evaluates the
   Expected Free Energy of candidate portfolio positions, and selects an action
   by softmax over -EFE. Its aversion to loss / debt (the "preference against
   debt") is NOT fixed: it decays during calm periods and spikes after losses,
   which is the endogenous engine of Minsky's boom-and-bust cycle.
   ============================================================================ */
(function (root) {
  'use strict';

  // ---- small utilities ------------------------------------------------------
  function mulberry32(a) {                     // seeded PRNG -> reproducible runs
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function normalize(v) {
    let s = 0; for (let i = 0; i < v.length; i++) s += v[i];
    if (s <= 0) return v.map(() => 1 / v.length);
    return v.map(x => x / s);
  }
  function entropy(col) {                       // Shannon entropy of a distribution
    let h = 0;
    for (let i = 0; i < col.length; i++) { const p = col[i]; if (p > 1e-12) h -= p * Math.log(p); }
    return h;
  }
  function softmaxNeg(G, gamma) {               // q(a) ∝ exp(-gamma * G(a))
    const m = Math.min.apply(null, G);
    const e = G.map(g => Math.exp(-gamma * (g - m)));
    return normalize(e);
  }
  function argmax(v) { let bi = 0; for (let i = 1; i < v.length; i++) if (v[i] > v[bi]) bi = i; return bi; }
  function clamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }

  // ---- generative model (shared beliefs held by every agent) ----------------
  // Hidden state factor inferred by the agent: MARKET REGIME m in {Bull,Neutral,Bear}
  // Controlled factor: POSITION p in {Defensive, Flat, Levered} (known, agent-set)
  //
  // Likelihood A0: price observation {Up,Flat,Down} given regime
  // A0[obs][regime]
  const A0 = [
    // Bull  Neutral Bear
    [0.70, 0.20, 0.08], // Up
    [0.22, 0.60, 0.22], // Flat
    [0.08, 0.20, 0.70]  // Down
  ];
  // Likelihood A1: wealth observation {Gain,Even,Loss} given regime AND position
  // A1[position][obs][regime]
  const A1 = [
    // Defensive: muted exposure, mostly Even, protected in Bear
    [ [0.22, 0.14, 0.10],   // Gain
      [0.66, 0.76, 0.72],   // Even
      [0.12, 0.10, 0.18] ], // Loss
    // Flat: fully invested, unlevered
    [ [0.62, 0.28, 0.10],   // Gain
      [0.28, 0.52, 0.30],   // Even
      [0.10, 0.20, 0.60] ], // Loss
    // Levered: amplified — big gains in Bull, big losses in Bear
    [ [0.82, 0.34, 0.05],   // Gain
      [0.13, 0.42, 0.10],   // Even
      [0.05, 0.24, 0.85] ]  // Loss
  ];
  // Transition for regime (uncontrolled) — persistence with mean reversion
  // B0[next][cur]
  const B0 = [
    // fromBull fromNeutral fromBear
    // Optimism is sticky (Bull->Bull 0.93) but pessimism clears (Bear->Bear 0.72):
    // this asymmetry lets the market recover to fundamental between crashes AND
    // is itself a driver of bubbles (the crowd's default drift is hopeful).
    [0.93, 0.24, 0.05], // ->Bull
    [0.06, 0.60, 0.23], // ->Neutral
    [0.01, 0.16, 0.72]  // ->Bear
  ];
  // precompute likelihood entropies (ambiguity term) H[A(:,state)]
  const H_A0 = [0, 1, 2].map(m => entropy([A0[0][m], A0[1][m], A0[2][m]]));
  const H_A1 = [0, 1, 2].map(p => [0, 1, 2].map(m => entropy([A1[p][0][m], A1[p][1][m], A1[p][2][m]])));

  function matVec(B, x) {                        // 3x3 * 3
    const y = [0, 0, 0];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) y[i] += B[i][j] * x[j];
    return y;
  }
  function predObs(A, mpred) {                   // A[obs][regime] · mpred
    const o = [0, 0, 0];
    for (let k = 0; k < 3; k++) for (let m = 0; m < 3; m++) o[k] += A[k][m] * mpred[m];
    return normalize(o);
  }

  // ---- agent construction ---------------------------------------------------
  function makeAgent(id, P, cfg, rnd) {
    const s0 = 0.2 + 0.6 * rnd();                  // idiosyncratic initial sentiment
    return {
      id,
      cash: cfg.initEquity,
      q: 0,                                       // asset units held
      debt: 0,
      belief: [0.34, 0.33, 0.33],                 // posterior over regime
      position: 1,                                // start Flat
      scar: s0,                                    // sentiment EMA of recent losses (0 confident .. 1 fearful)
      gammaLoss: cfg.gammaFloor + (cfg.gammaCeil - cfg.gammaFloor) * s0, // aversion to Loss/debt
      prevEquity: cfg.initEquity,
      lastWealthObs: 1,                            // Even
      financing: 0,                                // 0 hedge,1 speculative,2 ponzi
      calm: 0,
      alive: true,
      // heterogeneous temperament (keeps the population from moving in lockstep)
      decayMul: 0.6 + 0.8 * rnd(),                 // confidence-recovery speed multiplier
      shockMul: 0.6 + 0.8 * rnd(),                 // fear-spike speed multiplier
      precMul: 0.7 + 0.6 * rnd(),                  // policy-precision multiplier
      percNoise: 0.006 * (2 * rnd() - 1)           // idiosyncratic bias in perceived return
    };
  }

  // preference vector over wealth obs {Gain,Even,Loss} in log space.
  // Gain preferred (+greed), Loss dispreferred (-gammaLoss). This is the C the
  // paper calls the (socially constructed) preference; gammaLoss adapts in time.
  function prefC(agent, cfg) {
    return [cfg.greed, 0, -agent.gammaLoss];
  }

  // Belief in asset APPRECIATION, read straight off the inferred regime posterior:
  // Bull -> +1, Bear -> -1, mapped to [0,1]. This is the socially-constructed
  // expectation that Minsky's Ponzi units bet on ("continuation of positive trends").
  function apprecBelief(ag) {
    return clamp((ag.belief[0] - ag.belief[2] + 1) / 2, 0, 1);
  }
  // The (diminishing) PREFERENCE AGAINST DEBT is driven primarily by the belief in
  // appreciation: confidence in continued gains erodes caution -> agents lever up.
  // An optional emotional-memory channel (scar) can add path-dependent fear.
  function updateCaution(ag, cfg) {
    const pApp = apprecBelief(ag);
    const wB = 1.0, wE = cfg.emotion;
    const caution = clamp((wB * (1 - pApp) + wE * ag.scar) / (wB + wE), 0, 1);
    ag.pApp = pApp;
    ag.caution = caution;
    ag.gammaLoss = cfg.gammaFloor + (cfg.gammaCeil - cfg.gammaFloor) * caution;
  }

  // ---- one Active Inference decision for a single agent ---------------------
  function decide(agent, cfg) {
    // predicted regime for next step
    const mpred = matVec(B0, agent.belief);
    const C1 = prefC(agent, cfg);
    const G = [0, 0, 0];
    // explicit preference against the indebted (leveraged) STATE — the paper's
    // "preference against debt". A prior over the controllable position, scaled by
    // the agent's adaptive debt-aversion, so caution genuinely gates leverage.
    const debtCost = [0, 0, 1];                    // defensive, flat, levered
    for (let a = 0; a < 3; a++) {                 // candidate target positions
      const o1 = predObs(A1[a], mpred);
      // risk = KL(predicted wealth obs || preferred)  == Σ o (ln o - C)
      let risk = 0;
      for (let k = 0; k < 3; k++) risk += o1[k] * (Math.log(o1[k] + 1e-12) - C1[k]);
      // ambiguity = expected likelihood entropy under predicted states
      let amb = 0;
      for (let m = 0; m < 3; m++) amb += mpred[m] * (H_A1[a][m]);
      G[a] = risk + cfg.ambiguityWeight * amb + cfg.debtAversion * agent.gammaLoss * debtCost[a];
    }
    const qa = softmaxNeg(G, cfg.precision * (agent.precMul || 1));
    // sample (or argmax at high precision) — sampling keeps population diverse
    let a = argmax(qa);
    if (cfg.stochasticChoice) {
      let r = agent._rnd(), c = 0;
      for (let i = 0; i < 3; i++) { c += qa[i]; if (r <= c) { a = i; break; } }
    }
    agent.position = a;
    return a;
  }

  // ---- Bayesian state inference given realized observations -----------------
  function infer(agent, priceObs, wealthObs) {
    const prior = matVec(B0, agent.belief);        // temporal prior
    const post = [0, 0, 0];
    for (let m = 0; m < 3; m++) {
      post[m] = prior[m] * A0[priceObs][m] * A1[agent.position][wealthObs][m];
    }
    agent.belief = normalize(post);
  }

  // ==========================================================================
  //  WORLD / MARKET
  // ==========================================================================
  function createModel(cfg) {
    cfg = Object.assign({
      nAgents: 120,
      seed: 12345,
      initPrice: 100,
      initEquity: 1000,
      interest: 0.010,          // per step, on debt
      dividendCash: 0.6,        // FIXED cash per unit per step (income). Fundamental F = dividendCash/discount
      discount: 0.006,          // required yield -> fundamental value anchor
      maxLeverage: 1.4,         // levered target = (1+maxLeverage)*equity in assets
      defensiveMult: 0.40,      // defensive target asset value = mult * equity
      priceImpact: 0.045,       // kappa: liquidity / demand sensitivity
      meanRev: 0.03,            // fundamentalist pull when the asset is CHEAP (ends busts)
      revAsym: 0.25,            // pull-above-fundamental = meanRev*revAsym (short-sale limits let bubbles run)
      adjustSpeed: 0.28,        // fraction of desired position change executed per step (trading friction)
      noise: 0.006,             // price return noise sd
      decay: 0.030,             // confidence recovery: how fast caution erodes in calm (the Minsky knob)
      shock: 0.35,              // fear-spike rate: how fast caution rises after a Loss
      gammaFloor: 0.4,
      gammaCeil: 6.0,
      greed: 1.5,               // preference weight on Gain
      precision: 6.0,           // policy precision (rationality)
      ambiguityWeight: 1.0,
      stochasticChoice: true,
      debtAversion: 0.19,       // weight of the (belief-modulated) preference against the indebted state
      emotion: 0.35,            // 0..1 weight of the OPTIONAL emotional-memory channel (0 = pure belief-driven)
      social: 0.08,             // 0..1 contagion of the appreciation BELIEF toward the crowd (social construction)
      amortize: 0.04,           // principal fraction used for Minsky classification
      gainThresh: 0.015,        // equity-return thresholds for Gain/Loss obs
      lossThresh: -0.018
    }, cfg || {});

    cfg.fundamental = cfg.dividendCash / cfg.discount;   // anchor value F
    const rnd = mulberry32(cfg.seed);
    const agents = [];
    for (let i = 0; i < cfg.nAgents; i++) {
      const ag = makeAgent(i, cfg.initPrice, cfg, rnd);
      ag._rnd = mulberry32((cfg.seed ^ (i * 2654435761)) >>> 0);
      agents.push(ag);
    }

    return {
      cfg, agents, rnd,
      t: 0,
      price: cfg.initPrice,
      priceObs: 1,
      ret: 0,
      history: [],       // per-step metrics
      volWindow: []
    };
  }

  // realized wealth observation from equity return
  function wealthObsFromReturn(r, cfg) {
    if (r > cfg.gainThresh) return 0;             // Gain
    if (r < cfg.lossThresh) return 2;             // Loss
    return 1;                                     // Even
  }

  // Minsky financing posture of an agent
  function classifyFinancing(ag, price, cfg) {
    if (ag.debt <= 1e-6) return 0;                // no debt -> hedge
    const interestDue = cfg.interest * ag.debt;
    const principalDue = cfg.amortize * ag.debt;
    const income = cfg.dividendCash * ag.q;
    if (income < interestDue) return 2;           // Ponzi: can't cover interest
    if (income < interestDue + principalDue) return 1; // Speculative
    return 0;                                      // Hedge
  }

  function step(model) {
    const cfg = model.cfg, agents = model.agents, P = model.price;

    // ---- 1. each agent decides target position via Active Inference ----------
    let excessDemand = 0;
    const targetVal = [];
    for (const ag of agents) {
      if (!ag.alive) { targetVal.push(0); continue; }
      const a = decide(ag, cfg);
      const equity = ag.cash + ag.q * P - ag.debt;
      const eq = Math.max(equity, 1e-6);
      let mult;
      if (a === 0) mult = cfg.defensiveMult;
      else if (a === 1) mult = 1.0;
      else mult = 1.0 + cfg.maxLeverage;
      const V = mult * eq;                         // desired asset value
      targetVal.push(V);
      const desiredQ = V / P;
      excessDemand += cfg.adjustSpeed * (desiredQ - ag.q); // only part of the gap trades now
    }

    // ---- 2. price formation from net demand (bounded market-maker) ----------
    const pressure = Math.tanh(excessDemand / Math.max(agents.length, 1));
    const noise = (model.rnd() * 2 - 1) * cfg.noise;
    const gap = Math.log(cfg.fundamental / P);                    // >0 when price is below fundamental
    const revert = (gap > 0 ? cfg.meanRev : cfg.meanRev * cfg.revAsym) * gap; // asymmetric arbitrage
    let ret = cfg.priceImpact * pressure + revert + noise;
    ret = clamp(ret, -0.35, 0.35);
    const newP = Math.max(P * (1 + ret), 1e-3);
    model.ret = ret;
    model.price = newP;

    // price observation for agents
    const priceObs = ret > 0.006 ? 0 : ret < -0.006 ? 2 : 1;
    model.priceObs = priceObs;

    // ---- 3. execute trades, accrue income/interest, mark to market ----------
    let bankruptcies = 0, totalDebt = 0, totalAssetVal = 0, totalEquity = 0;
    const finCount = [0, 0, 0];
    let sumGamma = 0, aliveN = 0;
    const beliefMean = [0, 0, 0];

    for (let i = 0; i < agents.length; i++) {
      const ag = agents[i];
      if (!ag.alive) continue;
      // fill order at new price — partial adjustment (positions can't be unwound instantly)
      const desiredQ = targetVal[i] / newP;
      const dq = cfg.adjustSpeed * (desiredQ - ag.q);
      const cost = dq * newP;                      // >0 buy (spend/borrow), <0 sell
      ag.q = desiredQ;
      ag.cash -= cost;
      if (ag.cash < 0) { ag.debt += -ag.cash; ag.cash = 0; }  // finance purchase w/ debt

      // income (fixed cash dividends) and interest on debt
      ag.cash += cfg.dividendCash * ag.q;
      const interest = cfg.interest * ag.debt;
      ag.cash -= interest;
      if (ag.cash < 0) { ag.debt += -ag.cash; ag.cash = 0; } // capitalize unpaid interest
      // opportunistically repay debt with spare cash
      if (ag.cash > 0 && ag.debt > 0) {
        const pay = Math.min(ag.cash, ag.debt);
        ag.cash -= pay; ag.debt -= pay;
      }

      // mark to market
      const equity = ag.cash + ag.q * newP - ag.debt;
      const r = (equity - ag.prevEquity) / Math.max(Math.abs(ag.prevEquity), 1e-6) + ag.percNoise;
      const wObs = wealthObsFromReturn(r, cfg);
      ag.lastWealthObs = wObs;

      // ---- 4. Active Inference state update -------------------------------
      infer(ag, priceObs, wObs);

      // ---- 5. adapt the preference against debt (Minsky mechanism) --------
      // (a) OPTIONAL emotional memory: asymmetric EMA of loss experience — fear
      //     spikes fast after a Loss, confidence rebuilds slowly through calm.
      if (wObs === 2) { ag.scar += cfg.shock * ag.shockMul * (1 - ag.scar); ag.calm = 0; }
      else { ag.scar += -cfg.decay * ag.decayMul * ag.scar; ag.calm += 1; }
      ag.scar = clamp(ag.scar, 0, 1);
      // (b) PRIMARY driver: the belief in appreciation sets the preference against debt.
      updateCaution(ag, cfg);

      // bankruptcy / insolvency
      if (equity < 0) {
        bankruptcies++;
        // liquidate and respawn as a fresh, cautious entrant
        ag.q = 0; ag.debt = 0; ag.cash = cfg.initEquity;
        ag.scar = 1; ag.gammaLoss = cfg.gammaCeil; // scarred: maximal aversion
        ag.belief = [0.2, 0.3, 0.5];               // pessimistic
        ag.position = 0;
        ag.prevEquity = cfg.initEquity;
        ag.financing = 0;
        continue;
      }
      ag.prevEquity = equity;
      ag.financing = classifyFinancing(ag, newP, cfg);

      finCount[ag.financing]++;
      totalDebt += ag.debt;
      totalAssetVal += ag.q * newP;
      totalEquity += equity;
      sumGamma += ag.gammaLoss;
      beliefMean[0] += ag.belief[0]; beliefMean[1] += ag.belief[1]; beliefMean[2] += ag.belief[2];
      aliveN++;
    }

    // ---- 6. SOCIAL CONSTRUCTION of preferences: contagion of the appreciation
    //         belief. Each agent's regime posterior is nudged toward the crowd's,
    //         so optimism (and pessimism) spread — preferences are built socially.
    const n = Math.max(aliveN, 1);
    for (let k = 0; k < 3; k++) beliefMean[k] /= n;
    if (cfg.social > 0 && aliveN > 0) {
      for (const ag of agents) if (ag.alive) {
        ag.belief = normalize([
          ag.belief[0] + cfg.social * (beliefMean[0] - ag.belief[0]),
          ag.belief[1] + cfg.social * (beliefMean[1] - ag.belief[1]),
          ag.belief[2] + cfg.social * (beliefMean[2] - ag.belief[2])
        ]);
        updateCaution(ag, cfg);
      }
    }

    // rolling realized volatility
    model.volWindow.push(ret);
    if (model.volWindow.length > 25) model.volWindow.shift();
    const mu = model.volWindow.reduce((a, b) => a + b, 0) / model.volWindow.length;
    const vol = Math.sqrt(model.volWindow.reduce((a, b) => a + (b - mu) * (b - mu), 0) / model.volWindow.length);

    const leverage = totalEquity > 0 ? totalDebt / Math.max(totalEquity, 1e-6) : totalDebt;
    const fragility = (finCount[1] * 0.5 + finCount[2]) / n;   // 0..1 Ponzi-weighted

    const rec = {
      t: model.t,
      price: newP,
      ret,
      leverage,
      totalDebt,
      totalEquity,
      hedge: finCount[0] / n,
      speculative: finCount[1] / n,
      ponzi: finCount[2] / n,
      bankruptcies,
      meanGamma: sumGamma / n,
      apprec: beliefMean[0] - beliefMean[2],        // mean belief in appreciation (-1..1)
      vol,
      fragility,
      belief: beliefMean.slice()
    };
    model.history.push(rec);
    if (model.history.length > 4000) model.history.shift();
    model.t++;
    return rec;
  }

  const API = { createModel, step, A0, A1, B0 };
  root.MinskyModel = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);

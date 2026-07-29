/* ============================================================================
   Active Inference reconstruction of Minskyian macroeconomics — MULTI-ASSET
   Extends the single-asset model (Guénin-Carlut & Benazouz 2024) to K assets
   ("domains"). Each agent infers a separate market regime per asset, and uses an
   Active-Inference policy over capital DESTINATIONS {cash, asset_1..K} to
   allocate its (possibly levered) capital. Because capital chases the
   best-believed domain, bubbles rotate between domains and one watches excess
   capital DISPLACE from a souring domain into a rising one.
   ============================================================================ */
(function (root) {
  'use strict';

  function mulberry32(a){return function(){a|=0;a=(a+0x6D2B79F5)|0;let t=Math.imul(a^(a>>>15),1|a);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296;};}
  function normalize(v){let s=0;for(let i=0;i<v.length;i++)s+=v[i];if(s<=0)return v.map(()=>1/v.length);return v.map(x=>x/s);}
  function entropy(c){let h=0;for(let i=0;i<c.length;i++){const p=c[i];if(p>1e-12)h-=p*Math.log(p);}return h;}
  function clamp(x,lo,hi){return x<lo?lo:x>hi?hi:x;}
  function softmax(x,beta){const m=Math.max.apply(null,x);const e=x.map(v=>Math.exp(beta*(v-m)));return normalize(e);}

  // ---- shared generative model (same primitives as the single-asset engine) --
  const A0=[[0.70,0.20,0.08],[0.22,0.60,0.22],[0.08,0.20,0.70]];           // price obs | regime
  const A1=[ // wealth obs | (position, regime)  position: 0 defensive,1 flat,2 levered
    [[0.22,0.14,0.10],[0.66,0.76,0.72],[0.12,0.10,0.18]],
    [[0.62,0.28,0.10],[0.28,0.52,0.30],[0.10,0.20,0.60]],
    [[0.82,0.34,0.05],[0.13,0.42,0.10],[0.05,0.24,0.85]]
  ];
  const B0=[[0.93,0.24,0.05],[0.06,0.60,0.23],[0.01,0.16,0.72]];           // sticky-up, leaky-down
  const H_A1=[0,1,2].map(p=>[0,1,2].map(m=>entropy([A1[p][0][m],A1[p][1][m],A1[p][2][m]])));

  function matVec(B,x){const y=[0,0,0];for(let i=0;i<3;i++)for(let j=0;j<3;j++)y[i]+=B[i][j]*x[j];return y;}
  function predObs(A,mp){const o=[0,0,0];for(let k=0;k<3;k++)for(let m=0;m<3;m++)o[k]+=A[k][m]*mp[m];return normalize(o);}

  function makeAgent(id,K,cfg,rnd){
    const s0=0.2+0.6*rnd();
    const belief=[]; for(let k=0;k<K;k++) belief.push([0.34,0.33,0.33]);
    return {
      id, cash:cfg.initEquity, debt:0,
      q:new Array(K).fill(0),                 // holdings per asset
      belief,                                 // per-asset regime posterior
      scar:s0,                                // global emotional memory
      gammaLoss:cfg.gammaFloor+(cfg.gammaCeil-cfg.gammaFloor)*s0,
      prevEquity:cfg.initEquity, alive:true,
      decayMul:0.6+0.8*rnd(), shockMul:0.6+0.8*rnd(), precMul:0.7+0.6*rnd(),
      percNoise:0.006*(2*rnd()-1)
    };
  }

  // Per-asset appeal of INVESTING (expected valence under the agent's belief).
  // appeal high -> attractive; negative -> repulsive. Uses the levered likelihood
  // as the "opportunity" assessment, penalised by the agent's loss aversion.
  function assetAppeal(ag,k,cfg){
    const mp=matVec(B0,ag.belief[k]);
    const o=predObs(A1[2],mp);                        // wealth obs if invested/levered
    return cfg.greed*o[0]-ag.gammaLoss*o[2];          // greed·P(Gain) − γ·P(Loss)
  }
  function apprecOf(belief){return clamp((belief[0]-belief[2]+1)/2,0,1);}

  function createModel(cfg){
    cfg=Object.assign({
      nAgents:120, nAssets:3, seed:5,
      initEquity:1000, initPrice:100,
      interest:0.010, dividendCash:0.6, discount:0.006,
      maxLeverage:2.0, defensiveMult:0.40,
      priceImpact:0.060, meanRev:0.030, revAsym:0.25, bubbleDrag:0.015, adjustSpeed:0.28, noise:0.006,
      precision:6.0, allocPrecision:2.4, greed:1.5, debtAversion:0.19, ambiguityWeight:1.0,
      gammaFloor:0.4, gammaCeil:6.0,
      emotion:0.35, decay:0.030, shock:0.35, social:0.08,
      amortize:0.04, gainThresh:0.015, lossThresh:-0.018,
      cashBias:0.0                          // baseline appeal of holding cash
    },cfg||{});
    cfg.fundamental=cfg.dividendCash/cfg.discount;
    const K=cfg.nAssets;
    const rnd=mulberry32(cfg.seed);
    const agents=[];
    for(let i=0;i<cfg.nAgents;i++){const a=makeAgent(i,K,cfg,rnd);a._rnd=mulberry32((cfg.seed^(i*2654435761))>>>0);agents.push(a);}
    const prices=new Array(K).fill(cfg.initPrice);
    const volWin=[]; for(let k=0;k<K;k++) volWin.push([]);
    return {cfg,agents,rnd,K,t:0,prices,history:[]};
  }

  function wObs(r,cfg){return r>cfg.gainThresh?0:r<cfg.lossThresh?2:1;}

  function step(model){
    const cfg=model.cfg, agents=model.agents, K=model.K;
    const P=model.prices.slice();

    // ---- 1. each agent: AIF allocation across {cash, assets} + leverage --------
    const excess=new Array(K).fill(0);
    const targetQ=[];                       // desired holdings per agent per asset
    for(const ag of agents){
      if(!ag.alive){targetQ.push(new Array(K).fill(0));continue;}
      const appeal=new Array(K);
      for(let k=0;k<K;k++) appeal[k]=assetAppeal(ag,k,cfg);
      // destination policy: softmax over [cash, asset_1..K]
      const scores=[cfg.cashBias].concat(appeal);
      const w=softmax(scores, cfg.allocPrecision*(ag.precMul||1));
      const wCash=w[0];
      const riskyShare=1-wCash;
      // overall exposure: defensive..levered by risk-on share, leverage discounted by caution
      let m=cfg.defensiveMult+(1+cfg.maxLeverage-cfg.defensiveMult)*riskyShare;
      if(m>1) m=1+(m-1)/(1+cfg.debtAversion*ag.gammaLoss);
      const equity=Math.max(ag.cash+dot(ag.q,P)-ag.debt,1e-6);
      const V=m*equity;                      // total desired risky value
      // split across assets by their softmax mass (renormalised among assets)
      let wsum=0; for(let k=0;k<K;k++) wsum+=w[k+1];
      const tq=new Array(K).fill(0);
      for(let k=0;k<K;k++){
        const alloc=wsum>1e-9?w[k+1]/wsum:1/K;
        const desiredQ=(V*alloc)/P[k];
        tq[k]=desiredQ;
        excess[k]+=cfg.adjustSpeed*(desiredQ-ag.q[k]);
      }
      targetQ.push(tq);
    }

    // ---- 2. per-asset price formation -----------------------------------------
    const newP=new Array(K);
    for(let k=0;k<K;k++){
      // each domain holds ~1/K of total capital, so it is a shallower market:
      // price impact per domain scales with the number of domains.
      const pressure=Math.tanh(excess[k]*K/Math.max(agents.length,1));
      const noise=(model.rnd()*2-1)*cfg.noise;
      const gap=Math.log(cfg.fundamental/P[k]);
      const revert=(gap>0?cfg.meanRev:cfg.meanRev*cfg.revAsym)*gap;
      // convex "bubble ceiling": negligible near F, firm far above it -> bubbles
      // form freely but are bounded at a few × fundamental instead of exploding.
      const over=Math.max(0,P[k]/cfg.fundamental-1);
      const drag=-cfg.bubbleDrag*over*over/(1+over);
      let ret=clamp(cfg.priceImpact*pressure+revert+drag+noise,-0.35,0.35);
      newP[k]=Math.max(P[k]*(1+ret),1e-3);
    }
    model.prices=newP;
    const priceObs=new Array(K);
    for(let k=0;k<K;k++){const ret=newP[k]/P[k]-1;priceObs[k]=ret>0.006?0:ret<-0.006?2:1;}

    // ---- 3. execute, income/interest, mark to market, infer, adapt ------------
    let bankruptcies=0,totalDebt=0,totalEquity=0,sumGamma=0,aliveN=0,totalCash=0;
    const finCount=[0,0,0];
    const capital=new Array(K).fill(0);              // Σ value held in each domain
    const apprecMean=new Array(K).fill(0);
    for(let i=0;i<agents.length;i++){
      const ag=agents[i]; if(!ag.alive) continue;
      // partial-adjustment fills at new price
      for(let k=0;k<K;k++){
        const desiredQ=targetQ[i][k];
        const dq=cfg.adjustSpeed*(desiredQ-ag.q[k]);
        const cost=dq*newP[k];
        ag.q[k]+=dq; ag.cash-=cost;
        if(ag.cash<0){ag.debt+=-ag.cash;ag.cash=0;}
      }
      // income across all holdings, then interest
      let income=0; for(let k=0;k<K;k++) income+=cfg.dividendCash*ag.q[k];
      ag.cash+=income;
      const interest=cfg.interest*ag.debt; ag.cash-=interest;
      if(ag.cash<0){ag.debt+=-ag.cash;ag.cash=0;}
      if(ag.cash>0&&ag.debt>0){const pay=Math.min(ag.cash,ag.debt);ag.cash-=pay;ag.debt-=pay;}

      const equity=ag.cash+dot(ag.q,newP)-ag.debt;
      const r=(equity-ag.prevEquity)/Math.max(Math.abs(ag.prevEquity),1e-6)+ag.percNoise;
      const gwObs=wObs(r,cfg);

      // ---- per-asset regime inference (price obs + shared wealth obs) ---------
      for(let k=0;k<K;k++){
        const prior=matVec(B0,ag.belief[k]);
        const post=[0,0,0];
        for(let m=0;m<3;m++) post[m]=prior[m]*A0[priceObs[k]][m]*A1[1][gwObs][m];
        ag.belief[k]=normalize(post);
      }
      // ---- global emotional memory -> caution -> gammaLoss --------------------
      if(gwObs===2){ag.scar+=cfg.shock*ag.shockMul*(1-ag.scar);}
      else{ag.scar+=-cfg.decay*ag.decayMul*ag.scar;}
      ag.scar=clamp(ag.scar,0,1);
      // best-opportunity optimism across domains drives the debt preference
      let bestApp=0; for(let k=0;k<K;k++) bestApp=Math.max(bestApp,apprecOf(ag.belief[k]));
      const caution=clamp(((1-bestApp)+cfg.emotion*ag.scar)/(1+cfg.emotion),0,1);
      ag.gammaLoss=cfg.gammaFloor+(cfg.gammaCeil-cfg.gammaFloor)*caution;

      // ---- insolvency --------------------------------------------------------
      if(equity<0){
        bankruptcies++;
        ag.q=new Array(K).fill(0); ag.debt=0; ag.cash=cfg.initEquity;
        ag.scar=1; ag.gammaLoss=cfg.gammaCeil;
        for(let k=0;k<K;k++) ag.belief[k]=[0.2,0.3,0.5];
        ag.prevEquity=cfg.initEquity;
        continue;
      }
      ag.prevEquity=equity;
      // Minsky financing (aggregate)
      const interestDue=cfg.interest*ag.debt, principalDue=cfg.amortize*ag.debt;
      let fin=0;
      if(ag.debt>1e-6){ if(income<interestDue) fin=2; else if(income<interestDue+principalDue) fin=1; else fin=0; }
      finCount[fin]++;
      totalDebt+=ag.debt; totalEquity+=equity; totalCash+=ag.cash; sumGamma+=ag.gammaLoss; aliveN++;
      for(let k=0;k<K;k++){capital[k]+=ag.q[k]*newP[k]; apprecMean[k]+=apprecOf(ag.belief[k]);}
    }

    // ---- 4. social contagion of per-asset beliefs -----------------------------
    const n=Math.max(aliveN,1);
    for(let k=0;k<K;k++) apprecMean[k]/=n;
    if(cfg.social>0&&aliveN>0){
      const meanB=[]; for(let k=0;k<K;k++) meanB.push([0,0,0]);
      for(const ag of agents) if(ag.alive) for(let k=0;k<K;k++){meanB[k][0]+=ag.belief[k][0];meanB[k][1]+=ag.belief[k][1];meanB[k][2]+=ag.belief[k][2];}
      for(let k=0;k<K;k++){meanB[k][0]/=n;meanB[k][1]/=n;meanB[k][2]/=n;}
      for(const ag of agents) if(ag.alive) for(let k=0;k<K;k++){
        ag.belief[k]=normalize([
          ag.belief[k][0]+cfg.social*(meanB[k][0]-ag.belief[k][0]),
          ag.belief[k][1]+cfg.social*(meanB[k][1]-ag.belief[k][1]),
          ag.belief[k][2]+cfg.social*(meanB[k][2]-ag.belief[k][2])
        ]);
      }
    }

    const leverage=totalEquity>0?totalDebt/Math.max(totalEquity,1e-6):totalDebt;
    const rec={
      t:model.t, prices:newP.slice(), apprec:apprecMean.slice(),
      capital:capital.slice(), cash:totalCash,
      leverage, totalDebt, totalEquity,
      hedge:finCount[0]/n, speculative:finCount[1]/n, ponzi:finCount[2]/n,
      bankruptcies, meanGamma:sumGamma/n,
      ponziShare:finCount[2]/n
    };
    model.history.push(rec);
    if(model.history.length>4000) model.history.shift();
    model.t++;
    return rec;
  }
  function dot(a,b){let s=0;for(let i=0;i<a.length;i++)s+=a[i]*b[i];return s;}

  const API={createModel,step};
  root.MinskyMulti=API;
  if(typeof module!=='undefined'&&module.exports) module.exports=API;
})(typeof window!=='undefined'?window:globalThis);

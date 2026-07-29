(function(){
"use strict";
const M = window.MinskyMulti;
const gv = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const DOMCOL = ()=>['--d0','--d1','--d2','--d3','--d4'].map(gv);

/* ---------------- control schema ---------------- */
const GROUPS=[
 {name:'Market', color:gv('--gold'), open:true, params:[
   {key:'nAssets', label:'Number of domains', min:2, max:5, step:1, rebuild:true, fmt:v=>v|0,
    hint:'How many separate markets capital can flow between.'},
   {key:'nAgents', label:'Number of agents', min:20, max:320, step:10, rebuild:true, fmt:v=>v|0,
    hint:'Population of Active-Inference traders.'},
   {key:'interest', label:'Interest rate', min:0, max:0.05, step:0.001, fmt:v=>(v*100).toFixed(1)+'%',
    hint:'Per-step cost of debt. Higher rates make leverage fragile sooner.'},
   {key:'maxLeverage', label:'Max leverage', min:0.2, max:4, step:0.1, fmt:v=>v.toFixed(1)+'×',
    hint:'Extra exposure a fully-levered agent takes, as a multiple of equity.'},
   {key:'priceImpact', label:'Price impact', min:0.02, max:0.12, step:0.005, fmt:v=>v.toFixed(3),
    hint:'How strongly net demand moves a domain’s price.'},
   {key:'meanRev', label:'Bargain-hunting (cheap)', min:0, max:0.06, step:0.002, fmt:v=>v.toFixed(3),
    hint:'Arbitrage pull that lifts an under-valued domain (ends busts).'},
 ]},
 {name:'Agent cognition', color:gv('--sage'), open:true, params:[
   {key:'allocPrecision', label:'Focus of capital', min:1, max:6, step:0.2, fmt:v=>v.toFixed(1),
    hint:'Softmax precision of the capital-allocation policy: how hard agents concentrate on the best-believed domain.'},
   {key:'greed', label:'Appetite for gains', min:0, max:3, step:0.1, fmt:v=>v.toFixed(1),
    hint:'Preference weight on the Gain outcome.'},
   {key:'debtAversion', label:'Preference against debt', min:0, max:1.2, step:0.02, fmt:v=>v.toFixed(2),
    hint:'How much confidence is needed before agents will borrow.'},
 ]},
 {name:'Minsky mechanism', color:gv('--ponzi'), open:true, params:[
   {key:'emotion', label:'Weight of loss-memory', min:0, max:0.7, step:0.05, fmt:v=>v.toFixed(2),
    hint:'How much a lingering memory of past losses (vs. current belief) shapes each agent’s caution.'},
   {key:'decay', label:'Confidence recovery in calm', min:0, max:0.08, step:0.002, fmt:v=>v.toFixed(3),
    hint:'How fast caution erodes when losses stop (“stability breeds instability”).'},
   {key:'shock', label:'Fear spike after a loss', min:0, max:0.8, step:0.02, fmt:v=>v.toFixed(2),
    hint:'How sharply caution jumps when an agent takes a loss.'},
 ]},
 {name:'Social construction', color:gv('--blue'), open:true, params:[
   {key:'social', label:'Belief contagion', min:0, max:0.5, step:0.02, fmt:v=>v.toFixed(2),
    hint:'How strongly each agent’s beliefs are pulled toward the crowd.'},
 ]},
];
const PRESETS={
 'Baseline':{},
 'Euphoria':{debtAversion:0.10, greed:1.9},
 'Cautious crowd':{debtAversion:0.55},
 'Herd mentality':{social:0.30},
 'Two domains':{nAssets:2},
 'Five domains':{nAssets:5},
 'Lone wolves':{social:0.0},
 'Cheap money':{interest:0.002, maxLeverage:3.0},
};

/* ---------------- state ---------------- */
let cfg={}, sim=null, running=false, speedDial=4, frameAcc=0;
// actual model steps per animation frame = speedDial / 4, so the "4×" default runs
// at one step per frame; a fractional accumulator handles rates below 1 step/frame.
const WINDOW=460;
const DEFAULTS=Object.assign({}, M.createModel({}).cfg);

function rebuild(){
 const merged=Object.assign({}, DEFAULTS, cfg);
 merged.seed=parseInt(document.getElementById('seed').value,10)||5;
 sim=M.createModel(merged);
 cfg=Object.assign({}, sim.cfg);
 for(let i=0;i<3;i++) M.step(sim);
 buildLegends(); buildDomrow();
 render();
}

/* ---------------- controls ---------------- */
function buildControls(){
 const host=document.getElementById('controls'); host.innerHTML='';
 GROUPS.forEach(g=>{
  const gd=document.createElement('div'); gd.className='grp';
  const gh=document.createElement('div'); gh.className='gh';
  gh.innerHTML=`<span class="gi" style="background:${g.color}"></span>${g.name}<span class="cv">▾</span>`;
  gh.onclick=()=>gd.classList.toggle('col'); gd.appendChild(gh);
  const gb=document.createElement('div'); gb.className='gb';
  g.params.forEach(p=>{
   const c=document.createElement('div'); c.className='ct';
   const cur=(cfg[p.key]!==undefined?cfg[p.key]:DEFAULTS[p.key]);
   c.innerHTML=`<div class="r"><label>${p.label} <span class="inf" title="${p.hint.replace(/"/g,'&quot;')}">?</span></label><span class="v" id="v_${p.key}">${p.fmt(cur)}</span></div>`+
     `<input type="range" id="i_${p.key}" min="${p.min}" max="${p.max}" step="${p.step}" value="${cur}"><div class="h">${p.hint}</div>`;
   gb.appendChild(c);
   setTimeout(()=>{ const inp=document.getElementById('i_'+p.key); pct(inp,p);
     inp.addEventListener('input',()=>{ const val=parseFloat(inp.value);
       document.getElementById('v_'+p.key).textContent=p.fmt(val); pct(inp,p);
       if(p.rebuild){cfg[p.key]=val;rebuild();} else {cfg[p.key]=val; if(sim)sim.cfg[p.key]=val;} });
   },0);
  });
  gd.appendChild(gb); host.appendChild(gd);
 });
 // on small screens the charts come first; keep the control groups collapsed so the
 // panel is a compact, tappable list rather than a long wall of sliders.
 if(window.matchMedia && window.matchMedia('(max-width:900px)').matches)
   document.querySelectorAll('#controls .grp').forEach(g=>g.classList.add('col'));
}
function pct(inp,p){ inp.style.setProperty('--pct',((inp.value-p.min)/(p.max-p.min)*100)+'%'); }
function syncControls(){ GROUPS.forEach(g=>g.params.forEach(p=>{ const inp=document.getElementById('i_'+p.key); if(!inp)return;
  const cur=(cfg[p.key]!==undefined?cfg[p.key]:DEFAULTS[p.key]); inp.value=cur; pct(inp,p);
  document.getElementById('v_'+p.key).textContent=p.fmt(cur); })); }
function buildPresets(){ const host=document.getElementById('presets');
 Object.keys(PRESETS).forEach(n=>{ const b=document.createElement('div'); b.className='pset'; b.textContent=n;
  b.onclick=()=>{ cfg=Object.assign({},PRESETS[n]); rebuild(); syncControls(); }; host.appendChild(b); }); }

/* ---------------- canvas helpers ---------------- */
function fit(cv){ const dpr=window.devicePixelRatio||1, w=cv.clientWidth, h=cv.height;
 if(cv.width!==Math.round(w*dpr)){cv.width=Math.round(w*dpr); cv.style.height=h+'px';}
 const ctx=cv.getContext('2d'); ctx.setTransform(dpr,0,0,dpr,0,0); return {ctx,w,h}; }
function slc(){ const h=sim.history; return h.slice(Math.max(0,h.length-WINDOW)); }
function grid(ctx,x,y,w,h,r){ ctx.strokeStyle='rgba(120,96,58,.10)'; ctx.lineWidth=1;
 for(let i=0;i<=r;i++){const yy=y+h*i/r; ctx.beginPath();ctx.moveTo(x,yy);ctx.lineTo(x+w,yy);ctx.stroke();} }
function fmtN(v){return Math.abs(v)>=1000?(v/1000).toFixed(1)+'k':v.toFixed(0);}

function buildLegends(){
 const K=sim.K, cols=DOMCOL();
 const cap=document.getElementById('legCap'), pr=document.getElementById('legPrice');
 let s='';
 for(let k=0;k<K;k++) s+=`<span><i class="sq" style="background:${cols[k%5]}"></i>Domain ${k+1}</span>`;
 pr.innerHTML=s;
 cap.innerHTML=s+`<span><i class="sq" style="background:${gv('--cash')}"></i>idle cash</span>`;
}
function buildDomrow(){ const K=sim.K, cols=DOMCOL(); const host=document.getElementById('domrow'); host.innerHTML='';
 for(let k=0;k<K;k++){ const d=document.createElement('div'); d.className='dom';
  d.innerHTML=`<div class="dl"><span style="color:${cols[k%5]}">Domain ${k+1}</span><span id="dv${k}">–</span></div><div class="dtrack"><div class="dfill" id="df${k}" style="background:${cols[k%5]}"></div></div>`;
  host.appendChild(d); }
}

/* ---- capital displacement (stacked area) ---- */
function drawCapital(){
 const cv=document.getElementById('cCapital'); const {ctx,w,h}=fit(cv); ctx.clearRect(0,0,w,h);
 const d=slc(); if(!d.length) return; const K=sim.K, cols=DOMCOL();
 const padL=34,padR=8,padT=8,padB=12, pw=w-padL-padR, ph=h-padT-padB;
 const X=i=>padL+pw*i/(d.length-1||1), Y=v=>padT+ph*(1-v);
 // stack: domains then cash on top
 const shares=d.map(r=>{ const tot=r.capital.reduce((a,b)=>a+b,0)+r.cash||1;
   return r.capital.map(c=>c/tot).concat([r.cash/tot]); });
 const layers=K+1;
 let base=new Array(d.length).fill(0);
 for(let L=0;L<layers;L++){
   ctx.fillStyle = L<K ? cols[L%5] : gv('--cash');
   ctx.globalAlpha = L<K?0.9:0.55;
   ctx.beginPath(); ctx.moveTo(X(0),Y(base[0]));
   for(let i=0;i<d.length;i++) ctx.lineTo(X(i),Y(base[i]+shares[i][L]));
   for(let i=d.length-1;i>=0;i--) ctx.lineTo(X(i),Y(base[i]));
   ctx.closePath(); ctx.fill();
   for(let i=0;i<d.length;i++) base[i]+=shares[i][L];
 }
 ctx.globalAlpha=1;
 ctx.fillStyle=gv('--faint'); ctx.font='10px Inter'; ctx.textAlign='right';
 ctx.fillText('100%',padL-5,padT+9); ctx.fillText('0',padL-5,padT+ph);
}

/* ---- domain prices ---- */
function drawPrice(){
 const cv=document.getElementById('cPrice'); const {ctx,w,h}=fit(cv); ctx.clearRect(0,0,w,h);
 const d=slc(); if(!d.length) return; const K=sim.K, cols=DOMCOL(); const F=cfg.fundamental;
 const padL=40,padR=8,padT=10,padB=14, pw=w-padL-padR, ph=h-padT-padB;
 let lo=Infinity,hi=-Infinity; d.forEach(r=>r.prices.forEach(p=>{lo=Math.min(lo,p);hi=Math.max(hi,p);}));
 lo=Math.min(lo,F); hi=Math.max(hi,F); const pd=(hi-lo)*0.1||1; lo-=pd; hi+=pd; lo=Math.max(0,lo);
 const X=i=>padL+pw*i/(d.length-1||1), Y=v=>padT+ph*(1-(v-lo)/(hi-lo||1));
 grid(ctx,padL,padT,pw,ph,4);
 ctx.strokeStyle='rgba(120,96,58,.5)'; ctx.setLineDash([4,4]); ctx.lineWidth=1;
 ctx.beginPath(); ctx.moveTo(padL,Y(F)); ctx.lineTo(padL+pw,Y(F)); ctx.stroke(); ctx.setLineDash([]);
 ctx.fillStyle='rgba(120,96,58,.7)'; ctx.font='10px Inter'; ctx.textAlign='left'; ctx.fillText('fundamental',padL+4,Y(F)-4);
 for(let k=0;k<K;k++){ ctx.strokeStyle=cols[k%5]; ctx.lineWidth=1.7; ctx.beginPath();
   d.forEach((r,i)=>{const x=X(i),y=Y(r.prices[k]); i?ctx.lineTo(x,y):ctx.moveTo(x,y);}); ctx.stroke(); }
 ctx.fillStyle=gv('--faint'); ctx.textAlign='right'; ctx.font='10px Inter';
 for(let i=0;i<=4;i++){const v=lo+(hi-lo)*(1-i/4); ctx.fillText(fmtN(v),padL-6,padT+ph*i/4+3);}
}

/* ---- belief + leverage ---- */
function drawBelief(){
 const cv=document.getElementById('cBelief'); const {ctx,w,h}=fit(cv); ctx.clearRect(0,0,w,h);
 const d=slc(); if(!d.length) return;
 const padL=34,padR=34,padT=10,padB=12, pw=w-padL-padR, ph=h-padT-padB;
 const X=i=>padL+pw*i/(d.length-1||1);
 grid(ctx,padL,padT,pw,ph,4);
 const Yb=v=>padT+ph*(1-(v+1)/2);
 ctx.strokeStyle='rgba(120,96,58,.18)'; ctx.setLineDash([3,3]); ctx.beginPath(); ctx.moveTo(padL,Yb(0)); ctx.lineTo(padL+pw,Yb(0)); ctx.stroke(); ctx.setLineDash([]);
 let lmax=1.0; d.forEach(r=>lmax=Math.max(lmax,r.leverage)); lmax=Math.min(4,lmax*1.1);
 const Yl=v=>padT+ph*(1-Math.min(v,lmax)/lmax);
 // leverage fill+line
 ctx.fillStyle='rgba(193,113,74,.14)'; ctx.beginPath(); ctx.moveTo(X(0),Yl(0));
 d.forEach((r,i)=>ctx.lineTo(X(i),Yl(r.leverage))); ctx.lineTo(X(d.length-1),Yl(0)); ctx.closePath(); ctx.fill();
 ctx.strokeStyle=gv('--terra'); ctx.lineWidth=1.6; ctx.beginPath();
 d.forEach((r,i)=>{const x=X(i),y=Yl(r.leverage); i?ctx.lineTo(x,y):ctx.moveTo(x,y);}); ctx.stroke();
 // mean belief in appreciation (-1..1)
 ctx.strokeStyle=gv('--blue'); ctx.lineWidth=1.9; ctx.beginPath();
 d.forEach((r,i)=>{ const mb=r.apprec.reduce((a,b)=>a+b,0)/r.apprec.length; const sgn=2*mb-1;
   const x=X(i),y=Yb(sgn); i?ctx.lineTo(x,y):ctx.moveTo(x,y);}); ctx.stroke();
 ctx.font='10px Inter'; ctx.fillStyle=gv('--blue'); ctx.textAlign='right';
 ctx.fillText('+1',padL-5,Yb(1)+3); ctx.fillText('0',padL-5,Yb(0)+3); ctx.fillText('−1',padL-5,Yb(-1)+3);
 ctx.fillStyle=gv('--terra'); ctx.textAlign='left'; ctx.fillText(lmax.toFixed(1)+'×',padL+pw+5,Yl(lmax)+8); ctx.fillText('0',padL+pw+5,Yl(0));
}

/* ---- financing + bankruptcies ---- */
function drawFin(){
 const cv=document.getElementById('cFin'); const {ctx,w,h}=fit(cv); ctx.clearRect(0,0,w,h);
 const d=slc(); if(!d.length) return;
 const padL=30,padR=8,padT=8,padB=12, pw=w-padL-padR, ph=h-padT-padB;
 const X=i=>padL+pw*i/(d.length-1||1), Y=v=>padT+ph*(1-v);
 const cols=[gv('--hedge'),gv('--spec'),gv('--ponzi')], keys=['hedge','speculative','ponzi'];
 let base=new Array(d.length).fill(0);
 [2,1,0].forEach(L=>{ ctx.fillStyle=cols[L]; ctx.globalAlpha=0.86; ctx.beginPath(); ctx.moveTo(X(0),Y(base[0]));
   for(let i=0;i<d.length;i++) ctx.lineTo(X(i),Y(base[i]+d[i][keys[L]]));
   for(let i=d.length-1;i>=0;i--) ctx.lineTo(X(i),Y(base[i])); ctx.closePath(); ctx.fill();
   for(let i=0;i<d.length;i++) base[i]+=d[i][keys[L]]; });
 ctx.globalAlpha=1;
 let bkMax=1; d.forEach(r=>bkMax=Math.max(bkMax,r.bankruptcies));
 ctx.fillStyle=gv('--crisis');
 d.forEach((r,i)=>{ if(r.bankruptcies>0){const bh=ph*0.5*r.bankruptcies/bkMax; ctx.fillRect(X(i)-1,padT+ph-bh,2,bh);} });
 ctx.fillStyle=gv('--faint'); ctx.font='10px Inter'; ctx.textAlign='right';
 ctx.fillText('100%',padL-4,padT+9); ctx.fillText('0',padL-4,padT+ph);
}

/* ---------------- tiles / phase / domrow ---------------- */
function phaseOf(d){ const w=d.slice(-6); const av=k=>w.reduce((s,r)=>s+r[k],0)/w.length;
 const ponzi=av('ponzi'),spec=av('speculative'),lev=av('leverage'),bk=av('bankruptcies');
 if(bk>0.5) return {t:'Crisis / deleveraging', c:gv('--crisis')};
 if(ponzi>0.2) return {t:'Euphoria — Ponzi finance', c:gv('--ponzi')};
 if(spec+ponzi>0.3) return {t:'Speculative boom', c:gv('--spec')};
 if(lev<0.1) return {t:'Tranquil', c:gv('--hedge')};
 return {t:'Expansion', c:gv('--terra')};
}
function tiles(){ const d=sim.history[sim.history.length-1]; if(!d) return;
 const tot=d.capital.reduce((a,b)=>a+b,0)+d.cash||1;
 const topShare=Math.max(...d.capital)/tot;
 const mb=d.apprec.reduce((a,b)=>a+b,0)/d.apprec.length; const belief=2*mb-1;
 const defs=[
  {k:'Belief in gains', v:(belief>=0?'+':'')+belief.toFixed(2), s:'crowd, −1…+1'},
  {k:'Leverage', v:d.leverage.toFixed(2)+'×', s:'debt / equity'},
  {k:'Ponzi share', v:(d.ponzi*100).toFixed(0)+'%', s:'fragile financing'},
  {k:'Top domain', v:(topShare*100).toFixed(0)+'%', s:'of all capital'},
  {k:'Step', v:d.t, s:sim.K+' domains'},
 ];
 document.getElementById('tiles').innerHTML=defs.map(x=>`<div class="tile"><div class="k">${x.k}</div><div class="val">${x.v}</div><div class="s">${x.s}</div></div>`).join('');
}
function domrow(){ const d=sim.history[sim.history.length-1]; if(!d) return;
 const tot=d.capital.reduce((a,b)=>a+b,0)+d.cash||1;
 for(let k=0;k<sim.K;k++){ const sh=d.capital[k]/tot;
  const f=document.getElementById('df'+k), v=document.getElementById('dv'+k);
  if(f){f.style.width=(sh*100).toFixed(1)+'%';} if(v){v.textContent=(sh*100).toFixed(0)+'%';} }
}

/* ---------------- render loop ---------------- */
function render(){ drawCapital(); drawPrice(); drawBelief(); drawFin(); tiles(); domrow();
 const ph=phaseOf(slc()); document.getElementById('phaseTxt').textContent=ph.t;
 const dot=document.getElementById('phaseDot'); dot.style.background=ph.c; dot.style.boxShadow='0 0 8px '+ph.c;
 document.getElementById('phaseBadge').style.borderColor=ph.c+'88';
}
function frame(){
 if(running){ frameAcc += speedDial/4; while(frameAcc>=1){ M.step(sim); frameAcc--; } render(); }
 requestAnimationFrame(frame);
}

/* ---------------- transport ---------------- */
document.getElementById('btnPlay').onclick=function(){ running=!running; this.textContent=running?'❚❚ Pause':'▶ Run'; this.classList.toggle('primary',!running); };
document.getElementById('btnStep').onclick=()=>{ M.step(sim); render(); };
document.getElementById('btnReset').onclick=()=>rebuild();
document.getElementById('btnSeed').onclick=()=>rebuild();
document.getElementById('speed').addEventListener('input',function(){ speedDial=parseInt(this.value,10); document.getElementById('v_speed').textContent=speedDial+'×'; });

/* ---------------- about drawer ---------------- */
const DOCS={
 'Overview':`<h3>A market built out of beliefs</h3>
  <p>This is a runnable realisation of Guénin-Carlut &amp; Benazouz (2024). Every trader is a small
  <b>Active-Inference</b> agent: it infers whether each market is quietly appreciating and acts to confirm
  its own expectations. Its willingness to borrow is not a fixed dial — it is downstream of what it believes.</p>
  <p>Put a crowd of them together and Minsky's boom-and-bust appears on its own. Give them several markets and
  you also see <b>excess capital migrate between domains</b>, chasing the best story. Press Run and watch.</p>`,
 'Generative model':`<h3>What each agent believes</h3>
  <p>Each agent is a discrete <b>POMDP</b>. For every domain it infers a hidden regime
  <code>{Bull, Neutral, Bear}</code>; the Bull−Bear contrast is its <b>belief in appreciation</b>.</p>
  <p>It observes each domain’s <b>price move</b> {Up, Flat, Down} and its own <b>wealth outcome</b>
  {Gain, Even, Loss}. Regimes are <b>sticky upward, leaky downward</b> — optimism persists, pessimism clears —
  so beliefs build gradually and the market can climb out of busts.</p>
  <h3>Choosing where capital goes</h3>
  <p>The agent runs an Active-Inference policy over capital <b>destinations</b> {cash, domain₁..domainₖ},
  scoring each by Expected Free Energy and softmax-allocating its (possibly levered) capital across them.
  Confidence sets how much total risk to take; per-domain belief sets where it goes.</p>`,
 'Minsky mechanism':`<h3>Where the cycle comes from</h3>
  <p>The preference against debt is driven by the <b>belief in appreciation</b>:</p>
  <div class="eq">preference-against-debt  ∝  1 − belief in appreciation</div>
  <p>Calm, rising prices → agents infer Bull → caution erodes → they borrow and buy → prices rise
  further, <b>confirming the belief that drove them</b>. Debt piles up until income can’t service it and
  agents slide from <b>hedge → speculative → Ponzi</b> financing; when belief breaks, they all deleverage
  at once and the market crashes.</p>
  <p><b>What bounds the boom.</b> Belief alone is pure positive feedback. Two things keep it in check: a
  <b>lopsided arbitrage</b> that reins in extreme over-valuations, and — with several markets — the fact that
  capital can always <b>rotate elsewhere</b>, bleeding pressure out of any one domain. A path-dependent
  <b>memory of losses</b> (fear fast, confidence slow) further shades each agent’s nerve. In the single-domain
  limit that emotional memory becomes essential — exactly the “additional structure” the abstract wonders about.</p>`,
 'Capital rotation':`<h3>Displacement between domains</h3>
  <p>With several markets, agents concentrate capital in whichever domain’s story is strongest. As that
  belief matures and the domain stops rising, its appeal fades while a neglected domain—now cheap and
  recovering—becomes attractive again. Capital <b>rotates</b>: it doesn’t disappear at a crash, it
  <b>displaces</b> into the next promising domain.</p>
  <p>A striking side-effect: because excess capital can always find a fresh domain, the rotation acts as a
  <b>pressure valve</b> that <i>dampens</i> any single bubble compared with a one-market world. Set
  <i>Number of domains</i> to 2 to see fiercer individual bubbles; raise it for calmer prices but livelier rotation.</p>`,
 'Design choices':`<h3>Decisions made to realise the outline</h3>
  <p>The preprint names two ingredients and a conjecture; everything else is a modelling choice.</p>
  <ul>
   <li><b>Belief as the preference proxy</b> — more parsimonious than a bolt-on mood variable, and native to
   Active Inference’s self-evidencing. Minsky’s Ponzi unit becomes literally a bet on the agent’s own belief.</li>
   <li><b>Fixed cash dividend + fundamental value</b> — high prices mean low yield, so debt can’t be serviced:
   fragility is endogenous.</li>
   <li><b>Lopsided arbitrage</b> — strong when an asset is cheap, weak when expensive (short-sale limits). Without
   it the market locks into permanent boom or permanent slump; with it, cycles recur.</li>
   <li><b>Convex bubble ceiling</b> — negligible near fundamental, firm far above, so bubbles form freely but
   don’t run to infinity.</li>
   <li><b>Partial adjustment</b> — positions can’t be unwound instantly, so fire-sales trap leverage and produce
   clustered insolvencies.</li>
   <li><b>Heterogeneous agents &amp; belief contagion</b> — desynchronised temperaments plus socially-spread beliefs:
   “social construction of preferences” made mechanical.</li>
  </ul>`,
 'How to read it':`<h3>Reading the dashboard</h3>
  <ul>
   <li><b>Displacement of capital</b> — stacked bands show the share of all capital in each domain (plus idle cash).
   Swelling and shrinking bands are money migrating between domains.</li>
   <li><b>Domain prices</b> — one line per domain; dashed line is fundamental value; excursions above it are bubbles.</li>
   <li><b>Belief &amp; leverage</b> — blue is the crowd’s optimism (−1…+1), orange is aggregate borrowing. Blue leads.</li>
   <li><b>Ladder of fragility</b> — hedge / speculative / Ponzi shares, with insolvency spikes.</li>
   <li><b>Phase badge</b> — the current Minsky phase, top of the panel.</li>
  </ul>`,
 'Experiments':`<h3>Things to try</h3>
  <ul>
   <li><b>Watch capital flee.</b> Pause during a boom in one domain and watch the coloured bands trade places as
   the money migrates to the next — the headline behaviour.</li>
   <li><b>Fewer vs more domains.</b> Set <i>Number of domains</i> to 2 for fiercer individual bubbles; raise it to 5
   for calmer prices but livelier rotation — the pressure-valve effect.</li>
   <li><b>Cautious vs euphoric crowd.</b> Compare <i>Cautious crowd</i> (leverage falls, market calms) with
   <i>Euphoria</i> (borrowing climbs). Fragility is a disposition, not a fixed fact.</li>
   <li><b>Belief leads.</b> Slow the speed right down and watch the blue belief line turn <i>before</i> the orange
   leverage line each cycle.</li>
   <li><b>Cheap money.</b> Drop the interest rate toward zero and raise max leverage; borrowing spreads.</li>
  </ul>`,
};
function buildDrawer(){ const tabs=document.getElementById('dtabs'), body=document.getElementById('dbody'); const names=Object.keys(DOCS);
 names.forEach((n,i)=>{ const t=document.createElement('div'); t.className='dtab'+(i===0?' on':''); t.textContent=n;
  t.onclick=()=>{ document.querySelectorAll('.dtab').forEach(x=>x.classList.remove('on')); t.classList.add('on'); body.innerHTML=DOCS[n]; body.scrollTop=0; }; tabs.appendChild(t); });
 body.innerHTML=DOCS[names[0]]; }
function drawer(o){ document.getElementById('drawer').classList.toggle('on',o); document.getElementById('drawerBg').classList.toggle('on',o); }
document.getElementById('btnAbout').onclick=()=>drawer(true);
document.getElementById('closeDrawer').onclick=()=>drawer(false);
document.getElementById('drawerBg').onclick=()=>drawer(false);
document.addEventListener('keydown',e=>{ if(e.key==='Escape')drawer(false); });

/* ---------------- boot ---------------- */
buildControls(); buildPresets(); buildDrawer(); rebuild();
window.addEventListener('resize',()=>render());
requestAnimationFrame(frame);
setTimeout(()=>document.getElementById('btnPlay').click(),500);
})();

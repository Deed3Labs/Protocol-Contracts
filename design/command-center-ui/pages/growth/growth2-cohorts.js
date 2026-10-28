
/* ══ Cohorts: do the people we invite stick? ═════════════════════════════════════════
   A cohort is everyone invited in the same week. Activated = account + a bank, a $5 deposit or direct
   deposit, inside 90 days of the invite. Totals match Overview: 300 invited, 124 activated, 64 opened
   but not funded. The period picks which invite weeks are shown; city and source scale the counts. */
const COH = [ // invite week start (day index), batches, invited, activated, opened-not-funded, still active %, spent $10 %
  { d:42, tau:7.5, n:'15 Sep', b:'Batch 1',     inv:25, act:13, open:3,  keep:77, spent:92 },
  { d:49, tau:7, n:'22 Sep', b:'Batch 2',     inv:25, act:13, open:4,  keep:81, spent:92 },
  { d:56, tau:6.2, n:'29 Sep', b:'Batches 3–4', inv:50, act:26, open:8,  keep:85, spent:88 },
  { d:63, tau:5.4, n:'6 Oct',  b:'Batches 5–7', inv:75, act:38, open:17, keep:89, spent:87 },
  { d:70, tau:4.6, n:'13 Oct', b:'Batches 8–10',inv:75, act:31, open:20, keep:94, spent:84 },
  { d:77, tau:4.6, n:'20 Oct', b:'Batches 11–12',inv:50, act:3, open:12, keep:100, spent:67 } ];
const HOW = [['Connected a bank',71,89,'var(--fg)'],['Added $5',38,68,'var(--land)'],['Direct deposit',15,100,'var(--live)']];
const TAU = 6;
const CHS = { metric:'act', hov:null };
const cum = (c, day) => { const t = c.tau || TAU, el = TODAY - c.d; const fin = c.act / c.inv; const k = 1 - Math.exp(-el/t); return Math.min(1, fin * (1 - Math.exp(-day/t)) / (k || 1)); };

function cohRows(){
  const [a,b] = S.range;
  let mult = 1; if (S.F.city.size) mult *= share('city')[2] || 0; if (S.F.source.size) mult *= share('source')[2] || 0;
  if (S.F.shop.size) mult *= share('shop')[2] || 0; else if (S.F.design.size) mult *= share('design')[2] || 0;
  return COH.filter(c => c.d + 6 >= a && c.d <= b).map(c => ({...c, I:c.inv*mult, A:c.act*mult, O:c.open*mult, el: TODAY - c.d }));
}

function renderCohorts(){
  const rows = cohRows(), el = document.getElementById('ch');
  const I = rows.reduce((s,c)=>s+c.I,0), A = rows.reduce((s,c)=>s+c.A,0), O = rows.reduce((s,c)=>s+c.O,0);
  const keep = A ? rows.reduce((s,c)=>s+c.A*c.keep,0)/A : 0;
  if (!rows.length){
    document.getElementById('hdr').innerHTML = `<span class="when"><span class="dot"></span>Growth · Cohorts · Demo data</span><p class="brief">Nobody was invited in this period. <span class="q">Invites started 15 Sep; pick a longer period.</span></p>`;
    el.innerHTML = `<div class="bento"><div class="cell s12"><div class="bk-empty">No invite weeks fall inside ${perName()}. <button class="clear" data-per="all">Show since launch</button></div></div></div>`; return; }
  document.getElementById('hdr').innerHTML = `<span class="when"><span class="dot"></span>Growth · Cohorts · Demo data</span>
    <p class="brief">Most people who activate do it in the first week, and <a data-cjump="how">direct deposit</a> members are the ones who stay. <span class="q">${rows.length===COH.length?'All '+COH.length+' invite weeks':rows.length+' invite week'+(rows.length>1?'s':'')}${filterDesc()?' · '+filterDesc():''}.</span></p>
    <div class="strip">
      <div class="sc"><span class="lbl">Invited</span><div class="sc-v">${fmt(I)}</div><div class="mb"><i style="width:${I/1800*100}%"></i><span class="hroom" style="left:${I/1800*100}%;right:0"></span></div><div class="sc-s">of 1,800 who joined · rest still waiting</div></div>
      <div class="sc"><span class="lbl">Activated</span><div class="sc-v">${fmt(A)} <small>${p1(pct(A,I))}</small></div><div class="mb"><i style="width:${pct(A,I)}%"></i><i style="left:${pct(A,I)}%;width:${pct(O,I)}%;background:var(--land)"></i></div><div class="sc-s">${fmt(O)} more opened but haven't funded</div></div>
      <div class="sc"><span class="lbl">Days to activate</span><div class="sc-v">6 <small>median</small></div><div class="mb"><i style="width:${6/90*100}%"></i></div><div class="sc-s">of a 90-day window</div></div>
      <div class="sc"><span class="lbl">Still active</span><div class="sc-v">${Math.round(keep)}%</div><div class="mb"><i style="width:${keep}%;background:var(--settled)"></i></div><div class="sc-s">used Clear in the last 14 days</div></div>
    </div>`;

  /* cohort grid: rows are invite weeks, columns weeks since invite; cells not reached yet are hatched */
  const M = { act:['Activated','share of each week’s invites who had activated'], keep:['Still active','share of activated members still using Clear'], spent:['Spent their $10','share of activated members who spent the $10 at a shop'] };
  const W = 6, cell = (c,w) => {
    const reached = w*7 <= c.el, partial = !reached && (w-1)*7 < c.el;
    if (!reached && !partial) return '<div class="cg-na"></div>';
    let v; if (CHS.metric==='act') v = cum(c, Math.min(w*7, c.el)) * 100; else { const base = CHS.metric==='keep' ? c.keep : c.spent; v = base + (W - w) * (CHS.metric==='keep' ? 2.2 : -1.5); v = Math.max(0, Math.min(100, v)); }
    const shade = CHS.metric==='act' ? v/60 : v/100;
    return `<div class="cg-v ${partial?'part':''}" style="background:color-mix(in srgb,var(--fg) ${Math.round(8+shade*80)}%,transparent);color:${shade>.45?'var(--ground)':'var(--fg)'}" title="${c.n} · week ${w}${partial?' so far':''} · ${Math.round(v)}%">${Math.round(v)}%${partial?'<small>so far</small>':''}</div>`; };
  const grid = `<div class="cgw"><div class="cgx" style="grid-template-columns:150px 74px repeat(${W},minmax(56px,1fr)) 150px">
    <div class="h">Invite week</div><div class="h hr">Invited</div>${Array.from({length:W},(_,i)=>`<div class="h c">Week ${i+1}</div>`).join('')}<div class="h hn">Now</div>
    ${rows.map(c=>`<div class="rn" data-coh="${c.n}"><b>${c.n}</b><span>${c.b}</span></div><div class="inv num">${fmt(c.I)}</div>${Array.from({length:W},(_,i)=>cell(c,i+1)).join('')}
      <div class="now"><span class="cgu">${(() => { const t = Math.round(c.I), a = Math.round(c.A), o = Math.round(c.O); return `<i style="flex:${a};background:var(--fg)"></i><i style="flex:${o};background:var(--land)"></i><i style="flex:${Math.max(0,t-a-o)};background:var(--hair)"></i>`; })()}</span><b>${p1(pct(c.A,c.I))}</b></div>`).join('')}
  </div></div>`;

  /* time to activate: how many activated how soon after the invite; the first week is the dark part */
  const TT = [['Same day',31],['1–3 days',27],['4–7 days',29],['1–2 weeks',21],['2–4 weeks',12],['4+ weeks',4]];
  const ttT = TT.reduce((s,x)=>s+x[1],0), ttM = Math.max(...TT.map(x=>x[1]));
  let ttC = 0;
  const wk1 = Math.round((TT[0][1]+TT[1][1]+TT[2][1])/ttT*100);
  const curves = `<div class="tt"><div class="tt-big"><span class="big">${wk1}%</span><span>of activations happen in the first week after the invite</span></div>
    <div class="tt-bars">${TT.map(([n,v],i)=>{ ttC += v; const c = Math.round(ttC/ttT*100);
      return `<div class="tt-c ${i<3?'w1':''}"><span class="tt-v">${fmt(v*A/124)}</span><i style="height:${v/ttM*100}%"></i><span class="tt-l">${n}</span><span class="tt-cum">${c}%</span></div>`; }).join('')}
      <span class="tt-br" style="left:0;width:50%"><b>First week</b></span></div>
    <div class="tt-k"><span><i class="d"></i>First week</span><span><i></i>Later</span><span class="tt-ck">Bottom row: share activated by then</span></div></div>`;

  /* how they activated, and who stayed */
  const hT = HOW.reduce((s,h)=>s+h[1],0);
  const how = `<div class="hw"><div class="hw-bar">${HOW.map(h=>`<i style="flex:${h[1]};background:${h[3]}"></i>`).join('')}</div>
    ${HOW.map(h=>`<div class="hw-r"><span class="hw-n"><i style="background:${h[3]}"></i><b>${h[0]}</b><span>${fmt(h[1]*A/124)} · ${p1(h[1]/hT*100)}</span></span>
      <span class="hw-k"><span class="lbl">Still active</span><span class="shb"><i style="width:${h[2]}%;background:${h[2]>=95?'var(--settled)':h[2]<75?'var(--underway)':'var(--fg)'}"></i></span><b>${h[2]}%</b></span></div>`).join('')}</div>`;

  /* the 90-day window: each invite week's window on one axis, today marked, what's left to do */
  const w0 = Math.min(...rows.map(c=>c.d)), w1 = Math.max(...rows.map(c=>c.d)) + 96, span = w1 - w0 + 1;
  const WX = d => (d - w0)/span*100;
  const mo = []; for (let d=w0; d<=w1; d++){ const dt = dayDate(d); if (d===w0 || dt.getDate()===1) mo.push([d, dt.toLocaleString('en',{month:'short'})]); }
  const lanes = rows.map(c=>{ const left = 90 - c.el, still = Math.round(c.I - c.A);
    return `<div class="wn-l"><span class="wn-n"><b>${c.n}</b><span>${fmt(c.I)} invited</span></span>
      <span class="wn-t"><span class="wn-w" style="left:${WX(c.d)}%;width:${WX(c.d+90)-WX(c.d)}%"><i style="width:${c.el/90*100}%"></i></span></span>
      <span class="wn-r"><b>${fmt(still)}</b> not active · ${left} days left</span></div>`; }).join('');
  const windowV = `<div class="wn"><div class="wn-hd"><span></span><span class="wn-t">${mo.map(([d,m],i)=>{ const nx = mo[i+1] ? mo[i+1][0] : w1 + 1; return `<span class="wn-m ${i%2?'alt':''}" style="left:${WX(d)}%;width:${WX(nx)-WX(d)}%">${m}</span>`; }).join('')}</span><span></span></div>
    <div class="wn-body"><span></span><span class="wn-t"><i class="wn-now" style="left:${WX(TODAY)}%;border-left-color:var(--live)"><b>Today</b></i></span><span></span></div>${lanes}</div>`;

  el.innerHTML = `
  <section class="band" style="margin-top:0"><div class="bento"><div class="cell s12">
    <div class="hd"><h2>By invite week</h2><div class="r"><div class="seg sm" role="group" aria-label="Measure">${Object.entries(M).map(([k,[t]])=>`<button data-cmetric="${k}" aria-pressed="${CHS.metric===k}"><span class="lg">${t}</span><span class="st">${{act:'Activated',keep:'Active',spent:'$10'}[k]}</span></button>`).join('')}</div></div></div>
    ${grid}
    <div class="bk-ft"><span>${M[CHS.metric][0]}: ${M[CHS.metric][1]} by the end of each week. Outlined = this week so far.</span><span class="cg-k"><i style="background:var(--fg)"></i>Active<i style="background:var(--land)"></i>Opened<i style="background:var(--hair)"></i>Not yet</span></div></div></div></section>

  <section class="band"><div class="bento">
    <div class="cell s7"><div class="hd"><h2>How fast they activate</h2><div class="r"><span class="lbl">${fmt(A)} activations · time after invite</span></div></div>${curves}
      <div class="bk-ft"><span>After the first week activations slow to a trickle, so that's when to nudge.</span><button data-go="members">Nudge in Members →</button></div></div>
    <div class="cell s5" id="how"><div class="hd"><h2>How they activated</h2><div class="r"><span class="lbl">${fmt(A)} activations</span></div></div>${how}
      <div class="bk-ft"><span>Every direct deposit member stayed. <b>$5</b> deposits drift most.</span><span></span></div></div>
  </div></section>

  <section class="band"><div class="bento"><div class="cell s12">
    <div class="hd"><h2>The 90-day window</h2><div class="r"><span class="lbl">Activation has to happen inside it</span></div></div>
    ${windowV}
    <div class="bk-ft"><span><b>${fmt(I - A)}</b> invited people aren't active yet. The first window closes <b>${dFmt(w0+90)}</b>.</span><button data-go="members">See them in Members →</button></div></div></div></section>`;
}
document.addEventListener('mouseover', e => { if (S.tab!=='cohorts') return; const t = e.target.closest('[data-coh]'); const k = t ? t.dataset.coh : null; if (k===CHS.hov) return; CHS.hov = k;
  document.querySelectorAll('.cv-l').forEach(l=>{ l.classList.toggle('on', l.dataset.coh===k); l.classList.toggle('dim', !!k && l.dataset.coh!==k); });
  document.querySelectorAll('.cv-e').forEach(l=>l.classList.toggle('on', l.dataset.coh===k)); });

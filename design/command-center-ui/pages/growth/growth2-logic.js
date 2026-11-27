
/* ── Time: every period is a day range on one daily series, so any range adds up ──
   Day 0 is Tue 4 Aug (posters went up the following week); day 78 is today, Wed 21 Oct. */
const TODAY = 78, D0 = [2026,7,4];
const dayDate = i => new Date(D0[0], D0[1], D0[2]+i);
const dFmt = (i, y) => { const d = dayDate(i); return `${d.getDate()} ${d.toLocaleString('en',{month:'short'})}`; };
const W_VIS = [4200,4360,4720,5180,5620,6110,6640,7130,7620,8010,8239,8906];
const W_JOIN = [20,28,40,30,75,95,130,204,270,290,300,318], W_INV = [0,0,0,0,0,0,25,25,50,75,75,50], W_ACT = [0,0,0,0,0,0,9,16,24,33,35,27];
const W_OPEN = W_INV.map(v=>Math.round(v*.627)), W_SPEND = W_ACT.map(v=>Math.round(v*.88));
// spread each week over its 7 days, counted back from today; weekdays a little busier than weekends, Sundays busiest for visits
const DAILY = [W_VIS, W_JOIN, W_INV, W_OPEN, W_ACT, W_SPEND].map((W,si) => {
  const out = new Array(TODAY+1).fill(0);
  for (let d=0; d<=TODAY; d++){ const wk = 11 - Math.floor((TODAY-d)/7); if (wk<0) continue; const dow = dayDate(d).getDay();
    const wgt = si===2 ? (dow===2 ? 1 : 0) : (dow===0 ? 1.25 : dow===6 ? 1.1 : .93);
    out[d] = W[wk] * (si===2 ? wgt : wgt/7); }
  return out; });
const sumR = (si,a,b) => { let s=0; for (let d=Math.max(a,0); d<=Math.min(b,TODAY); d++) s += DAILY[si][d]; return s; };
const BASE = [0,1,2,3,4,5].map(si => sumR(si, TODAY-29, TODAY));   // the 30-day rows in D are this window
const PRESETS = [
  ['today','Today',[TODAY,TODAY]], ['7d','7 days',[TODAY-6,TODAY]], ['30d','30 days',[TODAY-29,TODAY]],
  ['90d','90 days',[TODAY-89,TODAY]], ['all','Since launch',[0,TODAY]] ];
const MORE = [ // the custom picker's quick picks; the last two are anchored to real events
  ['Yesterday',[TODAY-1,TODAY-1]], ['This week',[TODAY-2,TODAY]], ['Last week',[TODAY-9,TODAY-3]], ['This month',[TODAY-20,TODAY]], ['September',[28,57]],
  ['Since posters went up · 18 Aug',[14,TODAY]], ['Since invites started · 15 Sep',[42,TODAY]] ];
const S = { tab:'overview', per:'30d', range:[TODAY-29,TODAY], cmp:true, gran:'auto', step:0, dim:'source', view:'list', sort:'in', dir:-1,
  F:{city:new Set(), source:new Set(), shop:new Set(), design:new Set()}, open:null, sheet:null, pick:null, cal:1, pace:50 };
const span = () => S.range[1]-S.range[0]+1;
const factor = (a,b) => [0,1,2,3,4,5].map(si => BASE[si] ? sumR(si,a,b)/BASE[si] : 0);
const prevRange = () => { const n = span(), a = S.range[0]-n, b = S.range[0]-1; return b < 0 ? null : [Math.max(a,0), b]; };
const perName = () => { const p = PRESETS.find(p=>p[0]===S.per); if (p) return p[1]; const m = MORE.find(m=>m[1][0]===S.range[0]&&m[1][1]===S.range[1]); if (m) return m[0].split(' · ')[0]; return S.range[0]===S.range[1] ? dFmt(S.range[0]) : `${dFmt(S.range[0])} – ${dFmt(S.range[1])}`; };
const cmpOn = () => S.cmp && !!prevRange();
const cmpName = () => { const n = span(); return n===1 ? 'the day before' : `the ${n} days before`; };

const fmt = n => Math.round(n).toLocaleString('en-US');
const pct = (a,b) => b ? (a/b*100) : 0;
const p1 = v => v.toFixed(1) + '%';
function rng(seed){ let s=seed; return () => (s = (s*16807) % 2147483647, (s-1)/2147483646); }
const hash = t => [...t].reduce((a,c)=>a*31+c.charCodeAt(0)>>>0, 7);
const STEP_SHORT = ['Visit → join','Join → invite','Invite → open','Open → active','Active → spend'];

/* rows for a dimension, scaled to the range and to every other dimension's filter */
const ALL = () => D.source.rows.reduce((a,r)=>a.map((v,i)=>v+r.f[i]),[0,0,0,0,0,0]);
function share(dimKey){
  const all = ALL(), sel = S.F[dimKey];
  const pick = D[dimKey].rows.filter(r=>sel.has(r.n)).reduce((a,r)=>a.map((v,i)=>v+(r.f[i]||0)),[0,0,0,0,0,0]);
  return all.map((v,i)=> v ? pick[i]/v : 0);
}
function rowsFor(dimKey, rng2){
  const P = factor(...(rng2 || S.range));
  let mult = [1,1,1,1,1,1];
  Object.keys(S.F).forEach(k => { if (k!==dimKey && S.F[k].size) { const sh = share(k); mult = mult.map((m,i)=>m*sh[i]); } });
  if (D[dimKey].posters && S.F.source.size && !S.F.source.has('Posters')) return [];
  if (D[dimKey].posters && S.F.source.size) { const sh = share('source'); mult = mult.map((m,i)=> m / (sh[i]||1)); }
  let rows = D[dimKey].rows;
  if (S.F[dimKey].size) rows = rows.filter(r=>S.F[dimKey].has(r.n));
  return rows.map(r => ({...r, v: r.f.map((x,i)=> Math.round(x * P[i] * mult[i]))}));
}
const baseDim = () => S.F.shop.size ? 'shop' : S.F.design.size ? 'design' : 'source';
const totals = rng2 => rowsFor(baseDim(), rng2).reduce((a,r)=>a.map((v,i)=>v+r.v[i]),[0,0,0,0,0,0]);
const filterDesc = () => { const p = []; Object.entries(S.F).forEach(([k,set]) => { if (set.size) p.push(set.size===1 ? [...set][0] : `${set.size} ${k==='city'?'cities':D[k].name.toLowerCase()+'s'}`); }); return p.join(' · '); };
const nFilters = () => Object.values(S.F).reduce((a,s)=>a+s.size,0);
const rates = T => STEP.map((_,k)=>pct(T[k+1],T[k]));
const weakest = T => { const r = rates(T); let w = -1; r.forEach((v,k)=>{ if (T[k+1] > 0 && T[k] >= 10 && (w<0 || v < r[w])) w = k; }); return w<0 ? 0 : w; };

/* ── header ── */
function renderHdr(T){
  const r = rates(T), weak = weakest(T), fd = filterDesc();
  const ratio = (W_JOIN[11] / W_INV[11]).toFixed(1);
  const posterRow = rowsFor('source').find(x=>x.n==='Posters'), pj = posterRow ? posterRow.v[1] : 0;
  const sent = `${ratio} people join for every one we invite, and <a data-step="${weak}">${STEP_LONG[weak]}</a> is the weakest step at ${p1(r[weak])}. ` +
    (fd || S.per!=='30d' ? `<span class="q">Showing ${fd ? fd+', ' : ''}${perName().toLowerCase()==='today'?'today':perName()}.</span>` : `<span class="q">Posters bring ${Math.round(pct(pj,T[1]))}% of joins.</span>`);
  document.getElementById('hdr').innerHTML = `<span class="when"><span class="dot"></span>Growth · Soft launch · day 78 · Demo data</span>
    <p class="brief">${sent}</p>
    <div class="strip">
      <div class="sc"><span class="lbl">Joined · ${perName()}</span><div class="sc-v">${fmt(T[1])}</div>
        <div class="mb"><i style="width:${pct(pj,T[1])}%"></i></div><div class="sc-s">${Math.round(pct(pj,T[1]))}% from posters</div></div>
      <div class="sc"><span class="lbl">Waitlist · now</span><div class="sc-v">1,500</div>
        <div class="mb"><i style="width:16.7%"></i><span class="hroom" style="left:16.7%;right:0"></span></div><div class="sc-s">300 of 1,800 invited · 24-day wait</div></div>
      <div class="sc"><span class="lbl">Activated · ${perName()}</span><div class="sc-v">${fmt(T[4])} <small>${p1(pct(T[4],T[2]))}</small></div>
        <div class="mb"><i style="width:${Math.min(100,pct(T[4],T[2]))}%"></i><i style="left:${Math.min(100,pct(T[4],T[2]))}%;width:${Math.max(0,Math.min(100-pct(T[4],T[2]),pct(T[3]-T[4],T[2])))}%;background:var(--land)"></i></div><div class="sc-s">of invited · ${fmt(Math.max(0,T[3]-T[4]))} opened, not funded</div></div>
      <div class="sc"><span class="lbl">First $10 spends</span><div class="sc-v">${fmt(T[5])}</div>
        <div class="mb"><i style="width:${Math.min(100,pct(T[5],T[4]))}%"></i></div><div class="sc-s">${p1(pct(T[5],T[4]))} of active · $${fmt(T[5]*10)} to shops</div></div>
    </div>`;
}

/* ── control bar: desktop shows everything; phones get two buttons that open sheets ── */
const caret = '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 4.5l3 3 3-3"/></svg>';
const calIc = '<svg class="i" viewBox="0 0 20 20" style="width:15px;height:15px"><path d="M3 5h14v12H3z"/><path d="M3 9h14M7 3v4M13 3v4"/></svg>';
const filIc = '<svg class="i" viewBox="0 0 20 20" style="width:15px;height:15px"><path d="M3 5h14M6 10h8M8.5 15h3"/></svg>';
const linkIc = '<svg class="i" viewBox="0 0 20 20" style="width:15px;height:15px"><path d="M8 12l4-4"/><path d="M9 5l1.5-1.5a3.5 3.5 0 0 1 5 5L14 10M11 15l-1.5 1.5a3.5 3.5 0 0 1-5-5L6 10"/></svg>';
function fChecks(k){ const set = S.F[k]; return D[k].rows.map(r=>`<label><input type="checkbox" data-fv="${k}" value="${r.n}" ${set.has(r.n)?'checked':''}><span>${r.n}</span><span class="n">${fmt(r.f[0])}</span></label>`).join(''); }
function renderCtl(){
  const fl = k => { const set = S.F[k], n = D[k].name;
    const label = set.size===0 ? n : set.size===1 ? `${n}: <b>${[...set][0]}</b>` : `${n}: <b>${set.size}</b>`;
    const menu = S.open===k ? `<div class="menu" data-menu="${k}">${fChecks(k)}<div class="mf"><button data-fclear="${k}">Clear</button><button data-fclose>Done</button></div></div>` : '';
    return `<div class="fl cw"><button class="${set.size?'on':''}" data-fopen="${k}">${label}${caret}</button>${menu}</div>`; };
  const custom = !PRESETS.some(p=>p[0]===S.per);
  const n = nFilters();
  document.getElementById('ctl').innerHTML = `
    <div class="seg cw" role="group" aria-label="Period">${PRESETS.map(([k,v])=>`<button data-per="${k}" aria-pressed="${S.per===k}" ${k==='90d'?'title="Same as since launch until 2 Nov"':''}>${v}</button>`).join('')}<button data-custom aria-pressed="${custom}" class="cbtn">${calIc}${custom ? perName() : 'Custom'}</button></div>
    <button class="mbtn cc" data-sheet="period">${calIc}<b>${perName()}</b>${caret}</button>
    <button class="tog" data-cmp aria-pressed="${cmpOn()}" ${prevRange()?'':'disabled'} title="${prevRange()?'Compare to '+cmpName():'Nothing to compare before launch'}"><i></i><span class="d-only">Compare</span><span class="m-only">vs before</span></button>
    <span class="vsep cw"></span>
    ${['city','source','shop','design'].map(fl).join('')}
    <button class="mbtn cc ${n?'on':''}" data-sheet="filters">${filIc}Filters${n?` <b>${n}</b>`:''}</button>
    <div class="rt">${n?'<button class="clear" data-fclearall>Clear<span class="cw"> filters</span></button>':''}</div>
    ${S.open==='custom' ? calPop() : ''}`;
}

/* the custom range picker: quick picks on the left, two months on the right */
function monthGrid(y, m){
  const first = new Date(y,m,1), days = new Date(y,m+1,0).getDate(), lead = (first.getDay()+6)%7;
  const idx = d => Math.round((new Date(y,m,d) - dayDate(0))/864e5);
  const [a,b] = S.pick ? (S.pick.length===1 ? [S.pick[0],S.pick[0]] : S.pick) : S.range;
  let h = `<div class="cm"><div class="cm-h">${first.toLocaleString('en',{month:'long'})}</div><div class="cm-g">${['M','T','W','T','F','S','S'].map(x=>`<span class="w">${x}</span>`).join('')}${'<span></span>'.repeat(lead)}`;
  for (let d=1; d<=days; d++){ const i = idx(d), off = i<0 || i>TODAY;
    h += `<button ${off?'disabled':''} data-day="${i}" class="${i>=a&&i<=b?'in':''} ${i===a?'s':''} ${i===b?'e':''} ${i===TODAY?'t':''}">${d}</button>`; }
  return h + '</div></div>';
}
function calPop(){
  const months = [[2026,7],[2026,8],[2026,9]], view = months.slice(S.cal, S.cal+2);
  const lab = S.pick ? (S.pick.length===1 ? `${dFmt(S.pick[0])} – pick an end day` : `${dFmt(S.pick[0])} – ${dFmt(S.pick[1])}`) : `${dFmt(S.range[0])} – ${dFmt(S.range[1])}`;
  return `<div class="cal ${S.sheet?'as-sheet':''}" data-menu="custom">
    <div class="cal-q">${MORE.map(([t,r])=>`<button data-quick="${r.join(',')}" class="${r[0]===S.range[0]&&r[1]===S.range[1]?'on':''}">${t.replace(' · ','<span> · ')}${t.includes(' · ')?'</span>':''}</button>`).join('')}</div>
    <div class="cal-m"><div class="cal-nav"><button data-calnav="-1" ${S.cal===0?'disabled':''} aria-label="Earlier">‹</button><span>${lab}</span><button data-calnav="1" ${S.cal===1?'disabled':''} aria-label="Later">›</button></div>
      <div class="cal-2">${view.map(([y,m])=>monthGrid(y,m)).join('')}</div>
      <div class="mf"><button data-calcancel>Cancel</button><button class="btn p" style="height:32px" data-calapply ${S.pick && S.pick.length===1?'disabled':''}>Apply</button></div></div></div>`;
}

/* phone sheets */
function renderSheet(){
  let el = document.getElementById('sheet');
  if (!S.sheet){ if (el) el.remove(); document.body.classList.remove('sh'); return; }
  if (!el){ el = document.createElement('div'); el.id = 'sheet'; document.body.appendChild(el); }
  document.body.classList.add('sh');
  const body = S.sheet==='period'
    ? `<div class="sh-sec"><span class="lbl">Period</span><div class="sh-chips">${PRESETS.map(([k,v])=>`<button data-per="${k}" aria-pressed="${S.per===k}">${v}</button>`).join('')}</div></div>
       <div class="sh-sec"><span class="lbl">Quick picks</span><div class="sh-list">${MORE.map(([t,r])=>`<button data-quick="${r.join(',')}" class="${r[0]===S.range[0]&&r[1]===S.range[1]?'on':''}">${t}</button>`).join('')}</div></div>
       <div class="sh-sec"><span class="lbl">Or pick days</span><div class="cal-2 one">${monthGrid(2026, S.cal===0?8:9)}</div>
         <div class="cal-nav sm"><button data-calnav="-1" ${S.cal===0?'disabled':''}>‹ September</button><button data-calnav="1" ${S.cal===1?'disabled':''}>October ›</button></div></div>`
    : ['city','source','shop','design'].map(k=>`<div class="sh-sec"><div class="sh-h"><span class="lbl">${D[k].name}</span>${S.F[k].size?`<button data-fclear="${k}">Clear</button>`:''}</div><div class="menu flat">${fChecks(k)}</div></div>`).join('');
  const T = totals();
  el.innerHTML = `<div class="sh-scrim" data-sheetclose></div><div class="sh-panel" role="dialog" aria-label="${S.sheet==='period'?'Period':'Filters'}">
    <div class="sh-top"><b>${S.sheet==='period'?'Period':'Filters'}</b><button data-sheetclose aria-label="Close">✕</button></div>
    <div class="sh-body">${body}</div>
    <div class="sh-ft">${S.sheet==='filters'&&nFilters()?'<button class="clear" data-fclearall>Clear all</button>':'<span></span>'}<button class="btn p" data-sheetclose ${S.pick&&S.pick.length===1?'disabled':''}>${S.sheet==='period' ? (S.pick ? 'Apply '+(S.pick.length===2?dFmt(S.pick[0])+' – '+dFmt(S.pick[1]):'') : 'Done') : `Show ${fmt(T[0])} visits`}</button></div></div>`;
}

/* ── funnel: horizontal on wide screens, a vertical ladder on phones ── */
function renderFunnel(T){
  const pr = prevRange(), P = pr ? totals(pr) : null, on = cmpOn();
  const dlt = i => { if (!on || !P[i]) return '<span class="dl">&nbsp;</span>'; const d = pct(T[i]-P[i], P[i]); return `<span class="dl ${d>=0?'up':'dn'}">${d>=0?'+':''}${d.toFixed(1)}%</span>`; };
  const r = rates(T), weak = weakest(T);
  const w = 1000/6, mid = 60, hh = v => 6 + 104*Math.pow(Math.max(v,1)/Math.max(T[0],1), .25);
  let top='', bot='';
  T.forEach((v,i)=>{ const h=hh(v), x1=i*w+(i<5?w*.62:w), t=mid-h/2, b=mid+h/2;
    top += `${i?'':'M0 '+t}L${x1} ${t}`; if (i<5){ const h2=hh(T[i+1]); top += `C${x1+w*.2} ${t} ${(i+1)*w-w*.16} ${mid-h2/2} ${(i+1)*w} ${mid-h2/2}`; }
    let seg = `L${x1} ${b}`; if (i<5){ const h2=hh(T[i+1]); seg = `L${(i+1)*w} ${mid+h2/2}C${(i+1)*w-w*.16} ${mid+h2/2} ${x1+w*.2} ${b} ${x1} ${b}`; }
    bot = seg + bot; });
  const path = `${top}L1000 ${mid+hh(T[5])/2}${bot.replace(/^L1000 [\d.]+/,'')}L0 ${mid+hh(T[0])/2}Z`;
  const k = S.step, sx = k*w + w*.5, ex = (k+1)*w + w*.5;
  const vw = v => 8 + 92*Math.pow(Math.max(v,1)/Math.max(T[0],1), .25);
  document.getElementById('funnel').innerHTML = `
    <div class="hd"><h2>Funnel</h2><div class="r"><span class="lbl">${perName()}${filterDesc()?' · '+filterDesc():''}<span class="d-only">${on?' · change vs '+cmpName():''}</span></span></div></div>
    <div class="fh d-only">
      <div class="fh-cols">${T.map((v,i)=>`<div class="fh-c"><span class="lbl">${STG[i]}</span><span class="v">${fmt(v)}</span>${dlt(i)}</div>`).join('')}</div>
      <svg viewBox="0 0 1000 120" preserveAspectRatio="none">
        <defs><clipPath id="fc"><path d="${path}"/></clipPath></defs>
        <path class="body" d="${path}"/>
        <rect class="sel" clip-path="url(#fc)" x="${sx}" y="0" width="${ex-sx}" height="120"/>
        <rect class="last" clip-path="url(#fc)" x="${5*w}" y="0" width="${w}" height="120"/>
      </svg>
      <div class="steps">${STEP_SHORT.map((s,i)=>`<div class="st" style="grid-column:${2*i+2} / span 2"><button data-step="${i}" aria-pressed="${S.step===i}" class="${i===weak?'weak':''}" title="${s} · ${p1(r[i])}"><span class="sl">${s}</span><span class="sa">→</span><b>${p1(r[i])}</b></button></div>`).join('')}</div>
    </div>
    <div class="fv m-only">${T.map((v,i)=>`<div class="fv-r"><span class="lbl">${STG[i]}</span><span class="fv-b"><i class="${i===5?'k':''} ${i===S.step||i===S.step+1?'sel':''}" style="width:${vw(v)}%"></i></span><span class="v">${fmt(v)}</span>${dlt(i)}</div>
      ${i<5?`<button class="fv-s ${i===weak?'weak':''}" data-step="${i}" aria-pressed="${S.step===i}"><span>↓ ${STEP_SHORT[i]}</span><b>${p1(r[i])}</b></button>`:''}`).join('')}</div>
    <div class="fh-note"><span>${S.step===weak ? `<b>Weakest step.</b>` : `<b>${STEP[S.step]}.</b>`} ${fmt(T[S.step]-T[S.step+1])} of ${fmt(T[S.step])} ${STG[S.step].toLowerCase()} didn't reach ${STG[S.step+1].toLowerCase()}.</span></div>`;
}

/* ── breakdown ── */
function spark(seed, up){ const r = rng(seed); let v = 10, pts = []; for (let i=0;i<14;i++){ v += (r()-.45 + (up?.12:0))*3; pts.push(v); } const mn=Math.min(...pts), mx=Math.max(...pts);
  return `<svg class="sp" viewBox="0 0 84 22" preserveAspectRatio="none"><path d="${pts.map((p,i)=>`${i?'L':'M'}${(i/13*84).toFixed(1)} ${(20-(p-mn)/(mx-mn||1)*18).toFixed(1)}`).join('')}"/></svg>`; }
function dimOk(k){ const d = D[k]; if (d.onlyStep!==undefined && S.step!==d.onlyStep) return false; if (d.minStep!==undefined && S.step<d.minStep) return false; return true; }
function renderBk(){
  if (!dimOk(S.dim)) S.dim = 'source';
  const k = S.step, el = document.getElementById('bk');
  const dims = Object.keys(D).map(key=>`<button data-dim="${key}" aria-pressed="${S.dim===key}" ${dimOk(key)?'':'disabled title="Not available for this step"'}>${D[key].name}</button>`).join('');
  const views = S.dim==='week' ? '' : `<div class="vw" role="group" aria-label="View"><button data-view="list" aria-pressed="${S.view==='list'}" title="List"><svg class="i" viewBox="0 0 20 20" style="width:15px;height:15px"><path d="M3 5h14M3 10h14M3 15h14"/></svg></button><button data-view="chart" aria-pressed="${S.view==='chart'}" title="Rate against volume"><svg class="i" viewBox="0 0 20 20" style="width:15px;height:15px"><path d="M3 3v14h14"/><rect x="6" y="10" width="2.5" height="2.5"/><rect x="10" y="6" width="2.5" height="2.5"/><rect x="13" y="11" width="2.5" height="2.5"/></svg></button></div>`;
  const note = D[S.dim].posters ? ' · posters only' : '';
  let body = '', foot = '';
  if (S.dim==='week'){
    const cols = ['Week 1','Week 2','Week 3','Week 4','Week 5'];
    body = `<div class="hm-wrap"><div class="hm" style="grid-template-columns:96px 60px repeat(5,minmax(52px,1fr))"><div class="h"></div><div class="h">People</div>${cols.map(c=>`<div class="h">${c}</div>`).join('')}
      ${COH.map(c=>[c.n,c.inv,Array.from({length:5},(_,i)=>(i+1)*7<=c.el||(i*7<c.el)?Math.round(cum({...c,el:undefined,...c},Math.min((i+1)*7,TODAY-c.d))*100):undefined).filter(x=>x!==undefined)]).map(([w,n,v])=>`<div class="r">${w}</div><div>${n}</div>${cols.map((_,i)=> v[i]!==undefined ? `<div style="background:color-mix(in srgb,var(--fg) ${Math.round(12+v[i]*1.5)}%,transparent);color:${v[i]>34?'var(--ground)':'var(--fg)'}">${v[i]}%</div>` : '<div class="na"></div>').join('')}`).join('')}</div></div>`;
    foot = `<span>Share of each invite week that's active. <b>About half</b> activate by week three.</span><button data-go="members">Nudge the stuck in Members →</button>`;
  } else {
    const pr = prevRange(), on = cmpOn();
    const prevRows = on ? Object.fromEntries(rowsFor(S.dim, pr).map(r=>[r.n,r.v])) : {};
    let rows = rowsFor(S.dim).map(r=>({...r, in:r.v[k], out:r.v[k+1]||0}));
    const sumIn = rows.reduce((a,r)=>a+r.in,0), sumOut = rows.reduce((a,r)=>a+r.out,0), avg = pct(sumOut,sumIn);
    const hand = r => S.dim==='page' && r.f[1]===0;
    rows.forEach(r => { r.rate = r.in && !hand(r) ? pct(r.out,r.in) : null; const pv = prevRows[r.n];
      const j = rng(hash(r.n+k))(); r.prev = pv && pv[k] ? pct(pv[k+1],pv[k])*(0.92+j*0.16) : null; });
    const key = S.sort==='in' ? 'in' : S.sort==='out' ? 'out' : 'rate';
    rows.sort((a,b)=> ((a[key]??-1)-(b[key]??-1))*S.dir);
    const mx = Math.max(...rows.map(r=>r.rate||0), avg)*1.12 || 1;
    const cls = r => r.rate==null ? '' : r.rate > avg*1.2 ? 'hi' : r.rate < avg*.7 ? 'lo' : '';
    const th = (k2,t,c) => `<th data-sort="${k2}" class="${S.sort===k2?'s':''} ${c||''}">${t}${S.sort===k2?(S.dir<0?' ↓':' ↑'):''}</th>`;
    if (!rows.length) body = `<div class="bk-empty">No ${D[S.dim].name.toLowerCase()} rows match these filters. Shop and design only cover posters, so add Posters to the source filter.</div>`;
    else if (S.view==='list'){
      body = `<div class="bt-wrap"><table class="bt"><thead><tr><th class="c-nm">${D[S.dim].name}</th>${th('in',STG[k],'c-in')}${th('out',STG[k+1],'c-out')}${th('rate','Rate','c-rt')}${on?'<th class="c-cmp">Change</th>':''}<th class="c-sp">Last 14 days</th></tr></thead><tbody>
        ${rows.map(r=>{ const d = r.rate!=null && r.prev!=null ? r.rate - r.prev : null;
          return `<tr data-row="${r.n}" title="Filter the page to ${r.n}"><td class="tn c-nm"><b>${r.n}</b>${r.s?`<span>${r.s}</span>`:''}<span class="m-only mi">${fmt(r.in)} → ${r.rate==null?'—':fmt(r.out)}</span></td><td class="c-in">${fmt(r.in)}</td><td class="c-out">${r.rate==null?'<span class="quiet">—</span>':fmt(r.out)}</td>
          <td class="c-rt">${r.rate==null?'<span class="quiet small">Hands off</span>':`<div class="rb"><span class="bar"><i class="${cls(r)}" style="width:${r.rate/mx*100}%"></i><s style="left:${avg/mx*100}%"></s></span><b>${p1(r.rate)}</b></div>`}</td>
          ${on?`<td class="c-cmp">${d==null?'':Math.abs(d)<.05?'<span class="dl">±0.0 pts</span>':`<span class="dl ${d>=0?'up':'dn'}">${d>=0?'+':''}${d.toFixed(1)} pts</span>`}</td>`:''}
          <td class="c-sp">${spark(hash(r.n)+k, r.rate>avg)}</td></tr>`; }).join('')}
        <tr class="tot"><td class="c-nm">All${D[S.dim].posters?' posters':''}<span class="m-only mi">${fmt(sumIn)} → ${fmt(sumOut)}</span></td><td class="c-in">${fmt(sumIn)}</td><td class="c-out">${fmt(sumOut)}</td><td class="c-rt"><div class="rb"><span class="bar" style="background:none"><s style="left:${avg/mx*100}%"></s></span><b>${p1(avg)}</b></div></td>${on?'<td class="c-cmp"></td>':''}<td class="c-sp"></td></tr></tbody></table></div>`;
    } else {
      const pts = rows.filter(r=>r.rate!=null && r.in>0);
      const lx = v => Math.log10(Math.max(v,1)), xmin = Math.min(...pts.map(p=>lx(p.in))) - .15, xmax = Math.max(...pts.map(p=>lx(p.in))) + .15;
      const ymax = Math.ceil(Math.max(...pts.map(p=>p.rate), avg)*1.15/5)*5 || 5;
      const X = v => (lx(v)-xmin)/(xmax-xmin)*100, Y = v => 100 - v/ymax*100;
      const avgIn = Math.pow(10, pts.reduce((a,p)=>a+lx(p.in),0)/pts.length);
      body = `<div class="sc2"><div class="ax"></div>
        <div class="q good" style="left:0;top:0;width:${X(avgIn)}%;height:${Y(avg)}%"></div>
        <div class="q bad" style="left:${X(avgIn)}%;top:${Y(avg)}%;right:0;bottom:0"></div>
        <div class="av" style="left:0;right:0;top:${Y(avg)}%;border-top-width:1px"></div>
        <div class="av" style="top:0;bottom:0;left:${X(avgIn)}%;border-left-width:1px"></div>
        <span class="ql" style="left:8px;top:8px">Converts, needs volume</span>
        <span class="ql" style="right:8px;bottom:8px">Busy, weak</span>
        ${[0,.5,1].map(f=>`<span class="yl" style="top:${100-f*100}%">${(ymax*f).toFixed(0)}%</span>`).join('')}
        ${[...new Set([0,.5,1].map(f=>Math.round(Math.pow(10, xmin+(xmax-xmin)*f))))].map(v=>`<span class="xl" style="left:${X(v)}%">${fmt(v)}</span>`).join('')}
        ${pts.map(p=>`<span class="pt2 ${cls(p)}" style="left:${X(p.in)}%;top:${Y(p.rate)}%" data-row="${p.n}" title="${p.n} · ${p1(p.rate)}"><i></i><span>${p.n} · ${p1(p.rate)}</span></span>`).join('')}
      </div><div class="tr-x sc2-x"><span>${STG[k]} → (log scale)</span><span>Rate ↑</span></div>`;
    }
    if (rows.length){
      const ranked = rows.filter(r=>r.rate!=null && r.in >= sumIn*.02).sort((a,b)=>b.rate-a.rate);
      const best = ranked[0], worst = ranked[ranked.length-1];
      foot = best && worst && best!==worst ? `<span>Best <b>${best.n}, ${p1(best.rate)}</b> · lowest <b>${worst.n}, ${p1(worst.rate)}</b><span class="d-only"> · average ${p1(avg)}</span></span><button data-row="${best.n}">Filter to ${best.n} →</button>`
        : `<span>Average ${p1(avg)}</span><span></span>`;
    }
  }
  el.innerHTML = `<div class="bk-hd"><h2>${STEP[k]}, by ${D[S.dim].name.toLowerCase()}<span>${note}</span></h2><div class="dims-wrap"><div class="dims">${dims}</div></div>${views}</div>${body}<div class="bk-ft">${foot}</div>`;
}

/* ── trend: joins and invites side by side per day or week; the number on top is what the waitlist gained ── */
function renderTrend(){
  const [a,b] = S.range, n = b-a+1;
  const gran = S.gran==='auto' ? (n<=21 ? 'day' : 'week') : S.gran;
  let buckets = [];
  if (gran==='day') for (let d=a; d<=b; d++) buckets.push([d,d]);
  else { for (let e=b; e>=a; e-=7) buckets.unshift([Math.max(a,e-6), e]); }
  const T = totals(); // scale to the funnel's totals so filters apply and the numbers match the page
  const ser = si => { const tot = sumR(si,a,b) || 1; return buckets.map(([x,y]) => Math.round(sumR(si,x,y) * T[si] / tot)); };
  const J = ser(1), I = ser(2), A = ser(4), m = buckets.length;
  const raw = Math.max(5, ...J, ...I), mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1,2,2.5,5,10].map(x=>x*mag).find(s=>raw/s<=4) || mag*10, ymax = Math.ceil(raw*1.08/step)*step;
  const ticks = []; for (let v=0; v<=ymax+1e-9; v+=step) ticks.push(v);
  const part = i => gran==='week' && buckets[i][1]-buckets[i][0] < 6;
  const lab = i => gran==='day' ? dFmt(buckets[i][1]) : dFmt(buckets[i][0]) + (part(i) ? ` · ${buckets[i][1]-buckets[i][0]+1}d` : '');
  const every = m <= 12 ? 1 : Math.ceil(m/8);
  const host = document.getElementById('trend');
  host.innerHTML = `<div class="bc-y">${ticks.map(v=>`<span style="bottom:${v/ymax*100}%">${fmt(v)}</span>`).join('')}</div>
    <div class="bc-p">
      ${ticks.map(v=>`<i class="bc-g" style="bottom:${v/ymax*100}%"></i>`).join('')}
      <div class="bc-cols ${m>16?'dense':''}">${buckets.map((bk,i)=>{ const net = J[i]-I[i];
        return `<div class="bc-c ${part(i)?'part':''}" tabindex="0" data-tip="${gran==='day'?dFmt(bk[1]):(part(i)?`${dFmt(bk[0])} – ${dFmt(bk[1])} (part week)`:'Week of '+dFmt(bk[0]))}|${J[i]}|${I[i]}|${A[i]}|${net}">
          <span class="bc-net ${net>0?'up':'dn'}" style="bottom:calc(${Math.max(J[i],I[i])/ymax*100}% + 6px)">${net>0?'+':''}${fmt(net)}</span>
          <div class="bc-bars"><i class="j" style="height:${J[i]/ymax*100}%"></i><i class="v" style="height:${I[i]/ymax*100}%"></i><i class="a" style="height:${A[i]/ymax*100}%"></i></div>
          <span class="bc-x ${i%2?'odd':''}">${i%every===0 || i===m-1 ? lab(i) : ''}</span></div>`; }).join('')}</div>
      <div class="bc-tip" id="bctip" hidden></div>
    </div>`;
  const s = arr => fmt(arr.reduce((x,y)=>x+y,0)), tot = J.reduce((x,y)=>x+y,0) - I.reduce((x,y)=>x+y,0);
  document.getElementById('trx').innerHTML = '';
  document.getElementById('trk').innerHTML = `<span><i style="background:var(--fg);height:10px;width:10px"></i>Joined <b>${s(J)}</b></span><span><i style="background:var(--land);height:10px;width:10px"></i>Invited <b>${s(I)}</b></span><span><i style="background:color-mix(in srgb,var(--fg) 22%,transparent);height:10px;width:10px"></i>Activated <b>${s(A)}</b></span><span class="bc-k"><b class="up">+${fmt(tot)}</b> added to the waitlist</span>`;
  document.getElementById('trh').innerHTML = `<h2>Joins against invites</h2><div class="r"><span class="lbl">${perName()} · ${gran==='day'?'by day':'by week'}</span><div class="seg sm" role="group" aria-label="Granularity">${[['auto','Auto'],['day','Daily'],['week','Weekly']].map(([k,t])=>`<button data-gran="${k}" aria-pressed="${S.gran===k}" ${k==='day'&&n>92?'disabled':''}>${t}</button>`).join('')}</div></div>`;
}
document.addEventListener('mouseover', e => { const c = e.target.closest('.bc-c:not(.tf-c)'); const tip = document.getElementById('bctip'); if (!tip || S.tab!=='overview') return;
  if (!c){ tip.hidden = true; return; }
  const [t,j,i,a,net] = c.dataset.tip.split('|'); const p = c.parentElement.getBoundingClientRect(), r = c.getBoundingClientRect();
  tip.innerHTML = `<b>${t}</b><span><i style="background:var(--fg)"></i>Joined<em>${fmt(+j)}</em></span><span><i style="background:var(--land)"></i>Invited<em>${fmt(+i)}</em></span><span><i style="background:color-mix(in srgb,var(--fg) 22%,transparent)"></i>Activated<em>${fmt(+a)}</em></span><span class="nt">Waitlist<em>${+net>0?'+':''}${fmt(+net)}</em></span>`;
  tip.hidden = false; const tw = tip.offsetWidth; let x = r.right - p.left + 8; if (x + tw > p.width) x = r.left - p.left - tw - 8; tip.style.left = Math.max(0,x) + 'px'; });

/* ── waitlist: the people, not a projection. Next in line = who batch 14 would invite; Just joined = live. ── */
const WAIT_NEXT = [
  ['M','T','Redlands',"Poster · Rosa’s Panadería",'12 Sep'],['J','O','San Bernardino','Poster · Mesa Laundry','12 Sep'],
  ['A','R','Redlands','Website · /join','13 Sep'],['K','W','Riverside','Poster · Citrus Bowl Café','13 Sep'],
  ['L','H','Redlands','Poster · Uptown Barber','13 Sep'],['S','N','Colton','Social · Instagram','14 Sep']];
const WAIT_NEW = [
  ['D','P','San Bernardino','Poster · Mesa Laundry',2],['T','B','Riverside','Search',11],['G','K','Redlands','Poster · Uptown Barber',19],
  ['R','A','Redlands',"Poster · Rosa’s Panadería",34],['E','V','Fontana','Social · TikTok',52],['N','C','Redlands','Website · /join',71]];
const LIVE_POOL = [['B','S','Highland','Poster · Highland Hardware'],['I','M','Redlands','Poster · State St. Books'],['F','L','San Bernardino','Social · Instagram'],['C','J','Rialto','Search']];
let wlTimer = null, wlCount = 1500;
const mask = (f,l) => `${f}<span class="msk">•••••</span> ${l}.`;
const daysSince = d => { const [dd,mm] = d.split(' '); const dt = new Date(2026, mm==='Sep'?8:9, +dd); return Math.round((dayDate(TODAY) - dt)/864e5); };
const ago = m => m < 60 ? `${m} min ago` : `${Math.floor(m/60)}h ago`;
function renderWl(){
  const tab = S.wl || 'next';
  const rows = tab==='next'
    ? WAIT_NEXT.slice(0,5).map((r,i)=>{ const w = daysSince(r[4]); return `<div class="wr"><span class="wr-n">${i+1}</span><span class="wr-m"><b>${mask(r[0],r[1])}</b><span>${r[2]} · ${r[3]}</span></span><span class="wr-r"><b>${w} days</b><span class="wr-bar"><i style="width:${Math.min(100,w/60*100)}%"></i><s style="left:${24/60*100}%"></s></span></span></div>`; }).join('')
    : WAIT_NEW.slice(0,5).map((r,i)=>`<div class="wr nn ${r.isNew?'fresh':''}"><span class="wr-m"><b>${mask(r[0],r[1])}</b><span>${r[2]} · ${r[3]}</span></span><span class="wr-r"><b class="t">${ago(r[4])}</b><span class="wr-pos">#${fmt(wlCount - i)} in line</span></span></div>`).join('');
  document.getElementById('wl').innerHTML = `
    <div class="wl-sub"><div class="seg sm" role="group" aria-label="Waitlist view"><button data-wl="next" aria-pressed="${tab==='next'}">Next in line</button><button data-wl="new" aria-pressed="${tab==='new'}">Just joined</button></div>
      <span class="wl-note">${tab==='next' ? 'Batch 14 takes 25' : '<span class="dot" style="color:var(--settled)"></span> Live'}</span></div>
    <div class="wl-list">${rows}</div>
    ${tab==='next' ? `<div class="wl-key"><span class="wr-bar"><i style="width:40%"></i><s style="left:40%"></s></span>Waited, against the 24-day median</div>` : `<div class="wl-key">Names stay masked until you open someone in Members</div>`}
    <button class="foot" data-go="members">${tab==='next' ? 'Plan batch 14 in Members' : `See all ${fmt(wlCount)} in Members`} <span>→</span></button>`;
  clearInterval(wlTimer);
  if (tab==='new') wlTimer = setInterval(()=>{ const p = LIVE_POOL[(wlCount-1500) % LIVE_POOL.length]; WAIT_NEW.forEach(r=>{ r[4] += 1; r.isNew = false; }); const n = [p[0],p[1],p[2],p[3],0]; n.isNew = true; WAIT_NEW.unshift(n); WAIT_NEW.length = 6; wlCount++; document.querySelector('#wlh .r .lbl').textContent = `${fmt(wlCount)} waiting · 24-day median`; renderWl(); }, 9000);
}
function renderMoves(){
  // each move: what to do, the evidence drawn as two bars, and what it should be worth
  const bars = (a, b, la, lb, max, fa) => `<div class="mv-ev"><div><span>${la}</span><b>${fa(a)}</b></div><i class="mv-b"><i style="width:${a/max*100}%"></i></i><div><span>${lb}</span><b>${fa(b)}</b></div><i class="mv-b q"><i style="width:${b/max*100}%"></i></i></div>`;
  const M = [
    {k:'Swap a design', imp:'≈ +38 joins a month', t:'Redlands Tire & Lube', m:'Lowest join rate of the top shops, on decent traffic.',
     ev: bars(12.0, 24.9, 'This shop, design C', 'Design A average', 30, v=>v.toFixed(1)+'%'), go:'Plan the swap in Field'},
    {k:'Add posters', imp:'≈ +60 joins a month', t:'Riverside', m:'Each poster there pulls more visits than anywhere else.',
     ev: bars(512, 357, 'Visits per poster', 'All-city average', 600, v=>fmt(v)), go:'Add to the Field route'},
    {k:'Raise the invite pace', imp:'Waitlist stops growing', t:'Invite 300+ a week', m:'Joins outrun invites 6.4 to 1, so the wait keeps getting longer.',
     ev: bars(318, 50, 'Joins a week', 'Invites a week', 360, v=>fmt(v)), go:'Plan batch 14 in Members'}];
  document.getElementById('moves').innerHTML = `<div class="cell s12"><div class="hd"><h2>Next moves</h2><div class="r"><span class="lbl">Worked out from the numbers above</span></div></div>
    <div class="mv-g">${M.map(m=>`<div class="mv"><div class="mv-h"><span class="lbl">${m.k}</span><span class="chip ok">${m.imp}</span></div><b class="mv-t">${m.t}</b><span class="mv-m">${m.m}</span>${m.ev}<button class="btn mv-go">${m.go} →</button></div>`).join('')}</div></div>`;
}

function render(){
  document.querySelectorAll('.gtabs [data-tab]').forEach(b=>b.setAttribute('aria-current', b.dataset.tab===S.tab?'page':'false'));
  ['ov','tf','cp','ch','ap'].forEach(id=>{ const e = document.getElementById(id); if (e) e.hidden = !(id==='ov'&&S.tab==='overview' || id==='tf'&&S.tab==='traffic' || id==='cp'&&S.tab==='campaigns' || id==='ch'&&S.tab==='cohorts' || id==='ap'&&S.tab==='apps'); });
  if (S.tab!=='campaigns' && typeof CS!=='undefined' && CS.open){ CS.open = null; renderCampPanel(); }
  renderCtl(); renderSheet();
  if (S.tab==='overview'){ const T = totals(); renderHdr(T); renderFunnel(T); renderBk(); renderTrend(); }
  else if (S.tab==='traffic') renderTraffic();
  else if (S.tab==='campaigns') renderCampaigns();
  else if (S.tab==='cohorts') renderCohorts();
  else if (S.tab==='apps') renderApps();
  else { const nm = {campaigns:'Campaigns',cohorts:'Cohorts',apps:'Apps'}[S.tab]; document.getElementById('hdr').innerHTML = `<span class="when"><span class="dot"></span>Growth · ${nm}</span><p class="brief">${nm} is next. <span class="q">We're designing one tab at a time.</span></p>`; document.getElementById('tp').innerHTML = `<div class="bento"><div class="cell s12"><div class="bk-empty">${nm} hasn't been designed yet.</div></div></div>`; }
}
function setRange(r, key){ S.range = r.slice(); S.per = key || (PRESETS.find(p=>p[2][0]===r[0]&&p[2][1]===r[1])||[])[0] || 'custom'; S.pick = null; S.open = null; }
document.addEventListener('click', e => {
  if (e.target.id==='cscrim'){ CS.open = null; return renderCampaigns(); }
  const t = e.target.closest('button,[data-row],[data-row-src],[data-city],[data-camp],th[data-csort],a,input,[data-sheetclose]');
  if (!t){ if (S.open){ S.open=null; S.pick=null; renderCtl(); } return; }
  if (t.dataset.per){ const p = PRESETS.find(p=>p[0]===t.dataset.per); setRange([Math.max(0,p[2][0]),p[2][1]], p[0]); if (S.sheet) S.sheet = null; return render(); }
  if (t.hasAttribute('data-custom')){ S.open = S.open==='custom' ? null : 'custom'; S.pick = null; S.cal = 1; return renderCtl(); }
  if (t.dataset.quick){ setRange(t.dataset.quick.split(',').map(Number)); if (S.sheet) S.sheet=null; return render(); }
  if (t.dataset.calnav){ S.cal = Math.max(0, Math.min(1, S.cal + +t.dataset.calnav)); return S.sheet ? renderSheet() : renderCtl(); }
  if (t.dataset.day!==undefined){ const d = +t.dataset.day; S.pick = !S.pick || S.pick.length===2 ? [d] : [Math.min(S.pick[0],d), Math.max(S.pick[0],d)]; return S.sheet ? renderSheet() : renderCtl(); }
  if (t.hasAttribute('data-calapply')){ if (S.pick && S.pick.length===2) setRange(S.pick); return render(); }
  if (t.hasAttribute('data-calcancel')){ S.open = null; S.pick = null; return renderCtl(); }
  if (t.hasAttribute('data-sheetclose')){ if (S.sheet==='period' && S.pick && S.pick.length===2) setRange(S.pick); S.sheet = null; S.pick = null; return render(); }
  if (t.dataset.sheet){ S.sheet = t.dataset.sheet; S.cal = 1; S.pick = null; return renderSheet(); }
  if (t.dataset.tab){ S.tab = t.dataset.tab; window.scrollTo({top:0}); return render(); }
  if (t.dataset.cmetric){ CHS.metric = t.dataset.cmetric; return renderCohorts(); }
  if (t.dataset.cjump){ document.getElementById(t.dataset.cjump).scrollIntoView({behavior:'smooth',block:'center'}); return; }
  if (t.dataset.camp){ CS.open = t.dataset.camp; return renderCampaigns(); }
  if (t.hasAttribute('data-newcamp')){ CS.open = 'new'; return renderCampPanel(); }
  if (t.hasAttribute('data-cclose')){ CS.open = null; return renderCampaigns(); }
  if (t.dataset.csort){ CS.sort = t.dataset.csort; return renderCampaigns(); }
  if (t.dataset.cfilter){ const c = CAMPS.find(x=>x.id===t.dataset.cfilter); Object.values(S.F).forEach(s=>s.clear());
    if (c.type==='Posters'){ const d = D.design.rows.find(r=>r.n.startsWith(c.sub.slice(-1))); S.F.design.add(d.n); } else S.F.source.add(c.type==='Referrals'?'Direct':'Social');
    CS.open = null; return render(); }
  if (t.dataset.gran){ S.gran = t.dataset.gran; return S.tab==='traffic' ? renderTraffic() : S.tab==='apps' ? renderApps() : renderTrend(); }
  if (t.dataset.afeat){ AS.feat = t.dataset.afeat; return renderApps(); }
  if (t.dataset.ajump){ document.getElementById(t.dataset.ajump).scrollIntoView({behavior:'smooth',block:'center'}); return; }
  if (t.dataset.prop){ TS.prop = t.dataset.prop; return renderTraffic(); }
  if (t.dataset.iso!==undefined){ TS.iso = t.dataset.iso && TS.iso!==t.dataset.iso ? t.dataset.iso : null; return renderTraffic(); }
  if (t.dataset.twist){ const n = t.dataset.twist; TS.open.has(n) ? TS.open.delete(n) : TS.open.add(n); return renderTraffic(); }
  if (t.dataset.pgsort){ TS.pgSort = t.dataset.pgsort; return renderTraffic(); }
  if (t.hasAttribute('data-heatjump')){ document.getElementById('heat').scrollIntoView({behavior:'smooth', block:'center'}); return; }
  if (t.dataset.city){ S.F.city.clear(); S.F.city.add(t.dataset.city); return render(); }
  if (t.dataset.rowSrc){ S.F.source.clear(); S.F.source.add(t.dataset.rowSrc); return render(); }
  if (t.dataset.wl){ S.wl = t.dataset.wl; return renderWl(); }
  if (t.hasAttribute('data-cmp')){ S.cmp = !S.cmp; return render(); }
  if (t.dataset.fopen){ S.open = S.open===t.dataset.fopen ? null : t.dataset.fopen; return renderCtl(); }
  if (t.dataset.fclear){ S.F[t.dataset.fclear].clear(); return render(); }
  if (t.hasAttribute('data-fclose')){ S.open = null; return renderCtl(); }
  if (t.hasAttribute('data-fclearall')){ Object.values(S.F).forEach(s=>s.clear()); return render(); }
  if (t.dataset.fv){ const set = S.F[t.dataset.fv]; t.checked ? set.add(t.value) : set.delete(t.value); const o = S.open; render(); S.open = o; renderCtl(); return; }
  if (t.dataset.step){ S.step = +t.dataset.step; return render(); }
  if (t.dataset.dim){ S.dim = t.dataset.dim; S.sort='in'; S.dir=-1; return renderBk(); }
  if (t.dataset.view){ S.view = t.dataset.view; return renderBk(); }
  if (t.dataset.row){ const set = S.F[S.dim]; if (!set) return; set.clear(); set.add(t.dataset.row); return render(); }
  if (t.hasAttribute('data-copy')){ t.classList.add('done'); const o = t.innerHTML; t.innerHTML = '✓ Copied'; setTimeout(()=>{ t.classList.remove('done'); t.innerHTML = o; }, 1400); return; }
});
document.addEventListener('click', e => { if (e.target.closest('th[data-pgsort]')){ TS.pgSort = e.target.closest('th').dataset.pgsort; return renderTraffic(); } const th = e.target.closest('th[data-sort]'); if (!th) return; const k = th.dataset.sort; if (S.sort===k) S.dir *= -1; else { S.sort=k; S.dir=-1; } renderBk(); });
document.addEventListener('keydown', e => { if (e.key==='Escape' && typeof CS!=='undefined' && CS.open){ CS.open = null; renderCampaigns(); return; } if (e.key==='Escape'){ if (S.sheet){ S.sheet=null; renderSheet(); } else if (S.open){ S.open=null; S.pick=null; renderCtl(); } } });
window.addEventListener('scroll', () => { const c = document.getElementById('ctl'); c.classList.toggle('stuck', c.getBoundingClientRect().top <= 0.5); }, {passive:true});
const hs = location.hash.slice(1).split(',');
if (hs.includes('chart')) S.view='chart'; if (hs.includes('shop')) S.dim='shop'; if (hs.includes('f')) S.F.city.add('Redlands');
if (hs.includes('7d')) setRange([TODAY-6,TODAY],'7d'); if (hs.includes('today')) setRange([TODAY,TODAY],'today'); if (hs.includes('all')) setRange([0,TODAY],'all'); if (hs.includes('cal')) S.open='custom';
if (hs.includes('traffic')) S.tab='traffic'; if (hs.includes('campaigns')) S.tab='campaigns'; if (hs.includes('cohorts')) S.tab='cohorts'; if (hs.includes('apps')) S.tab='apps'; if (hs.includes('cpanel')) CS.open='pa'; if (hs.includes('newcamp')) CS.open='new'; if (hs.includes('sheetf')) S.sheet='filters'; if (hs.includes('sheetp')) S.sheet='period';
render(); renderWl(); renderMoves();

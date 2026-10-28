
/* ══ Merchants: every shop from first visit to monthly payout ════════════════════════════════
   Overview · Pipeline (prospect → signing, plus shop enquiries) · Partners (signed and transacting) · Payouts · Devices.
   One shop record opens from anywhere. It shares Field's routes, visits and leads: planning or logging a visit here lands in Field.
   Reps edit their own leads and see the rest read-only. Money changes (caps, terms, payouts) need a second person. */
const X = { kst:'prospect', tab:'overview', open:null, pf:'all', bq:'', note:{}, enqSt:{}, approvals:[] };
const ICO = {
  x:'<svg class="i" viewBox="0 0 20 20"><path d="M5 5l10 10M15 5 5 15"/></svg>',
  chk:'<svg class="i" viewBox="0 0 20 20"><path d="M4.5 10.5l3.5 3.5 7.5-8"/></svg>',
  scan:'<svg class="i" viewBox="0 0 20 20"><path d="M3 7V3h4M13 3h4v4M17 13v4h-4M7 17H3v-4M6 10h8"/></svg>',
  warn:'<svg class="i" viewBox="0 0 20 20" style="width:15px;height:15px;flex:none"><path d="M10 3l8 14H2z"/><path d="M10 8v4M10 14v1"/></svg>' };
const sevCol = s => `var(--${s==='line'?'line':s})`;
const life = p => { const d = daysTo(p.swap); return { pct: Math.min(1, Math.max(0, (60 - d)/60)), d }; };
const stopDone = s => s.tasks.every(t=>t.done);
const curStop = () => STOPS.find(s=>!stopDone(s));
const PHONE = () => matchMedia('(max-width:760px)').matches;
const F = { get tab(){ return 'merchants'; }, set tab(v){ if (v && v!=='merchants') toast(`Opens Field · ${v[0].toUpperCase()+v.slice(1)}`); }, scan:null, poster:null };
function toast(t){ let el = document.getElementById('toast'); if (!el){ el = document.createElement('div'); el.id='toast'; document.body.appendChild(el); } el.innerHTML = t; el.classList.add('on'); clearTimeout(el._t); el._t = setTimeout(()=>el.classList.remove('on'), t.includes('data-xundo') ? 6000 : 2800); }
const STG5 = [['prospect','Prospect'],['talking','Talking'],['signing','Signing'],['signed','Signed'],['transacting','Transacting']];
const STGN = Object.fromEntries(STG5);
const STGCOL = { prospect:'color-mix(in srgb,var(--fg) 14%,transparent)', talking:'color-mix(in srgb,var(--fg) 34%,transparent)', signing:'var(--live)', signed:'color-mix(in srgb,var(--fg) 58%,transparent)', transacting:'var(--fg)' };
const ini = n => n.replace(/[’'.&]/g,'').split(' ').filter(Boolean).map(w=>w[0]).slice(0,2).join('').toUpperCase();
const mine = m => m.owner===R.me, canEditM = m => isAdmin() || mine(m);
const whose = m => m.owner===R.me ? 'your lead' : `${firstName(m.owner)}’s`;
const dueTxtM = m => m.due==null ? '' : m.due<0 ? `${-m.due}d overdue` : m.due===0 ? 'today' : m.due===1 ? 'tomorrow' : fmtWD(dayT(m.due)).slice(0,3);
const routeFor = m => { const l = LEADS.find(x=>x.shop===m.name); if (!l) return null; const x = POOL.find(p=>p.kind==='merchant' && p.shop===m.name); return x ? routeOf(x.id) : null; };
const devFix = m => STOPS.find(s=>s.name===m.name && s.tasks.some(t=>t.kind==='device'));
const lastTxt = d => d==null ? 'Never visited' : d===0 ? 'Visited today' : `Last visit ${d}d ago`;
const IN_TALKS = () => MS.filter(m=>m.stage==='talking');
const sumVal = a => a.reduce((s,m)=>s+(m.val||0),0);
/* a lead in Field for any shop, so Plan a visit and Log a visit work for partners too */
function ensureLead(m){ let l = LEADS.find(x=>x.shop===m.name);
  if (!l){ l = { shop:m.name, city:m.city, stage: m.stage==='transacting' ? 'signed' : m.stage, owner:m.owner, last:m.last, next: m.next || (m.stage==='signed' ? 'Pitch card payments' : 'Check in'), due: m.due, val:m.val||0 }; LEADS.push(l); }
  return l; }

/* ── header ── */
function renderHdr(){
  const tx = TXO.length, all = MS.filter(m=>['transacting','signing','signed'].includes(m.stage)).length, sg = MS.filter(m=>m.stage==='signing').length, sd = MS.filter(m=>m.stage==='signed').length;
  const oct = TXO.reduce((s,m)=>s+m.oct,0), sales = TXO.reduce((s,m)=>s+m.octN,0), lost = TXO.reduce((s,m)=>s+m.lost,0), orig = TXO.reduce((s,m)=>s+m.orig,0);
  const talks = IN_TALKS(), od = MS.filter(m=>m.due!=null && m.due<0 && ['prospect','talking','signing'].includes(m.stage));
  const S = {
    overview:`Uptown Barber signed today, the third founding shop. <a data-xopen="icw">Inland Cycle Works</a> signs next for seat 4 of 5.`,
    pipeline:`${talks.length} shops are talking, worth ${money(sumVal(talks)).replace('.00','')} a month in financed work. ${od.length ? `<a data-xopen="${od[0].id}">${od.length} follow-up${od.length===1?' is':'s are'} overdue</a>.` : 'No follow-ups are overdue.'}`,
    partners:`${tx} of ${all} partners take card payments. ${sd} host a poster but haven’t turned payments on.`,
    payouts:`Rosa’s NET-14 payout of $412.60 goes tomorrow. The monthly run of $9,510.65 is Mon 2 Nov and <a data-xtab="payouts">needs a second approval</a>.`,
    devices:`Two shops need a device visit. <a data-xopen="orange">Orange St. Laundromat</a> is on Marcus’s route today, and Citrus Bowl Café is stop 7.`
  }[X.tab];
  document.getElementById('hdr').innerHTML = `<span class="when"><span class="dot"></span>Merchants · Wed 21 Oct · Demo data</span><p class="brief">${S}</p>
    <div class="strip">
      <div class="sc"><span class="lbl">Transacting</span><div class="sc-v">${tx} <small>of ${all} partners</small></div><div class="mb"><i style="width:${tx/all*100}%"></i><i style="left:${tx/all*100}%;width:${sg/all*100}%;background:var(--live)"></i><span class="hroom" style="left:${(tx+sg)/all*100}%;right:0"></span></div><div class="sc-s">${sg} signing · ${sd} on posters only</div></div>
      <div class="sc"><span class="lbl">In talks</span><div class="sc-v">${talks.length} <small>${money(sumVal(talks)).replace('.00','')}/mo</small></div><div class="mb"><i style="width:${talks.length/MS.filter(m=>['prospect','talking','signing'].includes(m.stage)).length*100}%;background:color-mix(in srgb,var(--fg) 45%,transparent)"></i></div><div class="sc-s">${MS.filter(m=>m.stage==='prospect').length} prospects not visited yet</div></div>
      <div class="sc"><span class="lbl">Cleared · October</span><div class="sc-v">${money(oct).replace(/\.\d+$/,'')}<small class="ct">${money(oct).match(/\.\d+$/)[0]}</small></div><div class="mb"><i style="width:${7940/oct*100}%"></i><i style="left:${7940/oct*100}%;width:${(oct-7940)/oct*100}%;background:color-mix(in srgb,var(--fg) 40%,transparent)"></i></div><div class="sc-s">${sales} sales · loss ${(lost/orig*100).toFixed(1)}%</div></div>
      <div class="sc"><span class="lbl">Payouts · 14 days</span><div class="sc-v">$12,839<small class="ct">.25</small></div><div class="mb"><i style="width:3.2%;background:var(--underway)"></i><i style="left:3.2%;width:74%"></i><i style="left:77.2%;width:22.8%;background:color-mix(in srgb,var(--fg) 40%,transparent)"></i></div><div class="sc-s">$430.00 in $10 redemptions owed</div></div>
    </div>`;
}

/* ── the map: cities as tags with one square per shop, tied to their place ── */
const CK = { transacting:'var(--fg)', signing:'var(--live)', signed:'color-mix(in srgb,var(--fg) 45%,transparent)', talking:'color-mix(in srgb,var(--fg) 18%,transparent)', prospect:'color-mix(in srgb,var(--fg) 18%,transparent)' };
function cityList(){ const by = {}; MS.forEach(m=>{ (by[m.city] ||= []).push(m); });
  const order = {transacting:0, signing:1, signed:2, talking:3, prospect:4};
  return Object.entries(by).filter(([c])=>GEO[c]).map(([c,l])=>({ c, l:l.sort((a,b)=>order[a.stage]-order[b.stage] || (b.oct||0)-(a.oct||0)), tx:l.filter(m=>m.stage==='transacting').length, oct:l.reduce((s,m)=>s+(m.oct||0),0) }))
    .sort((a,b)=>b.tx-a.tx || b.l.length-a.l.length); }
/* the map fills its cell, so its shape follows the space it gets: beside the city list on desktop, full width above it on tablet and phone */
const corrSize = () => { const mv = document.getElementById('mv'), w = mv && mv.clientWidth ? mv.clientWidth - 2 : 1126, one = matchMedia('(max-width:1024px)').matches;
  return { w: one ? w : w - 320, h: PHONE() ? 340 : one ? 440 : 560 }; };
function corridor(){
  const C = cityList(), sz = corrSize(), m = mkMap(FULL, sz.w/sz.h); X.asp = sz.w/sz.h;
  const tag = c => `<span class="fsp mcity ${X.city===c.c?'now':''} ${c.tx?'':'minor'} ${!c.tx&&X.city!==c.c?'z':''}" data-xcity="${c.c}" style="${m.at(...GEO[c.c])}"><svg class="fsp-l" aria-hidden="true"><line x1="0" y1="0" x2="0" y2="0"/></svg><i class="fsp-d"></i>
    <b class="fsp-t"><span class="mc-h"><b>${c.c}</b><span>${c.tx}/${c.l.length}</span></span><span class="mc-q">${c.l.slice(0,18).map(s=>`<i style="background:${CK[s.stage]}" title="${s.name} · ${STGN[s.stage]}"></i>`).join('')}${c.l.length>18?`<em>+${c.l.length-18}</em>`:''}</span></b></span>`;
  const pins = C.map(tag).join(''), live = C.map(c=>{ const [la,lo] = GEO[c.c]; return { ll:[lo,la], html:tag(c).replace(/ style="[^"]*"/,'') }; });
  return fmSlot('corridor', { bounds:[[FULL[0],FULL[2]],[FULL[1],FULL[3]]], pad:30, pins:live }, areaMap(m, { pins, cls:'corr' }), 'corr');
}

/* ══ Overview ══ */
function renderOverview(){
  const C = cityList(), sel = X.city ? C.find(c=>c.c===X.city) : null;
  const side = sel ? `<div class="mo-c"><div class="mo-ch"><b>${sel.c}</b><button class="lnk3" data-xcity="">All cities</button></div>${sel.l.map(m=>`<button class="mo-r" data-xopen="${m.id}"><i style="background:${CK[m.stage]}"></i><span><b>${m.name}</b><span>${STGN[m.stage]}${m.oct?` · ${money(m.oct)} in Oct`:''}</span></span></button>`).join('')}</div>`
    : `<div class="mo-lh"><span class="lbl">City</span><span class="lbl">October</span><span class="lbl">Live</span></div>` + C.map(c=>`<button class="mo-r city ${c.tx?'':'zero'}" data-xcity="${c.c}"><b>${c.c}</b><span class="mo-o">${c.oct ? money(c.oct) : '–'}</span><span class="mo-n"><b>${c.tx}</b> of ${c.l.length}</span></button>`).join('');
  const map = `<div class="cell s12"><div class="hd"><h2>Where the shops are</h2><div class="r"><span class="lbl">${MS.length} shops in ${C.length} cities</span></div></div>
      <div class="mo"><div class="mo-m">${corridor()}</div><div class="mo-s">${side}</div></div>
      <div class="bk-ft"><span class="f-key"><i style="background:var(--fg)"></i>Transacting <i style="background:var(--live)"></i>Signing <i style="background:color-mix(in srgb,var(--fg) 45%,transparent)"></i>Posters only <i style="background:color-mix(in srgb,var(--fg) 18%,transparent)"></i>In the pipeline</span><span class="small quiet d-only">${X.city ? 'Click the city again to see them all' : 'Click a city to see its shops'}</span></div></div>`;
  /* needs you: the list rule from Home */
  const icw = MSBY.icw, tri = MS.find(m=>m.name==='Tri-City Transmission'), triR = routeFor(tri);
  const NEED = [
    ['underway', 'Sign Inland Cycle Works', 'Founding seat 4 of 5 · Kai', 'Due Mon', `<span class="who">${R.me==='kai'?'You’re':'Kai is'} on it</span><button class="lnk" data-xopen="icw">Open →</button>`],
    ...(X.approvals.includes('rosas-pay') ? [] : [['live', 'Approve Rosa’s payout · $412.60', 'NET-14 · proposed by Dana Ruiz · goes tomorrow', 'Tomorrow', `<span class="who">Needs a second person</span><button class="lnk" data-xtab="payouts">Review →</button>`]]),
    ['absent', 'Tri-City Transmission is 4 days overdue', 'Talk terms · wants NET-14 · Marcus’s lead', '4d', triR ? `<span class="who">On ${firstName(triR.who)}’s ${fmtWD(dayT(triR.d)).slice(0,3)} route</span>` : `<span class="who none">Not on a route</span><button class="lnk" data-xplan="${tri.id}">Add to Marcus’s route →</button>`],
    ['absent', 'Orange St. Laundromat’s Point is offline', 'Unplugged since 08:40', '08:40', `<span class="who">On Marcus’s route today · stop 4</span>`],
    ['line', `${ENQ.filter(e=>(X.enqSt[e.id]||e.st)==='new').length} new shop enquiries`, 'From useclear.org/shops and poster pages', 'Today', `<button class="lnk" data-xtab="pipeline" data-xjump="menq">Triage →</button>`] ];
  const need = `<div class="cell s5"><div class="hd"><h2>Needs you</h2><div class="r"><span class="lbl">${NEED.length} things</span></div></div>
      <div class="al">${NEED.map(([sv,t,m,age,own])=>`<div class="alr"><div class="al-m"><div class="al-t"><i class="sv" style="background:${sevCol(sv)}"></i><b>${t}</b><span class="age">${age}</span></div><span class="m">${m}</span></div><div class="own ${own.includes('none')?'none':''}">${own}</div></div>`).join('')}</div>
      <div class="bk-ft"><span>Money and terms need a second person</span><button data-xgo="home">All of it on Home →</button></div></div>`;
  /* pipeline at a glance, with how many move from each stage to the next (last 90 days) */
  const CONV = [['62%','9 days'],['38%','18 days'],['91%','4 days'],['41%','23 days']];
  const st = STG5.map(([k,t])=>[k,t,MS.filter(m=>m.stage===k)]), mx = Math.max(...st.map(x=>x[2].length));
  const pipe = `<div class="cell s7"><div class="hd"><h2>From first visit to payments</h2><div class="r"><span class="lbl">${MS.length} shops · 90-day rates</span></div></div>
      <div class="mp">${st.map(([k,t,a],i)=>`${i ? `<div class="mp-c"><span></span><span class="mp-ca"><svg viewBox="0 0 10 10" aria-hidden="true"><path d="M5 1v8M2 6l3 3 3-3"/></svg><b>${CONV[i-1][0]}</b> move on · usually in ${CONV[i-1][1]}</span></div>` : ''}<button class="mp-r" data-xtab="${['transacting','signed'].includes(k)?'partners':'pipeline'}"><span class="mp-k"><i style="background:${STGCOL[k]}"></i>${t}</span><span class="mp-b"><i style="width:${a.length/mx*100}%;background:${STGCOL[k]}"></i></span><b>${a.length}</b>
        <span class="mp-s">${k==='prospect' ? 'Not visited yet' : k==='talking' ? money(sumVal(a)).replace('.00','')+' a month' : k==='signing' ? 'Founding seat 4 of 5' : k==='signed' ? 'Posters and $10 only' : money(a.reduce((s,m)=>s+m.oct,0))+' in Oct'}</span></button>`).join('')}</div>
      <div class="bk-ft"><span>17 shops host a poster but don’t take card payments yet</span><button data-xtab="partners" data-xpf="signed">Pitch them →</button></div></div>`;
  /* founding seats */
  const seats = [['Rosa’s Panadería','filled','Aug','rosas'],['Mesa Laundry','filled','Sep','mesa'],['Uptown Barber','filled','Today','uptown'],['Inland Cycle Works','signing','Signing','icw'],['','open','Open','']];
  const fs = `<div class="cell s5"><div class="hd"><h2>Founding seats</h2><div class="r"><span class="lbl">Capped at five</span></div></div>
      <div class="fsx">${seats.map(([n,s,w,id],i)=>`<button class="fsx-s ${s}" ${id?`data-xopen="${id}"`:'disabled'}><span class="fsx-n">${i+1}</span><b>${n||'Open seat'}</b><span>${w}</span></button>`).join('')}</div>
      <div class="led fsx-l"><div><span>Fee, for life</span><b>2.0%, not 2.5%</b></div><div><span>First 20 sales</span><b>No fee</b></div></div>
      <div class="bk-ft"><span>3 of 5 filled · one left after Inland Cycle Works</span><span></span></div></div>`;
  /* who's clearing the volume */
  const top = TXO.slice().sort((a,b)=>b.oct-a.oct), omx = top[0].oct;
  const vol = `<div class="cell s7"><div class="hd"><h2>Cleared by shop</h2><div class="r"><span class="lbl">October so far</span></div></div>
      <div class="mv">${top.slice(0,7).map(m=>`<button class="mv-r" data-xopen="${m.id}"><span>${m.name}</span><span class="mv-b"><i style="width:${m.oct/omx*100}%;background:${m.cap>=300?'var(--fg)':'var(--land)'}"></i></span><b>${money(m.oct)}</b></button>`).join('')}
        <div class="mv-r rest"><span>${top.length-7} more shops</span><span class="mv-b"><i style="width:${top.slice(7).reduce((s,m)=>s+m.oct,0)/omx*100}%;background:var(--line)"></i></span><b>${money(top.slice(7).reduce((s,m)=>s+m.oct,0))}</b></div></div>
      <div class="bk-ft"><span class="f-key"><i style="background:var(--fg)"></i>Financing shops, cap $300+ <i style="background:var(--land)"></i>Everyday shops</span><button data-xtab="partners">All partners →</button></div></div>`;
  const caps = TXO.filter(m=>m.hits>0).sort((a,b)=>b.hits-a.hits);
  const cp = `<div class="cell s5"><div class="hd"><h2>Caps to review</h2><div class="r"><span class="lbl">Hit their cap this week</span></div></div>
      <div class="mcl">${caps.map(m=>{ const r = capRaise(m); return `<button class="mcl-r" data-xopen="${m.id}"><span class="mcl-k"><b>${m.name}</b><span>${money(m.cap).replace('.00','')} cap · ${(m.lost/m.orig*100).toFixed(1)}% loss on ${m.orig}</span></span><span class="mcl-h">${[0,1,2].map(i=>`<i class="${i<m.hits?'on':''}"></i>`).join('')}</span>${r==='pending'?'<span class="fst tlv">Pending</span>':r==='raise'?'<span class="fst ok">Raise</span>':'<span class="fst warn2">Hold</span>'}</button>`; }).join('')}</div>
      <div class="bk-ft"><span>Raise on results: hit the cap with no losses</span><span></span></div></div>`;
  document.getElementById('mv').innerHTML = `
    <section class="band" style="margin-top:0"><div class="bento">${map}</div></section>
    <section class="band"><div class="bento">${pipe}${need}</div></section>
    <section class="band"><div class="bento">${vol}${cp}</div></section>
    <section class="band"><div class="bento">${fs.replace('cell s5','cell s12')}</div></section>`;
}

/* ══ Pipeline ══ */
const KCOL = [['prospect','Prospect','Not visited yet'],['talking','Talking','Visits, demos, calls'],['signing','Signing','Agreement out'],['signed','Signed','Posters and $10 only']];
const KMOVE = { prospect:'Moved back to Prospect', talking:'Moved to Talking', signing:'Agreement sent · moved to Signing', signed:'Agreement back · marked signed' };
function kTile(m){
  const rt = routeFor(m), od = m.due!=null && m.due<0, can = canEditM(m), sg = m.stage==='signed';
  const due = m.due==null ? '' : `<span class="kt-due ${od?'late':m.due<=1?'soon':''}">${od ? `${-m.due}d overdue` : dueTxtM(m)[0].toUpperCase()+dueTxtM(m).slice(1)}</span>`;
  const where = rt ? `<span class="kt-rt">${rt.who===R.me?'Your':firstName(rt.who)+'’s'} ${fmtWD(dayT(rt.d)).slice(0,3)} route</span>` : `<span>${m.last==null ? 'Never visited' : m.last===0 ? 'Visited today' : m.last+'d since a visit'}</span>`;
  return `<button class="kt ${od?'late':''} ${mine(m)?'me':''} ${can?'can':''} ${X.flash===m.id?'flash':''}" data-xopen="${m.id}" ${can?`data-kt="${m.id}"`:''} aria-label="${m.name}, ${STGN[m.stage]}${can?', drag to move':''}">
    <span class="kt-t"><b>${m.name}</b>${sg && m.owed ? `<span class="kt-v">${money(m.owed)}<small> owed</small></span>` : m.founding ? '<span class="kt-f">Founding 4/5</span>' : ''}</span>
    <span class="kt-m">${m.kind} · ${m.city}${sg ? ` · ${m.posters} poster${m.posters===1?'':'s'}` : ''}</span>
    ${m.val ? `<span class="kt-bw"><span class="kt-bar"><i style="width:${Math.min(100,m.val/12000*100).toFixed(0)}%"></i></span><span class="kt-v">${money(m.val).replace('.00','')}<small>/mo</small></span></span>` : ''}
    <span class="kt-n"><span>${m.next || 'No next step'}</span>${due}</span>
    <span class="kt-f2"><span class="av sm ${mine(m)?'':'dim'}">${TEAM[m.owner].ini}</span>${where}${can?'<svg class="kt-g" viewBox="0 0 10 16" aria-hidden="true"><circle cx="2.5" cy="3" r="1.3"/><circle cx="7.5" cy="3" r="1.3"/><circle cx="2.5" cy="8" r="1.3"/><circle cx="7.5" cy="8" r="1.3"/><circle cx="2.5" cy="13" r="1.3"/><circle cx="7.5" cy="13" r="1.3"/></svg>':''}</span></button>`; }
function renderPipeline(){
  const me = R.me;
  const q = X.bq.trim().toLowerCase(), hit = m => !q || m.name.toLowerCase().includes(q) || m.city.toLowerCase().includes(q) || m.kind.toLowerCase().includes(q);
  const ord = (x,y) => (X.seq && X.seq[x.id]!=null && X.seq[y.id]!=null) ? X.seq[x.id]-X.seq[y.id] : (x.due??99)-(y.due??99) || (y.val||0)-(x.val||0) || (y.posters||0)-(x.posters||0);
  const sub = (k,a) => k==='prospect'||k==='talking' ? `${money(sumVal(a)).replace('.00','')} a month` : k==='signing' ? (a.some(m=>m.founding)?'Founding seat 4 of 5':`${a.length} agreement${a.length===1?'':'s'} out`) : 'Posters and $10 only';
  const board = `<div class="cell s12"><div class="hd"><h2>Pipeline</h2><div class="r"><label class="msearch sm"><svg class="i" viewBox="0 0 20 20"><circle cx="9" cy="9" r="5"/><path d="M13 13l4 4"/></svg><input id="xbq" placeholder="Find a shop" value="${X.bq.replace(/"/g,'&quot;')}"></label><button class="btn p sm-b" data-xadd>+ Prospect</button></div></div>
      <div class="kb-tabs" id="kbtabs" role="tablist" aria-label="Stage">${KCOL.map(([k,t])=>`<button class="kb-tab ${X.kst===k?'on':''}" data-ktab="${k}" role="tab" aria-selected="${X.kst===k}"><b>${MS.filter(m=>m.stage===k && hit(m)).length}</b><span>${t}</span></button>`).join('')}</div>
      <div class="kb" id="kb">${KCOL.map(([k,t])=>{ const all = MS.filter(m=>m.stage===k && hit(m)).sort(ord), cap = k==='signed' && !X.allSigned && !q ? 6 : 99, a = all.slice(0,cap);
        return `<section class="kb-c ${X.kst===k?'on':''}" data-kcol="${k}"><header class="kb-h"><span><b>${t}</b><span>${sub(k,all)}</span></span><b class="kb-k">${all.length}</b><span class="kb-hint">${all.length} shop${all.length===1?'':'s'}</span></header>
          <div class="kb-b">${a.map(kTile).join('')}${all.length>cap ? `<button class="kb-more" data-xsigned>Show ${all.length-cap} more</button>` : k==='signed' && X.allSigned && !q ? '<button class="kb-more" data-xsigned>Show fewer</button>' : ''}${all.length ? '' : `<div class="kb-e">${q ? 'No matches' : 'Drop a shop here'}</div>`}</div></section>`; }).join('')}</div>
      <div class="bk-ft"><span><span class="kb-fd">${isAdmin() ? 'Drag a shop to move it. Every move is logged and can be undone.' : 'Drag your own leads to move them. Every move is logged.'}</span><span class="kb-fm">Hold a shop, then drop it on a stage above</span></span><button data-xtab="partners">Partners →</button></div></div>`;
  /* shop enquiries */
  const es = e => X.enqSt[e.id] || e.st;
  const enq = `<div class="cell s7" id="menq"><div class="hd"><h2>Shop enquiries</h2><div class="r"><span class="lbl">${ENQ.filter(e=>es(e)==='new').length} new</span></div></div>
      <div class="me-l">${ENQ.map(e=>{ const s = es(e), shown = X.reveal && X.reveal.has(e.id);
        return `<div class="me-r ${s}"><div class="me-t"><i class="sv" style="background:${s==='new'?'var(--live)':'var(--line)'}"></i><b class="${shown?'':'msk'}">${shown?e.name:e.mask}</b><span class="age">${e.when}</span></div>
          <span class="me-m">${e.kind} · ${e.city} · ${e.from}</span><p class="me-q">“${e.msg}”</p>
          <div class="me-a">${s==='new' ? `${e.known ? `<span class="me-k">Already a partner · posters only</span><button class="lnk" data-xopen="${e.known}">Open the shop →</button>` : `<button class="btn sm-b p" data-xenq="add|${e.id}">Add to pipeline</button><button class="btn sm-b" data-xenq="reply|${e.id}">Reply</button><button class="lnk3" data-xenq="no|${e.id}">Not a fit</button>`}${!shown?`<button class="lnk3 me-show" data-xreveal="${e.id}">Show name</button>`:''}`
            : s==='added' ? '<span class="ok me-k">Added to the pipeline</span>' : s==='replied' ? '<span class="me-k quiet">Replied</span>' : `<span class="me-k quiet">Not a fit${e.why?' · '+e.why:''}</span>`}</div></div>`; }).join('')}</div>
      <div class="bk-ft"><span>From useclear.org/shops · names masked, showing one is logged</span><span></span></div></div>`;
  /* where leads come from, and who owns them */
  const open = MS.filter(m=>['prospect','talking','signing'].includes(m.stage)), srcs = Object.keys(SRC).map(k=>[k, open.filter(m=>m.source===k)]), smx = Math.max(...srcs.map(x=>x[1].length),1);
  const own = Object.entries(TEAM).filter(([,t])=>t.field).map(([k,t])=>[k,t,open.filter(m=>m.owner===k)]);
  const src = `<div class="cell s5"><div class="hd"><h2>Where leads come from</h2><div class="r"><span class="lbl">${open.length} open</span></div></div>
      <div class="ms">${srcs.map(([k,a])=>`<div class="ms-r"><span>${SRC[k]}</span><span class="ms-b"><i style="width:${a.length/smx*100}%"></i></span><b>${a.length}</b><span class="ms-s">${a.filter(m=>m.stage==='talking'||m.stage==='signing').length} talking</span></div>`).join('')}</div>
      <div class="ms ms2"><span class="lbl">Who owns them</span>${own.map(([k,t,a])=>`<div class="ms-r"><span class="ms-p"><span class="av sm">${t.ini}</span>${k===R.me?'You':t.n}</span><span class="ms-b"><i style="width:${a.length/open.length*100}%;background:color-mix(in srgb,var(--fg) 55%,transparent)"></i></span><b>${a.length}</b><span class="ms-s">${money(sumVal(a)).replace('.00','')}/mo</span></div>`).join('')}</div>
      <div class="bk-ft"><span>Field walk-ins become prospects straight from the phone</span><span></span></div></div>`;
  document.getElementById('mv').innerHTML = `
    <section class="band" style="margin-top:0"><div class="bento">${board}</div></section>
    <section class="band"><div class="bento">${enq}${src}</div></section>`;
}

/* ══ Partners ══ */
function renderPartners(){
  const P = MS.filter(m=>['transacting','signing','signed'].includes(m.stage));
  const terms = [['NET-30',TXO.filter(m=>m.terms==='NET-30').length,'var(--fg)'],['NET-14',TXO.filter(m=>m.terms==='NET-14').length,'var(--land)']];
  const fees = [['2.5%',TXO.filter(m=>m.fee===2.5).length,'var(--fg)'],['2.0% founding',TXO.filter(m=>m.fee===2).length,'var(--land)'],['Free, first 20',TXO.filter(m=>m.fee===0).length,'var(--line)']];
  const caps = [100,120,150,300,500].map(c=>[c, TXO.filter(m=>m.cap===c).length]), cmx = Math.max(...caps.map(x=>x[1]));
  const mix = (a) => `<div class="mb2">${a.map(([k,v,c])=>`<i style="flex:${v};background:${c}"></i>`).join('')}</div><div class="mk2">${a.map(([k,v,c])=>`<span><i style="background:${c}"></i>${k} <b>${v}</b></span>`).join('')}</div>`;
  const sum = `<div class="cell s4"><div class="hd"><h2>Terms</h2><div class="r"><span class="lbl">${TXO.length} transacting</span></div></div><div class="mt"><div class="m-big">${terms[0][1]} <small>of ${TXO.length} on NET-30</small></div>${mix(terms)}</div><div class="bk-ft"><span>NET-14 needs 30-day customer terms</span><span></span></div></div>
    <div class="cell s4"><div class="hd"><h2>Fees</h2><div class="r"><span class="lbl">Per sale</span></div></div><div class="mt"><div class="m-big">2.5% <small>standard</small></div>${mix(fees)}</div><div class="bk-ft"><span>Taken out of each payout</span><span></span></div></div>
    <div class="cell s4"><div class="hd"><h2>Caps</h2><div class="r"><span class="lbl">Per sale</span></div></div><div class="mt"><div class="mcap">${caps.map(([c,n])=>`<div><span>${n}</span><i style="height:${n/cmx*100}%"></i><s>$${c}</s></div>`).join('')}</div></div><div class="bk-ft"><span>Raised after 15 clean sales</span><span></span></div></div>`;
  const F2 = { all:['All',P], transacting:['Transacting',TXO], signed:['Posters only',P.filter(m=>m.stage==='signed'||m.stage==='signing')], founding:['Founding',P.filter(m=>m.founding)] };
  const all = F2[X.pf][1].slice().sort((a,b)=>(b.oct||0)-(a.oct||0) || a.name.localeCompare(b.name)), PGX = 10, pgs = Math.max(1, Math.ceil(all.length/PGX));
  X.ppage = Math.min(X.ppage||0, pgs-1); const rows = all.slice(X.ppage*PGX, (X.ppage+1)*PGX);
  const omx = Math.max(...TXO.map(m=>m.oct));
  const tbl = `<div class="cell s12"><div class="hd"><h2>Every partner</h2><div class="r"><div class="seg sm" role="group" aria-label="Show">${Object.entries(F2).map(([k,[t,a]])=>`<button data-xpf="${k}" aria-pressed="${X.pf===k}">${t} ${a.length}</button>`).join('')}</div></div></div>
      <div class="bt-wrap"><table class="bt xp"><colgroup><col style="width:24%"><col style="width:13%"><col style="width:9%"><col style="width:9%"><col style="width:12%"><col style="width:17%"><col style="width:8%"><col style="width:8%"></colgroup>
        <thead><tr><th class="c-nm">Shop</th><th style="text-align:left">Status</th><th>Fee</th><th>Terms</th><th>Cap · hits</th><th style="text-align:left">Cleared · Oct</th><th>$10 owed</th><th>Visited</th></tr></thead><tbody>
        ${rows.map(m=>`<tr data-xopen="${m.id}"><td class="tn"><span class="xp-n"><b>${m.name}</b><span>${m.founding?'Founding · ':''}${m.kind} · ${m.city}</span></span></td>
          <td style="text-align:left"><span class="stg"><i style="width:9px;height:9px;display:block;background:${STGCOL[m.stage]}"></i>${m.stage==='signed'?'Posters only':STGN[m.stage]}</span></td>
          <td>${m.stage==='transacting' ? (m.fee===0?'Free':m.fee.toFixed(1)+'%') : '<span class="quiet">–</span>'}</td><td>${m.terms || '<span class="quiet">–</span>'}</td>
          <td>${m.cap ? `<span class="xp-c">$${m.cap}<span class="mcl-h">${[0,1,2].map(i=>`<i class="${i<m.hits?'on':''}"></i>`).join('')}</span></span>` : '<span class="quiet">–</span>'}</td>
          <td style="text-align:left">${m.oct ? `<span class="xp-o"><span class="xp-ob"><i style="width:${m.oct/omx*100}%"></i></span><b>${money(m.oct)}</b></span>` : '<span class="quiet">–</span>'}</td>
          <td>${m.owed ? money(m.owed) : '<span class="quiet">–</span>'}</td><td><span class="${m.last!=null && m.last>=30?'warn':''}">${m.last==null?'–':m.last===0?'Today':m.last+'d'}</span></td></tr>`).join('')}
        </tbody></table></div>
      <div class="bk-ft"><span><span class="d-only">Loss rate is on each shop’s own sales. </span>Click a shop to open it.</span><span class="pg2"><span>${X.ppage*PGX+1}–${Math.min(all.length,(X.ppage+1)*PGX)} of ${all.length}</span><button data-xppage="-1" ${X.ppage===0?'disabled':''} aria-label="Previous"><svg viewBox="0 0 16 16"><path d="M10 3.5 5.5 8l4.5 4.5"/></svg></button><button data-xppage="1" ${X.ppage>=pgs-1?'disabled':''} aria-label="Next"><svg viewBox="0 0 16 16"><path d="M6 3.5 10.5 8 6 12.5"/></svg></button></span></div></div>`;
  const up = P.filter(m=>m.stage==='signed').sort((a,b)=>(b.posters-a.posters) || (a.last??0)-(b.last??0));
  const pitch = `<div class="cell s12"><div class="hd"><h2>On posters, not payments</h2><div class="r"><span class="lbl">${up.length} shops to pitch</span></div></div>
      <div class="xu">${up.slice(0,9).map(m=>{ const rt = routeFor(m); return `<div class="xu-r"><button class="xu-k" data-xopen="${m.id}"><b>${m.name}</b><span>${m.city} · ${m.posters} poster${m.posters===1?'':'s'} · ${lastTxt(m.last).toLowerCase()}</span></button>
        ${rt ? `<span class="xu-on">On ${firstName(rt.who)}’s ${fmtWD(dayT(rt.d)).slice(0,3)} route</span>` : `<button class="btn sm-b" data-xplan="${m.id}">Plan a visit</button>`}</div>`; }).join('')}</div>
      <div class="bk-ft"><span>They already like Clear enough to host a poster. Card payments are the next step.</span><button data-xpf="signed">All ${up.length} →</button></div></div>`;
  document.getElementById('mv').innerHTML = `
    <section class="band" style="margin-top:0"><div class="bento">${sum}</div></section>
    <section class="band"><div class="bento">${tbl}</div></section>
    <section class="band"><div class="bento">${pitch}</div></section>`;
}

/* ══ Payouts ══ */
function renderPayouts(){
  const net30 = TXO.filter(m=>m.terms==='NET-30'), lines = net30.map(m=>({m, ...payOf(m)})), extra = [['icw','Inland Cycle Works',60],['tacos','Fontana Tacos',40]];
  const run = lines.reduce((a,l)=>a+l.total,0) + 100, sales = lines.reduce((a,l)=>a+l.sales,0), fees = lines.reduce((a,l)=>a+l.fee,0), red = lines.reduce((a,l)=>a+l.red,0) + 100;
  const W = Math.max(sales, run), x = v => (v/W*100).toFixed(2), prop = X.approvals.includes('run');
  const steps = [['Sales cleared',0,sales,'var(--fg)',money(sales)],['Fees',sales-fees,sales,'var(--absent)','−'+money(fees)],['$10 redemptions',sales-fees,sales-fees+red,'var(--land)','+'+money(red)],['Payout',0,run,'var(--fg)',money(run)]];
  const wf = `<div class="cell s7"><div class="hd"><h2>The next run</h2><div class="r"><span class="lbl">September · NET-30</span></div></div>
      <div class="xw-top"><div class="m-big">${money(run)}</div><span>to 11 shops on Mon 2 Nov</span></div>
      <div class="xw">${steps.map(([k,a,b,c,t],i)=>`<div class="xw-r ${i===3?'tot':''}"><span>${k}</span><span class="xw-t"><i style="left:${x(a)}%;width:${x(b-a)}%;background:${c}"></i></span><b>${t}</b></div>`).join('')}</div>
      <div class="f-ft2"><span class="small quiet">${prop ? 'Proposed · waiting for a second person' : 'Payouts need two people: you propose, Dana approves'}</span>${prop ? '<span class="fst tlv">Proposed</span>' : '<button class="btn p" data-xprop="run">Propose the run</button>'}</div></div>`;
  const col = +(sales*0.842).toFixed(2);
  const cl = `<div class="cell s5"><div class="hd"><h2>Collected before it goes out</h2><div class="r"><span class="lbl">For this run</span></div></div>
      <div class="xc"><div class="xc-r"><i style="width:84.2%"></i></div><div class="m-big">84.2% <small>repaid by members</small></div></div>
      <div class="led xc-l"><div><span>Collected</span><b>${money(col)}</b></div><div><span>Still due from members</span><b>${money(sales-col)}</b></div><div><span>Due by</span><b>30 Oct</b></div></div>
      <div class="bk-ft"><span>If members are late, the pool covers the gap</span><button data-xgo="money">Money →</button></div></div>`;
  const okR = X.approvals.includes('rosas-pay');
  const UP = [[1,'Rosa’s Panadería','NET-14 · September',412.60,'rosas', okR ? 'Approved' : 'Needs a second person'],[12,'Monthly run','NET-30 · 11 shops',run,null, prop?'Proposed':'Not proposed yet'],[14,'Arrowhead Nails','NET-14',732.00,'nails','Scheduled'],[14,'Cajon Phone Repair','NET-14',2184.00,'phone','Scheduled'],[28,'NET-14 shops','Next NET-14 round',1140.80,null,'Estimated']];
  const umx = Math.max(...UP.map(u=>u[3])), MON = d => new Date(dayT(d)).toLocaleDateString('en-US',{month:'long',timeZone:'UTC'});
  const rel = d => d===1 ? 'tomorrow' : `in ${d} days`;
  const rows = UP.map(([d,n,s,v,id,st],i)=>{ const same = i && UP[i-1][0]===d, newM = !i || MON(UP[i-1][0])!==MON(d);
    const mt = UP.filter(u=>MON(u[0])===MON(d)), band = newM ? `<div class="xq-m"><span class="lbl">${MON(d)}</span><span class="xq-mt">${mt.length} payout${mt.length===1?'':'s'} · <b>${money(mt.reduce((a,u)=>a+u[3],0))}</b></span></div>` : '';
    const grp = UP[i+1] && UP[i+1][0]===d;
    return `${band}<div class="xq-r ${same?'same':''} ${grp?'grp':''} ${d===1?'soon':''}"><span class="xq-d leaf">${same ? `<i class="tie" aria-hidden="true"></i><span class="sr">Same day</span>` : `<span>${fmtWD(dayT(d)).slice(0,3)}</span><b>${new Date(dayT(d)).getUTCDate()}</b>`}</span>
      <span class="xq-k">${id?`<button data-xopen="${id}"><b>${n}</b></button>`:`<b>${n}</b>`}<span>${s} · ${same ? 'same day' : rel(d)}</span></span><span class="xq-b"><i style="width:${v/umx*100}%"></i></span><b class="xq-v">${money(v)}</b>
      <span class="xq-s ${st==='Needs a second person'?'warn':st==='Proposed'?'tlv':st==='Approved'?'ok':''}">${st==='Needs a second person' && isAdmin() && R.me!=='dana' ? `<span class="xq-a"><span>Proposed by Dana</span><button class="btn sm-b p" data-xapprove="rosas-pay">Approve</button></span>` : st}</span></div>`; }).join('');
  const cal = `<div class="cell s12"><div class="hd"><h2>When money goes out</h2><div class="r"><span class="lbl">Next 30 days</span></div></div>
      <div class="xq">${rows}</div>
      <div class="bk-ft"><span>NET-14 shops are paid every other Wednesday</span><span></span></div></div>`;
  const tbl = `<div class="cell s12"><div class="hd"><h2>The monthly run, line by line</h2><div class="r"><span class="lbl">Mon 2 Nov</span></div></div>
      <div class="bt-wrap"><table class="bt xl"><colgroup><col style="width:26%"><col style="width:14%"><col style="width:12%"><col style="width:14%"><col style="width:14%"><col style="width:20%"></colgroup>
        <thead><tr><th class="c-nm">Shop</th><th>Sales cleared</th><th>Fee</th><th>$10 redemptions</th><th>Payout</th><th style="text-align:left">Share of run</th></tr></thead><tbody>
        ${lines.sort((a,b)=>b.total-a.total).map(l=>`<tr data-xopen="${l.m.id}"><td class="tn"><b>${l.m.name}</b></td><td>${money(l.sales)}</td><td>${l.fee?'−'+money(l.fee):'Free'}</td><td>${l.red?money(l.red):'<span class="quiet">–</span>'}</td><td><b>${money(l.total)}</b></td><td style="text-align:left"><span class="xp-o"><span class="xp-ob"><i style="width:${l.total/run*100}%"></i></span><span>${(l.total/run*100).toFixed(1)}%</span></span></td></tr>`).join('')}
        ${extra.map(([id,n,v])=>`<tr data-xopen="${id}"><td class="tn"><b>${n}</b><span>Posters only · redemptions</span></td><td><span class="quiet">–</span></td><td><span class="quiet">–</span></td><td>${money(v)}</td><td><b>${money(v)}</b></td><td style="text-align:left"><span class="xp-o"><span class="xp-ob"><i style="width:${v/run*100}%"></i></span><span>${(v/run*100).toFixed(1)}%</span></span></td></tr>`).join('')}
        <tr class="tot"><td class="tn"><b>Run total</b></td><td><b>${money(sales)}</b></td><td><b>−${money(fees)}</b></td><td><b>${money(red)}</b></td><td><b>${money(run)}</b></td><td></td></tr>
        </tbody></table></div>
      <div class="bk-ft"><span>Every account verified · proposed by one person, approved by another</span><span></span></div></div>`;
  document.getElementById('mv').innerHTML = `
    <section class="band" style="margin-top:0"><div class="bento">${wf}${cl}</div></section>
    <section class="band"><div class="bento">${cal}</div></section>
    <section class="band"><div class="bento">${tbl}</div></section>`;
}

/* ══ Devices ══ */
function renderDevices(){
  const rows = Object.entries(FLEET).map(([id,f])=>({ m:MSBY[id], f, bad: Object.values(f).flat().includes('off') ? 'off' : Object.values(f).flat().includes('low') ? 'low' : '' })).sort((a,b)=>(b.bad?1:0)-(a.bad?1:0));
  const all = rows.flatMap(r=>DTYPE.flatMap(([k])=>r.f[k]||[])), off = all.filter(x=>x==='off').length, low = all.filter(x=>x==='low').length;
  const fleet = `<div class="cell s12"><div class="hd"><h2>Devices at shops</h2><div class="r"><span class="lbl">${all.length} devices · ${off} offline · ${low} battery low</span></div></div>
      <div class="bt-wrap"><table class="bt xd"><colgroup><col style="width:22%"><col style="width:10%"><col style="width:16%"><col style="width:10%"><col style="width:10%"><col style="width:12%"><col style="width:20%"></colgroup>
        <thead><tr><th class="c-nm">Shop</th>${DTYPE.map(([k,t])=>`<th style="text-align:left">${t}</th>`).join('')}<th>Checked in</th><th style="text-align:left">What’s next</th></tr></thead><tbody>
        ${rows.map(({m,f,bad})=>{ const st = devFix(m), di = st ? STOPS.indexOf(st)+1 : 0;
          return `<tr data-xopen="${m.id}" class="${bad}"><td class="tn"><b>${m.name}</b><span class="${bad?'warn':''}">${bad ? f.note : m.city}</span>
            <span class="xd-mq">${DTYPE.filter(([k])=>f[k]).map(([k,t])=>`<span>${t.replace('Clear ','')}<span class="xd-q">${f[k].map(x=>`<i class="${x}"></i>`).join('')}</span></span>`).join('')}${bad && st ? `<span class="xd-on">Marcus · today, stop ${di}</span>` : ''}</span></td>
          ${DTYPE.map(([k])=>`<td style="text-align:left">${f[k] ? `<span class="xd-q">${f[k].map(s=>`<i class="${s}"></i>`).join('')}</span>` : '<span class="quiet">–</span>'}</td>`).join('')}
          <td>${f.seen}</td><td style="text-align:left">${bad ? (st ? `<span class="xd-on">Marcus · today, stop ${di}</span>` : `<button class="lnk4" data-xplan="${m.id}">Plan a visit</button>`) : '<span class="quiet">All online</span>'}</td></tr>`; }).join('')}
        </tbody></table></div>
      <div class="bk-ft"><span class="f-key"><i style="background:var(--fg)"></i>Online <i style="background:var(--underway)"></i>Battery low <i class="koff"></i>Offline</span><span class="small quiet">Points report in every 2 minutes</span></div></div>`;
  const RF = [['Bought',14,'Awaiting repair'],['Repairing',6,'Screens, ports'],['Testing',4,'48-hour soak'],['Ready',8,'In stock'],['Shipped',21,'At shops']], rmx = 53;
  const PRE = [['Mission Auto Care','Thu 29 Oct',100,2],['Kingston Vet','Thu 29 Oct',40,1],['Colton Cuts','Thu 29 Oct',40,1],['Sun Valley HVAC','Mon 2 Nov',150,3],['Mentone Coffee','Mon 2 Nov',40,1],['Base Line Pho','Fri 6 Nov',220,6],['Fontana Tacos','Fri 6 Nov',160,5]];
  const SHIP = [['Thu 29 Oct','ready'],['Mon 2 Nov','ready'],['Fri 6 Nov','line']].map(([d,st])=>[d, PRE.filter(p=>p[1]===d).map(p=>[p[0],p[3]]), st]);
  const ref = `<div class="cell s7"><div class="hd"><h2>Refurb line</h2><div class="r"><span class="lbl">Used Samsung units</span></div></div>
      <div class="xr"><div class="m-big">8 <small>ready to ship · 10 still in repair or testing</small></div>
        <div class="xr-b">${RF.map(([k,n],i)=>`<i style="flex:${n};background:${['color-mix(in srgb,var(--fg) 22%,transparent)','color-mix(in srgb,var(--fg) 35%,transparent)','color-mix(in srgb,var(--fg) 50%,transparent)','var(--fg)','var(--land)'][i]}"></i>`).join('')}</div>
        <div class="xr-s">${RF.map(([k,n,s])=>`<div><span class="lbl">${k}</span><b>${n}</b><span>${s}</span></div>`).join('')}</div></div>
      <div class="xs"><div class="xs-h lbl">Where they go</div>${SHIP.map(([d,who,st])=>{ const n = who.reduce((a,[,u])=>a+u,0);
        return `<div class="xs-r ${st}"><span class="leaf"><span>${d.split(' ')[0]}</span><b>${d.split(' ')[1]}</b><span>${d.split(' ')[2]}</span></span><span class="xs-u"><b>${n}</b> unit${n>1?'s':''}</span>
          <span class="xs-w">${who.map(([s,u])=>`${s} <span class="quiet">${u}</span>`).join(' · ')}</span><span class="xs-s">${st==='ready'?'Ready':'On the line'}</span></div>`; }).join('')}</div>
      <div class="bk-ft"><span>A repaired unit costs $61.00, against $189.00 new</span><span></span></div></div>`;
  const pre = `<div class="cell s5"><div class="hd"><h2>Pre-orders</h2><div class="r"><span class="lbl">Refundable until made</span></div></div>
      <div class="xo-top"><div class="m-big">$750.00</div><span>in deposits for 19 devices</span></div>
      <div class="xo">${PRE.map(([n,d,v,u])=>{ const m = MS.find(x=>x.name===n); return `<button class="xo-r" ${m?`data-xopen="${m.id}"`:''}><b>${n}</b><span>${u} · ${d}</span><b>${money(v)}</b></button>`; }).join('')}</div>
      <div class="bk-ft"><span>Ready units go out oldest deposit first</span><span></span></div></div>`;
  document.getElementById('mv').innerHTML = `
    <section class="band" style="margin-top:0"><div class="bento">${fleet}</div></section>
    <section class="band"><div class="bento">${ref}${pre}</div></section>`;
}

/* ══ The shop record (side panel) and adding a prospect ══ */
function ensurePanel(){ let pn = document.getElementById('mpanel');
  if (!pn){ const sc = document.createElement('div'); sc.id='mscrim'; sc.className='scrim'; document.body.appendChild(sc); pn = document.createElement('aside'); pn.id='mpanel'; pn.className='panel mpanel xpanel'; document.body.appendChild(pn); }
  return pn; }
function renderPanel(){
  const pn = ensurePanel();
  if (!X.open && !R.panel && !X.add){ document.body.classList.remove('pn'); return; }
  document.body.classList.add('pn');
  if (R.panel) return (VPANELS.includes(R.panel.k) ? visitPanel : planPanel)(pn);
  if (X.add) return addPanel(pn);
  const m = MSBY[X.open], me = R.me, edit = canEditM(m), si = STG5.findIndex(s=>s[0]===m.stage), rt = routeFor(m), ds = devFix(m);
  const visits = VLOG.filter(v=>v.shop===m.name), notes = X.note[m.id] || (m.id==='tri' ? [] : []);
  const spark = m.stage==='transacting' ? series(14, Math.round(m.oct*14/21), i=>((i+hashN(m.name))%7===6 ? .25 : .55+.5*Math.abs(Math.sin((i+hashN(m.name))/1.7))), hashN(m.name)) : null, smx = spark ? Math.max(...spark,1) : 1;
  const nextBlock = m.next ? `<div class="fit"><b>${m.next}</b><span>${m.due!=null ? (m.due<0 ? `${-m.due} days overdue` : m.due===0 ? 'Due today' : 'Due '+fmtWD(dayT(m.due))) : 'No date set'} · ${rt ? `on ${rt.who===me?'your':firstName(rt.who)+'’s'} ${fmtWD(dayT(rt.d))} route` : ds ? `on Marcus’s route today, stop ${STOPS.indexOf(ds)+1}` : 'not on a route'}</span></div>` : '';
  const money_ = m.stage==='transacting' ? `<div><div class="w90-h"><span class="lbl">Cleared · last 14 days</span><b>${money(m.oct)} in Oct · ${m.octN} sales</b></div><div class="fpr-sp">${spark.map(v=>`<i style="height:${v/smx*100}%"></i>`).join('')}</div></div>
      <div class="led"><div><span>Fee</span><b>${m.fee===0?'Free for the first 20 sales':m.fee.toFixed(1)+'%'+(m.founding?' · founding, for life':'')}</b></div><div><span>Terms</span><b>${m.terms}</b></div>
        <div><span>Cap per sale</span><b>$${m.cap} · hit ${m.hits} time${m.hits===1?'':'s'} this week</b></div><div><span>Loss on their own sales</span><b class="${m.lost?'warn':''}">${(m.lost/m.orig*100).toFixed(1)}% · ${m.lost} of ${m.orig}</b></div>
        <div><span>Next payout</span><b>${m.terms==='NET-14' ? (m.id==='rosas'?'$412.60 tomorrow':'Wed 4 Nov') : money(payOf(m).total)+' · Mon 2 Nov'}</b></div><div><span>$10 owed to them</span><b>${m.owed?money(m.owed):'Nothing'}</b></div></div>` : '';
  const dev = FLEET[m.id] ? `<div><span class="lbl">Devices</span><div class="xdv">${DTYPE.filter(([k])=>FLEET[m.id][k]).map(([k,t])=>`<span><span class="xd-q">${FLEET[m.id][k].map(s=>`<i class="${s}"></i>`).join('')}</span>${t}${FLEET[m.id][k].length>1?' × '+FLEET[m.id][k].length:''}</span>`).join('')}</div>${FLEET[m.id].note?`<span class="small warn">${FLEET[m.id].note}</span>`:''}</div>` : '';
  const sel = m.stage==='signed' ? `<div class="led"><div><span>Posters up</span><b>${m.posters}</b></div><div><span>$10 owed to them</span><b>${m.owed?money(m.owed):'Nothing'}</b></div><div><span>Takes cards</span><b class="warn">Not yet</b></div></div>` : '';
  const pro = ['prospect','talking','signing'].includes(m.stage) ? `<div class="led"><div><span>Could finance</span><b>${m.val ? money(m.val).replace('.00','')+' a month' : '–'}</b></div><div><span>Came from</span><b>${SRC[m.source]||'–'}</b></div><div><span>${m.founding?'Seat':'Kind'}</span><b>${m.founding?'Founding, 4 of 5':m.kind}</b></div></div>` : '';
  pn.innerHTML = `<div class="pn-hd"><span class="lbl">${m.stage==='signed'?'Posters only':STGN[m.stage]}</span>${m.founding?'<span class="fst tlv">Founding</span>':''}<button class="x" data-xclose aria-label="Close">${ICO.x}</button></div>
    <div class="pn-b">
      <div class="fpr-top"><span class="fshop">${ini(m.name)}</span><div><h3>${m.name}</h3><span class="small quiet">${m.kind} · ${m.city} · ${m.owner===me?'your shop':firstName(m.owner)+'’s shop'}</span></div></div>
      <div class="fpl x5">${STG5.map(([k,t],i)=>`<span class="${i<si?'past':i===si?'now':''}">${t}</span>`).join('')}</div>
      ${nextBlock}${pro}${sel}${money_}${dev}
      <div><span class="lbl">Visits</span>${visits.length ? visits.slice(0,6).map(v=>`<div class="hs3"><b>${v.out}${v.to?' → '+STGN[v.to]:''} <span class="quiet" style="font-weight:400">· ${v.what}</span></b><span>${vDay(v.d)} · ${v.who===me?'you':firstName(v.who)}</span></div>`).join('') : `<p class="small quiet" style="margin:6px 0 0">${lastTxt(m.last)}.</p>`}</div>
      <div><span class="lbl">Notes</span>${(X.note[m.id]||[]).map(n=>`<div class="nt3"><p>${n.t}</p><span>${n.by} · just now</span></div>`).join('') || '<p class="small quiet" style="margin:6px 0 0">No notes yet.</p>'}
        ${edit ? `<div class="nt3-in"><textarea id="xnote" rows="2" placeholder="Add a note for the team"></textarea><button class="btn" style="height:32px" data-xnote="${m.id}">Add</button></div>` : ''}</div>
    </div>
    <div class="pn-ft mft">${edit ? `${rt||ds ? '' : `<button class="btn" data-xplan="${m.id}">Plan a visit</button>`}<button class="btn p" data-xlog="${m.id}">Log a visit</button>
      <div class="more3"><button class="btn" data-xmore>More ▾</button><div class="mm3" hidden>
        ${['prospect','talking','signing'].includes(m.stage) ? STG5.filter(([k])=>k!==m.stage && k!=='transacting').map(([k,t])=>`<button data-xstage="${m.id}|${k}">Move to ${t}</button>`).join('') : ''}
        ${isAdmin() && m.stage==='transacting' ? `<button data-xmprop="Raise the cap to $${[100,120,150,300,500].find(c=>c>m.cap)||m.cap}|${m.id}">Raise the cap <span>2nd approval</span></button><button data-xmprop="Change terms to ${m.terms==='NET-30'?'NET-14':'NET-30'}|${m.id}">Change terms <span>2nd approval</span></button><button class="dz" data-xmprop="Pause payments|${m.id}">Pause payments <span>2nd approval</span></button>` : ''}
        ${isAdmin() && ['prospect','talking'].includes(m.stage) ? `<button data-xowner="${m.id}">Give it to ${m.owner==='marcus'?'Dana':'Marcus'}</button>` : ''}
        ${['prospect','talking'].includes(m.stage) ? `<button class="dz" data-xstage="${m.id}|closed">Not a fit <span>Logged</span></button>` : ''}</div></div>`
      : `${['transacting','signed','signing','talking','prospect'].includes(m.stage) && TEAM[R.me].field && !rt ? `<button class="btn" data-xplan="${m.id}">Plan a visit</button>` : ''}<span class="small quiet" style="margin-left:auto">${firstName(m.owner)}’s shop · read-only for you</span>`}</div>`;
}
function addPanel(pn){ const A = X.add, who = isAdmin() ? A.owner : R.me;
  pn.innerHTML = `<div class="pn-hd"><span class="lbl">New prospect</span><button class="x" data-xclose aria-label="Close">${ICO.x}</button></div>
    <div class="pn-b"><h3>Add a prospect</h3>
      <label><span class="lbl">Shop name</span><input id="xan" class="vin" value="${A.name||''}" placeholder="Rancho Cucamonga Auto"></label>
      <div class="xa2"><label><span class="lbl">Kind of shop</span><input id="xak" class="vin" value="${A.kind||''}" placeholder="Auto repair"></label>
        <label><span class="lbl">City</span><select id="xac" class="vin">${Object.keys(GEO).map(c=>`<option ${A.city===c?'selected':''}>${c}</option>`).join('')}</select></label></div>
      <div class="xa-f"><span class="lbl">Came from</span><div class="seg sm" role="group">${Object.entries(SRC).map(([k,t])=>`<button data-xasrc="${k}" aria-pressed="${A.source===k}">${t.replace('Next to a poster shop','Poster shop')}</button>`).join('')}</div></div>
      ${isAdmin() ? `<div class="xa-f"><span class="lbl">Whose lead</span><div class="seg sm" role="group">${Object.entries(TEAM).filter(([,t])=>t.field).map(([k,t])=>`<button data-xaown="${k}" aria-pressed="${who===k}">${k===R.me?'Me':t.n}</button>`).join('')}</div></div>` : `<p class="small quiet" style="margin:0">It’ll be your lead.</p>`}
      <div class="xa2"><label><span class="lbl">Next step</span><input id="xanx" class="vin" value="Walk in"></label><label><span class="lbl">Could finance a month</span><input id="xav" class="vin" inputmode="numeric" placeholder="$5,000"></label></div>
      ${A.from ? `<p class="small quiet" style="margin:0">From a shop enquiry. It’s marked added there.</p>` : ''}
    </div>
    <div class="pn-ft"><span class="small quiet" style="margin-right:auto">Lands in Field’s Needs a visit</span><button class="btn" data-xclose>Cancel</button><button class="btn p" data-xasave>Add the prospect</button></div>`; }

/* ── render + events ── */
function render(){
  document.querySelectorAll('.gtabs [data-xtab]').forEach(b=>b.setAttribute('aria-current', b.dataset.xtab===X.tab?'page':'false'));
  renderHdr(); renderMe();
  ({overview:renderOverview, pipeline:renderPipeline, partners:renderPartners, payouts:renderPayouts, devices:renderDevices})[X.tab]();
  renderPanel(); fmMountAll(); requestAnimationFrame(fmLayoutDrawn);
}
const closeX = () => { X.open = null; X.add = null; R.panel = null; };
document.addEventListener('click', e => {
  if (e.target.id==='mscrim'){ closeX(); return render(); }
  const t = e.target.closest('button,a,tr[data-xopen],input,select,[data-xcity]'); if (!t){ const mm = document.querySelector('.mm3'); if (mm) mm.hidden = true; return; }
  const d = t.dataset;
  if (d.xtab){ X.tab = d.xtab; if (d.xpf){ X.pf = d.xpf; X.ppage = 0; } closeX(); render(); if (d.xjump){ const el = document.getElementById(d.xjump); el && el.scrollIntoView({behavior:'smooth', block:'start'}); } else window.scrollTo({top:0}); return; }
  if (d.xpf){ X.pf = d.xpf; X.ppage = 0; return render(); }
  if (d.xppage){ X.ppage = (X.ppage||0) + +d.xppage; return render(); }
  if (d.ktab){ if (X.kst===d.ktab) return; const order = KCOL.map(c=>c[0]), dir = order.indexOf(d.ktab) > order.indexOf(X.kst) ? 1 : -1; X.kst = d.ktab;
    document.querySelectorAll('#kbtabs .kb-tab').forEach(b=>{ const on = b.dataset.ktab===X.kst; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
    document.querySelectorAll('#kb .kb-c').forEach(c=>c.classList.toggle('on', c.dataset.kcol===X.kst));
    const col = document.querySelector(`#kb .kb-c.on`); if (col && col.animate && !matchMedia('(prefers-reduced-motion:reduce)').matches) col.animate([{opacity:0, transform:`translateX(${dir*24}px)`},{opacity:1, transform:'none'}], {duration:220, easing:'cubic-bezier(.2,.8,.2,1)'});
    return; }
  if (d.xsigned!==undefined){ X.allSigned = !X.allSigned; return render(); }
  if (d.xapprove){ X.approvals.push(d.xapprove); toast('Approved · Rosa’s $412.60 goes out tomorrow · logged in Records'); return render(); }
  if (d.xundo!==undefined){ const u = X.undo; X.undo = null; document.getElementById('toast')?.classList.remove('on'); if (u) u(); return; }
  if (d.xcity!==undefined){ X.city = d.xcity && X.city!==d.xcity ? d.xcity : null; return render(); }
  if (d.xopen){ closeX(); X.open = d.xopen; return render(); }
  if (t.hasAttribute('data-xclose') || t.hasAttribute('data-fclose')){ e.stopImmediatePropagation(); const back = R.panel && X.open; R.panel = null; X.add = null; if (!back) X.open = null; return render(); }
  if (t.hasAttribute('data-xmore')){ const mm = t.parentElement.querySelector('.mm3'); mm.hidden = !mm.hidden; return; }
  if (d.xplan){ const m = MSBY[d.xplan]; ensureLead(m); const r = leadToRoute(m.name, canEditM(m) ? null : R.me); toast(`${m.name} added to ${r.who===R.me?'your':TEAM[r.who].n+'’s'} route tomorrow · Field → Plan`); return render(); }
  if (d.xlog){ const m = MSBY[d.xlog]; ensureLead(m); R.panel = { k:'log', shop:m.name, out:null }; return render(); }
  if (d.xnote){ const v = (document.getElementById('xnote')||{}).value.trim(); if (!v) return; (X.note[d.xnote] ||= []).push({ by:TEAM[R.me].n, t:v }); return render(); }
  if (d.xstage){ const [id,k] = d.xstage.split('|'), m = MSBY[id]; m.stage = k==='closed' ? 'closed' : k; const l = LEADS.find(x=>x.shop===m.name); if (l) l.stage = k; toast(k==='closed' ? `${m.name} marked not a fit · logged` : `${m.name} moved to ${STGN[k]}`); if (k==='closed') X.open = null; return render(); }
  if (d.xowner){ const m = MSBY[d.xowner]; m.owner = m.owner==='marcus' ? 'dana' : 'marcus'; const l = LEADS.find(x=>x.shop===m.name); if (l) l.owner = m.owner; toast(`${m.name} is now ${TEAM[m.owner].n}’s lead`); return render(); }
  if (d.xmprop){ const [what,id] = d.xmprop.split('|'); X.approvals.push(what+'|'+id); toast(`<b>${what}</b> proposed · it needs a second person in Needs you`); return render(); }
  if (d.xprop){ X.approvals.push(d.xprop); toast('Monthly run proposed · Dana approves it in Needs you'); return render(); }
  if (d.xreveal){ (X.reveal ||= new Set()).add(d.xreveal); toast('Shown · logged in Records'); return render(); }
  if (d.xenq){ const [a,id] = d.xenq.split('|'), en = ENQ.find(x=>x.id===id);
    if (a==='add'){ X.add = { name:en.name, kind:en.kind, city:en.city, source:'enquiry', owner:R.me==='kai'?'marcus':R.me, from:id }; return render(); }
    if (a==='reply'){ X.enqSt[id] = 'replied'; toast('Reply drafted in your email · marked replied'); return render(); }
    if (a==='no'){ X.enqSt[id] = 'notfit'; toast('Marked not a fit · logged'); return render(); } }
  if (t.hasAttribute('data-xadd')){ X.add = { source:'walkin', owner: isAdmin() ? 'marcus' : R.me, city:'Redlands' }; return render(); }
  if (d.xasrc){ X.add.source = d.xasrc; ['name','kind'].forEach((k,i)=>X.add[k] = document.getElementById(['xan','xak'][i]).value); return renderPanel(); }
  if (d.xaown){ X.add.owner = d.xaown; ['name','kind'].forEach((k,i)=>X.add[k] = document.getElementById(['xan','xak'][i]).value); return renderPanel(); }
  if (t.hasAttribute('data-xasave')){ const A = X.add, name = document.getElementById('xan').value.trim(); if (!name){ toast('Add the shop’s name'); return; }
    const m = { id:'p-'+hashN(name+Date.now()), name, kind: document.getElementById('xak').value.trim() || 'Shop', city: document.getElementById('xac').value, stage:'prospect', val: +(document.getElementById('xav').value.replace(/\D/g,'')) || 0,
      owner: isAdmin() ? A.owner : R.me, next: document.getElementById('xanx').value || 'Walk in', due:null, last:null, source:A.source, posters:0 };
    MS.push(m); MSBY[m.id] = m; ensureLead(m); if (A.from) X.enqSt[A.from] = 'added'; X.add = null; X.open = m.id; toast(`${name} added · ${m.owner===R.me?'your':TEAM[m.owner].n+'’s'} lead`); return render(); }
  if (d.xgo){ toast(`Goes to ${d.xgo[0].toUpperCase()+d.xgo.slice(1)} in the Command Center`); return; }
  if (d.fgo){ toast(`Goes to ${d.fgo} in the Command Center`); return; }
});
document.addEventListener('input', e => { if (e.target.id==='xbq'){ X.bq = e.target.value; renderPipeline(); const i = document.getElementById('xbq'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); } });
document.addEventListener('keydown', e => { if (e.key==='Escape' && (X.open || X.add || R.panel)){ closeX(); render(); } });

/* ══ Pipeline drag: the tile lifts into a ghost that follows the pointer, its slot travels through the columns and the tiles around it slide
   out of the way. Press and drag with a mouse; touch and hold on a phone. Reps can only pick up their own leads (only those carry data-kt). ══ */
(() => {
  let D = null; const EASE = 'cubic-bezier(.2,.8,.2,1)';
  const tiles = () => [...document.querySelectorAll('#kb .kt')];
  const flip = fn => { const before = new Map(tiles().map(el=>[el, el.getBoundingClientRect()])); fn();
    tiles().forEach(el=>{ if (D && el===D.el) return; const a = before.get(el); if (!a) return; const b = el.getBoundingClientRect(), dx = a.left-b.left, dy = a.top-b.top;
      if (dx||dy) el.animate([{transform:`translate(${dx}px,${dy}px)`},{transform:'none'}], {duration:220, easing:EASE}); }); };
  function start(){
    const r = D.el.getBoundingClientRect(); D.ox = D.x - r.left; D.oy = D.y - r.top; D.from = { col:D.el.closest('[data-kcol]').dataset.kcol, next:D.el.nextElementSibling };
    const g = D.el.cloneNode(true); g.classList.add('kt-ghost'); g.removeAttribute('data-kt'); g.removeAttribute('data-xopen');
    Object.assign(g.style, { width:r.width+'px', height:r.height+'px', left:r.left+'px', top:r.top+'px' });
    document.body.appendChild(g); D.g = g; D.el.classList.add('kt-ph'); document.body.classList.add('kb-drag'); D.on = true;
    g.animate([{transform:'none'},{transform:'rotate(1.4deg) scale(1.03)'}], {duration:160, easing:EASE, fill:'forwards'});
    try { navigator.vibrate && navigator.vibrate(12); } catch(_){}
    D.raf = requestAnimationFrame(tick); }
  function place(){
    D.g.style.translate = `${D.x - D.ox - parseFloat(D.g.style.left)}px ${D.y - D.oy - parseFloat(D.g.style.top)}px`;
    const hit = document.elementFromPoint(D.x, D.y), tab = hit && hit.closest('#kbtabs [data-ktab]'), col = !tab && hit && hit.closest('#kb [data-kcol]');
    document.querySelectorAll('#kbtabs .kb-tab.over').forEach(c=>{ if (c!==tab) c.classList.remove('over'); });
    D.tab = tab ? tab.dataset.ktab : null; D.g.classList.toggle('mini', !!tab); if (tab){ tab.classList.add('over'); return; }
    document.querySelectorAll('#kb .kb-c.over').forEach(c=>{ if (c!==col) c.classList.remove('over'); });
    if (!col) return; col.classList.add('over');
    const body = col.querySelector('.kb-b'), list = [...body.querySelectorAll('.kt')].filter(el=>el!==D.el);
    const before = list.find(el=>{ const b = el.getBoundingClientRect(); return D.y < b.top + b.height/2; }) || body.querySelector('.kb-more, .kb-e');
    if (D.el.parentNode===body && (before ? D.el.nextElementSibling===before : !D.el.nextElementSibling)) return;
    flip(()=>{ before ? body.insertBefore(D.el, before) : body.appendChild(D.el); });
    document.querySelectorAll('#kb .kb-b').forEach(b=>b.classList.toggle('has', !!b.querySelector('.kt'))); }
  function tick(){ if (!D || !D.on) return;
    const kb = document.getElementById('kb'), br = kb.getBoundingClientRect(), edge = 48;
    if (D.x < br.left + edge) kb.scrollLeft -= 12; else if (D.x > br.right - edge) kb.scrollLeft += 12;
    const moved = Math.abs(D.y - D.sy) > 24; if (moved && D.y < 80) scrollBy(0, -10); else if (moved && D.y > innerHeight - 64) scrollBy(0, 10);
    place(); D.raf = requestAnimationFrame(tick); }
  const stop = e => { e.stopPropagation(); e.preventDefault(); };
  function end(cancel){
    if (!D) return; clearTimeout(D.t); const d = D; D = null;
    removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', cc); removeEventListener('keydown', esc);
    if (!d.on) return; cancelAnimationFrame(d.raf);
    document.addEventListener('click', stop, true); setTimeout(()=>document.removeEventListener('click', stop, true), 0);
    document.body.classList.remove('kb-drag'); document.querySelectorAll('#kb .kb-c.over, #kbtabs .kb-tab.over').forEach(c=>c.classList.remove('over'));
    if (!cancel && d.tab){ const m = MSBY[d.el.dataset.kt], tabEl = document.querySelector(`#kbtabs [data-ktab="${d.tab}"]`);
      if (d.tab===m.stage) cancel = true;
      else { const tr = tabEl.getBoundingClientRect(), gr = d.g.getBoundingClientRect(), tx = tr.left + tr.width/2 - (gr.left + gr.width/2), ty = tr.top + tr.height/2 - (gr.top + gr.height/2);
        const cur = d.g.style.translate.split(' ').map(parseFloat);
        const an = d.g.animate([{transform:'rotate(1.4deg) scale(1.03)', opacity:1},{transform:`translate(${tx}px,${ty}px) scale(.18)`, opacity:0}], {duration:260, easing:EASE, fill:'forwards'});
        an.onfinish = () => { d.g.remove(); const prev = { stage:m.stage, seq:X.seq ? {...X.seq} : null };
          X.seq = {}; document.querySelectorAll('#kb .kt').forEach((el,i)=>{ X.seq[el.dataset.xopen] = i; }); X.seq[m.id] = -1;
          moved(m, d.tab, prev); const t2 = document.querySelector(`#kbtabs [data-ktab="${d.tab}"]`); t2 && t2.animate([{transform:'scale(1.08)'},{transform:'none'}], {duration:300, easing:EASE}); };
        return; } }
    if (cancel){ const body = document.querySelector(`#kb [data-kcol="${d.from.col}"] .kb-b`); flip(()=>{ d.from.next && d.from.next.parentNode===body ? body.insertBefore(d.el, d.from.next) : body.appendChild(d.el); }); }
    const r = d.el.getBoundingClientRect(), gx = r.left - parseFloat(d.g.style.left), gy = r.top - parseFloat(d.g.style.top);
    const an = d.g.animate([{translate:d.g.style.translate, transform:'rotate(1.4deg) scale(1.03)'},{translate:`${gx}px ${gy}px`, transform:'none'}], {duration:200, easing:EASE, fill:'forwards'});
    an.onfinish = () => { d.g.remove(); d.el.classList.remove('kt-ph'); if (cancel) return;
      const m = MSBY[d.el.dataset.kt], to = d.el.closest('[data-kcol]').dataset.kcol; if (!m) return;
      const prev = { stage:m.stage, seq:X.seq ? {...X.seq} : null };
      X.seq = {}; document.querySelectorAll('#kb .kt').forEach((el,i)=>{ X.seq[el.dataset.xopen] = i; });
      if (prev.stage===to){ render(); return; }
      moved(m, to, prev); }; }
  function moved(m, to, prev){
    m.stage = to; if (to==='talking' && m.next==='Walk in') m.next = 'Second visit';
    (X.note[m.id] ||= []).push({ by:TEAM[R.me].n, t:KMOVE[to] });
    X.flash = m.id; X.undo = () => { m.stage = prev.stage; X.seq = prev.seq; X.note[m.id].pop(); X.flash = m.id; render(); setTimeout(()=>{ X.flash = null; }, 900); };
    render(); setTimeout(()=>{ X.flash = null; }, 900);
    toast(`${m.name} · ${KMOVE[to].toLowerCase()} · logged <button class="tst-u" data-xundo>Undo</button>`); }
  function move(e){ if (!D) return; D.x = e.clientX; D.y = e.clientY;
    if (!D.on){ const far = Math.hypot(D.x-D.sx, D.y-D.sy) > (D.touch ? 8 : 5); if (far){ if (D.touch) return end(true); start(); } return; }
    e.preventDefault(); }
  const up = () => end(false), cc = () => end(true), esc = e => { if (e.key==='Escape') end(true); };
  document.addEventListener('touchmove', e => { if (D && D.on) e.preventDefault(); }, {passive:false});
  document.addEventListener('pointerdown', e => {
    const el = e.target.closest('#kb .kt[data-kt]'); if (!el || e.button>0) return;
    D = { el, sx:e.clientX, sy:e.clientY, x:e.clientX, y:e.clientY, touch:e.pointerType!=='mouse', on:false };
    if (D.touch) D.t = setTimeout(()=>{ if (D && !D.on) start(); }, 320);
    addEventListener('pointermove', move); addEventListener('pointerup', up); addEventListener('pointercancel', cc); addEventListener('keydown', esc);
  });
})();
let rsT; addEventListener('resize', () => { requestAnimationFrame(fmLayoutDrawn); clearTimeout(rsT);
  rsT = setTimeout(() => { if (X.tab!=='overview' || !X.asp) return; const sz = corrSize(); if (Math.abs(sz.w/sz.h - X.asp)/X.asp > .04) render(); }, 140); });
const hs = location.hash.slice(1).split(',');
['overview','pipeline','partners','payouts','devices'].forEach(t=>{ if (hs.includes(t)) X.tab = t; });
if (hs.includes('rec')) X.open = 'rosas';
if (hs.includes('lead')) X.open = MS.find(m=>m.name==='Tri-City Transmission').id;
if (hs.includes('add')) X.add = { source:'walkin', owner:'marcus', city:'Redlands' };
if (hs.includes('rep')) R.me = 'marcus';
if (hs.includes('red')) X.city = 'Redlands';
if (hs.includes('dark')) document.documentElement.dataset.theme = 'dark';
render();

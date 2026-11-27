
/* ══ Field: posters and the people who keep them up ══════════════════════════════════════════
   Today is the phone on the route. Plan builds the next routes at a desk. Posters is the fleet.
   Placement is where the next posters go. Counter devices belong to Merchants; Field only gets the fixes as stops. */
const F = { tab:'today', scan:null, outcome:null, poster:null, pf:'all', pq:'', page:0, place:null, day:1, who:{1:'marcus',2:'dana',5:'marcus'},
  plan:{ 1:new Set(['p90','p63','n1']), 2:new Set(['d1','d2']), 5:new Set() }, saved:{}, later:new Set() };
const PHONE = () => matchMedia('(max-width:760px)').matches;
const stopDone = s => s.tasks.every(t=>t.done);
const curStop = () => STOPS.find(s=>!stopDone(s));
const ICO = {
  x:'<svg class="i" viewBox="0 0 20 20"><path d="M5 5l10 10M15 5 5 15"/></svg>',
  chk:'<svg class="i" viewBox="0 0 20 20"><path d="M4.5 10.5l3.5 3.5 7.5-8"/></svg>',
  scan:'<svg class="i" viewBox="0 0 20 20"><path d="M3 7V3h4M13 3h4v4M17 13v4h-4M7 17H3v-4M6 10h8"/></svg>',
  out:'<svg class="i" viewBox="0 0 20 20"><path d="M11 4h5v5M16 4l-7 7M14 12v4H4V6h4"/></svg>',
  cam:'<svg class="i" viewBox="0 0 20 20"><path d="M3 7h3l1.5-2h5L14 7h3v9H3z"/><circle cx="10" cy="11.5" r="2.8"/></svg>',
  warn:'<svg class="i" viewBox="0 0 20 20" style="width:15px;height:15px;flex:none"><path d="M10 3l8 14H2z"/><path d="M10 8v4M10 14v1"/></svg>' };
const sevCol = s => `var(--${s==='line'?'line':s})`;

/* ── header: brief + the same four vitals on every tab ── */
function renderHdr(){
  const up = POSTERS.filter(p=>p.status==='up').length, due = POSTERS.filter(p=>p.status==='due').length, faded = POSTERS.filter(p=>p.status==='faded').length, miss = POSTERS.filter(p=>p.status==='missing').length, tot = POSTERS.length;
  const done = STOPS.filter(stopDone).length, cur = curStop();
  const scans = POSTERS.reduce((s,p)=>s+p.scans,0), soon = POSTERS.filter(p=>p.status==='up' && daysTo(p.swap)<=14).length;
  const city = cityRows(), best = city.slice().sort((a,b)=>b.per-a.per)[0], gap = city.filter(c=>c.waiting && !c.posters).sort((a,b)=>b.waiting-a.waiting)[0] || city.slice().sort((a,b)=>b.waiting/Math.max(1,b.posters)-a.waiting/Math.max(1,a.posters))[0];
  const late = POSTERS.find(p=>p.n===44);
  const S = {
    today: cur ? `<a data-ftab="today" data-fjump="fnow">Marcus Lee is at ${cur.name}</a>, stop ${STOPS.indexOf(cur)+1} of ${STOPS.length}. Next is ${STOPS[STOPS.indexOf(cur)+1]?.name || 'the last stop'}, where ${pid(44)} is ${-daysTo(late.swap)} days past its swap.` : 'Today’s route is done. Anything left moves to tomorrow.',
    plan: (() => { const tm = R.routes.filter(x=>x.d===1), draft = tm.filter(x=>x.status!=='accepted'), open = POOL.filter(x=>!R.dropped.has(x.id) && !R.snoozed.has(x.id) && !routeOf(x.id)).length, mer = POOL.filter(x=>x.kind==='merchant' && !routeOf(x.id)).length;
      return `${tm.length} route${tm.length===1?'':'s'} tomorrow${draft.length ? `, ${draft.map(x=>`<a data-froute="${x.id}">${firstName(x.who)}’s ${x.status==='sent'?'isn’t accepted yet':'isn’t sent yet'}</a>`).join(' and ')}` : ', all accepted'}. <a data-ftab="plan" data-fjump="fpool">${open} things need a visit</a> and aren’t on any route, ${mer} of them merchant visits.`; })(),
    visits: (() => { const od = dueLeads().filter(l=>l.due<0), sg = VLOG.find(v=>v.out==='Signed' && v.d===0);
      return `${sg ? `${firstName(sg.who)} signed <a data-fvisit="${VLOG.indexOf(sg)}">${sg.shop}</a> today. ` : ''}${od.length ? `<a data-vlf="due">${od.length} follow-up${od.length===1?' is':'s are'} overdue</a>, ${od.map(l=>l.shop).join(' and ')}.` : 'No follow-ups are overdue.'}`; })(),
    posters: `${up} of ${tot} posters are up. ${pid(44)} at Mesa Laundry is ${-daysTo(late.swap)} days past its swap, and ${soon} more come due in the next two weeks.`,
    placement: `${best.city} gets ${best.per} scans a poster, the most of any city, from ${best.posters} posters. ${gap.city} has ${int(gap.waiting)} people waiting and ${gap.posters ? 'only '+gap.posters+' poster'+(gap.posters===1?'':'s') : 'no posters'}.`
  }[F.tab];
  document.getElementById('hdr').innerHTML = `<span class="when"><span class="dot"></span>Field · Wed 21 Oct · Demo data</span><p class="brief">${S}</p>
    <div class="strip">
      <div class="sc"><span class="lbl">Posters up</span><div class="sc-v">${up} <small>of ${tot}</small></div><div class="mb"><i style="width:${up/tot*100}%"></i><i style="left:${up/tot*100}%;width:${due/tot*100}%;background:var(--land)"></i><i style="left:${(up+due)/tot*100}%;width:${faded/tot*100}%;background:var(--underway)"></i><i style="left:${(up+due+faded)/tot*100}%;width:${miss/tot*100}%;background:var(--absent)"></i></div><div class="sc-s">${due} swap due · ${faded} faded · ${miss} missing</div></div>
      <div class="sc"><span class="lbl">Today’s route</span><div class="sc-v">${done} <small>of ${STOPS.length} stops</small></div><div class="mb"><i style="width:${done/STOPS.length*100}%"></i><span class="hroom" style="left:${done/STOPS.length*100}%;right:0"></span></div><div class="sc-s">Marcus Lee · back by 14:00</div></div>
      <div class="sc"><span class="lbl">Visits · 7 days</span><div class="sc-v">${visitsIn(7).length} <small>${visitsIn(7).filter(v=>v.kind==='merchant').length} merchant</small></div><div class="mb"><i style="width:${visitsIn(7).filter(v=>v.kind==='poster').length/Math.max(1,visitsIn(7).length)*100}%"></i><i style="left:${visitsIn(7).filter(v=>v.kind==='poster').length/Math.max(1,visitsIn(7).length)*100}%;width:${visitsIn(7).filter(v=>v.kind==='merchant').length/Math.max(1,visitsIn(7).length)*100}%;background:var(--live)"></i></div><div class="sc-s">${visitsIn(7).filter(v=>v.to).length} moved a shop forward · ${new Set(visitsIn(7).map(v=>v.who)).size} people out</div></div>
      <div class="sc"><span class="lbl">Follow-ups due</span><div class="sc-v">${dueLeads().filter(l=>l.due<=2).length} <small>next 2 days</small></div><div class="mb"><i style="width:${dueLeads().filter(l=>l.due<0).length/Math.max(1,dueLeads().length)*100}%;background:var(--absent)"></i><i style="left:${dueLeads().filter(l=>l.due<0).length/Math.max(1,dueLeads().length)*100}%;width:${dueLeads().filter(l=>l.due>=0&&l.due<=2).length/Math.max(1,dueLeads().length)*100}%;background:var(--underway)"></i></div><div class="sc-s">${dueLeads().filter(l=>l.due<0).length} overdue · ${dueLeads().filter(l=>!leadRoute(l)).length} not on a route</div></div>
    </div>`;
}

/* ── shared bits ── */
const chip = (t, cls='') => `<span class="fch ${cls}">${t}</span>`;
const stopMark = (i, st) => `<span class="fno ${st}">${st==='done'?ICO.chk:i+1}</span>`;

/* ══ Today ══ */
/* maps fill their space edge to edge: draw at the box's own shape, and redraw if the box changes shape */
const FIT = {};
function fitMap(k, build, asp0){ const f = FIT[k] ||= { asp:asp0 }; f.build = build; return build(f.asp); }
function fitMaps(){ let changed = false; Object.entries(FIT).forEach(([k,f])=>{ const w = document.querySelector(`[data-fit="${k}"]`); if (!w || !w.clientHeight || !w.clientWidth) return;
    const a = w.clientWidth / w.clientHeight; if (Math.abs(a - f.asp)/f.asp > .03){ f.asp = a; w.innerHTML = f.build(a); changed = true; } });
  if (changed) fmMountAll(); requestAnimationFrame(fmLayoutDrawn); }
function routeMap(slot, list, curIdx, aspect){ // list: [{name, city}], curIdx: index of the stop you're at (-1 = a plan, nothing done)
  const LL = list.map(s=>shopLL(s.name, s.city)), m = mkMap(list.length ? boundsOf(LL, .018) : FULL, aspect);
  const P = LL.map(([la,lo])=>m.p(la,lo));
  const pos = q => `left:${(q[0]/m.W*100).toFixed(2)}%;top:${(q[1]/m.H*100).toFixed(2)}%`;
  const state = i => curIdx<0 ? 'next' : i < curIdx ? 'done' : i===curIdx ? 'now' : 'next';
  // a stop: a dot on the exact spot, and a numbered tag that moves out of the way of other stops, tied back by a leader line
  const pin = (s,i,style='') => { const st = state(i); return `<span class="fsp ${st}" ${style} aria-label="${i+1}. ${s.name}${st==='done'?', done':st==='now'?', you are here':''}"><svg class="fsp-l" aria-hidden="true"><line x1="0" y1="0" x2="0" y2="0"/></svg><i class="fsp-d"></i><b class="fsp-t">${i+1}<em>${s.name}</em></b></span>`; };
  const leg = (q,i) => `M${P[i].map(v=>v.toFixed(1)).join(',')} L${q.map(v=>v.toFixed(1)).join(',')}`;
  const svg = P.slice(1).map((q,i)=>`<path class="fm-rc" d="${leg(q,i)}"/>`).join('') + P.slice(1).map((q,i)=>`<path class="fm-rt ${curIdx>=0 && i < curIdx ? 'done' : ''}" d="${leg(q,i)}"/>`).join('');
  const fallback = areaMap(m, { svg, pins: list.map((s,i)=>pin(s,i,`style="${pos(P[i])}"`)).join(''), cls:'rt' });
  const lngLat = LL.map(([la,lo])=>[lo,la]), bb = list.length ? boundsOf(LL, .01) : FULL;
  return fmSlot(slot, { bounds:[[bb[0],bb[2]],[bb[1],bb[3]]], pad:36, route:lngLat, done:Math.max(0,curIdx), pins:list.map((s,i)=>({ ll:lngLat[i], html:pin(s,i) })) }, fallback, 'rt');
}
function renderToday(){
  const done = STOPS.filter(stopDone).length, cur = curStop(), ci = cur ? STOPS.indexOf(cur) : STOPS.length, nx = cur ? STOPS[ci+1] : null;
  const leftMins = STOPS.filter(s=>!stopDone(s)).length * 34;
  const info = cur ? SHOP_INFO[cur.id] : null;
  const now = cur ? `<div class="cell s7" id="fnow"><div class="hd"><h2>Now · stop ${ci+1} of ${STOPS.length}</h2><div class="r"><span class="lbl">ETA ${cur.eta}</span></div></div>
      <div class="fn-top"><p class="fn-name">${cur.name}</p><span>${cur.where} · ${cur.city}</span></div>
      <div class="fn-facts"><div><span class="lbl">Open until</span><b>${info[0]}</b></div><div><span class="lbl">Ask for</span><b>${info[1]}</b></div><div><span class="lbl">Last visit</span><b>${info[2]}</b></div></div>
      <div class="fn-tasks">${cur.tasks.map((t,i)=>`<div class="fn-t ${t.done?'done':''}"><span class="fn-c">${t.done?ICO.chk:''}</span>
          <span class="fn-k"><b>${t.t}</b><span>${t.done ? `${t.out} at ${t.done}` : t.kind==='poster' ? `Design ${t.p.design} · ${t.note || 'Scan the code to log it'}` : t.note}</span></span>
          ${t.done ? '' : t.kind==='poster' ? `<button class="btn sm-b" data-fscan="${t.p.n}">${ICO.scan}Scan</button>` : t.kind==='merchant' ? `<button class="btn sm-b" data-fdev="${i}">Log the visit</button>` : `<button class="btn sm-b" data-fdev="${i}">Mark done</button>`}</div>`).join('')}</div>
      <div class="f-ft2"><button class="lnk3" data-fskip>Skip${nx?` · next is ${nx.name}`:''}</button><a class="lnk3" href="https://maps.google.com/?q=${encodeURIComponent(cur.name+' '+cur.city+' CA')}" target="_blank" rel="noopener">Directions ↗</a></div></div>`
    : `<div class="cell s7" id="fnow"><div class="hd"><h2>Route done</h2></div><div class="fn-top"><p class="fn-name">All ${STOPS.length} stops logged</p><span>Anything left over moves to tomorrow.</span></div><div class="f-ft2"><span class="small quiet">Back at 13:52</span><button class="lnk3" data-ftab="plan">Plan tomorrow →</button></div></div>`;
  const map = `<div class="cell s5"><div class="hd"><h2>The route</h2><div class="r"><span class="lbl">${int(31)} mi · 8 stops</span></div></div>
      <div class="fm-wrap" data-fit="today">${fitMap('today', a => routeMap('today', STOPS, ci, a), .86)}</div>
      <div class="bk-ft"><span><b>${done} of ${STOPS.length}</b> done · about ${Math.floor(leftMins/60)} h ${leftMins%60} min left</span><span class="f-key"><i class="k-done"></i>Done <i class="k-now"></i>Now <i class="k-next"></i>Next</span></div></div>`;
  // stops, grouped by city
  const groups = []; STOPS.forEach((s,i)=>{ const g = groups[groups.length-1]; if (g && g.city===s.city) g.stops.push([s,i]); else groups.push({city:s.city, stops:[[s,i]]}); });
  const list = `<div class="cell s7"><div class="hd"><h2>Stops</h2><div class="r"><span class="lbl">Marcus Lee · started 08:50</span></div></div>
      <div class="fs-l">${groups.map(g=>`<div class="fs-g"><span class="lbl">${g.city}</span><span>${g.stops.filter(([s])=>stopDone(s)).length} of ${g.stops.length}</span></div>
        ${g.stops.map(([s,i])=>{ const d = stopDone(s), isNow = s===cur; return `<div class="fs-r ${d?'done':''} ${isNow?'now':''}">${stopMark(i, d?'done':isNow?'now':'next')}
          <span class="fs-k"><b>${s.name}</b><span>${s.where}</span></span><span class="fs-t">${s.tasks.map(t=>chip(t.kind==='poster'?pid(t.p.n):t.kind==='merchant'?'Merchant':'Device', t.done?'ok':'')).join('')}</span>
          <span class="fs-e">${d ? s.tasks[s.tasks.length-1].done : isNow ? '<b class="warn">Now</b>' : s.eta}</span></div>`; }).join('')}`).join('')}</div>
      <div class="bk-ft"><span>Back by 14:00 if nothing runs long</span><button data-ftab="plan">Plan tomorrow →</button></div></div>`;
  // the van: what's loaded against what today still needs
  const need = {A:0,B:0,C:0}; STOPS.forEach(s=>s.tasks.forEach(t=>{ if (t.kind==='poster' && !t.done && /^(Swap|Replace)/.test(t.t)) need[t.p.design]++; }));
  const needN = Object.values(need).reduce((a,b)=>a+b,0);
  const van = `<div class="cell s5"><div class="hd"><h2>In the van</h2><div class="r"><span class="lbl">Loaded 08:40</span></div></div>
      <div class="fv">${Object.keys(VAN).map(k=>`<div class="fv-r">${designThumb(k,22)}<span class="fv-k"><b>Design ${k}</b><span>${need[k]} still to put up · ${VAN[k]} loaded</span></span><span class="fv-u">${Array.from({length:VAN[k]},(_,i)=>`<i class="${i<need[k]?'need':''}"></i>`).join('')}</span></div>`).join('')}
        <div class="fv-r">${batteryThumb(22)}<span class="fv-k"><b>Clear Point batteries</b><span>1 for Citrus Bowl table 4 · 2 loaded</span></span><span class="fv-u"><i class="need"></i><i></i></span></div></div>
      <div class="bk-ft"><span><b>${needN}</b> posters still to put up today</span><span class="f-key"><i class="k-need"></i>Needed <i class="k-spare"></i>Spare</span></div></div>`;
  // logged today
  const log = []; STOPS.forEach(s=>s.tasks.forEach(t=>{ if (t.done) log.push({s, t}); })); log.sort((a,b)=>b.t.done.localeCompare(a.t.done));
  const cnt = k => log.filter(l=>l.t.out===k).length, devN = log.filter(l=>l.t.kind==='device').length;
  const tiles = [...Object.keys(OUT).map(k=>[k, cnt(k), OUT[k][1], OUT[k][0]]), ['Devices', devN, 'Fixed', 'settled']];
  const logged = `<div class="cell s12"><div class="hd"><h2>Logged today</h2><div class="r"><span class="lbl">${log.length} things · ${log.filter(l=>l.t.photo).length} with a photo</span></div></div>
      <div class="fl-tiles">${tiles.map(([k,n,s,c])=>`<div class="fl-t ${n?'':'z'}"><span class="lbl">${k}</span><b style="${n?`color:var(--${c==='settled'?'fg':c})`:''}">${n}</b><span>${s}</span></div>`).join('')}</div>
      <div class="fl-l">${log.length ? log.map(l=>`<div class="fl-r"><span class="fl-tm">${l.t.done}</span><i class="fl-sv" style="background:var(--${l.t.kind==='poster'?OUT[l.t.out][0]:'settled'})"></i>
          <span class="fl-k"><b>${l.t.kind==='poster' ? `${l.t.out} ${pid(l.t.p.n)}` : 'Fixed the counter device'}</b><span>${l.s.name}${l.t.noteIn?' · '+l.t.noteIn:''}</span></span>
          <span class="fl-d">${l.t.kind==='poster' ? `${designThumb(l.t.p.design,16)} Design ${l.t.p.design}` : 'Counter device'}</span><span class="fl-ph">${l.t.photo?ICO.cam+'Photo':'<span class="quiet">No photo</span>'}</span></div>`).join('') : '<p class="small quiet" style="padding:18px 22px;margin:0">Scans show up here as they happen.</p>'}</div>
      <div class="bk-ft"><span>Every scan is logged with the time and place</span><button data-fgo="records">Audit log · Records →</button></div></div>`;
  // found on earlier checks, not on today's route
  const later = POOL.filter(x=>x.kind!=='new' && (x.sev==='absent' || x.sev==='underway')).slice(0,3);
  const lat = `<div class="cell s12"><div class="hd"><h2>Found on earlier checks</h2><div class="r"><span class="lbl">Not on today’s route</span></div></div>
      <div class="fw-l">${later.map(x=>`<div class="fw-r"><i class="fl-sv" style="background:${sevCol(x.sev)}"></i><span class="fw-k"><b>${x.shop}</b><span>${x.city}</span></span><span class="fw-w"><b>${x.what}</b><span>${x.why}</span></span><span class="fw-m">+${x.mins} min</span>
        <button class="btn sm-b ${F.later.has(x.id)?'on':''}" data-flater="${x.id}">${F.later.has(x.id)?'Added ✓':'Add to today'}</button></div>`).join('')}</div>
      <div class="bk-ft"><span>Adding all ${later.length} makes today about ${later.reduce((s,x)=>s+x.mins,0)} min longer</span><button data-ftab="plan">Put them on another day →</button></div></div>`;
  document.getElementById('fv').innerHTML = `
    ${PHONE() ? [now,list,map,van].map((c,i)=>`<section class="band" ${i?'':'style="margin-top:0"'}><div class="bento">${c.replace(/cell s[57]/,'cell s12')}</div></section>`).join('')
      : `<section class="band" style="margin-top:0"><div class="bento">${now}${van}</div></section>
    <section class="band"><div class="bento">${list}${map}</div></section>`}
    <section class="band"><div class="bento">${logged}</div></section>
    <section class="band"><div class="bento">${lat}</div></section>
    <div class="fbar"><button class="btn p" data-fscan="pick">${ICO.scan}Scan a poster</button></div>`;
}

/* ══ Posters ══ */
const life = p => { const age = daysTo(TODAY) - daysTo(p.hung), d = daysTo(p.swap); return { pct: Math.min(1, Math.max(0, (60 - d)/60)), d }; };
function renderPosters(){
  const need = POSTERS.filter(p=>p.status!=='up').sort((a,b)=>a.swap-b.swap);
  // swaps coming due, by week, with anything overdue first
  const wk = [['Late',-999,0]]; for (let w=0; w<8; w++) wk.push([w===0?'This week':fmtD(TODAY+w*7*DAY), w*7, w*7+7]);
  const wc = wk.map(([t,a,b])=>[t, POSTERS.filter(p=>p.status!=='missing' && daysTo(p.swap)>=a && daysTo(p.swap)<b).length]);
  const wmx = Math.max(...wc.map(x=>x[1]), 1);
  const due = `<div class="cell s7"><div class="hd"><h2>Swaps coming due</h2><div class="r"><span class="lbl">Each poster lasts 60 days</span></div></div>
      <div class="fd">${wc.map(([t,v],i)=>`<div class="fd-c ${i===0?'late':''} ${i===1?'now':''}"><b>${v}</b><span class="fd-b"><i style="height:${v/wmx*100}%"></i></span><span class="fd-l">${t}</span></div>`).join('')}</div>
      <div class="bk-ft"><span>The week of ${wc.slice(2).sort((a,b)=>b[1]-a[1])[0][0]} is the busiest. Spread it over two routes.</span><button data-ftab="plan">Plan →</button></div></div>`;
  const nowL = `<div class="cell s5"><div class="hd"><h2>Needs you now</h2><div class="r"><span class="lbl">${need.length} posters</span></div></div>
      <div class="fq">${need.map(p=>{ const d = daysTo(p.swap); return `<button class="fq-r" data-fposter="${p.n}"><span class="fq-t"><i class="sv" style="background:var(--${ST[p.status][0]})"></i><b>${pid(p.n)} · ${p.shop}</b><span class="fq-a">${p.status==='missing'?'Missing':p.status==='faded'?'Faded':d<0?`${-d}d late`:`in ${d}d`}</span></span>
        <span class="fq-m">${p.city} · design ${p.design} · ${STOPS.some(s=>s.tasks.some(t=>t.p&&t.p.n===p.n)) ? '<b>on today’s route</b>' : routeOf('p'+p.n) ? `on ${firstName(routeOf('p'+p.n).who)}’s ${fmtWD(dayT(dayOf('p'+p.n))).slice(0,3)} route` : '<span class="warn">not on a route</span>'}</span></button>`; }).join('')}</div>
      <div class="bk-ft"><span>Swaps go on a route as they come due</span><button data-ftab="plan">Plan →</button></div></div>`;
  // inventory
  const q = F.pq.trim().toLowerCase();
  let rows = POSTERS.filter(p => F.pf==='all' || (F.pf==='need' ? p.status!=='up' : p.design===F.pf)).filter(p => !q || pid(p.n).toLowerCase().includes(q) || p.shop.toLowerCase().includes(q) || p.city.toLowerCase().includes(q));
  rows = rows.slice().sort((a,b)=>a.swap-b.swap);
  const PG = 12, pages = Math.max(1, Math.ceil(rows.length/PG)); F.page = Math.min(F.page, pages-1);
  const view = rows.slice(F.page*PG, F.page*PG+PG), smx = Math.max(...POSTERS.map(p=>p.scans));
  const inv = `<div class="cell s12"><div class="hd"><h2>Every poster</h2><div class="r"><div class="seg sm" role="group" aria-label="Show">${[['all','All '+POSTERS.length],['need','Needs you '+need.length],['A','Design A'],['B','Design B'],['C','Design C']].map(([k,t])=>`<button data-fpf="${k}" aria-pressed="${F.pf===k}">${t}</button>`).join('')}</div></div></div>
      <div class="fi-s"><label class="msearch"><svg class="i" viewBox="0 0 20 20"><circle cx="9" cy="9" r="5"/><path d="M13 13l4 4"/></svg><input id="fpq" placeholder="Find a poster by code, shop or city" value="${F.pq.replace(/"/g,'&quot;')}"></label><span class="small quiet">Soonest swap first</span></div>
      <div class="bt-wrap"><table class="bt fi"><colgroup><col style="width:22%"><col style="width:20%"><col style="width:28%"><col style="width:16%"><col style="width:14%"></colgroup>
        <thead><tr><th class="c-nm">Poster</th><th style="text-align:left">Where</th><th style="text-align:left">Life · 60 days</th><th>Scans · 30 days</th><th>Status</th></tr></thead><tbody>
        ${view.map(p=>{ const L = life(p); return `<tr data-fposter="${p.n}"><td class="tn"><span class="fi-p">${designThumb(p.design,18)}<span class="pn"><b>${pid(p.n)}</b><span>Design ${p.design} · ${DESIGNS[p.design].name}</span></span></span></td>
          <td style="text-align:left"><span class="pn"><b class="fi-sh">${p.shop}</b><span>${p.city}</span></span></td>
          <td style="text-align:left"><span class="fi-l"><span class="fi-lb ${p.status==='up'?'':'bad'}"><i style="width:${L.pct*100}%"></i></span><span class="${L.d<0||p.status!=='up'?'warn':''}">${p.status==='missing' ? 'Gone' : L.d<0 ? `${-L.d}d late` : `swap ${fmtD(p.swap)}`}</span></span></td>
          <td><span class="fi-sc"><span class="fi-sb"><i style="width:${p.scans/smx*100}%"></i></span><b>${p.scans}</b></span></td>
          <td>${chip(ST[p.status][1], p.status==='up'?'ok':p.status==='missing'?'bad':'warn')}</td></tr>`; }).join('') || '<tr><td colspan="5" class="tn"><span class="quiet">No posters match.</span></td></tr>'}
        </tbody></table></div>
      <div class="bk-ft"><span>${rows.length ? `${F.page*PG+1}–${Math.min(rows.length,(F.page+1)*PG)} of ${rows.length}` : '0 posters'}</span><span class="pg2"><button data-fpage="-1" ${F.page===0?'disabled':''} aria-label="Previous"><svg viewBox="0 0 16 16"><path d="M10 3.5 5.5 8l4.5 4.5"/></svg></button><button data-fpage="1" ${F.page>=pages-1?'disabled':''} aria-label="Next"><svg viewBox="0 0 16 16"><path d="M6 3.5 10.5 8 6 12.5"/></svg></button></span></div></div>`;
  document.getElementById('fv').innerHTML = `
    <section class="band" style="margin-top:0"><div class="bento">${due}${nowL}</div></section>
    <section class="band"><div class="bento">${inv}</div></section>`;
}

/* ══ Placement ══ */
function cityRows(){
  const cities = Object.keys(GEO).map(c=>{ const ps = POSTERS.filter(p=>p.city===c), sc = ps.reduce((s,p)=>s+p.scans,0);
    return { city:c, posters:ps.length, scans:sc, per: ps.length ? Math.round(sc/ps.length) : 0, waiting: WAITING_BY_CITY[c] || 0, live: LIVE_BY_CITY[c] || 0, signing: SIGNING_BY_CITY[c] || 0 }; });
  const avg = POSTERS.reduce((s,p)=>s+p.scans,0) / POSTERS.length;
  cities.forEach(c=>{ // a simple, explainable rule: add where scans a poster beat the average or people wait with few posters; hold where a shop can't take the $10 yet
    const perWait = c.waiting / Math.max(1, c.posters);
    c.add = c.per > avg*1.15 ? 3 : perWait > 20 ? 2 : c.per && c.per < avg*.6 ? 0 : 1;
    c.why = c.per > avg*1.15 ? `Each poster pulls ${c.per} scans, ${Math.round((c.per/avg-1)*100)}% above average` : perWait > 20 ? `${int(c.waiting)} waiting for ${c.posters} poster${c.posters===1?'':'s'}` : c.per && c.per < avg*.6 ? 'Posters here pull below average' : 'About average';
    c.note = !c.live ? 'No live shop yet' : '';
    c.score = (c.per/avg) + perWait/30 + (c.live?0.3:0); });
  return cities.sort((a,b)=>b.score-a.score);
}
const placeSize = () => { const fv = document.getElementById('fv'), w = fv && fv.clientWidth ? fv.clientWidth - 2 : 1126, one = matchMedia('(max-width:1024px)').matches;
  return { w: one ? w : w - (matchMedia('(max-width:1180px)').matches ? 300 : 340), h: PHONE() ? 320 : one ? 420 : 520 }; };
function renderPlacement(){
  const C = cityRows(), avg = Math.round(POSTERS.reduce((s,p)=>s+p.scans,0) / POSTERS.length), top = C.filter(c=>c.add>=2).slice(0,4);
  const wmx = Math.max(...C.map(c=>c.waiting)), sel = F.place;
  const sz = placeSize(), pm = mkMap(FULL, sz.w/sz.h), rOf = c => c.waiting ? Math.round(9 + Math.sqrt(c.waiting/wmx)*30) : 0; F.asp = sz.w/sz.h;
  const bubbles = C.map(c=>{ const r = rOf(c), on = sel===c.city, sq = Math.min(14, 5 + c.posters/3);
    return `<button class="fbub ${on?'on':''} ${c.add>=2?'add':''}" data-fplace="${on?'':c.city}" style="${pm.at(...GEO[c.city])};--r:${(r/7.6).toFixed(2)}" aria-label="${c.city}: ${c.waiting} waiting, ${c.posters} posters">${r?'<i class="fbub-w"></i>':''}<b style="width:${sq}px;height:${sq}px"></b>${c.add>=2?`<em>+${c.add}</em>`:''}</button>`; }).join('');
  const liveB = C.map(c=>{ const r = rOf(c), on = sel===c.city, sq = Math.min(14, 5 + c.posters/3); const [la,lo] = GEO[c.city];
    return { ll:[lo,la], html:`<div class="fm-mk"><button class="fbub ${on?'on':''} ${c.add>=2?'add':''}" data-fplace="${on?'':c.city}" style="--rpx:${r}px" aria-label="${c.city}">${r?'<i class="fbub-w"></i>':''}<b style="width:${sq}px;height:${sq}px"></b>${c.add>=2?`<em>+${c.add}</em>`:''}</button></div>` }; });
  const pmapD = areaMap(pm, { pins:bubbles, cls:'place', labelGap: city => Math.max(10, rOf(C.find(c=>c.city===city))+4) }).replace(/--g:(\d+)px/g, (s,g)=>`--g:max(10px, calc(${(g/7.6).toFixed(2)}cqw))`);
  const pmap = fmSlot('place', { bounds:[[FULL[0],FULL[2]],[FULL[1],FULL[3]]], pad:24, pins:liveB }, pmapD, 'place');
  const cand = POOL.filter(x=>x.kind==='new').concat([{shop:'Brockton Coffee', city:'Riverside', why:'Asked about Clear at the farmers market', id:'c3'},{shop:'Baseline Cuts', city:'Rialto', why:'Prospect in Merchants · talking', id:'c4'}]);
  const candRow = x => { const on = x.kind==='new' && dayOf(x.id)!=null; return `<div class="fpm-c"><span><b>${x.shop}</b><span>${x.why.replace('From Placement · ','')}</span></span>${x.kind==='new' ? `<button class="btn sm-b ${on?'on':''}" data-fnew="${x.id}">${on?'On route ✓':'Add to route'}</button>` : `<button class="btn sm-b" data-fgo="merchants">Ask first</button>`}</div>`; };
  const c = sel && C.find(x=>x.city===sel), here = c ? cand.filter(x=>x.city===c.city) : [];
  const side = c ? `<div class="fpm-h"><b>${c.city}</b><button class="lnk3" data-fplace="">All suggestions</button></div>
      <div class="fpm-d"><div class="fpm-big"><span class="m-big ${c.add>=2?'warn':''}">${c.add ? `+${c.add}` : 'Hold'} <small>${c.add ? `poster${c.add===1?'':'s'} suggested` : 'no new posters for now'}</small></span><span class="fpm-y">${c.why}</span></div>
        <div class="led fpm-l"><div><span>Posters up</span><b>${c.posters}</b></div><div><span>Scans a poster</span><b>${c.per || '–'} <span class="quiet">· average ${avg}</span></b></div><div><span>People waiting</span><b>${int(c.waiting)}</b></div><div><span>Shops taking cards</span><b>${c.live || '<span class="warn">None yet</span>'}</b></div></div>
        <div class="fpm-cs"><span class="lbl">Shops that could take one</span>${here.length ? here.map(candRow).join('') : `<p class="small quiet" style="margin:6px 0 0">None lined up in ${c.city} yet. <button class="lnk3" data-fgo="merchants">Find one in Merchants</button></p>`}</div></div>`
    : `<div class="fpm-h"><span class="lbl">Suggested next</span><span class="fpm-ht">+${top.reduce((a,x)=>a+x.add,0)} posters in ${top.length} cities</span></div>
      ${top.map(c=>`<button class="fpm-r" data-fplace="${c.city}"><span class="fpm-t"><b>${c.city}</b><span class="fpm-a">Add ${c.add}</span></span><span class="fpm-y">${c.why}</span><span class="fpm-n">${c.posters} posters · ${c.per} scans each · ${int(c.waiting)} waiting${c.note?` · <span class="warn">${c.note}</span>`:''}</span></button>`).join('')}`;
  const map = `<div class="cell s12"><div class="hd"><h2>Where the next posters go</h2><div class="r"><span class="lbl">Average ${avg} scans a poster</span></div></div>
      <div class="fpm"><div class="fpm-m">${pmap}</div><div class="fpm-s">${side}</div></div>
      <div class="bk-ft"><span class="f-key fpm-k"><span><i class="k-wait"></i>People waiting</span><span><i class="k-post"></i>Posters up</span><span><b class="warn">+3</b> Suggested</span></span><span class="small quiet d-only">${sel ? 'Click the city again to go back' : 'Click a city to see why'}</span></div></div>`;
  const cmx = Math.max(...C.map(c=>c.per));
  const table = `<div class="cell s12"><div class="hd"><h2>Cities</h2><div class="r"><span class="lbl">Last 30 days</span></div></div>
      <div class="bt-wrap"><table class="bt fc"><colgroup><col style="width:17%"><col style="width:9%"><col style="width:24%"><col style="width:10%"><col style="width:10%"><col style="width:13%"><col style="width:17%"></colgroup>
        <thead><tr><th class="c-nm">City</th><th>Posters</th><th style="text-align:left">Scans a poster</th><th>Waiting</th><th>Shops live</th><th>Suggest</th><th></th></tr></thead><tbody>
        ${C.slice().sort((a,b)=>b.posters-a.posters).map(c=>`<tr class="${sel===c.city?'sel':''}"><td class="tn"><b>${c.city}</b></td><td>${c.posters}</td>
          <td style="text-align:left"><span class="fi-sc l"><span class="fi-sb"><i style="width:${c.per/cmx*100}%" class="${c.per>avg*1.15?'hi':''}"></i><s style="left:${avg/cmx*100}%"></s></span><b>${c.per}</b></span></td>
          <td>${c.waiting ? int(c.waiting) : '<span class="quiet">–</span>'}</td><td>${c.live || '<span class="quiet">None</span>'}</td><td>${c.add ? `<b class="${c.add>=2?'warn':''}">+${c.add}</b>` : '<span class="quiet">Hold</span>'}</td>
          <td><button class="lnk4" data-fplace="${c.city}">See on the map</button></td></tr>`).join('')}
        </tbody></table></div>
      <div class="bk-ft"><span>The line in each bar is the average</span><button data-fgo="growth">Scans by shop · Growth →</button></div></div>`;
  const shops = `<div class="cell s7"><div class="hd"><h2>Shops that could take a poster</h2><div class="r"><span class="lbl">${cand.length} shops</span></div></div>
      <div class="fw-l">${cand.map(x=>{ const on = x.kind==='new' && dayOf(x.id)!=null; return `<div class="fw-r c"><span class="fw-k"><b>${x.shop}</b><span>${x.city}</span></span><span class="fw-w"><span>${x.why.replace('From Placement · ','')}</span></span>
        ${x.kind==='new' ? `<button class="btn sm-b ${on?'on':''}" data-fnew="${x.id}">${on?'On route ✓':'Add to route'}</button>` : `<button class="btn sm-b" data-fgo="merchants">Ask first</button>`}</div>`; }).join('')}</div>
      <div class="bk-ft"><span>A shop has to say yes before a poster goes up</span><button data-fgo="merchants">Prospects · Merchants →</button></div></div>`;
  const dv = Object.entries(DESIGNS).map(([k,d])=>[k, d, Math.round(d.scans/d.posters), Math.round(d.joined/d.scans*100)]), dmx = Math.max(...dv.map(x=>x[2]));
  const des = `<div class="cell s5"><div class="hd"><h2>Which design</h2><div class="r"><span class="lbl">Scans a poster</span></div></div>
      <div class="fdz">${dv.map(([k,d,per,j])=>`<div class="fdz-r">${designThumb(k,26)}<span class="fdz-k"><b>Design ${k} · ${d.name}</b><span>${d.posters} posters · ${j}% of scans join</span></span><span class="fi-sc"><span class="fi-sb"><i style="width:${per/dmx*100}%"></i></span><b>${per}</b></span></div>`).join('')}</div>
      <div class="bk-ft"><span>New posters go up as design B. Swap C as it comes due.</span><button data-fgo="growth/campaigns">Campaigns →</button></div></div>`;
  document.getElementById('fv').innerHTML = `
    <section class="band" style="margin-top:0"><div class="bento">${map}</div></section>
    <section class="band"><div class="bento">${table}</div></section>
    <section class="band"><div class="bento">${shops}${des}</div></section>`;
}

/* ══ Panels: scan sheet and poster record ══ */
function ensurePanel(){ let pn = document.getElementById('fpanel');
  if (!pn){ const sc = document.createElement('div'); sc.id='fscrim'; sc.className='scrim'; document.body.appendChild(sc); pn = document.createElement('aside'); pn.id='fpanel'; pn.className='panel fpanel'; document.body.appendChild(pn); }
  return pn; }
function renderPanel(){
  const pn = ensurePanel();
  if (F.scan==null && F.poster==null && !R.panel){ document.body.classList.remove('pn'); return; }
  document.body.classList.add('pn');
  if (R.panel) return (VPANELS.includes(R.panel.k) ? visitPanel : planPanel)(pn);
  if (F.scan!=null) return scanSheet(pn);
  const p = POSTERS.find(x=>x.n===F.poster), L = life(p), sp = series(14, Math.max(14,Math.round(p.scans*14/30)), i=>.8+.25*Math.sin((i+p.n)/2.2), p.n);
  const smx = Math.max(...sp,1), onRoute = STOPS.some(s=>s.tasks.some(t=>t.p&&t.p.n===p.n)), planned = dayOf('p'+p.n)!=null ? [dayOf('p'+p.n)] : null;
  pn.innerHTML = `<div class="pn-hd"><span class="lbl">${pid(p.n)}</span>${chip(ST[p.status][1], p.status==='up'?'ok':p.status==='missing'?'bad':'warn')}<button class="x" data-fclose aria-label="Close">${ICO.x}</button></div>
    <div class="pn-b">
      <div class="fpr-top">${designThumb(p.design,56)}<div><h3>${p.shop}</h3><span class="small quiet">${p.city} · design ${p.design}, ${DESIGNS[p.design].name}</span></div></div>
      <div class="w90"><div class="w90-h"><span class="lbl">Life · 60 days</span><b class="${L.d<0||p.status!=='up'?'warn':''}">${p.status==='missing'?'Gone from the window':L.d<0?`${-L.d} days late`:`${L.d} days left`}</b></div><span class="wbar big ${L.d<10||p.status!=='up'?'lo':''}"><i style="width:${L.pct*100}%"></i></span><span class="small quiet">Hung ${fmtD(p.hung)} · swap by ${fmtD(p.swap)}</span></div>
      <div><div class="w90-h"><span class="lbl">Scans · last 14 days</span><b>${p.scans} in 30 days</b></div><div class="fpr-sp">${sp.map(v=>`<i style="height:${v/smx*100}%"></i>`).join('')}</div></div>
      <div class="led"><div><span>Last checked</span><b>${fmtD(p.checked)}</b></div><div><span>Code</span><b>useclear.org/s/${p.shopId}</b></div><div><span>Route</span><b>${onRoute?'Today, Marcus Lee':planned?fmtWD(dayT(+planned[0])):'Not on a route'}</b></div></div>
      <div><span class="lbl">History</span><div class="hs3"><b>Hung, design ${p.design}</b><span>${fmtD(p.hung)}</span></div><div class="hs3"><b>Checked · up and fine</b><span>${fmtD(Math.max(p.hung+DAY, p.checked))}</span></div>${p.status!=='up'?`<div class="hs3"><b class="warn">${ST[p.status][1]}</b><span>${fmtD(p.checked)}</span></div>`:''}</div>
    </div>
    <div class="pn-ft mft">${!onRoute && !planned && p.status!=='up' || (!onRoute && !planned && L.d<=14) ? `<button class="btn p" data-fputroute="${p.n}">Add to tomorrow’s route</button>` : ''}<button class="btn" data-fscan="${p.n}">${ICO.scan}Log a check</button><button class="btn" style="margin-left:auto" data-fclose>Close</button></div>`;
}
function scanSheet(pn){
  const p = F.scan==='pick' ? null : POSTERS.find(x=>x.n===F.scan);
  const task = p && STOPS.flatMap(s=>s.tasks.map(t=>({s,t}))).find(x=>x.t.p && x.t.p.n===p.n);
  let body, foot;
  if (!p){ const cur = curStop(), sug = cur ? cur.tasks.filter(t=>t.kind==='poster'&&!t.done) : [];
    body = `<div class="vf"><i></i><i></i><i></i><i></i><span>Point at the code on the poster</span></div>
      <div><span class="lbl">At this stop</span><div class="fcodes">${(sug.length?sug:[{p:POSTERS.find(x=>x.n===44)}]).map(t=>`<button class="fcode" data-fpickc="${t.p.n}">${designThumb(t.p.design,18)}<b>${pid(t.p.n)}</b><span>${t.p.shop}</span><span>→</span></button>`).join('')}</div></div>
      <div><span class="lbl">Or type the code</span><div class="fcin"><input id="fcode" inputmode="numeric" placeholder="P-027" autocomplete="off" aria-label="Poster code"><button class="btn" data-fcode>Look it up</button></div></div>`;
    foot = `<span class="nx">Every scan is logged with time and place</span><button class="btn" data-fclose>Cancel</button>`;
  } else {
    const sel = F.outcome || (task && /^(Swap|Replace)/.test(task.t.t) ? 'Replaced' : 'Checked'); F.outcome = sel;
    body = `<div class="fpr-top">${designThumb(p.design,44)}<div><span class="lbl">${pid(p.n)} · design ${p.design}</span><h3>${p.shop}</h3><span class="small quiet">Hung ${fmtD(p.hung)} · ${p.scans} scans in 30 days</span></div></div>
      ${task?`<div class="fnote"><b>On today’s route.</b> ${task.t.t}${task.t.note?', '+task.t.note.toLowerCase():''}.</div>`:''}
      <div><span class="lbl">What did you find?</span><div class="fog">${Object.keys(OUT).map(k=>`<button class="fo ${sel===k?'on':''}" data-fout="${k}" aria-pressed="${sel===k}"><i class="fl-sv" style="background:var(--${OUT[k][0]})"></i><b>${k}</b><span>${OUT[k][1]}</span></button>`).join('')}</div></div>
      <div class="fph-row"><label class="fph">${ICO.cam}<span>Take a photo</span><input type="file" accept="image/*" capture="environment" hidden></label><input id="fnoteIn" placeholder="Note (optional)" autocomplete="off"></div>
      <div class="led">${sel==='Replaced'?`<div><span>New poster</span><b>Design ${p.design}, same code</b></div><div><span>Next swap</span><b>${fmtD(TODAY+60*DAY)}</b></div>`:sel==='Missing'?`<div><span>Next</span><b>A new poster goes on tomorrow’s route</b></div>`:sel==='Damaged'?`<div><span>Next</span><b>A swap goes on tomorrow’s route</b></div>`:`<div><span>Next check</span><b>On the next pass</b></div>`}</div>`;
    foot = `<button class="btn" data-fscan="pick">Scan another</button><button class="btn p" style="margin-left:auto" data-fsavescan="${p.n}">Save · ${sel.toLowerCase()}</button>`;
  }
  pn.innerHTML = `<div class="pn-hd"><span class="lbl">${p?'Log a poster':'Scan a poster'}</span><button class="x" data-fclose aria-label="Close">${ICO.x}</button></div><div class="pn-b">${body}</div><div class="pn-ft">${foot}</div>`;
}

/* ── render + events ── */
function render(){
  document.querySelectorAll('.gtabs [data-ftab]').forEach(b=>b.setAttribute('aria-current', b.dataset.ftab===F.tab?'page':'false'));
  renderHdr(); renderMe();
  ({today:renderToday, plan:renderPlan, visits:renderVisits, posters:renderPosters, placement:renderPlacement})[F.tab]();
  renderPanel();
  fmMountAll();
  fitMaps();
}
function toast(t){ let el = document.getElementById('toast'); if (!el){ el = document.createElement('div'); el.id='toast'; document.body.appendChild(el); } el.innerHTML = t; el.classList.add('on'); clearTimeout(el._t); el._t = setTimeout(()=>el.classList.remove('on'), 2600); }
const closeP = () => { F.scan = null; F.poster = null; F.outcome = null; R.panel = null; };
document.addEventListener('click', e => {
  if (e.target.id==='fscrim'){ closeP(); return render(); }
    const t = e.target.closest('button,a,input,label,tr[data-fposter]'); if (!t) return;
  const d = t.dataset;
  if (d.ftab){ F.tab = d.ftab; closeP(); render(); if (d.fjump){ const el = document.getElementById(d.fjump); el && el.scrollIntoView({behavior:'smooth', block:'start'}); } else window.scrollTo({top:0}); return; }
  if (d.fscan){ F.poster = null; F.outcome = null; F.scan = d.fscan==='pick' ? 'pick' : +d.fscan; return render(); }
  if (d.fpickc){ F.scan = +d.fpickc; F.outcome = null; return renderPanel(); }
  if (t.hasAttribute('data-fcode')){ const v = (document.getElementById('fcode').value.match(/\d+/)||[])[0]; const p = v && POSTERS.find(x=>x.n===+v); if (p){ F.scan = p.n; F.outcome = null; return renderPanel(); } toast('No poster with that code'); return; }
  if (d.fout){ F.outcome = d.fout; return renderPanel(); }
  if (d.fsavescan){ const n = +d.fsavescan, p = POSTERS.find(x=>x.n===n), out = F.outcome, task = STOPS.flatMap(s=>s.tasks).find(x=>x.p && x.p.n===n);
    if (task){ task.done = '10:3'+(4+Math.floor(Math.random()*5)); task.out = out; task.photo = 0; task.noteIn = (document.getElementById('fnoteIn')||{}).value || ''; }
    if (out==='Replaced'){ p.status='up'; p.hung=TODAY; p.swap=TODAY+60*DAY; } else if (out==='Missing') p.status='missing'; else if (out==='Damaged') p.status='faded';
    p.checked = TODAY; closeP(); toast(`${out} · ${pid(n)} at ${p.shop} is logged`); return render(); }
  if (d.fdev && curStop().tasks[+d.fdev].kind==='merchant'){ R.panel = { k:'log', shop:curStop().name, out:null, stop:+d.fdev }; return render(); }
  if (d.fdev){ const cur = curStop(); const tk = cur.tasks[+d.fdev]; tk.done = '10:3'+(4+Math.floor(Math.random()*5)); toast('Counter device marked fixed · Merchants sees it'); return render(); }
  if (t.hasAttribute('data-fskip')){ const cur = curStop(); const i = STOPS.indexOf(cur); STOPS.push(STOPS.splice(i,1)[0]); toast(`${cur.name} moved to the end of the route`); return render(); }
  if (d.flater){ F.later.has(d.flater) ? F.later.delete(d.flater) : F.later.add(d.flater); toast(F.later.has(d.flater)?'Added to the end of today’s route':'Taken off today’s route'); return render(); }
  if (d.fposter){ F.scan = null; F.poster = +d.fposter; return render(); }
  if (t.hasAttribute('data-fclose')){ closeP(); return render(); }
  if (d.fputroute){ const r = tomorrowFor('marcus'); r.ids.push('p'+d.fputroute); dirty(r); toast(`${pid(+d.fputroute)} added to ${firstName(r.who)}’s route tomorrow`); return render(); }
  // posters
  if (d.fpf){ F.pf = d.fpf; F.page = 0; return render(); }
  if (d.fpage){ F.page += +d.fpage; return render(); }
  // placement
  if (d.fplace!==undefined){ F.place = d.fplace || null; if (F.tab!=='placement'){ F.tab = 'placement'; } render(); if (d.fplace && t.closest('.fc')) document.querySelector('.fpm').scrollIntoView({behavior:'smooth', block:'center'}); return; }
  if (d.fnew){ const on = routeOf(d.fnew), r = on || tomorrowFor('marcus'); if (on) on.ids = on.ids.filter(x=>x!==d.fnew); else r.ids.push(d.fnew); dirty(r); toast(on ? 'Taken off its route' : `Added to ${firstName(r.who)}’s route tomorrow`); return render(); }
  if (d.fgo){ toast(`Goes to ${d.fgo} in the Command Center`); return; }
});
let wasPhone = PHONE(), rsF; addEventListener('resize', () => { if (PHONE()!==wasPhone){ wasPhone = PHONE(); render(); } else fitMaps();
  clearTimeout(rsF); rsF = setTimeout(() => { if (F.tab!=='placement' || !F.asp) return; const z = placeSize(); if (Math.abs(z.w/z.h - F.asp)/F.asp > .04) render(); }, 140); });
document.addEventListener('input', e => {
  if (e.target.id==='fpq'){ F.pq = e.target.value; F.page = 0; renderPosters(); const i = document.getElementById('fpq'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
});
document.addEventListener('keydown', e => { if (e.key==='Escape' && (F.scan!=null || F.poster!=null || R.panel)){ closeP(); render(); } if (e.key==='Enter' && e.target.id==='fcode') document.querySelector('[data-fcode]').click(); });
const hs = location.hash.slice(1).split(',');
['today','plan','visits','posters','placement'].forEach(t=>{ if (hs.includes(t)) F.tab = t; });
if (hs.includes('vlog')) R.panel = { k:'log', shop:'Mission Auto Care', out:'Ready to sign' };
if (hs.includes('vlead')) R.panel = { k:'lead', shop:'Tri-City Transmission' };
if (hs.includes('vrec')) R.panel = { k:'visit', i:1 };
if (hs.includes('scan')) F.scan = 27;
if (hs.includes('pick')) F.scan = 'pick';
if (hs.includes('poster')) F.poster = 44;
if (hs.includes('riv')) F.place = 'Riverside';
if (hs.includes('item')) R.panel = { k:'item', id:'p90' };
if (hs.includes('add')){ R.panel = { k:'add' }; R.addSel = 'Brockton Coffee'; R.addTask = 'talk'; }
if (hs.includes('send')) R.panel = { k:'send' };
if (hs.includes('rep')) R.me = 'marcus';
if (hs.includes('fri')) R.sel = 'r3';
if (hs.includes('newr')) R.panel = { k:'newroute', d:6, who:null };
if (hs.includes('mer')) R.panel = { k:'item', id:'m1' };
render();

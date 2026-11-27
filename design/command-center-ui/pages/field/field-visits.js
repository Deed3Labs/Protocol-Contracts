
/* ══ Visits: what happened in the field, and what it leads to ════════════════════════════════
   Every finished stop by anyone, with its outcome. Merchant visits carry a pipeline outcome that updates the shop in Merchants.
   Follow-ups are the merchant leads with a next step, sorted by when it's due; "gone quiet" are partners and leads nobody has seen lately.
   Ties: Uptown Barber signed today (Merchants: founding seat 3 of 5), Mission Auto Care's demo is tomorrow, Inland Cycle Works is signing. */
const V = { kind:'all', who:'all', lf:'due' };
const OUTC = { // outcome → tone, label, pipeline stage it leads to (merchant)
  'Not in':['line','Nobody to talk to',null], 'Not interested':['absent','Said no for now','closed'], 'Interested':['live','Wants to hear more',null],
  'Demo booked':['live','Demo on the calendar','talking'], 'Ready to sign':['underway','Agreement next','signing'], 'Signed':['settled','Agreement signed','signed'],
  'Replaced':['settled','New poster up',null], 'Checked':['settled','Up and fine',null], 'Damaged':['underway','Needs a swap',null], 'Missing':['absent','Gone from the window',null],
  'Fixed':['settled','Working again',null], 'Couldn’t fix':['absent','Needs another visit',null] };
const STAGE_N = { prospect:'Prospect', talking:'Talking', signing:'Signing', signed:'Signed', closed:'Closed' };
/* merchant leads: shop, city, stage, owner, last visit (days ago, null = never), next step, due (days from today), could finance a month */
const LEADS = [
  ['Mission Auto Care','Redlands','talking','marcus',7,'Demo the merchant app',1,9000],
  ['Orange Show Tires','San Bernardino','talking','marcus',8,'Bring the numbers',-2,7500],
  ['Tri-City Transmission','San Bernardino','talking','marcus',6,'Talk terms · wants NET-14',-4,8000],
  ['Barton Rd. Appliance','Grand Terrace','talking','dana',9,'Second visit',0,5500],
  ['Sun Valley HVAC','Highland','talking','marcus',5,'Ride-along with the owner',2,12000],
  ['Inland Cycle Works','Redlands','signing','kai',2,'Sign the agreement',5,0],
  ['Cypress Dental','Redlands','talking','kai',null,'Meet the owner',5,6000],
  ['Kingston Vet','Redlands','talking','kai',null,'Visit after the intro email',8,4500],
  ['Kendall Thrift','San Bernardino','signed','dana',49,'Check in · no charges in 3 weeks',null,0],
  ['Base Line Pho','San Bernardino','signed','marcus',54,'Check in · poster faded?',null,0],
  ['Citrus Plaza Optical','Redlands','signed','dana',57,'Check in · staff not set up',null,0],
  ['Redlands Smog & Brake','Redlands','prospect','marcus',null,'Walk in',null,5000],
  ['IE Mattress Outlet','Colton','prospect','dana',null,'Walk in',null,6500],
  ['Fontana Furniture','Fontana','prospect','dana',null,'Walk in',null,7000],
  ['Lugonia Auto Glass','Redlands','prospect','marcus',null,'Walk in',null,4000],
  ['Sunset Muffler','Rialto','prospect','marcus',null,'Walk in',null,3500]
].map(([shop,city,stage,owner,last,next,due,val])=>({ shop, city, stage, owner, last, next, due, val }));
/* the visit log: today's finished stops, then two weeks of history (weekdays) */
const VLOG = (() => {
  const r = rng(77), out = [], pick = a => a[Math.floor(r()*a.length)];
  const posterShops = POSTERS.filter(p=>!p.board);
  // fixed story entries
  const fixed = [
    [0,'09:20','marcus','Uptown Barber','Redlands','merchant','Sign the agreement','Signed','Founding seat 3 of 5. Andre wants the counter device by Friday.','signing'],
    [-2,'14:10','kai','Inland Cycle Works','Redlands','merchant','Walk through the agreement','Ready to sign','Owner wants a lawyer to read it. Signing next week.','talking'],
    [-2,'11:30','dana','Mesa Laundry','San Bernardino','poster','Check P-044','Damaged','Sun-faded. Window faces south; try the side window next time.',null],
    [-5,'15:40','marcus','Sun Valley HVAC','Highland','merchant','Walk in','Interested','Owner wants to see it on a real job. Ride-along Friday.','prospect'],
    [-6,'13:05','marcus','Tri-City Transmission','San Bernardino','merchant','Follow up','Interested','Likes it, but only on NET-14. Need an answer on terms.','talking'],
    [-7,'10:15','marcus','Mission Auto Care','Redlands','merchant','Walk in','Demo booked','Service manager Luis. Demo Thu 22 Oct, 10 am.','prospect'],
    [-8,'16:00','marcus','Orange Show Tires','San Bernardino','merchant','Walk in','Interested','Asked what it costs them. Promised to bring the numbers.','prospect'],
    [-9,'12:20','dana','Barton Rd. Appliance','Grand Terrace','merchant','Walk in','Interested','Good first talk. Owner back from vacation the 21st.','prospect'],
    [-9,'14:45','dana','Baseline Cuts','Rialto','merchant','Walk in','Not interested','Already takes a buy-now-pay-later app.','prospect'],
    [-12,'11:00','marcus','Mesa Laundry','San Bernardino','merchant','Walk in','Not in','Owner out. Came back on the 9th.',null] ];
  fixed.forEach(([d,t,who,shop,city,kind,what,outc,note,from])=>out.push({ d, t, who, shop, city, kind, what, out:outc, note, photo: kind==='poster', from, to: from && OUTC[outc][2] && OUTC[outc][2]!==from ? OUTC[outc][2] : null }));
  // today's finished route stops
  STOPS.forEach(s=>s.tasks.forEach(tk=>{ if (tk.done) out.push({ d:0, t:tk.done, who:'marcus', shop:s.name, city:s.city, kind:tk.kind, what:tk.t, out:tk.out || 'Fixed', note:'', photo:!!tk.photo }); }));
  // history: posters on Marcus's routes, devices and merchants mostly Dana
  for (let d=-1; d>=-14; d--){ const wd = new Date(dayT(d)).getUTCDay(); if (wd===0 || wd===6) continue;
    const n = 4 + Math.floor(r()*4); let t = 9*60 + 10;
    for (let i=0;i<n;i++){ const p = pick(posterShops), o = r()<.55 ? 'Checked' : r()<.75 ? 'Replaced' : r()<.6 ? 'Damaged' : 'Missing'; t += 20 + Math.floor(r()*25);
      out.push({ d, t:hhmm(t), who:'marcus', shop:p.shop, city:p.city, kind:'poster', what:`${o==='Replaced'?'Swap':'Check'} ${pid(p.n)}`, out:o, note:'', photo:r()<.7 }); }
    if (r()<.6){ const sh = pick(['Cajon Phone Repair','Highland Hardware','Citrus Bowl Café','Rosa’s Panadería','State St. Books']); const ok = r()<.8;
      out.push({ d, t:hhmm(13*60 + Math.floor(r()*120)), who:'dana', shop:sh, city: (SHOPLIST.find(x=>x[0]===sh)||[0,['Redlands']])[1][0], kind:'device', what: pick(['Swap the battery','Re-pair the Tap reader','Drop off receipt rolls']), out: ok ? 'Fixed' : 'Couldn’t fix', note:'', photo:false }); } }
  return out.sort((a,b)=> b.d-a.d || b.t.localeCompare(a.t));
})();
const vDay = d => d===0 ? 'Today' : d===-1 ? 'Yesterday' : fmtWD(dayT(d));
const visitsIn = days => VLOG.filter(v=>v.d > -days);
const dueLeads = () => LEADS.filter(l=>l.due!=null && l.stage!=='closed');
const quietLeads = () => LEADS.filter(l=>l.stage==='signed' && l.last!=null && l.last >= 30);
const newLeads = () => LEADS.filter(l=>l.stage==='prospect' && l.last==null);
const leadPool = l => POOL.find(x=>x.kind==='merchant' && x.shop===l.shop);
const leadRoute = l => { const x = leadPool(l); return x ? routeOf(x.id) : null; };

function renderVisits(){
  const me = R.me;
  /* follow-ups */
  const lists = { due:[dueLeads(),'Next step due'], quiet:[quietLeads(),'Partners nobody’s seen in 30+ days'], new:[newLeads(),'Prospects never visited'] };
  const L = lists[V.lf][0].slice().sort((a,b)=> V.lf==='due' ? a.due-b.due : V.lf==='quiet' ? b.last-a.last : (b.val||0)-(a.val||0));
  const dueTxt = l => l.due==null ? (l.last==null ? 'Never visited' : `Last seen ${l.last} days ago`) : l.due<0 ? `${-l.due} day${l.due===-1?'':'s'} overdue` : l.due===0 ? 'Due today' : l.due===1 ? 'Due tomorrow' : `Due ${fmtWD(dayT(l.due)).slice(0,3)}`;
  const sev = l => l.due!=null && l.due<0 ? 'absent' : l.due===0 || l.due===1 ? 'underway' : l.stage==='signed' ? 'underway' : 'line';
  const fuRow = l => { const rt = leadRoute(l);
    return `<div class="vf-r"><div class="vf-t"><i class="sv" style="background:${sevCol(sev(l))}"></i><button class="vf-n" data-flead="${l.shop}"><b>${l.shop}</b></button><span class="vf-a ${l.due!=null&&l.due<0?'bad':''}">${dueTxt(l)}</span></div>
      <span class="vf-m">${l.next} · ${STAGE_N[l.stage]} · ${l.owner===me?'your lead':firstName(l.owner)+'’s lead'}${l.last!=null && l.due!=null ? ` · last visit ${l.last}d ago` : ''}</span>
      <div class="vf-s">${rt ? `<span class="vf-on">On ${rt.who===me?'your':firstName(rt.who)+'’s'} ${fmtWD(dayT(rt.d)).slice(0,3)} route</span><button class="lnk3" data-froute="${rt.id}" data-ftabgo="plan">Open →</button>`
        : `<span class="vf-off">Not on a route</span><button class="lnk3" data-fleadroute="${l.shop}">Add to ${l.owner===me?'your':firstName(l.owner)+'’s'} route →</button>`}</div></div>`; };
  const fu = `<div class="cell s7"><div class="hd"><h2>Follow-ups</h2><div class="r"><div class="seg sm" role="group" aria-label="Show">${[['due','Due '+dueLeads().length],['quiet','Gone quiet '+quietLeads().length],['new','Never visited '+newLeads().length]].map(([k,t])=>`<button data-vlf="${k}" aria-pressed="${V.lf===k}">${t}</button>`).join('')}</div></div></div>
      <div class="vf-l">${L.map(fuRow).join('') || '<p class="small quiet" style="padding:18px 22px;margin:0">Nothing here.</p>'}</div>
      <div class="bk-ft"><span>${lists[V.lf][1]}. These come from the Merchants pipeline.</span><button data-fgo="merchants">Pipeline · Merchants →</button></div></div>`;
  /* what merchant visits led to, last 30 days */
  const mv = VLOG.filter(v=>v.kind==='merchant' && v.d > -30), cnt = k => mv.filter(v=>v.out===k).length;
  const steps = [['Merchant visits', mv.length], ['Talked to someone', mv.length - cnt('Not in')], ['Interested or further', mv.filter(v=>['Interested','Demo booked','Ready to sign','Signed'].includes(v.out)).length], ['Demo or further', mv.filter(v=>['Demo booked','Ready to sign','Signed'].includes(v.out)).length], ['Signed', cnt('Signed')]];
  const fn = `<div class="cell s5"><div class="hd"><h2>What visits led to</h2><div class="r"><span class="lbl">Merchants · 30 days</span></div></div>
      <div class="vfn">${steps.map(([t,n],i)=>`${i ? `<div class="vfn-c"><span></span><span><svg viewBox="0 0 10 10" aria-hidden="true"><path d="M5 1v8M2 6l3 3 3-3"/></svg><b>${steps[i-1][1] ? Math.round(n/steps[i-1][1]*100) : 0}%</b> kept going</span></div>` : ''}<div class="vfn-r"><span>${t}</span><span class="vfn-b"><i style="width:${n/Math.max(1,steps[0][1])*100}%" class="${i===steps.length-1?'on':''}"></i></span><b>${n}</b></div>`).join('')}</div>
      <div class="vfn-n">${mv.filter(v=>v.to).length} visits moved a shop forward in the pipeline</div>
      <div class="bk-ft"><span>${cnt('Not in') ? `Nobody was in ${cnt('Not in')===1?'once':cnt('Not in')+' times'}. Mornings work better.` : 'Someone was in every time.'}</span><span></span></div></div>`;
  /* the log */
  const who = Object.entries(TEAM).filter(([,t])=>t.field);
  const rows = VLOG.filter(v=>(V.kind==='all' || (V.kind==='poster' ? v.kind==='poster' : v.kind===V.kind)) && (V.who==='all' || v.who===V.who));
  let lastD = null;
  const log = rows.slice(0, 60).map((v,i)=>{ const hd = v.d!==lastD ? `<div class="vl-g"><span>${vDay(v.d)}</span><span>${rows.filter(x=>x.d===v.d).length} visits</span></div>` : ''; lastD = v.d; const o = OUTC[v.out] || ['line',''];
    return `${hd}<button class="vl-r" data-fvisit="${VLOG.indexOf(v)}"><span class="vl-tm">${v.t}</span><span class="av sm ${v.who===me?'':'dim'}">${TEAM[v.who].ini}</span>
      <span class="vl-k"><b>${v.shop}</b><span>${KIND[v.kind]} · ${v.what}</span></span>
      <span class="vl-o"><i class="sv" style="background:${sevCol(o[0])}"></i>${v.out}${v.to && STAGE_N[v.to]!==v.out ? `<span class="vl-st">→ ${STAGE_N[v.to]}</span>` : ''}</span>
      <span class="vl-x">${v.note ? '<span title="Has a note">Note</span>' : ''}${v.photo ? '<span title="Has a photo">Photo</span>' : ''}</span></button>`; }).join('');
  const lg = `<div class="cell s12"><div class="hd"><h2>Every visit</h2><div class="r"><div class="seg sm" role="group" aria-label="Kind">${[['all','All'],['poster','Posters'],['merchant','Merchants'],['device','Devices']].map(([k,t])=>`<button data-vkind="${k}" aria-pressed="${V.kind===k}">${t}</button>`).join('')}</div>
        <div class="seg sm" role="group" aria-label="Who">${[['all','Everyone'], ...who.map(([k,t])=>[k, k===me?'You':t.n.split(' ')[0]])].map(([k,t])=>`<button data-vwho="${k}" aria-pressed="${V.who===k}">${t}</button>`).join('')}</div></div></div>
      <div class="vl-l">${log || '<p class="small quiet" style="padding:18px 22px;margin:0">No visits match.</p>'}</div>
      <div class="bk-ft"><span>${rows.length} visits in two weeks${V.who!=='all' ? ' by '+(V.who===me?'you':TEAM[V.who].n) : ''}. Click one to see it.</span><button data-fgo="records">Audit log · Records →</button></div></div>`;
  /* by person, last 14 days */
  const pr = who.map(([k,t])=>{ const vs = VLOG.filter(v=>v.who===k), days = new Set(vs.map(v=>v.d)).size;
    return { k, t, n:vs.length, days, po:vs.filter(v=>v.kind==='poster').length, me2:vs.filter(v=>v.kind==='merchant').length, dv:vs.filter(v=>v.kind==='device').length, fwd:vs.filter(v=>v.to).length }; });
  const pmx = Math.max(...pr.map(p=>p.n), 1);
  const ppl = `<div class="cell s12"><div class="hd"><h2>By person</h2><div class="r"><span class="lbl">Last 14 days</span></div></div>
      <div class="bt-wrap"><table class="bt vp"><colgroup><col style="width:22%"><col style="width:10%"><col style="width:34%"><col style="width:12%"><col style="width:12%"><col style="width:10%"></colgroup>
        <thead><tr><th class="c-nm">Person</th><th>Days out</th><th style="text-align:left">Visits</th><th>Merchant</th><th>Moved forward</th><th></th></tr></thead><tbody>
        ${pr.map(p=>`<tr><td class="tn"><span class="vp-n"><span class="av sm">${p.t.ini}</span><b>${p.k===me?'You':p.t.n}</b></span></td><td>${p.days}</td>
          <td style="text-align:left"><span class="vp-b"><span class="vp-bar">${[['po','var(--fg)'],['me2','var(--live)'],['dv','var(--land)']].map(([f,c])=>p[f]?`<i style="width:${p[f]/pmx*100}%;background:${c}" title="${p[f]}"></i>`:'').join('')}</span><b>${p.n}</b></span></td>
          <td>${p.me2}</td><td>${p.fwd ? `<b class="ok">${p.fwd}</b>` : '<span class="quiet">0</span>'}</td><td><button class="lnk4" data-vwho="${p.k}">Their visits</button></td></tr>`).join('')}
        </tbody></table></div>
      <div class="bk-ft"><span class="f-key"><i style="background:var(--fg)"></i>Posters <i style="background:var(--live)"></i>Merchants <i style="background:var(--land)"></i>Devices</span><span></span></div></div>`;
  document.getElementById('fv').innerHTML = `
    <section class="band" style="margin-top:0"><div class="bento">${fu}${fn}</div></section>
    <section class="band"><div class="bento">${lg}</div></section>
    <section class="band"><div class="bento">${ppl}</div></section>`;
}

/* ── panels: a visit, and logging a merchant visit ── */
const VPANELS = ['visit','log','lead'];
function visitPanel(pn){
  const P = R.panel;
  if (P.k==='visit'){ const v = VLOG[P.i], o = OUTC[v.out] || ['line',''];
    pn.innerHTML = `<div class="pn-hd"><span class="lbl">${KIND[v.kind]} visit</span><span class="fst ${o[0]==='settled'?'ok':o[0]==='live'?'tlv':''}">${v.out}</span><button class="x" data-fclose aria-label="Close">${ICO.x}</button></div>
      <div class="pn-b"><div class="fpr-top"><span class="fshop">${v.shop.split(' ').map(w=>w[0]).slice(0,2).join('')}</span><div><h3>${v.shop}</h3><span class="small quiet">${v.city} · ${vDay(v.d)}, ${v.t} · ${TEAM[v.who].n}</span></div></div>
        <div class="fit"><b>${v.what}</b><span>${v.out} · ${o[1]}</span></div>
        ${v.to ? `<div><span class="lbl">Pipeline</span><div class="vst"><span>${STAGE_N[v.from]}</span><span class="vst-a">→</span><b>${STAGE_N[v.to]}</b></div><span class="small quiet">Updated the shop in Merchants</span></div>` : ''}
        <div><span class="lbl">Note</span><p class="vnote">${v.note || '<span class="quiet">No note</span>'}</p></div>
        ${v.photo ? `<div><span class="lbl">Photo</span><div class="vph">${v.kind==='poster' ? designThumb('B',40) : ''}<span>Taken at ${v.t}</span></div></div>` : ''}
      </div><div class="pn-ft">${v.kind==='merchant' ? `<button class="btn" data-fgo="merchants">In Merchants ↗</button>` : ''}<button class="btn" style="margin-left:auto" data-fclose>Close</button></div>`;
    return; }
  if (P.k==='lead'){ const l = LEADS.find(x=>x.shop===P.shop), rt = leadRoute(l), hist = VLOG.filter(v=>v.shop===l.shop), si = STAGES_M.findIndex(s=>s[0]===l.stage);
    pn.innerHTML = `<div class="pn-hd"><span class="lbl">Merchant · ${STAGE_N[l.stage]}</span><button class="x" data-fclose aria-label="Close">${ICO.x}</button></div>
      <div class="pn-b"><div class="fpr-top"><span class="fshop">${l.shop.split(' ').map(w=>w[0]).slice(0,2).join('')}</span><div><h3>${l.shop}</h3><span class="small quiet">${l.city} · ${l.owner===R.me?'your lead':firstName(l.owner)+'’s lead'}</span></div></div>
        <div class="fit"><b>${l.next}</b><span>${l.due==null ? (l.last==null ? 'Never visited' : `Nobody’s been in ${l.last} days`) : l.due<0 ? `${-l.due} days overdue` : l.due===0 ? 'Due today' : 'Due '+fmtWD(dayT(l.due))}</span></div>
        <div><span class="lbl">In the Merchants pipeline</span><div class="fpl">${STAGES_M.map(([k,t],i)=>`<span class="${i<si?'past':i===si?'now':''}">${t}</span>`).join('')}</div>${l.val ? `<span class="small quiet">Could finance about $${int(l.val)} a month</span>` : ''}</div>
        <div><span class="lbl">Visits</span>${hist.length ? hist.map(v=>`<div class="hs3"><b>${v.out}${v.to?' → '+STAGE_N[v.to]:''}</b><span>${vDay(v.d)} · ${firstName(v.who)}</span></div>`).join('') : '<p class="small quiet" style="margin:6px 0 0">No visits yet.</p>'}</div>
      </div>
      <div class="pn-ft mft">${rt ? `<button class="btn" data-froute="${rt.id}" data-ftabgo="plan">On ${firstName(rt.who)}’s ${fmtWD(dayT(rt.d)).slice(0,3)} route →</button>` : `<button class="btn" data-fleadroute="${l.shop}">Add to a route</button>`}<button class="btn p" data-flog="${l.shop}">Log a visit</button></div>`;
    return; }
  if (P.k==='log'){ const l = LEADS.find(x=>x.shop===P.shop) || { shop:P.shop, stage:'signed', city:'' }, sel = P.out, nxt = OUTC[sel] && OUTC[sel][2];
    const moves = sel && nxt && nxt!==l.stage && !(nxt==='talking' && l.stage!=='prospect');
    pn.innerHTML = `<div class="pn-hd"><span class="lbl">Log a visit</span><button class="x" data-fclose aria-label="Close">${ICO.x}</button></div>
      <div class="pn-b"><h3>${l.shop}</h3>
        <div><span class="lbl">What happened</span><div class="fad-t">${['Not in','Not interested','Interested','Demo booked','Ready to sign','Signed'].map(k=>`<button class="${sel===k?'on':''}" data-vout="${k}" aria-pressed="${sel===k}"><b>${k}</b><span>${OUTC[k][1]}</span></button>`).join('')}</div></div>
        ${moves ? `<div class="fnote">Moves ${l.shop} from <b>${STAGE_N[l.stage]}</b> to <b>${STAGE_N[nxt]}</b> in Merchants.</div>` : ''}
        <div><span class="lbl">Next step</span><input id="vnext" class="vin" placeholder="${sel==='Demo booked'?'Demo the merchant app':sel==='Ready to sign'?'Sign the agreement':sel==='Not interested'?'No next step':'What happens next'}" value="${P.next||''}">
          <div class="seg sm" style="margin-top:8px" role="group" aria-label="When">${[['1','Tomorrow'],['3','This week'],['7','Next week'],['','None']].map(([k,t])=>`<button data-vwhen="${k}" aria-pressed="${(P.when??'3')===k}">${t}</button>`).join('')}</div></div>
        <label><span class="lbl">Note</span><textarea id="vnote" class="cmp" rows="3" placeholder="Who you talked to, what they said"></textarea></label>
      </div>
      <div class="pn-ft"><span class="nx">${sel ? 'Saved to Merchants and Records' : 'Pick what happened'}</span><button class="btn" data-fclose>Cancel</button><button class="btn p" data-vsave ${!sel?'disabled':''}>Save the visit</button></div>`;
    return; }
}
/* add a lead to its owner's next route: tomorrow's if they have one, otherwise a new draft for tomorrow */
function leadToRoute(shop, who){ const l = LEADS.find(x=>x.shop===shop); let x = leadPool(l);
  if (!x){ x = { id:'m'+(POOL.length+100), kind:'merchant', shop:l.shop, city:l.city, what:l.next, why: l.stage==='signed' ? `Partner · last seen ${l.last} days ago` : l.last==null ? 'Never visited' : `Last visit ${l.last} days ago`, stage:l.stage, owner:l.owner, val:l.val, mins: l.stage==='prospect' ? 15 : 30, sev:'live' }; POOL.push(x); POOLBY[x.id] = x; }
  const w = who || l.owner; let r = R.routes.find(q=>q.d===1 && q.who===w);
  if (!r){ r = { id:'r'+(++R.nid), d:1, who:w, ids:[], status:'draft', by:R.me, start: STARTS[w] ? w : 'office' }; R.routes.push(r); }
  if (!r.ids.includes(x.id)) r.ids.push(x.id); dirty(r); return r; }
document.addEventListener('click', e => {
  const t = e.target.closest('button,a'); if (!t) return; const d = t.dataset;
  const done = () => { e.stopImmediatePropagation(); render(); };
  if (d.vlf){ if (F.tab!=='visits') F.tab = 'visits'; V.lf = d.vlf; return done(); }
  if (d.vkind){ V.kind = d.vkind; return done(); }
  if (d.vwho){ V.who = d.vwho; done(); if (t.closest('.vp')) document.querySelector('.vl-l').scrollIntoView({behavior:'smooth', block:'center'}); return; }
  if (d.fvisit){ R.panel = { k:'visit', i:+d.fvisit }; return done(); }
  if (d.flead){ R.panel = { k:'lead', shop:d.flead }; return done(); }
  if (d.ftabgo && d.froute){ R.sel = d.froute; F.tab = d.ftabgo; R.panel = null; e.stopImmediatePropagation(); render(); window.scrollTo({top:0}); return; }
  if (d.fleadroute){ const r = leadToRoute(d.fleadroute); R.panel = null; toast(`${d.fleadroute} added to ${r.who===R.me?'your':TEAM[r.who].n+'’s'} route tomorrow · ${r.status==='draft'?'not sent yet':'sent'}`); return done(); }
  if (d.flog){ R.panel = { k:'log', shop:d.flog, out:null }; return done(); }
  if (d.vout){ R.panel.out = d.vout; R.panel.next = (document.getElementById('vnext')||{}).value || ''; if (d.vout==='Not interested' || d.vout==='Signed') R.panel.when = ''; e.stopImmediatePropagation(); return renderPanel(); }
  if (d.vwhen!==undefined){ R.panel.when = d.vwhen; R.panel.next = (document.getElementById('vnext')||{}).value || ''; e.stopImmediatePropagation(); return renderPanel(); }
  if (t.hasAttribute('data-vsave')){ const P = R.panel, l = LEADS.find(x=>x.shop===P.shop), nxt = OUTC[P.out][2], note = (document.getElementById('vnote')||{}).value || '', next = (document.getElementById('vnext')||{}).value || '';
    const from = l ? l.stage : null, moves = l && nxt && nxt!==l.stage && !(nxt==='talking' && l.stage!=='prospect');
    const now = new Date(), tm = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    VLOG.unshift({ d:0, t:tm, who:R.me, shop:P.shop, city: l ? l.city : '', kind:'merchant', what: l ? l.next : 'Follow up', out:P.out, note, photo:false, from, to: moves ? nxt : null });
    if (l){ if (moves) l.stage = nxt; l.last = 0; const w = P.when ?? '3'; l.due = w==='' ? null : +w; if (next) l.next = next; else if (P.out==='Demo booked') l.next = 'Demo the merchant app'; else if (P.out==='Ready to sign') l.next = 'Sign the agreement'; }
    if (P.stop!=null){ const cur = curStop(), tk = cur && cur.tasks[P.stop]; if (tk){ tk.done = tm; tk.out = P.out; } }
    R.panel = null; toast(`Visit saved${moves ? ` · ${P.shop} is now ${STAGE_N[nxt]} in Merchants` : ''}`); return done(); }
}, true);

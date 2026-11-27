
/* ══ Plan: everyone's routes for the coming days ═════════════════════════════════════════════
   The week is shared: every route, for everyone, by day. A route belongs to one person on one day.
   Who can do what comes from the signed-in person (Permissions), not a switch on the page:
   · an admin plans any route and assigns it to themselves or to anyone with Field access, then sends it;
   · someone with Field access (a rep) plans only their own routes and saves them; everyone else's are read-only.
   A route is more than posters: merchant work from the Merchants pipeline (walk-ins, follow-ups, demos, signings)
   and counter-device fixes go on it too. Routes don't move money, so there's no second approval. */
const dayT = d => TODAY + d*DAY;
const POOLBY = Object.fromEntries(POOL.map(x=>[x.id,x]));
const DAYS = [1,2,5,6,7];
const STARTS = { office:['Office','Redlands', [34.0556,-117.1825]], marcus:['Marcus’s place','San Bernardino', [34.1170,-117.3010]], dana:['Dana’s place','Riverside', [33.9530,-117.3960]], kai:['Kai’s place','Redlands', [34.0420,-117.1700]] };
const R = { me:'kai', sel:'r1', pf:'all', near:true, show:false, snoozed:new Set(), dropped:new Set(), adhoc:0, nid:9, panel:null, q:'', addSel:null, addTask:'check', drag:null,
  routes:[
    { id:'r1', d:1, who:'marcus', ids:['p90','n1','p63'], status:'draft', by:'kai', start:'office' },
    { id:'r2', d:1, who:'dana', ids:['m4','m9'], status:'sent', by:'kai', start:'dana', sentAt:'Wed 21 Oct, 08:10' },
    { id:'r3', d:2, who:'dana', ids:['d1','d2'], status:'accepted', by:'kai', start:'dana', sentAt:'Tue 20 Oct', okAt:'Tue 20 Oct' },
    { id:'r4', d:2, who:'marcus', ids:['m3','p55'], status:'accepted', by:'marcus', start:'marcus', okAt:'Wed 21 Oct, 07:55' },
    { id:'r5', d:5, who:'kai', ids:['m6','m7'], status:'accepted', by:'kai', start:'kai', okAt:'Tue 20 Oct' } ] };
const ME = () => TEAM[R.me], isAdmin = () => !!ME().admin;
const RT = id => R.routes.find(r=>r.id===id);
const routeOf = item => R.routes.find(r=>r.ids.includes(item)) || null;
const dayOf = item => { const r = routeOf(item); return r ? r.d : null; };
const canEdit = r => !!r && (isAdmin() || r.who===R.me);
const firstName = k => TEAM[k].n.split(' ')[0];
const stopsOf = r => r.ids.map(id=>POOLBY[id]).filter(Boolean);
const km = (a, b) => { const dl = (b[0]-a[0])*Math.PI/180, dn = (b[1]-a[1])*Math.PI/180, h = Math.sin(dl/2)**2 + Math.cos(a[0]*Math.PI/180)*Math.cos(b[0]*Math.PI/180)*Math.sin(dn/2)**2; return 2*6371*Math.asin(Math.sqrt(h)) * 1.3; }; // road ≈ 1.3× straight line
const llOf = x => shopLL(x.shop, x.city);
const drive = (a, b) => Math.round(3 + km(a, b) * 1.4);
const hhmm = m => `${String(Math.floor(m/60)).padStart(2,'0')}:${String(Math.round(m%60)).padStart(2,'0')}`;
const hm = m => m >= 60 ? `${Math.floor(m/60)} h ${String(m%60).padStart(2,'0')} min` : `${m} min`;
function plan(r){ const st = stopsOf(r), home = STARTS[r.start][2]; let t = 9*60, at = home, miles = 0; const times = [];
  st.forEach(x=>{ const ll = llOf(x); t += drive(at, ll); miles += km(at, ll); times.push(t); t += x.mins; at = ll; });
  if (st.length){ t += drive(at, home); miles += km(at, home); }
  return { st, times, mins: st.length ? t - 9*60 : 0, back: st.length ? hhmm(t) : null, miles: Math.round(miles*0.621) }; }
function bestOrder(r){ const left = stopsOf(r); let at = STARTS[r.start][2]; const out = [];
  while (left.length){ left.sort((a,b)=>km(at, llOf(a)) - km(at, llOf(b))); const n = left.shift(); out.push(n.id); at = llOf(n); } r.ids = out; }
R.routes.forEach(bestOrder);
const STATUS = { draft:['Draft',''], sent:['Sent','tlv'], accepted:['Accepted','ok'] };
const statusChip = r => { const [t,c] = STATUS[r.status]; return `<span class="fst ${c}">${t}</span>`; };
/* a change to a route someone else already has sends it back to draft, so it gets sent again */
const dirty = r => { if (!r) return; if (r.status!=='draft' && r.who!==R.me){ r.status = 'draft'; r.changed = true; } else if (r.who===R.me && r.status==='accepted'){ r.status = 'draft'; r.changed = true; } };
const KIND = { poster:'Poster', new:'New poster', device:'Counter device', merchant:'Merchant', visit:'Visit' };
const STAGES_M = [['prospect','Prospect'],['talking','Talking'],['signing','Signing'],['signed','Signed']];
const tomorrowFor = who => R.routes.find(r=>r.d===1 && r.who===who) || R.routes.find(r=>r.d===1);
/* the signed-in person, shown top right; in the prototype it switches so you can see each role */
function renderMe(){ const el = document.getElementById('fme'); if (!el) return; const m = ME();
  el.innerHTML = `<button class="fme-b" data-fmeopen aria-haspopup="true"><span class="av">${m.ini}</span><span>${m.n} <span class="quiet">· ${m.role}</span></span><svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 4.5l3 3 3-3"/></svg></button>
    <div class="fme-m" hidden><span class="lbl">Prototype · sign in as</span>${['kai','marcus','dana'].map(k=>`<button data-fme="${k}" aria-pressed="${R.me===k}"><span class="av">${TEAM[k].ini}</span><span><b>${TEAM[k].n}</b><span>${TEAM[k].admin?'Admin · plans anyone’s routes':'Field access · plans their own'}</span></span></button>`).join('')}</div>`; }

function renderPlan(){
  renderMe();
  let r = RT(R.sel); if (!r){ r = R.routes.find(x=>x.who===R.me) || R.routes[0]; R.sel = r && r.id; }
  const me = R.me, edit = canEdit(r), P = r ? plan(r) : null;
  /* the week: one fixed-height strip for the whole team. Each day: the date, one avatar per route (the ring is its status),
     how much of the team's field time is used, and the one thing that needs you. More than five people collapse into +N. */
  const fieldN = Object.values(TEAM).filter(t=>t.field).length, CAP = fieldN * 300;
  const canAddOn = d => isAdmin() || !R.routes.some(x=>x.d===d && x.who===me);
  const av = x => `<button class="fwa ${x.status} ${R.sel===x.id?'on':''} ${x.who===me?'me':''}" data-froute="${x.id}" aria-pressed="${R.sel===x.id}" title="${x.who===me?'You':TEAM[x.who].n} · ${STATUS[x.status][0]} · ${plan(x).st.length} stops">${TEAM[x.who].ini}</button>`;
  const dayCol = (d, live) => { const rs = live ? [] : R.routes.filter(x=>x.d===d), mins = live ? 8*34 : rs.reduce((s,x)=>s+plan(x).mins,0), stops = live ? 8 : rs.reduce((s,x)=>s+x.ids.length,0);
    const selHere = rs.some(x=>x.id===R.sel), dt = new Date(dayT(live?0:d)), toSend = rs.filter(x=>x.status==='draft' && x.ids.length && x.who!==me).length, mineDraft = rs.filter(x=>x.status==='draft' && x.who===me && x.ids.length).length, waiting = rs.filter(x=>x.status==='sent').length;
    const need = live ? `<span class="tlv">Marcus is on stop ${STOPS.filter(stopDone).length+1} of 8</span>` : !rs.length ? '<span class="quiet">Nobody out</span>'
      : toSend && isAdmin() ? `<span class="warn">${toSend} not sent</span>` : mineDraft ? `<span class="warn">Yours isn’t saved</span>` : waiting ? `<span class="tlv">${waiting} waiting to accept</span>` : '<span class="ok">All set</span>';
    const shown = rs.slice(0,5), more = rs.length - shown.length, selOver = more && rs.slice(5).some(x=>x.id===R.sel);
    const segs = live ? `<i class="me" style="width:${mins/CAP*100}%"></i>` : rs.map(x=>`<i class="${x.id===R.sel?'on':''}" style="width:${plan(x).mins/CAP*100}%"></i>`).join('');
    return `<div class="fwd3 ${live?'live':''} ${selHere?'sel':''}">
      <div class="fwd3-h"><span class="lbl">${live ? 'Today' : d===1 ? 'Tomorrow' : WD[dt.getUTCDay()]}</span>${!live && canAddOn(d) ? `<button class="fwd3-add" data-fnewroute="${d}" aria-label="${isAdmin()?'New route':'Plan my route'} on ${fmtWD(dayT(d))}">+</button>` : ''}</div>
      <div class="fwd3-n"><b>${dt.getUTCDate()}</b><span>${MON[dt.getUTCMonth()]}</span></div>
      <div class="fwd3-a">${live ? `<span class="fwa live">ML</span>` : shown.map(av).join('')}${more ? `<button class="fwa more ${selOver?'on':''}" data-fdaymore="${d}" title="${rs.slice(5).map(x=>TEAM[x.who].n).join(', ')}">+${more}</button>` : ''}${!live && !rs.length ? '<span class="fwa none"></span>' : ''}</div>
      <div class="fwd3-b"><span class="fwd3-bar">${segs}</span><span class="fwd3-t">${stops ? `${stops} stop${stops===1?'':'s'} · ${hm(mins)}` : '–'}</span></div>
      <div class="fwd3-s">${need}</div></div>`; };
  const week = `<div class="cell s12"><div class="hd"><h2>The week</h2><div class="r"><span class="lbl">${fieldN} people with Field access</span></div></div>
      <div class="fwk3">${dayCol(0,true)}${DAYS.map(d=>dayCol(d,false)).join('')}</div>
      <div class="bk-ft"><span>The bar is the team’s field time used, out of ${fieldN} × 5 hours. ${isAdmin() ? 'Click a person to open their route.' : 'You can change your own routes.'}</span><span class="f-key fsq-k"><i class="fsq draft"></i>Draft <i class="fsq sent"></i>Sent <i class="fsq accepted"></i>Accepted</span></div></div>`;

  /* what needs a visit */
  const center = P && P.st.length ? [P.st.reduce((s,x)=>s+llOf(x)[0],0)/P.st.length, P.st.reduce((s,x)=>s+llOf(x)[1],0)/P.st.length] : STARTS[r ? r.start : 'office'][2];
  const sevRank = { absent:0, underway:1, live:2, line:3 };
  const kindOk = x => R.pf==='all' || (R.pf==='poster' ? (x.kind==='poster'||x.kind==='new') : x.kind===R.pf);
  let items = POOL.filter(x=>!R.dropped.has(x.id) && (R.show || !R.snoozed.has(x.id)) && kindOk(x));
  items.sort((a,b)=> R.near ? km(center, llOf(a)) - km(center, llOf(b)) : sevRank[a.sev]-sevRank[b.sev]);
  const unplanned = POOL.filter(x=>!R.dropped.has(x.id) && !R.snoozed.has(x.id) && !routeOf(x.id)).length;
  const poolRow = x => { const on = routeOf(x.id), here = r && on===r, dist = Math.round(km(center, llOf(x))*0.621), moveOk = !on || canEdit(on);
    const act = !edit ? '' : here ? `<button class="btn sm-b on" data-fadd="${x.id}" aria-label="Take ${x.shop} off this route">Added ✓</button>`
      : on && !moveOk ? `<span class="fp-taken">${firstName(on.who)} · ${fmtWD(dayT(on.d)).slice(0,3)}</span>`
      : on ? `<button class="btn sm-b" data-fadd="${x.id}">Move here</button>` : `<button class="btn sm-b" data-fadd="${x.id}">Add</button>`;
    const lead = x.kind==='merchant' && x.owner ? `<span class="fch ${x.owner===me?'ok':''}">${x.owner===me?'Your lead':firstName(x.owner)+'’s lead'}</span>` : '';
    return `<div class="fp-r ${here?'on':''} ${R.snoozed.has(x.id)?'snz':''}"><i class="fl-sv" style="background:${sevCol(x.sev)}"></i>
      <button class="fp-k" data-fitem="${x.id}"><b>${x.shop}</b><span>${x.what} · ${x.why}</span></button>
      <span class="fp-m">${lead || (on && !here ? `<span class="fch">${fmtWD(dayT(on.d)).slice(0,3)}</span>` : R.snoozed.has(x.id) ? '<span class="fch">Snoozed</span>' : `${dist} mi`)}</span>${act}</div>`; };
  const nK = k => POOL.filter(x=>!R.dropped.has(x.id) && !routeOf(x.id) && (k==='poster' ? (x.kind==='poster'||x.kind==='new') : x.kind===k)).length;
  const pool = `<div class="cell s5" id="fpool"><div class="hd"><h2>Needs a visit</h2><div class="r"><span class="lbl">${unplanned} not planned</span></div></div>
      <div class="fp-tb"><div class="seg sm" role="group" aria-label="Show">${[['all','All'],['poster','Posters'],['merchant','Merchants'],['device','Devices']].map(([k,t])=>`<button data-fpf2="${k}" aria-pressed="${R.pf===k}">${t}</button>`).join('')}</div>
        <div class="seg sm" role="group" aria-label="Sort">${[[true,'Nearest'],[false,'Most urgent']].map(([k,t])=>`<button data-fnear="${k}" aria-pressed="${R.near===k}">${t}</button>`).join('')}</div></div>
      <div class="fp-l">${items.map(poolRow).join('') || '<p class="small quiet" style="padding:16px 22px;margin:0">Nothing here needs a visit.</p>'}</div>
      <div class="bk-ft"><span>${R.pf==='merchant' ? 'From the Merchants pipeline' : R.near ? 'Nearest to this route first' : 'Most urgent first'}${R.snoozed.size ? ` · ${R.snoozed.size} snoozed` : ''}</span>${R.pf==='merchant' ? '<button data-fgo="merchants">Pipeline · Merchants →</button>' : R.snoozed.size ? `<button data-fshowsnz>${R.show?'Hide':'Show'} snoozed</button>` : '<span></span>'}</div></div>`;

  /* the selected route */
  let builder;
  if (!r){ builder = `<div class="cell s7" id="froute"><div class="hd"><h2>No route picked</h2></div><div class="fb"><div class="fb-empty" style="padding:28px 22px"><b>Pick a route in the week</b><span>Or add one with + ${isAdmin()?'Route':'My route'}.</span></div></div><div class="f-ft2"><span></span><span></span></div></div>`; }
  else {
    const ov = P.mins > 300, own = r.who===me, field = Object.entries(TEAM).filter(([,t])=>t.field);
    const stopRow = (x,i) => `<div class="fb-r" draggable="${edit}" data-fdrag="${i}"><span class="fb-h" aria-hidden="true">${edit?'⠿':''}</span><span class="fb-n">${i+1}</span>
        <button class="fs-k" data-fitem="${x.id}"><b>${x.shop}</b><span>${KIND[x.kind]} · ${x.what}</span></button><span class="fs-e">${hhmm(P.times[i])}</span>
        ${edit ? `<span class="fb-a"><button data-fmv="${i}|-1" ${i===0?'disabled':''} aria-label="Move up">↑</button><button data-fmv="${i}|1" ${i===P.st.length-1?'disabled':''} aria-label="Move down">↓</button><button data-fadd="${x.id}" aria-label="Take ${x.shop} off">${ICO.x}</button></span>` : ''}</div>`;
    const whoCtl = isAdmin() ? `<label class="fb-sel"><span class="lbl">Assigned to</span><select id="fwho">${field.map(([k,t])=>`<option value="${k}" ${r.who===k?'selected':''}>${k===me?'Me ('+t.n+')':t.n}</option>`).join('')}</select></label>`
      : `<span class="lbl">${own ? 'Your route' : TEAM[r.who].n+'’s route · read-only'}</span>`;
    const foot = !edit ? `<div class="f-ft2"><span class="small quiet">Planned by ${r.by===r.who ? firstName(r.who) : firstName(r.by)} · only ${firstName(r.who)} or an admin can change it</span><span></span></div>`
      : own ? `<div class="f-ft2"><span class="small quiet">${r.status==='accepted' ? `Saved · it’s on your phone${!isAdmin()?' and Kai can see it':''}` : r.changed ? 'Changed since you saved it' : 'Draft · save it to put it on your phone'}</span><button class="btn p" data-fsaveme ${!P.st.length||r.status==='accepted'?'disabled':''}>${r.status==='accepted' ? 'Saved ✓' : 'Save my route'}</button></div>`
      : r.status==='sent' ? `<div class="f-ft2"><span class="small quiet">Sent ${r.sentAt} · waiting for ${firstName(r.who)} to accept</span><button class="lnk3" data-funsend>Take it back</button></div>`
      : r.status==='accepted' ? `<div class="f-ft2"><span class="small"><b class="ok">${firstName(r.who)} ${r.by===r.who?'planned and saved it':'accepted'}</b> <span class="quiet">· ${r.okAt}</span></span><span class="small quiet">Changing it sends it again</span></div>`
      : `<div class="f-ft2"><span class="small quiet">${r.changed ? 'Changed since it was sent' : 'Draft · only you can see it'}</span><button class="btn p" data-fsend ${!P.st.length?'disabled':''}>Send to ${firstName(r.who)}</button></div>`;
    const sib = R.routes.filter(x=>x.d===r.d);
    builder = `<div class="cell s7" id="froute"><div class="hd"><h2>${fmtWD(dayT(r.d))}</h2>${statusChip(r)}<div class="r">${whoCtl}</div></div>
      ${sib.length > 1 ? `<div class="fsib" role="tablist" aria-label="Routes on ${fmtWD(dayT(r.d))}">${sib.map(x=>`<button role="tab" aria-selected="${x.id===r.id}" data-froute="${x.id}"><span class="av sm">${TEAM[x.who].ini}</span>${x.who===me?'You':TEAM[x.who].n}<i class="fsq ${x.status}"></i></button>`).join('')}</div>` : ''}
      <div class="fb">
        <div class="fb-m" data-fit="plan">${fitMap('plan', a => routeMap('plan', P.st.map(x=>({name:x.shop, city:x.city})), -1, a), 2.6)}</div>
        <div class="fb-s"><div><span class="lbl">Stops</span><b>${P.st.length}</b></div><div><span class="lbl">About</span><b class="${ov?'warn':''}">${P.st.length ? hm(P.mins) : '–'}</b></div><div><span class="lbl">Miles</span><b>${P.st.length ? P.miles : '–'}</b></div><div><span class="lbl">Back by</span><b>${P.back || '–'}</b></div></div>
        ${edit ? `<div class="fb-tb"><label class="fb-sel"><span class="lbl">Start</span><select id="fstart">${Object.entries(STARTS).filter(([k])=>k==='office'||k===r.who).map(([k,[n]])=>`<option value="${k}" ${r.start===k?'selected':''}>${n}</option>`).join('')}</select></label>
          <span class="fb-tbr"><button class="btn sm-b" data-fbest ${P.st.length<3?'disabled':''}>Best order</button><button class="btn sm-b" data-faddstop>+ Add a stop</button></span></div>` : ''}
        ${ov ? `<div class="fair fb-warn">${ICO.warn}<span>That’s over a 5-hour day. Move a stop to another day or split the route.</span></div>` : ''}
        <div class="fb-l">${P.st.length ? P.st.map(stopRow).join('') + `<div class="fb-end"><span class="fb-n">⌂</span><span>Back at ${STARTS[r.start][0].toLowerCase()}</span><span class="fs-e">${P.back}</span></div>`
          : `<div class="fb-empty"><b>No stops yet</b><span>${edit ? 'Add things from Needs a visit, or add a stop of your own.' : 'Nothing planned for this route.'}</span></div>`}</div>
      </div>${foot}</div>`;
  }
  document.getElementById('fv').innerHTML = `
    <section class="band" style="margin-top:0"><div class="bento">${week}</div></section>
    <section class="band"><div class="bento">${builder}${pool}</div></section>`;
}

/* ── panels ── */
const TASKS = [['check','Check the poster',12,'visit'],['swap','Swap the poster',18,'poster'],['new','Put up a new poster',25,'new'],['walkin','Walk in and pitch',15,'merchant'],['follow','Follow up',20,'merchant'],['demo','Demo the merchant app',40,'merchant'],['device','Fix a counter device',20,'device'],['talk','Talk to the owner',15,'visit']];
const SHOPLIST = (() => { const s = new Map(); SHOPS.forEach(x=>s.set(x[1], [x[7],'Partner'])); OTHER_SHOPS.forEach((n,i)=>s.set(n, [OTHER_CITY[i],'Partner']));
  [['Magnolia Laundry','Riverside'],['Sierra Lakes Barber','Fontana'],['Brockton Coffee','Riverside'],['Baseline Cuts','Rialto'],['Kingston Vet','Redlands'],['Lugonia Auto Glass','Redlands'],['Sunset Muffler','Rialto'],['University Optometry','Redlands'],['Yucaipa Pet Clinic','Yucaipa']].forEach(([n,c])=>s.set(n,[c,'Prospect'])); return [...s.entries()]; })();
function planPanel(pn){
  const P = R.panel, r = RT(R.sel), dayName = r ? fmtWD(dayT(r.d)) : '';
  if (P.k==='item'){ const x = POOLBY[P.id], on = routeOf(x.id), p = x.n ? POSTERS.find(q=>q.n===x.n) : null, L = p ? life(p) : null;
    const info = ['8 pm','6 pm','7 pm','9 pm','5 pm'][hashN(x.shop)%5], who = ['the owner','Luis','Kim','Ms. Tran','Hector','Sofia'][hashN(x.shop)%6];
    const si = x.kind==='merchant' ? STAGES_M.findIndex(s=>s[0]===x.stage) : -1;
    const btn = !r || !canEdit(r) ? '' : on===r ? `<button class="btn p" data-fadd="${x.id}">Take off ${dayName.slice(0,3)}</button>`
      : on && !canEdit(on) ? `<span class="small quiet">On ${firstName(on.who)}’s ${fmtWD(dayT(on.d)).slice(0,3)} route</span>` : `<button class="btn p" data-fadd="${x.id}" title="${r.who===R.me?'Your':firstName(r.who)+'’s'} ${dayName} route">${on ? 'Move' : 'Add'} to ${dayName.slice(0,3)}</button>`;
    pn.innerHTML = `<div class="pn-hd"><span class="lbl">${KIND[x.kind]}</span><i class="fl-sv" style="background:${sevCol(x.sev)}"></i><button class="x" data-fclose aria-label="Close">${ICO.x}</button></div>
      <div class="pn-b">
        <div class="fpr-top">${p ? designThumb(p.design,48) : x.kind==='device' ? batteryThumb(48,1) : x.kind==='merchant' ? `<span class="fshop">${x.shop.split(' ').map(w=>w[0]).slice(0,2).join('')}</span>` : designThumb(x.design||'B',48)}<div><h3>${x.shop}</h3><span class="small quiet">${x.city}</span></div></div>
        <div class="fit"><b>${x.what}</b><span>${x.why}</span></div>
        ${x.kind==='merchant' ? `<div><div class="w90-h"><span class="lbl">In the Merchants pipeline</span>${x.owner?`<b>${x.owner===R.me?'Your lead':firstName(x.owner)+'’s lead'}</b>`:''}</div>
            <div class="fpl">${STAGES_M.map(([k,t],i)=>`<span class="${i<si?'past':i===si?'now':''}">${t}</span>`).join('')}</div>
            ${x.val ? `<span class="small quiet">Could finance about $${int(x.val)} a month</span>` : ''}</div>` : ''}
        ${p ? `<div class="w90"><div class="w90-h"><span class="lbl">Poster ${pid(p.n)} · 60-day life</span><b class="${L.d<0||p.status!=='up'?'warn':''}">${p.status==='missing'?'Gone':L.d<0?`${-L.d} days late`:`${L.d} days left`}</b></div><span class="wbar big ${L.d<10||p.status!=='up'?'lo':''}"><i style="width:${L.pct*100}%"></i></span><span class="small quiet">Design ${p.design} · ${p.scans} scans in 30 days · hung ${fmtD(p.hung)}</span></div>` : ''}
        <div class="led"><div><span>Open until</span><b>${info}</b></div><div><span>Ask for</span><b>${who}</b></div><div><span>Takes about</span><b>${x.mins} min</b></div><div><span>Planned</span><b>${on ? `${fmtWD(dayT(on.d))} · ${on.who===R.me?'you':firstName(on.who)}` : 'Not yet'}</b></div></div>
        ${x.kind==='merchant' ? `<p class="small quiet" style="margin:0">Whatever happens on the visit gets logged back to this shop in Merchants.</p>` : x.kind==='device' ? `<p class="small quiet" style="margin:0">From Merchants. Bring a spare battery and a receipt roll.</p>` : x.kind==='new' ? `<p class="small quiet" style="margin:0">From Placement. The owner said yes; bring design ${x.design}.</p>` : ''}
      </div>
      <div class="pn-ft mft">${btn}${x.kind==='merchant' ? `<button class="btn" data-fgo="merchants">In Merchants ↗</button>` : ''}
        <div class="more3"><button class="btn" data-fmore>More ▾</button><div class="mm3" hidden><button data-fsnooze="${x.id}">${R.snoozed.has(x.id)?'Unsnooze':'Snooze a week'} <span>Hides it</span></button><button class="dz" data-fdrop="${x.id}">Not needed <span>Logged</span></button></div></div></div>`;
    return; }
  if (P.k==='add'){ const q = R.q.trim().toLowerCase(), list = SHOPLIST.filter(([n,[c]])=>!q || n.toLowerCase().includes(q) || c.toLowerCase().includes(q)).slice(0,8);
    pn.innerHTML = `<div class="pn-hd"><span class="lbl">Add a stop · ${dayName}</span><button class="x" data-fclose aria-label="Close">${ICO.x}</button></div>
      <div class="pn-b">
        <div><span class="lbl">Shop</span><label class="msearch" style="margin-top:8px;max-width:none"><svg class="i" viewBox="0 0 20 20"><circle cx="9" cy="9" r="5"/><path d="M13 13l4 4"/></svg><input id="faddq" placeholder="Search partners and prospects" value="${R.q.replace(/"/g,'&quot;')}" autocomplete="off"></label>
          <div class="fad-l">${list.map(([n,[c,k]])=>`<button class="fad-r ${R.addSel===n?'on':''}" data-faddsel="${n}"><b>${n}</b><span>${c} · ${k}</span></button>`).join('') || '<p class="small quiet" style="margin:8px 0">No shop matches. Add new prospects in Merchants first.</p>'}</div></div>
        <div><span class="lbl">What to do there</span><div class="fad-t">${TASKS.map(([k,t,m])=>`<button class="${R.addTask===k?'on':''}" data-ftask="${k}" aria-pressed="${R.addTask===k}"><b>${t}</b><span>about ${m} min</span></button>`).join('')}</div></div>
        <label><span class="lbl">Note for whoever goes</span><textarea id="faddnote" class="cmp" rows="2" placeholder="Optional"></textarea></label>
      </div>
      <div class="pn-ft"><span class="nx">${R.addSel ? R.addSel : 'Pick a shop'}</span><button class="btn" data-fclose>Cancel</button><button class="btn p" data-faddgo ${!R.addSel?'disabled':''}>Add to ${dayName.slice(0,3)}</button></div>`;
    return; }
  if (P.k==='send'){ const Pl = plan(r), load = {A:0,B:0,C:0}; let dev = 0, mer = 0; Pl.st.forEach(x=>{ if (x.design) load[x.design]++; if (x.kind==='device') dev++; if (x.kind==='merchant') mer++; });
    const nm = TEAM[r.who].n;
    pn.innerHTML = `<div class="pn-hd"><span class="lbl">Send the route</span><button class="x" data-fclose aria-label="Close">${ICO.x}</button></div>
      <div class="pn-b"><h3>${dayName} · ${nm}</h3>
        <div class="bx4">${[['Stops',Pl.st.length],['About',hm(Pl.mins)],['Miles',Pl.miles],['Back by',Pl.back]].map(([t,v])=>`<div><span class="lbl">${t}</span><b style="font-size:16px;white-space:nowrap">${v}</b></div>`).join('')}</div>
        <div><span class="lbl">The stops</span><div class="fsd">${Pl.st.map((x,i)=>`<div><span class="fb-n">${i+1}</span><span><b>${x.shop}</b><span class="small quiet"> · ${x.what}</span></span><span>${hhmm(Pl.times[i])}</span></div>`).join('')}</div></div>
        <div><span class="lbl">Bring</span><div class="fv fsl">${Object.entries(load).filter(([,v])=>v).map(([k,v])=>`<div class="fv-r">${designThumb(k,20)}<span class="fv-k"><b>${v} × design ${k}</b><span>${DESIGNS[k].name}</span></span></div>`).join('')}
          ${dev ? `<div class="fv-r">${batteryThumb(20)}<span class="fv-k"><b>${dev} spare batter${dev===1?'y':'ies'} and receipt rolls</b><span>For the counter device fixes</span></span></div>` : ''}
          ${mer ? `<div class="fv-r"><span class="fshop sm">M</span><span class="fv-k"><b>Merchant kit</b><span>Agreements, a demo tablet and window stickers · ${mer} merchant stop${mer===1?'':'s'}</span></span></div>` : ''}</div></div>
        <label><span class="lbl">Note for ${firstName(r.who)}</span><textarea id="fsendnote" class="cmp" rows="3" placeholder="Anything they should know"></textarea></label>
      </div>
      <div class="pn-ft"><span class="nx">${firstName(r.who)} gets it on the phone</span><button class="btn" data-fclose>Not yet</button><button class="btn p" data-fsendgo>Send</button></div>`;
    return; }
  if (P.k==='newroute'){ const who = isAdmin() ? P.who : R.me, field = Object.entries(TEAM);
    pn.innerHTML = `<div class="pn-hd"><span class="lbl">${isAdmin() ? 'New route' : 'Plan my route'}</span><button class="x" data-fclose aria-label="Close">${ICO.x}</button></div>
      <div class="pn-b"><h3>${isAdmin() ? 'Who and when' : 'Pick a day'}</h3>
        <div><span class="lbl">Day</span><div class="fad-t">${DAYS.concat([8,9]).map(d=>{ const taken = who && R.routes.some(x=>x.d===d && x.who===who), n = R.routes.filter(x=>x.d===d).length;
          return `<button class="${P.d===d?'on':''}" data-fnrday="${d}" ${taken?'disabled':''}><b>${d===1?'Tomorrow · ':''}${fmtWD(dayT(d))}</b><span>${taken ? (who===R.me?'You':firstName(who))+' already have one' : n ? n+' other route'+(n===1?'':'s') : 'Nothing planned'}</span></button>`; }).join('')}</div></div>
        ${isAdmin() ? `<div><span class="lbl">Who goes</span><div class="fwho">${field.map(([k,t])=>`<button data-fnrwho="${k}" aria-pressed="${who===k}" ${!t.field?'disabled':''}><span class="av sm">${t.ini}</span><span><b>${k===R.me?'Me':t.n}</b><span>${t.role}${t.field?'':' · no Field access'}</span></span></button>`).join('')}</div>
          <p class="small quiet" style="margin:8px 0 0">Only people with Field access can take a route. Change access in Permissions.</p></div>` : `<p class="small quiet" style="margin:0">You can plan routes for yourself. To plan for someone else, ask an admin.</p>`}
      </div>
      <div class="pn-ft"><span class="nx">Then add its stops</span><button class="btn" data-fclose>Cancel</button><button class="btn p" data-fnrgo ${!P.d||!who?'disabled':''}>Start the route</button></div>`;
    return; }
}

/* ── plan events (before Field's main handler) ── */
document.addEventListener('click', e => {
  const t = e.target.closest('button,select,input');
  const menu = document.querySelector('.fme-m'); if (menu && !menu.hidden && !(t && t.closest('#fme'))) menu.hidden = true;
  if (!t) return; const d = t.dataset, r = RT(R.sel);
  const done = () => { e.stopImmediatePropagation(); render(); };
  if (t.hasAttribute('data-fmeopen')){ const m = document.querySelector('.fme-m'); m.hidden = !m.hidden; e.stopImmediatePropagation(); return; }
  if (d.fme){ R.me = d.fme; R.panel = null; const own = R.routes.find(x=>x.who===R.me); if (own && !canEdit(RT(R.sel))) R.sel = own.id; toast(`Signed in as ${TEAM[R.me].n} · ${TEAM[R.me].admin?'admin':'Field access'}`); return done(); }
  if (d.fdaymore){ const rs = R.routes.filter(x=>x.d===+d.fdaymore); R.sel = rs[5].id; return done(); }
  if (d.froute){ R.sel = d.froute; R.panel = null; if (F.tab!=='plan') F.tab = 'plan'; return done(); }
  if (d.fpf2){ R.pf = d.fpf2; return done(); }
  if (d.fnear){ R.near = d.fnear==='true'; return done(); }
  if (t.hasAttribute('data-fshowsnz')){ R.show = !R.show; return done(); }
  if (d.fitem){ R.panel = { k:'item', id:d.fitem }; F.scan = null; F.poster = null; return done(); }
  if (d.fadd){ if (!canEdit(r)) return; const id = d.fadd, on = routeOf(id);
    if (on===r){ r.ids = r.ids.filter(x=>x!==id); toast(`${POOLBY[id].shop} taken off`); }
    else { if (on){ if (!canEdit(on)) return; on.ids = on.ids.filter(x=>x!==id); dirty(on); } r.ids.push(id); toast(`${POOLBY[id].shop} ${on?'moved':'added'} to ${r.who===R.me?'your':firstName(r.who)+'’s'} ${fmtWD(dayT(r.d)).slice(0,3)} route`); }
    dirty(r); if (R.panel && R.panel.k==='item' && t.closest('.panel')) R.panel = null; return done(); }
  if (d.fmv){ const [i,dir] = d.fmv.split('|').map(Number), a = r.ids, j = i+dir; [a[i],a[j]] = [a[j],a[i]]; dirty(r); return done(); }
  if (t.hasAttribute('data-fbest')){ bestOrder(r); dirty(r); toast('Stops put in the shortest order'); return done(); }
  if (t.hasAttribute('data-fsaveme')){ r.status = 'accepted'; r.by = R.me; r.okAt = 'just now'; r.changed = false; toast(isAdmin() ? 'Saved · it’s on your phone' : 'Saved · it’s on your phone and Kai can see it'); return done(); }
  if (t.hasAttribute('data-fsend')){ R.panel = { k:'send' }; return done(); }
  if (t.hasAttribute('data-fsendgo')){ r.status = 'sent'; r.sentAt = 'just now'; r.changed = false; R.panel = null; toast(`Sent · ${TEAM[r.who].n} gets it on the phone`); return done(); }
  if (t.hasAttribute('data-funsend')){ r.status = 'draft'; toast('Taken back · it’s a draft again'); return done(); }
  if (t.hasAttribute('data-faddstop')){ R.panel = { k:'add' }; R.q = ''; R.addSel = null; R.addTask = 'check'; return done(); }
  if (d.faddsel){ R.addSel = d.faddsel; e.stopImmediatePropagation(); return renderPanel(); }
  if (d.ftask){ R.addTask = d.ftask; e.stopImmediatePropagation(); return renderPanel(); }
  if (t.hasAttribute('data-faddgo')){ const task = TASKS.find(x=>x[0]===R.addTask), [city,kd] = SHOPLIST.find(x=>x[0]===R.addSel)[1], id = 'a'+(++R.adhoc), note = (document.getElementById('faddnote')||{}).value || '';
    const x = { id, kind:task[3], shop:R.addSel, city, what:task[1], why: note || (kd==='Prospect' ? 'Prospect · added by hand' : 'Added by hand'), sev:'line', mins:task[2], design: task[3]==='new'||task[3]==='poster' ? 'B' : undefined, stage: kd==='Prospect' ? 'prospect' : undefined };
    POOL.push(x); POOLBY[id] = x; r.ids.push(id); dirty(r); R.panel = null; toast(`${R.addSel} added`); return done(); }
  if (d.fnewroute!==undefined && t.hasAttribute('data-fnewroute')){ R.panel = { k:'newroute', d: d.fnewroute ? +d.fnewroute : null, who: isAdmin() ? null : R.me }; return done(); }
  if (d.fnrday){ R.panel.d = +d.fnrday; e.stopImmediatePropagation(); return renderPanel(); }
  if (d.fnrwho){ R.panel.who = d.fnrwho; if (R.routes.some(x=>x.d===R.panel.d && x.who===d.fnrwho)) R.panel.d = null; e.stopImmediatePropagation(); return renderPanel(); }
  if (t.hasAttribute('data-fnrgo')){ const { d:dd } = R.panel, who = isAdmin() ? R.panel.who : R.me, id = 'r'+(++R.nid);
    if (!DAYS.includes(dd)){ DAYS.push(dd); DAYS.sort((a,b)=>a-b); }
    R.routes.push({ id, d:dd, who, ids:[], status:'draft', by:R.me, start: STARTS[who] ? who : 'office' }); R.sel = id; R.panel = null;
    toast(`${fmtWD(dayT(dd))} · route started for ${who===R.me?'you':TEAM[who].n}`); return done(); }
  if (d.fsnooze){ R.snoozed.has(d.fsnooze) ? R.snoozed.delete(d.fsnooze) : R.snoozed.add(d.fsnooze); toast(R.snoozed.has(d.fsnooze) ? 'Snoozed for a week' : 'Back in the list'); R.panel = null; return done(); }
  if (d.fdrop){ const on = routeOf(d.fdrop); if (on){ on.ids = on.ids.filter(x=>x!==d.fdrop); dirty(on); } R.dropped.add(d.fdrop); toast('Marked not needed · logged in Records'); R.panel = null; return done(); }
  if (t.hasAttribute('data-fmore')){ const mm = t.parentElement.querySelector('.mm3'); mm.hidden = !mm.hidden; e.stopImmediatePropagation(); return; }
}, true);
document.addEventListener('change', e => { const r = RT(R.sel);
  if (e.target.id==='fstart'){ r.start = e.target.value; dirty(r); render(); }
  if (e.target.id==='fwho'){ const w = e.target.value; if (R.routes.some(x=>x!==r && x.d===r.d && x.who===w)){ toast(`${TEAM[w].n} already has a route that day`); render(); return; } r.who = w; if (r.start!=='office') r.start = STARTS[w] ? w : 'office'; dirty(r); r.status = 'draft'; render(); } });
document.addEventListener('input', e => { if (e.target.id==='faddq'){ R.q = e.target.value; renderPanel(); const i = document.getElementById('faddq'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); } });
document.addEventListener('dragstart', e => { const row = e.target.closest && e.target.closest('[data-fdrag]'); if (!row) return; R.drag = +row.dataset.fdrag; row.classList.add('drag'); e.dataTransfer.effectAllowed = 'move'; });
document.addEventListener('dragover', e => { const row = e.target.closest && e.target.closest('[data-fdrag]'); if (R.drag==null || !row) return; e.preventDefault(); document.querySelectorAll('.fb-r.over').forEach(x=>x.classList.remove('over')); row.classList.add('over'); });
document.addEventListener('drop', e => { const row = e.target.closest && e.target.closest('[data-fdrag]'); if (R.drag==null || !row) return; e.preventDefault(); const r = RT(R.sel), a = r.ids, to = +row.dataset.fdrag, [m] = a.splice(R.drag,1); a.splice(to,0,m); R.drag = null; dirty(r); render(); });
document.addEventListener('dragend', () => { R.drag = null; document.querySelectorAll('.fb-r.drag,.fb-r.over').forEach(x=>x.classList.remove('drag','over')); });

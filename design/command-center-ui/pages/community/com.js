
/* ══ Community — where members talk, meet and watch ═══════════════════════════════════════════════════════════
   Overview (what's on and what needs you) · Forum (every thread, and moderation) · Live (town halls, spaces,
   presentations, hearings) · Channel (Clear on Dial). Decisions are tracked in Governance; this is the conversation. */
const C = { tab:'overview', cat:'all', tp:0, ep:0, panel:null, me:'kai', ev:'list', mo:0 };
const ICO = { chev:'<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5"/></svg>', back:'<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3.5 5.5 8l4.5 4.5"/></svg>',
  x:'<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
  talk:'<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z"/></svg>',
  eye:'<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8s-2.4 4.5-6.5 4.5S1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/></svg>',
  air:'<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="1.6"/><path d="M5 5a4.2 4.2 0 0 0 0 6M11 5a4.2 4.2 0 0 1 0 6M3 3a7 7 0 0 0 0 10M13 3a7 7 0 0 1 0 10"/></svg>' };
function toast(t){ let el = document.getElementById('toast'); if (!el){ el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el); } el.innerHTML = t; el.classList.add('on'); clearTimeout(el._t); el._t = setTimeout(()=>el.classList.remove('on'), 3200); }
const cell = (cls, title, right, body, foot) => `<div class="cell ${cls}"><div class="hd"><h2>${title}</h2><div class="r">${right}</div></div>${body}<div class="bk-ft">${foot}</div></div>`;
const lbl = t => `<span class="lbl">${t}</span>`;
const band = (cells, first) => `<section class="band"${first?' style="margin-top:0"':''}><div class="bento">${cells}</div></section>`;
const pager = (p, n, per, key) => { const pages = Math.max(1, Math.ceil(n/per)); return `<span class="pg2"><span>${n ? p*per+1 : 0}–${Math.min(n,(p+1)*per)} of ${n}</span><button data-${key}="-1" ${p===0?'disabled':''} aria-label="Previous">${ICO.back}</button><button data-${key}="1" ${p>=pages-1?'disabled':''} aria-label="Next">${ICO.chev}</button></span>`; };
const pagerOr = (p, n, per, key, noun) => n > per ? pager(p, n, per, key) : `<span class="quiet">${n} ${noun}</span>`;
const av = k => `<span class="av sm" title="${who(k)}">${PPL[k] ? PPL[k].ini : k.toUpperCase()}</span>`;
const STAFF = () => !!PPL[C.me] && PPL[C.me].staff;
const kindTag = e => `<span class="cm-kt ${e.kind}">${KIND[e.kind][0]}</span>`;
const hrs = n => { const h = Math.floor(n), m = Math.round((n-h)*60); return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`; };
const nowH = (NOW - TODAY)/3600e3;
const live = () => EVENTS.find(e=>e.st==='live');
const reqs = () => EVENTS.filter(e=>e.st==='request');
const flagsOpen = () => FLAGS.filter(f=>f.st==='open');

/* ── header ── */
function renderHdr(){
  const L = live(), wk = EVENTS.filter(e=>e.st!=='past' && e.at>=NOW-DAY && e.at<NOW+7*DAY), part = PART.any[PART.any.length-1];
  const B = {
    overview: `${L ? `<a data-copen="${L.id}">${L.t}</a> is live with ${L.live} listening. ` : ''}Tomorrow’s town hall has ${EV['E-34'].rsvp} coming and ${EV['E-34'].q - EV['E-34'].qSorted} questions still to sort.`,
    forum: `${POSTS_WK[POSTS_WK.length-1]} posts this week, the most so far. ${flagsOpen().length} flagged posts are waiting for a moderator.`,
    live: `${reqs().length} members have asked to host something. The last hearing answered ${EV['E-31'].qAns} of ${EV['E-31'].q} questions.`,
    channel: `${CH.name} is on ${CH.num} with ${CH.viewers} watching. Tomorrow at 18:00 the town hall airs live.` }[C.tab];
  const segs = (arr, col) => arr.map((x,i)=>`<i style="left:${i/Math.max(5,arr.length)*100}%;width:calc(${100/Math.max(5,arr.length)}% - 2px);background:${col(x)}"></i>`).join('');
  const pw = POSTS_WK, pmx = Math.max(...pw);
  document.getElementById('hdr').innerHTML = `<span class="when"><span class="dot"></span>Community · Wed 21 Oct · Demo data</span><p class="brief">${B}</p>
    <div class="strip">
      <div class="sc" ${L?`data-copen="${L.id}"`:''}><span class="lbl">On air now</span><div class="sc-v">${L ? L.live : 0} <small>${L ? 'listening' : 'nothing live'}</small></div><div class="mb"><i style="width:${L ? L.live/L.peak*100 : 0}%;background:var(--absent)"></i></div><div class="sc-s">${L ? `${L.t} · peak ${L.peak}` : 'Next: tomorrow 18:00'}</div></div>
      <div class="sc" data-ctab="live"><span class="lbl">Next 7 days</span><div class="sc-v">${wk.filter(e=>e.st!=='request').length} <small>events</small></div><div class="mb">${segs(wk, e=>e.st==='request' ? 'var(--line)' : e.st==='live' ? 'var(--absent)' : 'var(--fg)')}</div><div class="sc-s">${wk.filter(e=>e.st==='request').length} more asked for · ${EV['E-34'].rsvp} coming tomorrow</div></div>
      <div class="sc" data-ctab="forum"><span class="lbl">Forum this week</span><div class="sc-v">${pw[pw.length-1]} <small>posts</small></div><div class="mb">${pw.map((v,i)=>`<i style="left:${i/pw.length*100}%;width:calc(${100/pw.length}% - 2px);background:color-mix(in srgb,var(--fg) ${Math.round(18+v/pmx*70)}%,transparent)"></i>`).join('')}</div><div class="sc-s">${Math.round((pw[6]/pw[5]-1)*100)}% more than last week · ${IDEAS} ideas</div></div>
      <div class="sc" data-cjump="cm-part"><span class="lbl">Taking part</span><div class="sc-v">${part} <small>of ${MEMBERS} members</small></div><div class="mb"><i style="width:${part/MEMBERS*100}%;background:var(--land)"></i></div><div class="sc-s">${pct(part,MEMBERS)} posted, came or watched this week</div></div>
    </div>`;
}

/* ── shared pieces ── */
function needsCell(){
  const E3 = EV['E-34'], N = [
    ...reqs().map(e=>['underway', `Approve: ${e.t}`, `${who(e.host)} asked to host · ${WD(e.at)} ${fmtD(e.at)} ${hm(e.at)}`, WD(e.at), 'Request', `data-copen="${e.id}"`]),
    ...(flagsOpen().length ? [['absent', `${flagsOpen().length} flagged posts`, flagsOpen().map(f=>f.why.toLowerCase()).join(' · '), ago(Math.min(...flagsOpen().map(f=>f.at))).replace(' ago',''), 'Moderate', 'data-ctab="forum" data-cjump="cm-flags"']] : []),
    ['live', `Sort questions for ${WD(E3.at)}’s town hall`, `${E3.q - E3.qSorted} of ${E3.q} still to sort · you host it`, 'Tomorrow', 'You host', `data-copen="${E3.id}"`]];
  return cell('s5','Needs you',`<span class="lbl">${N.length} things</span>`,
    `<div class="gv-nd">${N.map(([sv,t,m,age,own,at])=>`<button class="gv-nd-r" ${at}><i style="background:${({underway:'var(--underway)',live:'var(--live)',absent:'var(--absent)',line:'var(--line)'})[sv]}"></i><span class="gv-nd-k"><b>${t}</b><span>${m}</span></span><span class="gv-nd-a"><span class="${sv==='live'?'me':sv==='absent'?'bad':''}">${own}</span><span class="mono">${age}</span></span></button>`).join('')}</div>`,
    `<span>Members host by request · staff and board approve</span><span></span>`);
}
function curve(arr, mx, cls=''){ return `<div class="cm-cv ${cls}">${arr.map((v,i)=>`<i style="height:${v/mx*100}%" class="${i===arr.length-1?'now':''}"></i>`).join('')}</div>`; }
function evRow(e, compact){
  const m = e.st==='live' ? `<b class="cm-on">${e.live} listening</b>` : e.st==='request' ? `<b class="cm-rq">Asked to host</b>` : e.st==='past' ? `<b>${e.came} came</b>` : `<b>${e.rsvp ? e.rsvp+' coming' : 'RSVPs open later'}</b>`;
  const sub = e.st==='past' ? `${e.qAns} of ${e.q} questions answered` : e.st==='live' ? `Peak ${e.peak} · ${e.hands} hands raised` : e.q ? `${e.q} questions in` : e.gov ? e.gov : e.place || '';
  return `<button class="cm-ev st-${e.st}" data-copen="${e.id}">${leaf(e.at)}<span class="cm-ev-k"><span class="cm-ev-h">${kindTag(e)}${e.prop?`<span class="cm-pr mono">${e.prop}</span>`:''}${e.chan&&!compact?`<span class="cm-ch" title="On the channel">${ICO.air}</span>`:''}</span><b>${e.t}</b><span>${hm(e.at)} · ${e.len} min · ${who(e.host)}${e.co?` with ${e.co.map(who).join(', ')}`:''}</span></span>
    <span class="cm-ev-m">${m}<span>${sub}</span></span></button>`;
}
function thRow(t){
  return `<button class="cm-th ${t.locked?'lk':''}" data-cthread="${t.id}"><span class="cm-th-k"><span class="cm-th-h">${t.pin?'<span class="cm-fl pin">Pinned</span>':''}${t.answered?'<span class="cm-fl ok">Answered</span>':''}${t.locked?'<span class="cm-fl lk">Locked</span>':''}${t.hot?'<span class="cm-fl hot">Busy</span>':''}${t.prop?`<span class="cm-pr mono">${t.prop}</span>`:''}</span><b>${t.t}</b><span>${CAT[t.cat]} · ${who(t.by)} · ${t.id}</span></span>
    <span class="cm-n">${ICO.talk}${t.r}</span><span class="cm-n">${ICO.eye}${t.rd}</span><span class="cm-th-a">${ago(t.last)}</span></button>`;
}

/* ══ Overview ══════════════════════════════════════════════════════════════════════════════════════════════ */
function renderOverview(){
  const L = live(), mins = Math.round((NOW - L.at)/6e4);
  const on = cell('s7','On air now',`<span class="lbl">${KIND[L.kind][0]} · ${mins} min in</span>`,
    `<div class="cm-live"><div class="cm-live-h"><span class="cm-dot"></span><div><b>${L.t}</b><span>${who(L.host)} hosts · ${L.co.map(who).join(', ')} moderates · approved request</span></div></div>
      <div class="cm-live-f"><div class="m-big">${L.live} <small>listening now · peak ${L.peak}</small></div>${curve(LIVE_CURVE, L.peak*1.1, 'red')}</div>
      <div class="led cm-live-l">${[['Hands raised',`${L.hands} waiting to speak`],['On the channel','Airing live on Channel 4, with captions'],['Recording','Saved to the library when it ends']].map(([k,v])=>`<div><span>${k}</span><b>${v}</b></div>`).join('')}</div></div>`,
    `<span>Run it from Dial’s master control</span><button data-cdial>Open in Dial ↗</button>`);
  const up = EVENTS.filter(e=>e.st==='next').sort((a,b)=>a.at-b.at).slice(0,4);
  const coming = cell('s7','Coming up',`<span class="lbl">${EVENTS.filter(e=>e.st==='next').length} scheduled</span>`,
    `<div class="cm-evl">${up.map(e=>evRow(e)).join('')}</div>`, `<span>Hearings and board meetings are tracked in Governance</span><button data-ctab="live">Every event →</button>`);
  const sch = cell('s5','On the channel today',`<span class="lbl">${CH.num} · ${CH.viewers} watching</span>`,
    `<div class="cm-sl">${SCHED.filter(s=>s[3]!=='off' && s[0]+s[1]>nowH-1).slice(0,6).map(s=>{ const on = s[0]<=nowH && nowH<s[0]+s[1];
      return `<div class="cm-sl-r ${on?'on':''} ${s[3]}"><span class="mono">${hrs(s[0])}</span><span><b>${s[2]}</b><em>${s[4]}</em></span>${on?'<span class="cm-onair">On air</span>':`<span class="cm-sk">${({loop:'Loop',show:'Show',replay:'Replay',live:'Live'})[s[3]]}</span>`}</div>`; }).join('')}</div>`,
    `<span>Off air 22:00 to 06:00</span><button data-ctab="channel">Channel →</button>`);
  const hot = THREADS.filter(t=>!t.locked).sort((a,b)=>b.r*2+b.rd/10-(a.r*2+a.rd/10)).slice(0,5);
  const forum = cell('s7','Busiest in the forum',`<span class="lbl">This week</span>`, `<div class="cm-thl">${hot.map(thRow).join('')}</div>`,
    `<span>Proposal threads link to Governance</span><button data-ctab="forum">Forum →</button>`);
  const P = PART, n = P.any.length - 1, mx = Math.max(...P.any);
  const part = cell('s5','Who’s taking part',`<span class="lbl">Members, by week</span>`,
    `<div class="cm-pt" id="cm-part"><div class="m-big">${P.any[n]} <small>of ${MEMBERS} members posted, came or watched this week · ${pct(P.any[n],MEMBERS)}</small></div>
      <div class="cm-pt-c">${P.any.map((v,i)=>`<div class="${i===n?'now':''}"><i style="height:${v/mx*100}%"></i><s>${WEEKS[i]}</s></div>`).join('')}</div>
      <div class="led cm-pt-l">${[['Wrote in the forum',P.posted[n]],['Came to something live',P.came[n]],['Watched the channel',P.watched[n]]].map(([k,v])=>`<div><span>${k}</span><span class="cm-pt-b"><i style="width:${v/P.any[n]*100}%"></i></span><b>${v}</b></div>`).join('')}</div></div>`,
    `<span>Counted once per member, however often</span><span></span>`);
  document.getElementById('cv').innerHTML = band(on + needsCell(), 1) + band(coming + sch) + band(forum + part);
}

/* ══ Forum ═════════════════════════════════════════════════════════════════════════════════════════════════ */
function renderForum(){
  const L = THREADS.filter(t=>C.cat==='all' || t.cat===C.cat).sort((a,b)=>(b.pin||0)-(a.pin||0) || b.last-a.last), per = 8;
  C.tp = Math.min(C.tp, Math.max(0, Math.ceil(L.length/per)-1));
  const list = cell('s12','Every thread',`<div class="seg sm" role="group" aria-label="Category">${CATS.map(([k,t])=>`<button data-ccat="${k}" aria-pressed="${C.cat===k}">${t}</button>`).join('')}</div>`,
    `<div class="cm-thl"><div class="cm-th hd2"><span>${lbl('Thread')}</span>${lbl('Replies')}${lbl('Readers')}${lbl('Last post')}</div>${L.slice(C.tp*per, C.tp*per+per).map(thRow).join('') || `<div class="gv-e"><span>No threads here yet</span></div>`}</div>`,
    `<span>Pinned threads stay on top · proposal threads are tracked in Governance</span>${pagerOr(C.tp, L.length, per, 'ctp', 'threads')}`);
  const F = FLAGS.slice().sort((a,b)=>(a.st==='open'?0:1)-(b.st==='open'?0:1) || b.at-a.at);
  const flags = cell('s7','Flagged',`<span class="lbl">${flagsOpen().length} waiting</span>`,
    `<div class="cm-fg" id="cm-flags">${F.map(f=>`<div class="cm-fg-r ${f.st}">${av(f.by)}<span class="cm-fg-k"><span class="cm-fg-h"><b>${f.why}</b><span class="mono">${f.thread}</span></span><span class="cm-fg-t">${f.st==='hidden' ? `<em>Hidden by ${who(f.mod)} · the author was told why</em>` : `“${f.t}”`}</span><span class="cm-fg-s">${f.src} · ${ago(f.at)}</span></span>
      <span class="cm-fg-a">${f.st==='open' ? `<button class="btn sm-b" data-ckeep="${f.id}">Keep</button><button class="btn sm-b dz" data-chide="${f.id}">Hide</button>` : `<span class="fst ${f.st==='hidden'?'warn2':''}">${f.st==='hidden'?'Hidden':'Kept'}</span>`}</span></div>`).join('')}</div>`,
    `<span>Nothing is deleted · every hide is logged in Records with its reason</span><span></span>`);
  const pmx = Math.max(...POSTS_WK);
  const pace = cell('s5','Posts a week',`<span class="lbl">Last 7 weeks</span>`,
    `<div class="cm-pt"><div class="m-big">${POSTS_WK[6]} <small>posts this week, from ${PART.posted[6]} members</small></div>
      <div class="cm-pt-c">${POSTS_WK.map((v,i)=>`<div class="${i===6?'now':''}"><i style="height:${v/pmx*100}%"></i><s>${WEEKS[i]}</s></div>`).join('')}</div>
      <div class="led cm-pt-l2">${[['Questions answered','81%'],['First reply','2.4 h median'],['Ideas open',IDEAS],['Hidden this month','3 posts']].map(([k,v])=>`<div><span>${k}</span><b>${v}</b></div>`).join('')}</div></div>`,
    `<span>Staff answers count once per question</span><span></span>`);
  document.getElementById('cv').innerHTML = band(list, 1) + band(flags + pace);
}

/* ── a month as a grid, shared with Governance's calendar ── */
const MONL = ['January','February','March','April','May','June','July','August','September','October','November','December'];
function monthGrid(items, mo, col){
  const base = Date.UTC(2026, 9+mo, 1), d0 = new Date(base), next = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth()+1, 1);
  const lead = (d0.getUTCDay()+6)%7, start = base - lead*DAY, weeks = Math.ceil((lead + Math.round((next-base)/DAY))/7);
  const cells = Array.from({length:weeks*7},(_,i)=>{ const t = start + i*DAY, d = new Date(t), out = t<base || t>=next, wk = i%7>=5, es = items.filter(c=>c.t>=t && c.t<t+DAY);
    return `<div class="gm-d ${out?'out':''} ${wk?'wk':''} ${t===TODAY?'today':''} ${t<TODAY?'past':''}"><span class="gm-n">${d.getUTCDate()===1 ? MON[d.getUTCMonth()]+' 1' : d.getUTCDate()}</span>
      ${es.slice(0,3).map(c=>`<button class="gm-e ${col(c)[1]||''}" ${c.at} style="--c:${col(c)[0]}" title="${c.title}"><i></i><span>${c.title}</span></button>`).join('')}${es.length>3?`<span class="gm-more">+${es.length-3} more</span>`:''}</div>`; }).join('');
  return `<div class="gm"><div class="gm-h">${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(x=>`<span>${x}</span>`).join('')}</div><div class="gm-g">${cells}</div></div>`;
}
const monthName = mo => { const d = new Date(Date.UTC(2026, 9+mo, 1)); return `${MONL[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
const viewSeg = (key, v) => `<div class="seg sm gm-sw" role="group" aria-label="View"><button data-${key}="list" aria-pressed="${v==='list'}">List</button><button data-${key}="month" aria-pressed="${v==='month'}">Month</button></div>`;
const monthNav = (key, mo, min, max) => `<span class="pg2"><span>${monthName(mo)}</span>${mo?`<button class="gm-today" data-${key}="0">Today</button>`:''}<button data-${key}="${mo-1}" ${mo<=min?'disabled':''} aria-label="Previous month">${ICO.back}</button><button data-${key}="${mo+1}" ${mo>=max?'disabled':''} aria-label="Next month">${ICO.chev}</button></span>`;

/* ══ Live ══════════════════════════════════════════════════════════════════════════════════════════════════ */
function renderLive(){
  const G = [['live','Live now'],['request','Asked to host'],['next','Coming up'],['past','Past']];
  const L = G.flatMap(([st])=>EVENTS.filter(e=>e.st===st).sort((a,b)=>st==='past' ? b.at-a.at : a.at-b.at));
  const colOf = e => e.st==='live' ? ['var(--absent)'] : e.st==='request' ? ['var(--underway)','req'] : e.st==='past' ? ['var(--fg-50)'] : ['var(--fg)'];
  const items = EVENTS.map(e=>({ t:Date.UTC(new Date(e.at).getUTCFullYear(), new Date(e.at).getUTCMonth(), new Date(e.at).getUTCDate()), title:`${hm(e.at)} ${e.t}`, at:`data-copen="${e.id}"`, e }));
  const key = `<span class="f-key"><span><i style="background:var(--absent)"></i>Live</span><span><i style="background:var(--fg)"></i>Coming up</span><span><i class="cm-req"></i>Asked to host</span><span><i style="background:var(--fg-50)"></i>Past</span></span>`;
  const all = C.ev==='month'
    ? cell('s12', monthName(C.mo), viewSeg('cev', C.ev), `${monthGrid(items, C.mo, x=>colOf(x.e))}<div class="gm-list"><div class="cm-evl">${EVENTS.filter(e=>{ const m = Date.UTC(2026, 9+C.mo, 1), n = Date.UTC(2026, 10+C.mo, 1); return e.at>=m && e.at<n; }).sort((a,b)=>a.at-b.at).map(e=>evRow(e)).join('') || '<div class="gv-e"><span>Nothing this month</span></div>'}</div></div>`, `${key}${monthNav('cmo', C.mo, -1, 3)}`)
    : cell('s12','Every event',`<div class="gt-cr-h">${viewSeg('cev', C.ev)}<span class="lbl">${EVENTS.length} events</span></div>`,
    `<div class="cm-evl">${G.map(([st,t])=>{ const E = L.filter(e=>e.st===st); return E.length ? `<div class="gv-g">${lbl(`${t} · ${E.length}`)}</div>${E.map(e=>evRow(e)).join('')}` : ''; }).join('')}</div>`,
    `<span>Every event can air on the channel and is saved to the library</span><span class="quiet">${EVENTS.length} events</span>`);
  const H1 = EV['E-31'], mx = Math.max(...TH_CURVE)*1.1;
  const last = cell('s7','The last hearing',`<span class="lbl">${H1.prop} · ${WD(H1.at)} ${fmtD(H1.at)}</span>`,
    `<div class="cm-lh"><div class="m-big">${H1.came} <small>members came · peak ${H1.peak} at once · ${H1.len} min</small></div>${curve(TH_CURVE, mx)}
      <div class="cm-lh-x"><span>${hm(H1.at)}</span><span>${hrs(18 + H1.len/60)}</span></div>
      <div class="led cm-live-l">${[['Questions',`${H1.qAns} of ${H1.q} answered on air`],['The rest','Answered in the thread by staff'],['Recording',H1.rec],['The proposal',`${H1.prop} · voting now, in Governance`]].map(([k,v])=>`<div><span>${k}</span><b>${v}</b></div>`).join('')}</div></div>`,
    `<span>A hearing runs during a proposal’s discussion step</span><button data-cgov="${H1.prop}">Governance →</button>`);
  const R = [['Town hall','Staff and board','Video, questions sorted ahead'],['Space','Any member, by request','Audio, hands raised'],['Presentation','Staff, board or a member by request','Slides and video'],['Hearing','Staff, for a proposal','During its discussion step'],['Board meeting','The board','Open session; private items left out'],['Annual meeting','The board','Live; votes signed in the app']];
  const rules = cell('s5','Who hosts what',`<span class="lbl">Every kind of event</span>`,
    `<div class="cm-hr">${R.map(([k,h,s])=>`<div><span><b>${k}</b><em>${s}</em></span><b>${h}</b></div>`).join('')}</div>`,
    `<span>Requests go to staff and board to approve</span><span></span>`);
  document.getElementById('cv').innerHTML = band(all, 1) + band(last + rules);
}

/* ══ Channel ═══════════════════════════════════════════════════════════════════════════════════════════════ */
function renderChannel(){
  const vmx = Math.max(...VIEW_HR)*1.15;
  const day = cell('s12',`Today on ${CH.name}`,`<span class="lbl">${CH.num} · call sign ${CH.call}</span>`,
    `<div class="cm-day"><div class="cm-day-v">${Array.from({length:24},(_,h)=>`<i style="height:${VIEW_HR[h]!=null ? VIEW_HR[h]/vmx*100 : 0}%" class="${h<VIEW_HR.length?'':'f'}"></i>`).join('')}</div>
      <div class="cm-day-b">${SCHED.map(s=>`<button class="cm-blk ${s[3]} ${s[0]<=nowH && nowH<s[0]+s[1]?'on':''}" style="left:${s[0]/24*100}%;width:${s[1]/24*100}%" data-cblk="${s[2]}" title="${hrs(s[0])} · ${s[2]}"><b>${s[2]}</b>${s[1]>=1.5?`<em>${hrs(s[0])}</em>`:''}</button>`).join('')}<span class="cm-now" style="left:${nowH/24*100}%"><em>Now</em></span></div>
      <div class="cm-day-x">${[0,3,6,9,12,15,18,21].map(h=>`<span style="left:${h/24*100}%">${hrs(h)}</span>`).join('')}</div></div>`,
    `<span class="f-key"><span><i style="background:var(--absent)"></i>Live</span><span><i style="background:var(--fg)"></i>Show</span><span><i style="background:color-mix(in srgb,var(--fg) 45%,transparent)"></i>Replay</span><span><i style="background:color-mix(in srgb,var(--fg) 18%,transparent)"></i>Loop</span><span><i class="cm-off"></i>Off air</span></span><button data-cdial>Schedule in Dial ↗</button>`);
  const lib = cell('s7','Library',`<span class="lbl">Recordings and shows</span>`,
    `<div class="cm-lib">${LIB.map(([t,s,v,at])=>`<div class="cm-lib-r">${leaf(at)}<span><b>${t}</b><em>${s}</em></span><span class="cm-n">${ICO.eye}${int(v)}</span><button class="btn sm-b" data-cadd="${t}">Add to schedule</button></div>`).join('')}</div>`,
    `<span>Every town hall, hearing and talk lands here when it ends</span><span></span>`);
  const viewers = cell('s5','Watching',`<span class="lbl">This week</span>`,
    `<div class="cm-pt"><div class="m-big">${CH.viewers} <small>watching now · ${PART.watched[6]} members this week</small></div>
      <div class="led cm-pt-l2">${[['Watch hours',`${CH.wk} this week`],['Comments',`${CH.comments} today`],['Most watched','September town hall'],['Relays',CH.relay],['Ads','None · it’s the co-op’s channel']].map(([k,v])=>`<div><span>${k}</span><b>${v}</b></div>`).join('')}</div>
      <p class="bpn-n">One channel for now. Each community gets its own, like a local station, once there are regional councils.</p></div>`,
    `<span>Runs on Dial</span><button data-cdial>Master control ↗</button>`);
  document.getElementById('cv').innerHTML = band(day, 1) + band(lib + viewers);
}

/* ══ Panels ════════════════════════════════════════════════════════════════════════════════════════════════ */
function ensurePanel(){ let pn = document.getElementById('cpanel');
  if (!pn){ const sc = document.createElement('div'); sc.id = 'cscrim'; sc.className = 'scrim'; document.body.appendChild(sc); pn = document.createElement('aside'); pn.id = 'cpanel'; pn.className = 'panel cpanel'; document.body.appendChild(pn); }
  return pn; }
function renderPanel(){ const pn = ensurePanel(), P = C.panel;
  if (!P){ document.body.classList.remove('pn'); return; }
  document.body.classList.add('pn'); pn.innerHTML = P.ev ? evPanel(EV[P.ev]) : thPanel(THREADS.find(t=>t.id===P.th)); }
const phd = k => `<div class="pn-hd"><span class="lbl">${k}</span><button class="x" data-cclose aria-label="Close">${ICO.x}</button></div>`;
function evPanel(e){
  const K = KIND[e.kind], st = {live:'Live now',next:`${WD(e.at)} ${fmtD(e.at)} at ${hm(e.at)}`,request:`Asked for ${WD(e.at)} ${fmtD(e.at)} at ${hm(e.at)}`,past:`Held ${WD(e.at)} ${fmtD(e.at)}`}[e.st];
  const rows = [['Kind',`${K[0]} · ${K[1]}`],['When',`${WD(e.at)} ${fmtD(e.at)} · ${hm(e.at)} · ${e.len} min`],['Host',`${who(e.host)}${e.co?` with ${e.co.map(who).join(', ')}`:''}`],
    ['On the channel', e.chan ? 'Airs live on Channel 4, then goes to the library' : e.st==='request' ? 'Decided when it’s approved' : 'No'],
    ...(e.prop ? [['The proposal',`<button class="lnk3" data-cgov="${e.prop}">${e.prop} · tracked in Governance</button>`]] : []), ...(e.gov ? [['In Governance',e.gov]] : [])];
  let block = '';
  if (e.st==='live') block = `<div>${lbl('Listening, minute by minute')}<div class="cm-pn-c">${curve(LIVE_CURVE, e.peak*1.1, 'red')}</div><p class="bpn-n">${e.live} listening now, peak ${e.peak}. ${e.hands} hands raised.</p></div>`;
  if (e.prep) block = `<div>${lbl('Getting ready')}<div class="led gv-cl">${e.prep.map(([k,v])=>`<div><span><i class="${v===1||v==='On'||/Live/.test(v)?'ok':''}"></i>${k}</span><b>${v===1?'Ready':v}</b></div>`).join('')}</div><p class="bpn-n">${e.rsvp} members are coming. ${e.q} questions came in through the thread; ${e.qSorted} are sorted for the night.</p></div>`;
  if (e.st==='request') block = `<div>${lbl(`What ${who(e.host)} wants to do`)}<p class="bpn-w"><b>${e.t}.</b> ${e.why}</p><p class="bpn-n">Approving it schedules the event, lets ${who(e.host)} host and puts a staff member in as moderator.</p></div>`;
  if (e.st==='past') block = `<div>${lbl('How it went')}<div class="led">${[['Came',`${e.came} · peak ${e.peak}`],['Questions',`${e.qAns} of ${e.q} answered on air`],['Recording',e.rec]].map(([k,v])=>`<div><span>${k}</span><b>${v}</b></div>`).join('')}</div></div>`;
  const ft = !STAFF() ? `<span class="small quiet" style="margin-right:auto">${st}</span>` : e.st==='request' ? `<button class="btn" data-cdecline="${e.id}">Decline</button><button class="btn p" data-capprove="${e.id}">Approve</button>`
    : e.st==='live' ? `<button class="btn" data-cend="${e.id}">End it</button><button class="btn p" data-cdial>Open in Dial ↗</button>` : e.st==='next' ? `<button class="btn" data-cremind="${e.id}">Remind members</button><button class="btn p" data-cdial>Set up in Dial ↗</button>` : `<span class="small quiet" style="margin-right:auto">${st}</span><button class="btn" data-cwatch>Watch the recording ↗</button>`;
  return phd(`${e.id} · ${K[0]}`) + `<div class="pn-b"><div><p class="bpn-t">${e.t}</p><p class="bpn-s ${e.st==='live'?'cm-red':''}">${st}</p></div>
    <div class="led">${rows.map(([k,v])=>`<div><span>${k}</span><b>${v}</b></div>`).join('')}</div>${block}</div><div class="pn-ft">${ft}</div>`;
}
function thPanel(t){
  const sample = [[t.by, t.last - 5*3600e3, 'Opening post. ' + (t.note || 'Members can reply, react and quote; staff answers are marked.')],['dana', t.last - 3*3600e3, 'Thanks for raising it. Here’s where this stands, and what happens next.', 1],[ '6a', t.last, 'Following this one.']];
  return phd(`${t.id} · ${CAT[t.cat]}`) + `<div class="pn-b"><div><p class="bpn-t">${t.t}</p><p class="bpn-s">${t.r} replies · ${t.rd} readers · last post ${ago(t.last)}</p></div>
    ${t.prop ? `<p class="bpn-w"><b>This is the thread for ${t.prop}.</b> The proposal itself, its steps and its vote are tracked in Governance. Talk happens here.</p>` : ''}
    <div class="gv-th">${lbl('Latest')}${sample.map(([k,at,x,s])=>`<div class="gv-tp">${av(k)}<span><span class="gv-f-h"><b>${who(k)}</b>${s?'<span class="gv-staff">Staff</span>':''}<span class="quiet">${ago(at)}</span></span><span>${x}</span></span></div>`).join('')}</div></div>
    <div class="pn-ft">${t.prop ? `<button class="btn" data-cgov="${t.prop}">${t.prop} in Governance →</button>` : ''}<button class="btn p" data-capp>Open in the app ↗</button></div>`;
}

/* ══ render + events ═══════════════════════════════════════════════════════════════════════════════════════ */
function render(){
  document.querySelectorAll('.gtabs [data-ctab]').forEach(b=>b.setAttribute('aria-current', b.dataset.ctab===C.tab?'page':'false'));
  document.getElementById('cw').classList.toggle('ro', !STAFF());
  renderHdr();
  ({overview:renderOverview, forum:renderForum, live:renderLive, channel:renderChannel})[C.tab]();
  renderPanel();
}
const closeC = () => { C.panel = null; };
document.addEventListener('click', e => {
  if (e.target.id==='cscrim'){ closeC(); return render(); }
  const t = e.target.closest('button,a,[data-ctab],[data-copen],[data-cjump]'); if (!t) return; const d = t.dataset;
  if (d.ctab){ C.tab = d.ctab; closeC(); render(); if (d.cjump){ const el = document.getElementById(d.cjump); el && el.scrollIntoView({behavior:'smooth', block:'center'}); } else window.scrollTo({top:0}); return; }
  if (d.cjump){ const el = document.getElementById(d.cjump); el && el.scrollIntoView({behavior:'smooth', block:'center'}); return; }
  if (d.copen){ C.panel = {ev:d.copen}; return render(); }
  if (d.cthread){ C.panel = {th:d.cthread}; return render(); }
  if (d.cclose!==undefined){ closeC(); return render(); }
  if (d.ccat){ C.cat = d.ccat; C.tp = 0; return render(); }
  if (d.cev){ C.ev = d.cev; return render(); }
  if (d.cmo!==undefined){ C.mo = Math.max(-1, Math.min(3, +d.cmo)); return render(); }
  if (d.ctp){ C.tp += +d.ctp; return render(); }
  if (d.chide){ const f = FLAGS.find(x=>x.id===d.chide); f.st = 'hidden'; f.mod = C.me; render(); return toast('Hidden · the author is told why · logged in Records'); }
  if (d.ckeep){ const f = FLAGS.find(x=>x.id===d.ckeep); f.st = 'kept'; f.mod = C.me; render(); return toast('Kept · the reporters are told it stays up'); }
  if (d.capprove){ const ev = EV[d.capprove]; ev.st = 'next'; ev.rsvp = 0; ev.co = ['dana']; ev.chan = true; closeC(); render(); return toast(`Approved · ${who(ev.host)} hosts ${WD(ev.at)} ${hm(ev.at)} with Dana Ruiz moderating`); }
  if (d.cdecline){ const ev = EV[d.cdecline]; EVENTS.splice(EVENTS.indexOf(ev),1); closeC(); render(); return toast(`Declined · ${who(ev.host)} gets the reason in the app`); }
  if (d.cend) return toast('Ends the space for everyone · the recording goes to the library');
  if (d.cremind) return toast('Reminder goes to everyone who said they’re coming');
  if (d.cdial!==undefined) return toast('Opens Clear’s station in Dial');
  if (d.cgov) return toast(`Goes to ${d.cgov} in Governance`);
  if (d.capp!==undefined) return toast('Opens the thread in the member app');
  if (d.cwatch!==undefined) return toast('Opens the recording on the channel');
  if (d.cadd) return toast(`${d.cadd} · pick a slot in Dial’s schedule`);
  if (d.cblk) return toast(`${d.cblk} · edit it in Dial’s schedule`);
});
document.addEventListener('keydown', e => { if (e.key==='Escape' && C.panel){ closeC(); render(); } });
const hs = location.hash.slice(1).split(',');
['overview','forum','live','channel'].forEach(t=>{ if (hs.includes(t)) C.tab = t; });
if (hs.includes('member')) C.me = 'm1'; if (hs.includes('month')) C.ev = 'month';
if (hs.includes('dark')) document.documentElement.dataset.theme = 'dark';
['E-33','E-34','E-36','E-31'].forEach(id=>{ if (hs.includes(id)) C.panel = {ev:id}; });
if (hs.includes('T-412')) C.panel = {th:'T-412'};
render();

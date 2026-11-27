
/* ══ Governance — Proposals first ══════════════════════════════════════════════════════════════════════════════
   Every decision the co-op makes, from a member's draft to the thing actually being done. Discussion runs alongside
   every step; the text freezes when voting opens; member ballots stay sealed until the close. */
const G = { tab:'overview', cal:'all', ag:'all', cv:'list', mo:0, set:'open', st:null, panel:null, me:'kai', pp:0, back:false };
const ICO = { chev:'<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5"/></svg>', back:'<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3.5 5.5 8l4.5 4.5"/></svg>',
  x:'<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>', arrow:'<svg viewBox="0 0 8 12" aria-hidden="true"><path d="M1.5 1.5 6.5 6l-5 4.5"/></svg>',
  talk:'<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z"/></svg>' };
function toast(t){ let el = document.getElementById('toast'); if (!el){ el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el); } el.innerHTML = t; el.classList.add('on'); clearTimeout(el._t); el._t = setTimeout(()=>el.classList.remove('on'), 3200); }
const cell = (cls, title, right, body, foot) => `<div class="cell ${cls}"><div class="hd"><h2>${title}</h2><div class="r">${right}</div></div>${body}<div class="bk-ft">${foot}</div></div>`;
const lbl = t => `<span class="lbl">${t}</span>`;
const band = (cells, first) => `<section class="band"${first?' style="margin-top:0"':''}><div class="bento">${cells}</div></section>`;
const pager = (p, n, per, key) => { const pages = Math.max(1, Math.ceil(n/per)); return `<span class="pg2"><span>${n ? p*per+1 : 0}–${Math.min(n,(p+1)*per)} of ${n}</span><button data-${key}="-1" ${p===0?'disabled':''} aria-label="Previous">${ICO.back}</button><button data-${key}="1" ${p>=pages-1?'disabled':''} aria-label="Next">${ICO.chev}</button></span>`; };
const av = k => `<span class="av sm" title="${PPL[k] ? PPL[k].n : mm(k)}">${PPL[k] ? PPL[k].ini : k.toUpperCase()}</span>`;
const byName = k => PPL[k] ? who(k) : mm(k);
const STAFF = () => !!PPL[G.me] && PPL[G.me].staff;

/* where a proposal stands */
const tasksOpen = p => (p.tasks||[]).filter(t=>t[4]!=='done');
const isOpen = p => ['draft','sponsor','check','vote'].includes(p.st) || (p.st==='done' && tasksOpen(p).length);
const quorumN = p => RULES[p.type].q ? Math.ceil(MEMBERS*RULES[p.type].q) : null;
const stateTxt = p => ({
  draft: () => `Draft v${p.ver}${p.coauth ? ` · ${p.coauth.length} co-author${p.coauth.length>1?'s':''}` : ''}`,
  sponsor: () => `${p.sponsors} of ${SPONSORS} co-signers · ${SPONSORS-p.sponsors} more by ${fmtD(p.sponsorBy)}`,
  check: () => p.type==='elect' ? `Nominations open · ${p.nominations} so far` : `${p.checker===G.me ? 'You’re checking it' : `Being checked by ${who(p.checker)}`} · due ${WD(p.checkDue)} ${fmtD(p.checkDue)}`,
  vote: () => p.board ? `On the board’s agenda for ${fmtD(p.board)}` : `${p.cast} of ${MEMBERS} voted · closes ${fmtD(p.voteClose)}`,
  decided: () => p.result==='passed' ? `Passed ${fmtD(p.decidedAt)}` : p.result==='quorum' ? `Didn’t count · ${p.cast} voted, ${quorumN(p)} needed` : `Failed ${fmtD(p.decidedAt)}`,
  done: () => tasksOpen(p).length ? `Passed ${fmtD(p.decidedAt)} · ${tasksOpen(p).length} of ${p.tasks.length} tasks left` : `Carried out · all ${p.tasks.length} tasks done`,
  withdrawn: () => p.why, expired: () => p.why })[p.st]();

/* the progress mark each row carries: one bar, a caption under it, the figure that matters on the right */
function prog(p){
  const bar = (f, cls='', tick) => `<span class="gv-bar ${cls}"><i style="width:${Math.min(100,f*100)}%"></i>${tick!=null?`<s style="left:${Math.min(100,tick*100)}%"></s>`:''}</span>`;
  const cap = (l, r, rc='') => `<span class="gv-cap"><span>${l}</span><b class="${rc}">${r}</b></span>`;
  if (p.st==='sponsor') return bar(p.sponsors/SPONSORS,'gb-sp') + cap(`${p.sponsors} co-signers`, `${SPONSORS} needed`);
  if (p.st==='vote' && !p.board) return bar(p.cast/MEMBERS,'gb-vt',RULES[p.type].q) + cap(`${p.cast} voted`, p.cast>=quorumN(p) ? 'Enough to count' : `${quorumN(p)} needed`, p.cast>=quorumN(p)?'ok':'');
  if (p.st==='vote') return bar(0,'gb-hx') + cap('Board vote', fmtD(p.board));
  if (p.st==='check') return p.checks ? bar(p.checks.filter(c=>c[2]).length/p.checks.length,'gb-ck') + cap(`${p.checks.filter(c=>c[2]).length} of ${p.checks.length} checks`, p.type==='elect' ? `${p.nominations} nominated` : `${who(p.checker)}`) : '';
  if (p.st==='done'){ const n = p.tasks.length, d = p.tasks.filter(t=>t[4]==='done').length, late = p.tasks.filter(t=>t[4]==='late').length;
    return `<span class="gv-tk">${p.tasks.map(t=>`<i class="${t[4]}"></i>`).join('')}</span>` + cap(`${d} of ${n} tasks done`, late ? `${late} late` : d===n ? 'Done' : 'On time', late ? 'bad' : d===n ? 'ok' : ''); }
  if (p.st==='decided') return bar(p.cast/MEMBERS,'gb-off',RULES[p.type].q) + cap(`${p.cast} voted`, p.result==='quorum' ? `${quorumN(p)} needed` : p.result==='passed' ? 'Passed' : 'Failed', p.result==='passed' ? 'ok' : 'bad');
  if (p.st==='draft') return bar(0,'gb-hx') + cap(`Version ${p.ver}`, p.coauth ? `${p.coauth.length} co-authors` : 'Solo');
  return bar(0) + cap(p.st==='withdrawn' ? 'Withdrawn' : `${p.sponsors} of ${SPONSORS} co-signers`, p.st==='withdrawn' ? 'By the author' : 'Expired');
}
/* what happens next, and when */
function nextOf(p){
  const t = p.st==='vote' ? (p.board ? ['Board meets',p.board] : ['Closes',p.voteClose]) : p.st==='check' ? [p.type==='elect'?'Nominations end':'Check due',p.checkDue] : p.st==='sponsor' ? ['Expires',p.sponsorBy] : p.st==='draft' ? ['Started',p.opened]
    : p.st==='done' ? (()=>{ const o = p.tasks.filter(x=>x[4]!=='done').sort((a,b)=>a[3]-b[3])[0]; return o ? ['Next task due',o[3],o[4]==='late'] : ['Done by',Math.max(...p.tasks.map(x=>x[3]))]; })()
    : p.st==='decided' ? ['Decided',p.decidedAt] : ['Ended',p.endedAt];
  return `<span class="gv-n ${t[2]?'bad':''}">${lbl(t[0])}<b>${WD(t[1])} ${fmtD(t[1])}</b></span>`;
}

/* ── header ── */
function renderHdr(){
  const v = PROPS.filter(p=>p.st==='vote' && !p.board), v0 = v[0], pipe = PROPS.filter(p=>['draft','sponsor','check'].includes(p.st)), T = PROPS.flatMap(p=>(p.tasks||[]).map(t=>[p,t])), late = T.filter(([p,t])=>t[4]==='late');
  const soon = calItems().filter(c=>c.t>=TODAY && c.t<TODAY+25*DAY && c.kind==='filing' && c.st!=='done');
  const brief = {
    overview: `Members are voting on <a data-gopen="${v0.id}">${v0.t.replace(/^Adopt /,'')}</a>, and enough have voted for it to count. ${late.length ? `One passed decision is <a data-gopen="${late[0][0].id}">running late</a>.` : 'Every passed decision is on time.'}`,
    proposals: `${PROPS.filter(isOpen).length} proposals are open. ${pipe.length} are on the way to a vote and <a data-gopen="${v0.id}">${v0.id}</a> closes ${WD(v0.voteClose)} ${fmtD(v0.voteClose)}.`,
    boards: `The co-op board meets <a data-gmt="M-14">${WD(MEETINGS[0][2])} ${fmtD(MEETINGS[0][2])}</a> with ${AGENDA.length} items. ${GBOARDS.filter(b=>!b[4]).reduce((a,b)=>a+b[3].filter(s=>!s[1]).length,0)} seats are open across three boards.`,
    entities: `${ENT.filter(e=>e[3]==='formed').length} of ${ENT.length} entities are formed. <a data-gent="dt">The Deed & Title Co.</a> files to form by ${fmtD(ENTF.dt.due)}.`,
    agreements: `<a data-gagr="icw">Inland Cycle Works</a> signed and waits on you. ${AGR.filter(a=>a.st==='renew' && a.b<TODAY+60*DAY).length} agreements renew in the next 60 days.`,
    calendar: `${soon.length} filings are due by ${fmtD(TODAY+25*DAY)}. ${soon.filter(c=>c.st==='ready').length} are ready to file.` }[G.tab];
  const segs = (arr, col) => arr.map((x,i)=>`<i style="left:${i/Math.max(6,arr.length)*100}%;width:calc(${100/Math.max(6,arr.length)}% - 2px);background:${col(x)}"></i>`).join('');
  document.getElementById('hdr').innerHTML = `<span class="when"><span class="dot"></span>Governance · Wed 21 Oct · Demo data</span><p class="brief">${brief}</p>
    <div class="strip">
      <div class="sc" data-gopen="${v0.id}"><span class="lbl">Voting now</span><div class="sc-v">${v0.cast} <small>of ${MEMBERS} voted</small></div><div class="mb"><i style="width:${v0.cast/MEMBERS*100}%;background:var(--live)"></i><s class="nflr" style="left:${RULES[v0.type].q*100}%"></s></div><div class="sc-s">${v0.id} · needs ${quorumN(v0)} · closes ${fmtD(v0.voteClose)}</div></div>
      <div class="sc" data-gst="all"><span class="lbl">On the way</span><div class="sc-v">${pipe.length} <small>proposals</small></div><div class="mb">${segs(pipe, p=>({draft:'var(--line)',sponsor:'var(--underway)',check:'var(--fg)'})[p.st])}</div><div class="sc-s">${['draft','sponsor','check'].map(s=>`${pipe.filter(p=>p.st===s).length} ${STG[s][1].toLowerCase()}`).join(' · ')}</div></div>
      <div class="sc" data-gjump="gv-done"><span class="lbl">Carried out</span><div class="sc-v">${T.filter(([p,t])=>t[4]==='done').length} <small>of ${T.length} tasks</small></div><div class="mb">${segs(T, ([p,t])=>({done:'var(--fg)',doing:'var(--settled)',waits:'var(--line)',late:'var(--absent)'})[t[4]])}</div><div class="sc-s">${late.length} late · ${T.filter(([p,t])=>t[4]==='waits').length} waiting on another step</div></div>
      <div class="sc" data-gjump="gv-talk"><span class="lbl">In the forum</span><div class="sc-v">${IDEAS} <small>ideas</small></div><div class="mb"><i style="width:${3/IDEAS*100}%;background:var(--land)"></i><i style="left:${3/IDEAS*100}%;width:${(IDEAS-3)/IDEAS*100}%;background:color-mix(in srgb,var(--fg) 22%,transparent)"></i></div><div class="sc-s">3 new this week</div></div>
    </div>`;
}

/* ── needs you: shared by Overview and Proposals ── */
function needsCell(){
  const v = PROPS.find(p=>p.st==='vote' && !p.board);
  const N = !STAFF() ? [
    ['live', `Vote on ${v.id}`, `${v.t} · you haven’t voted yet`, left(v.voteClose).replace('in ',''), 'Vote in the app', `data-gopen="${v.id}"`],
    ['underway', 'Co-sign P-015', 'Reprint the window posters · 3 more co-signers needed', fmtD(PROP['P-015'].sponsorBy), 'Your call', 'data-gopen="P-015"'],
    ['line', 'Comment on P-017', 'Hold the annual meeting on a Saturday · a draft', '2 d', 'Draft', 'data-gopen="P-017"']] : [
    ['live', `Vote on ${v.id}`, `${v.t} · you haven’t voted yet`, left(v.voteClose).replace('in ',''), 'Vote in the app', `data-gopen="${v.id}"`],
    ...PROPS.filter(p=>p.st==='check' && p.checker===G.me).map(p=>['underway', `Check ${p.id}`, `${p.t} · ${p.checks.filter(c=>!c[2]).length} checks left`, WD(p.checkDue), 'You check it', `data-gopen="${p.id}"`]),
    ...PROPS.flatMap(p=>(p.tasks||[]).filter(t=>t[4]==='late' && t[2]===G.me).map(t=>['absent', t[0], `${p.id} passed ${fmtD(p.decidedAt)} · due ${fmtD(t[3])}`, `${Math.round((NOW-t[3])/DAY)} d late`, 'Your task', `data-gopen="${p.id}"`])),
    ...AGR.filter(x=>x.st==='out').map(x=>['live', `Sign: ${x.party}`, `${x.name} · they signed ${fmtD(x.sent+2*DAY)}`, '1 d', 'Your signature', `data-gagr="${x.id}"`]),
    ['line', 'A post was hidden in P-012', 'Dana Ruiz · it shared another member’s address', '1 d', 'Logged', `data-gopen="P-012" data-gthread="1"`]];
  return cell('s5','Needs you',`<span class="lbl">${N.length} things</span>`,
    `<div class="gv-nd">${N.map(([sv,t,m,age,own,at])=>`<button class="gv-nd-r" ${at}><i style="background:${({underway:'var(--underway)',live:'var(--live)',absent:'var(--absent)',line:'var(--line)'})[sv]}"></i><span class="gv-nd-k"><b>${t}</b><span>${m}</span></span><span class="gv-nd-a"><span class="${sv==='live'?'me':sv==='absent'?'bad':''}">${own}</span><span class="mono">${age}</span></span></button>`).join('')}</div>`,
    `<span>Votes are cast in the member app</span><span></span>`);

}

/* ══ Proposals ══════════════════════════════════════════════════════════════════════════════════════════════ */
function renderProposals(){
  const ORD = {vote:0,check:1,sponsor:2,draft:3,done:4,decided:5,withdrawn:6,expired:6}, per = 7;
  const inSet = p => G.set==='all' || (G.set==='open' ? isOpen(p) : !isOpen(p));
  const L = PROPS.filter(p=>G.st ? p.st===G.st : inSet(p)).sort((a,b)=>ORD[a.st]-ORD[b.st] || (b.opened-a.opened));
  G.pp = Math.min(G.pp, Math.max(0, Math.ceil(L.length/per)-1));
  const SET = [['open','Open',PROPS.filter(isOpen).length],['closed','Closed',PROPS.filter(p=>!isOpen(p)).length],['all','All',PROPS.length]];
  const rail = `<div class="gv-rail">${STAGES.map(([k,t,s],i)=>{ const n = PROPS.filter(p=>p.st===k).length;
      return `<button class="gv-rs ${k} ${G.st===k?'on':''} ${n?'':'z'}" data-gst="${k}" aria-pressed="${G.st===k}"><span class="gv-rh"><span class="gv-rn">${i+1}</span><b>${t}</b>${i<5?`<span class="gv-ra"><i></i>${ICO.arrow}</span>`:''}</span><span class="gv-rc">${n}</span><span class="gv-rd">${s}</span></button>`; }).join('')}</div>`;
  const GRP = st => st==='withdrawn'||st==='expired' ? 'Ended' : STG[st][1];
  let prev = null;
  const rows = L.slice(G.pp*per, G.pp*per+per).map(p=>{ const R = RULES[p.type], g = GRP(p.st), h = !G.st && g!==prev ? `<div class="gv-g">${lbl(`${g} · ${L.filter(x=>GRP(x.st)===g).length}`)}</div>` : ''; prev = g;
    return `${h}<button class="gv-r st-${p.st} ${p.tasks&&p.tasks.some(t=>t[4]==='late')?'late':''}" data-gopen="${p.id}">
      <span class="gv-k"><b>${p.t}</b><span><span class="mono">${p.id}</span> · ${R.t} · ${byName(p.by)}</span></span>
      <span class="gv-p">${prog(p)}</span>${nextOf(p)}
      <span class="gv-c">${ICO.talk}${p.posts}</span><span class="gv-go">${ICO.chev}</span></button>`; }).join('');
  const list = cell('s12','Every proposal',`<div class="seg sm" role="group" aria-label="Which proposals">${SET.map(([k,t,n])=>`<button data-gset="${k}" aria-pressed="${!G.st && G.set===k}">${t} ${n}</button>`).join('')}</div>`,
    `${rail}<div class="gv-l">${rows || `<div class="gv-e"><span>Nothing ${G.st ? `is in ${STG[G.st][1].toLowerCase()}` : 'here'} right now</span></div>`}</div>`,
    `<span>${G.st ? `Showing ${STG[G.st][1].toLowerCase()} · <button class="lnk3" data-gset="${G.set}">Show every step</button>` : 'Discussion stays open at every step · the text freezes when voting opens'}</span>${L.length > per ? pager(G.pp, L.length, per, 'gpp') : `<span class="quiet">${L.length} ${L.length===1?'proposal':'proposals'}</span>`}`);

  /* the vote that's running */
  const v = PROPS.find(p=>p.st==='vote' && !p.board), q = quorumN(v), days = v.castBy, dmx = Math.max(days[days.length-1], q)*1.1;
  const span = Math.round((v.voteClose - v.voteOpen)/DAY), today = days.length;
  const vote = cell('s7','Voting now',`<span class="lbl">${v.id} · closes ${WD(v.voteClose)} ${fmtD(v.voteClose)}</span>`,
    `<div class="gv-v"><div class="gv-vh"><div class="m-big">${v.cast} <small>of ${MEMBERS} members have voted · ${pct(v.cast,MEMBERS)}</small></div>
       <span class="fst">Enough voted</span></div>
      <div class="gv-vc">${Array.from({length:span},(_,i)=>{ const n = days[i]; return `<div class="${i<today?'':'f'} ${i===today-1?'now':''}"><i style="height:${n!=null ? n/dmx*100 : 0}%"></i><s>${i===0?fmtD(v.voteOpen):i===today-1?'Today':i===span-1?fmtD(v.voteClose):''}</s></div>`; }).join('')}
        <span class="gv-q" style="bottom:${q/dmx*100}%"><em>${q} needed to count · ${RULES[v.type].q*100}%</em></span></div>
      <div class="led gv-vl">${[['Results','Sealed until the vote closes'],['To pass',`${RULES[v.type].pass} of those voting yes or no`],['The board','Recommends yes · 3 to 0, on the record'],['Each voter','Gets a receipt to check their vote was counted']].map(([k,x])=>`<div><span>${k}</span><b>${x}</b></div>`).join('')}</div></div>`,
    `<span>${MEMBERS-v.cast} haven’t voted · ${Math.ceil((v.voteClose-NOW)/DAY)} days left</span><button data-gremind="${v.id}">Remind them →</button>`);

  /* the forum */
  const talk = cell('s7','Discussion',`<span class="lbl">From Community · latest first</span>`,
    `<div class="gv-f" id="gv-talk">${POSTS.map(x=>`<button class="gv-f-r ${x.hidden?'hid':''}" data-gopen="${x.p==='idea'?'':x.p}" ${x.p==='idea'?'data-gidea':''}>${av(x.by)}<span class="gv-f-k"><span class="gv-f-h"><b>${byName(x.by)}</b>${x.staff?'<span class="gv-staff">Staff</span>':''}<span class="gv-tag mono">${x.p==='idea'?'Idea':x.p}</span></span>
        ${x.hidden ? `<em>Hidden by ${x.hidden}</em>` : `<span class="gv-f-t">${x.t}</span>`}</span><span class="gv-f-a"><span>${ago(x.at)}</span>${x.r?`<span>${ICO.talk}${x.r}</span>`:''}</span></button>`).join('')}</div>`,
    `<span>The talk happens in Community · decisions are tracked here</span><button data-gforum>Community →</button>`);

  /* carried out */
  const D2 = PROPS.filter(p=>p.st==='done');
  const done = cell('s5','Carried out',`<span class="lbl">Passed, then done</span>`,
    `<div class="gv-d" id="gv-done">${D2.map(p=>`<div class="gv-d-p"><button class="gv-d-h" data-gopen="${p.id}"><span class="mono">${p.id}</span><b>${p.t}</b></button>
      ${p.tasks.map(t=>`<div class="gv-d-t ${t[4]}"><i></i><span><b>${t[0]}</b><em>${t[1]} · ${who(t[2])}${t[5] ? ' · '+t[5].toLowerCase() : ''}</em></span><span class="gv-d-s">${({done:'Done',doing:'Under way',waits:'Waiting',late:`${Math.round((NOW-t[3])/DAY)} d late`})[t[4]]}</span></div>`).join('')}</div>`).join('')}</div>`,
    `<span class="f-key"><span><i style="background:var(--fg)"></i>Done</span><span><i style="background:var(--settled)"></i>Under way</span><span><i class="hx"></i>Waiting</span><span><i style="background:var(--absent)"></i>Late</span></span><span></span>`);

  /* who decides what */
  const rules = cell('s12','Who decides what','<span class="lbl">From the co-op agreement</span>',
    `<div class="gv-rt"><div class="gv-rt-r hd2">${lbl('Kind of decision')}${lbl('Who decides')}${lbl('To pass')}${lbl('Turnout to count')}${lbl('Vote runs')}</div>
      ${Object.entries(RULES).map(([k,r])=>`<div class="gv-rt-r ${r.off?'off':''}"><span class="gv-rt-k"><b>${r.t}</b><em>${r.note}</em></span><span>${r.body}</span><span>${r.pass}</span><span>${r.q ? `${r.q*100}% · ${Math.ceil(MEMBERS*r.q)} members` : '<span class="quiet">A meeting’s quorum</span>'}</span><span>${r.days ? `${r.days} days` : '<span class="quiet">At a meeting</span>'}</span></div>`).join('')}</div>`,
    `<span>${PETITION}</span><span></span>`);

  document.getElementById('gv').innerHTML = band(list, 1) + band(vote + needsCell()) + band(talk + done) + band(rules);
}

/* ══ Panel ══════════════════════════════════════════════════════════════════════════════════════════════════ */
function ensurePanel(){ let pn = document.getElementById('gpanel');
  if (!pn){ const sc = document.createElement('div'); sc.id = 'gscrim'; sc.className = 'scrim'; document.body.appendChild(sc); pn = document.createElement('aside'); pn.id = 'gpanel'; pn.className = 'panel gpanel'; document.body.appendChild(pn); }
  return pn; }
function renderPanel(){ const pn = ensurePanel(), P = G.panel;
  if (!P){ document.body.classList.remove('pn'); return; }
  document.body.classList.add('pn'); pn.innerHTML = P.id ? propPanel(PROP[P.id]) : P.ent ? entPanel(P.ent) : P.agr ? agrPanel(P.agr) : P.mt ? mtPanel(P.mt) : ''; if (P.thread){ const el = pn.querySelector('.gv-th'); el && el.scrollIntoView({block:'start'}); } }
function track(p){
  const order = ['draft','sponsor','check','vote','decided','done'], at = p.st==='withdrawn'||p.st==='expired' ? -1 : order.indexOf(p.st);
  const T = RULES[p.type].q ? STAGES : STAGES.map(s=>s[0]==='sponsor' ? [s[0],'Co-signing'] : s[0]==='vote' ? [s[0],'Board vote'] : s);
  return `<div class="bd-tk">${T.map(([k,t],i)=>`<span class="${at<0?'':i<at?'done':i===at?(p.tasks&&p.tasks.some(x=>x[4]==='late')?'late':'now'):''}"><i></i>${t}</span>`).join('')}</div>`; }
function propPanel(p){
  const R = RULES[p.type], q = quorumN(p), mine = STAFF();
  const rows = [['Kind',R.t],['Who decides',R.body],['To pass',R.pass],...(q ? [['Turnout to count',`${R.q*100}% · ${q} of ${MEMBERS} members`]] : []),...(R.days ? [['Vote runs',`${R.days} days`]] : []),
    ['Written by',`${byName(p.by)}${p.coauth ? ` with ${p.coauth.length} co-author${p.coauth.length>1?'s':''}` : ''}`],['Text',`Version ${p.ver}${p.decidedAt || p.endedAt ? ' · final' : p.frozen ? ` · frozen ${fmtD(p.frozen)}` : ' · can still change'}`],
    ...(p.amt ? [['From the co-op balance',`$${p.amt.toFixed(2)} of $476.20`]] : []),
    ...(p.live ? [['Live',p.live]] : []),...(p.boardVote ? [[p.st==='vote'?'The board recommends':'The board voted', `${p.st==='vote'?'Yes · ':''}${p.boardVote[0]} to ${p.boardVote[1]}, on the record`]] : [])];
  let block = '';
  if (p.st==='sponsor') block = `<div>${lbl('Co-signers')}<div class="gv-pb"><span class="gv-bar gb-sp"><i style="width:${p.sponsors/SPONSORS*100}%"></i></span><b>${p.sponsors} of ${SPONSORS}</b></div><p class="bpn-n">It goes to a vote once ${SPONSORS} members co-sign · expires ${fmtD(p.sponsorBy)} if not, and the thread stays.</p></div>`;
  if (p.st==='check') block = `<div>${lbl(`The check · ${who(p.checker)} · due ${fmtD(p.checkDue)}`)}<div class="led gv-cl">${p.checks.map(([k,s,ok])=>`<div><span><i class="${ok?'ok':''}"></i>${k}</span><b>${s}</b></div>`).join('')}</div>
    <p class="bpn-n">The check decides who votes and what it takes. It can send a proposal back with a reason, never stop it for being unpopular.</p>
    ${G.back ? `<label>${lbl('Why it goes back')}<textarea id="gback" class="vin" rows="3" placeholder="What needs to change before it can go forward"></textarea></label>` : ''}</div>`;
  if (p.st==='vote' && !p.board) block = `<div>${lbl('Turnout')}<div class="gv-pb"><span class="gv-bar gb-vt"><i style="width:${p.cast/MEMBERS*100}%"></i><s style="left:${R.q*100}%"></s></span><b>${p.cast} of ${MEMBERS}</b></div>
    <p class="bpn-w"><b>Results are sealed until ${WD(p.voteClose)} ${fmtD(p.voteClose)} at 23:59.</b> Nobody sees how the vote is going, staff included. At the close the tally is counted, signed and written on-chain, and each voter can check their receipt.</p></div>`;
  if (p.st==='decided') block = `<div>${lbl('Result')}<div class="gv-pb"><span class="gv-bar gb-vt"><i style="width:${p.cast/MEMBERS*100}%"></i><s style="left:${R.q*100}%"></s></span><b>${p.cast} of ${MEMBERS}</b></div>
    <p class="bpn-n">${p.result==='quorum' ? `${p.tally[0]} yes, ${p.tally[1]} no, ${p.tally[2]} abstained, but only ${p.cast} voted and ${q} were needed for it to count. It can come back as a new proposal.` : ''}</p></div>`;
  if (p.tasks) block = `<div>${lbl('Carrying it out')}<div class="gv-d gv-d-pn">${p.tasks.map((t,i)=>`<div class="gv-d-t ${t[4]}"><i></i><span><b>${t[0]}</b><em>${t[1]} · ${who(t[2])} · due ${fmtD(t[3])}${t[5] ? ' · '+t[5].toLowerCase() : ''}</em></span>${t[2]===G.me && (t[4]==='doing'||t[4]==='late') ? `<button class="btn sm-b" data-gtask="${p.id}:${i}">Mark done</button>` : `<span class="gv-d-s">${({done:'Done',doing:'Under way',waits:'Waiting',late:'Late'})[t[4]]}</span>`}</div>`).join('')}</div></div>`;
  const th = POSTS.filter(x=>x.p===p.id);
  const thread = `<div class="gv-th">${lbl(`Discussion · ${p.posts} posts${p.st==='vote'?' · open during the vote':''}`)}
    ${th.map(x=>`<div class="gv-tp ${x.hidden?'hid':''}">${av(x.by)}<span><span class="gv-f-h"><b>${byName(x.by)}</b>${x.staff?'<span class="gv-staff">Staff</span>':''}<span class="quiet">${ago(x.at)}</span></span>${x.hidden ? `<em>Hidden by ${x.hidden} · logged in Records</em>` : `<span>${x.t}</span>`}</span></div>`).join('') || '<p class="bpn-n">Older posts are in the forum.</p>'}
    ${p.frozen ? `<div class="gv-ver"><i></i>Text frozen at version ${p.ver} · ${fmtD(p.frozen)}</div>` : ''}</div>`;
  const ft = !mine ? `<span class="small quiet" style="margin-right:auto">Read-only · ${stateTxt(p)}</span><button class="btn" data-gforum>Thread in Community →</button>`
    : p.st==='check' && p.checker===G.me ? (G.back ? `<button class="btn" data-gbackx>Back</button><button class="btn dz" data-gsend="${p.id}">Send it back</button>` : `<button class="btn" data-gbacko>Send back</button><button class="btn p" data-gpass="${p.id}">${p.type==='elect'?'Close nominations':'Checked · send it on'}</button>`)
    : p.st==='vote' && !p.board ? `<button class="btn" data-gremind="${p.id}">Remind the ${MEMBERS-p.cast}</button><button class="btn p" data-gapp>Vote in the app ↗</button>`
    : p.st==='sponsor' ? `<button class="btn" data-gforum>Thread in Community →</button><button class="btn p" data-gshare>Share the co-sign link</button>`
    : `<span class="small quiet" style="margin-right:auto">${stateTxt(p)}</span><button class="btn" data-gforum>Thread in Community →</button>`;
  return `<div class="pn-hd"><span class="lbl">${p.id} · ${R.t}</span><button class="x" data-gclose aria-label="Close">${ICO.x}</button></div>
    <div class="pn-b"><div><p class="bpn-t">${p.t}</p><p class="bpn-s ${p.st==='vote'?'me':''}">${stateTxt(p)}</p></div>${track(p)}
      <p class="bpn-n">${p.sum}</p>
      <div class="led">${rows.map(([k,v])=>`<div><span>${k}</span><b>${v}</b></div>`).join('')}</div>
      ${block}${thread}</div>
    <div class="pn-ft">${ft}</div>`;
}

/* ══ render + events ════════════════════════════════════════════════════════════════════════════════════════ */
function render(){
  document.querySelectorAll('.gtabs [data-gtab]').forEach(b=>b.setAttribute('aria-current', b.dataset.gtab===G.tab?'page':'false'));
  document.getElementById('gw').classList.toggle('ro', !STAFF());
  renderHdr();
  ({overview:renderOverview, proposals:renderProposals, boards:renderBoards, entities:renderEntities, agreements:renderAgreements, calendar:renderCalendar})[G.tab]();
  renderPanel();
}
const closeG = () => { G.panel = null; G.back = false; };
document.addEventListener('click', e => {
  if (e.target.id==='gscrim'){ closeG(); return render(); }
  const t = e.target.closest('button,a,[data-gopen],[data-gst],[data-gjump],[data-gent],[data-gagr],[data-gmt],[data-gmo]'); if (!t) return; const d = t.dataset;
  if (d.gtab){ G.tab = d.gtab; closeG(); render(); window.scrollTo({top:0}); return; }
  if (d.gset){ G.set = d.gset; G.st = null; G.pp = 0; return render(); }
  if (d.gst){ G.tab = 'proposals'; G.st = d.gst==='all' || G.st===d.gst ? null : d.gst; if (d.gst==='all') G.set = 'open'; G.pp = 0; return render(); }
  if (d.gjump){ const el = document.getElementById(d.gjump); el && el.scrollIntoView({behavior:'smooth', block:'center'}); return; }
  if (d.gidea!==undefined) return toast('Goes to the idea in Community');
  if (d.gopen){ G.panel = {id:d.gopen, thread:d.gthread}; G.back = false; return render(); }
  if (d.gent){ G.panel = {ent:d.gent}; return render(); }
  if (d.gagr){ G.panel = {agr:d.gagr}; return render(); }
  if (d.gmt){ G.panel = {mt:d.gmt}; return render(); }
  if (d.gcal){ G.cal = d.gcal; return render(); }
  if (d.gcv){ G.cv = d.gcv; return render(); }
  if (d.gmo!==undefined){ G.mo = Math.max(0, Math.min(11, +d.gmo)); if (d.gmv) G.cv = 'month'; return render(); }
  if (d.gag){ G.ag = d.gag; return render(); }
  if (d.gsign){ const a = AGR.find(x=>x.id===d.gsign); a.st = 'signed'; a.a = NOW; a.b = NOW + 365*DAY; closeG(); render(); return toast(`Signed · ${a.party} is added in the Ops Safe next, in Build`); }
  if (d.gcomm!==undefined) return toast('Goes to Community → Live');
  if (d.gcompare) return toast('Opens the two versions side by side, with every change marked');
  if (d.gdraft){ const a = AGR.find(x=>x.id===d.gdraft), V = VERS[a.id], last = V[V.length-1]; return toast(last[2]==='draft'||last[2]==='vote' ? `${last[0]} is already open · edit it instead` : `Drafts the next version from ${last[0]} · it goes to ${a.type==='member'?'a member vote':'the board'} before it’s in force`); }
  if (d.gfile) return toast('Opens the filing checklist');
  if (d.gclose!==undefined){ closeG(); return render(); }
  if (d.gpp){ G.pp += +d.gpp; return render(); }
  if (d.gbacko!==undefined){ G.back = true; return render(); }
  if (d.gbackx!==undefined){ G.back = false; return render(); }
  if (d.gsend){ const p = PROP[d.gsend], why = (document.getElementById('gback')||{}).value || 'No reason given'; p.st = 'draft'; p.ver += 1; closeG(); render(); return toast(`Sent back to ${byName(p.by)} · the reason is posted in the thread`); }
  if (d.gpass){ const p = PROP[d.gpass]; p.checks.forEach(c=>c[2]=1);
    if (RULES[p.type].q){ p.st = 'vote'; p.voteOpen = NOW; p.voteClose = NOW + RULES[p.type].days*DAY; p.cast = 0; p.castBy = [0]; p.frozen = NOW; }
    else { p.st = 'vote'; p.board = D(11,4); p.frozen = NOW; }
    closeG(); render(); return toast(p.board ? `Checked · on the board’s agenda for 4 Nov · text frozen` : `Checked · voting opens now`); }
  if (d.gtask){ const [id,i] = d.gtask.split(':'), p = PROP[id]; p.tasks[+i][4] = 'done'; if (p.tasks[+i+1] && p.tasks[+i+1][4]==='waits') p.tasks[+i+1][4] = 'doing'; render(); return toast('Marked done · logged in Records'); }
  if (d.gremind) return toast(`Reminder sent to ${MEMBERS - PROP[d.gremind].cast} members · in the app and by email`);
  if (d.gapp!==undefined) return toast('Opens your ballot in the member app');
  if (d.gshare!==undefined) return toast('Co-sign link copied');
  if (d.gforum!==undefined) return toast('Goes to the thread in Community');
});
document.addEventListener('keydown', e => { if (e.key==='Escape' && G.panel){ closeG(); render(); } });
const hs = location.hash.slice(1).split(',');
['overview','proposals','boards','entities','agreements','calendar'].forEach(t=>{ if (hs.includes(t)) G.tab = t; });
['dt','hold','fdn'].forEach(id=>{ if (hs.includes('ent-'+id)) G.panel = {ent:id}; }); if (hs.includes('agr-icw')) G.panel = {agr:'icw'}; if (hs.includes('agr-mem')) G.panel = {agr:'mem21'}; if (hs.includes('mt')) G.panel = {mt:'M-14'}; if (hs.includes('month')) G.cv = 'month';
if (hs.includes('member')) G.me = 'm2';
if (hs.includes('dark')) document.documentElement.dataset.theme = 'dark';
['P-012','P-015','P-016','P-013','P-009','P-010'].forEach(id=>{ if (hs.includes(id)) G.panel = {id}; });
if (hs.includes('closed')) G.set = 'closed';
render();

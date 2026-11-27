
/* ══ Governance — the other tabs. Functions only: they're called after everything above has loaded. ══════════ */

const ownerName = k => PPL[k] ? who(k) : /^[0-9a-f]{2}$/.test(k) ? mm(k) : k;
/* every dated thing across governance: filings, meetings, votes, tasks and renewals */
function calItems(){
  const out = [];
  FILINGS.forEach(f=>out.push({ t:f[3], kind:f[2].startsWith('Annual member') ? 'meeting' : 'filing', title:f[2], ent:f[1], st:f[4], owner:f[5], at:`data-gfile="${f[0]}"` }));
  MEETINGS.filter(m=>m[4]==='next').forEach(m=>out.push({ t:m[2], kind:'meeting', title:`${GBOARDS.find(b=>b[0]===m[1])[1]} meets`, ent:m[1]==='coop'?'coop':m[1], st:'next', owner:'kai', at:`data-gmt="${m[0]}"` }));
  PROPS.forEach(p=>{
    if (p.st==='vote' && !p.board) out.push({ t:p.voteClose, kind:'vote', title:`${p.id} closes · ${p.t}`, ent:'coop', st:'next', owner:'Members', at:`data-gopen="${p.id}"` });
    if (p.st==='check') out.push({ t:p.checkDue, kind:'vote', title:`${p.id} ${p.type==='elect'?'nominations close':'check due'} · ${p.t}`, ent:'coop', st:'next', owner:p.checker, at:`data-gopen="${p.id}"` });
    if (p.st==='sponsor') out.push({ t:p.sponsorBy, kind:'vote', title:`${p.id} co-signing ends · ${p.t}`, ent:'coop', st:'next', owner:p.by, at:`data-gopen="${p.id}"` });
    (p.tasks||[]).filter(x=>x[4]!=='done').forEach(x=>out.push({ t:x[3], kind:'task', title:`${x[0]} · ${p.id}`, ent:'coop', st:x[4]==='late'?'late':'next', owner:x[2], at:`data-gopen="${p.id}"` })); });
  AGR.filter(a=>a.st==='renew').forEach(a=>out.push({ t:a.b, kind:'renew', title:`${a.name} renews · ${a.party}`, ent:a.type==='company'?'coop':'fin', st:'next', owner:'kai', at:`data-gagr="${a.id}"` }));
  return out.sort((a,b)=>a.t-b.t);
}
const CALK = { filing:['Filing','var(--fg)'], meeting:['Meeting','var(--live)'], vote:['Proposal','color-mix(in srgb,var(--live) 55%,transparent)'], task:['Task','var(--settled)'], renew:['Renewal','var(--underway)'] };
function calStatus(c){
  if (c.kind==='filing') return `<span class="gt-st ${c.st==='later'?'later':''}" style="--c:${FST[c.st][1]}">${FST[c.st][0]}</span>`;
  if (c.st==='late') return `<span class="gt-st bad" style="--c:var(--absent)">${Math.round((NOW-c.t)/DAY)} d late</span>`;
  return `<span class="gt-st" style="--c:${CALK[c.kind][1]}">${CALK[c.kind][0]}</span>`;
}
/* a list of dated rows; rows that share a date hang off the first with a tie */
function calList(items, cls=''){
  let prev = null;
  return `<div class="gt-cl ${cls}">${items.map(c=>{ const day = Math.floor(c.t/DAY), same = day===prev; prev = day;
    return `<button class="gt-cr ${same?'same':''} ${c.st==='late'?'late':''} ${c.st==='done'?'done':''}" ${c.at}>${same ? '<span class="gt-tie"><i></i></span>' : leaf(c.t)}<span class="gt-ck"><b>${c.title}</b><span>${ESHORT[c.ent]||c.ent} · ${ownerName(c.owner)}</span></span>${calStatus(c)}</button>`; }).join('')}</div>`;
}
const stageChip = p => { const i = STAGES.findIndex(s=>s[0]===p.st); return `<span class="gt-sg ${p.st}"><span class="gv-rn">${i+1}</span>${STG[p.st][1]}</span>`; };
function seatChips(b, small){
  return `<span class="gt-seats ${small?'sm':''}">${b[3].map(s=>{ const C = SEATC[s[0]];
    return `<span class="gt-seat ${s[1]?'':'open'}" style="--c:${C[1]}" title="${C[0]}${s[1]?' · '+who(s[1]):''}">${small ? '' : `<i></i><b>${s[1] ? (s[1]==='kai'?'Kai':who(s[1]).replace('Member ','')) : 'Open'}</b><em>${s[1] ? `to ${MON[new Date(s[3]).getUTCMonth()]} ${new Date(s[3]).getUTCFullYear()}` : s[4]||C[0]}</em>`}</span>`; }).join('')}</span>`;
}
const votesDots = v => `<span class="gt-vd">${v.map(x=>`<i class="${x}" title="${VOTEC[x][0]}"></i>`).join('')}</span>`;

/* ══ Overview ══════════════════════════════════════════════════════════════════════════════════════════════ */
function renderOverview(){
  const ORD = {vote:0,check:1,sponsor:2,draft:3,done:4};
  const open = PROPS.filter(isOpen).sort((a,b)=>ORD[a.st]-ORD[b.st]).slice(0,6);
  const deciding = cell('s7','Being decided',`<span class="lbl">${PROPS.filter(isOpen).length} open proposals</span>`,
    `<div class="gt-dl">${open.map(p=>`<button class="gt-dr ${p.tasks&&p.tasks.some(t=>t[4]==='late')?'late':''}" data-gopen="${p.id}">${stageChip(p)}<span class="gt-dk"><b>${p.t}</b><span><span class="mono">${p.id}</span> · ${RULES[p.type].body}</span></span>${nextOf(p)}</button>`).join('')}</div>`,
    `<span>Discussion happens in Community · decisions are tracked here</span><button data-gtab="proposals">Every proposal →</button>`);
  const up = calItems().filter(c=>c.t>=TODAY && c.st!=='done').slice(0,7);
  const coming = cell('s7','Coming up',`<span class="lbl">Next ${Math.ceil((up[up.length-1].t-TODAY)/DAY)} days</span>`, calList(up),
    `<span>Filings, meetings, votes and renewals</span><button data-gtab="calendar">Calendar →</button>`);
  const boards = cell('s5','Boards',`<span class="lbl">Seats filled</span>`,
    `<div class="gt-bl">${GBOARDS.map(b=>`<button class="gt-br ${b[4]?'off':''}" data-gtab="boards"><span class="gt-bk"><b>${b[1]}</b><span>${b[4] ? 'Switches on at 5 communities' : `${b[3].filter(s=>s[1]).length} of ${b[3].length} seats filled`}</span></span>${seatChips(b,1)}</button>`).join('')}</div>`,
    `<span>Next: co-op board, ${WD(MEETINGS[0][2])} ${fmtD(MEETINGS[0][2])}</span><button data-gtab="boards">Boards →</button>`);
  const recent = cell('s7','Recently decided',`<span class="lbl">Every vote on the record</span>`,
    `<div class="gt-rl">${RESOS.slice(0,5).map(r=>resoRow(r)).join('')}</div>`,
    `<span>Board votes are on the record by name</span><button data-gtab="boards">Resolutions →</button>`);
  const f = ENT.filter(e=>e[3]==='formed').length, fg = ENT.filter(e=>e[3]==='forming'), pl = ENT.filter(e=>e[3]==='planned').length, nf = ENT.filter(e=>e[3]!=='formed');
  const ents = cell('s5','Entities',`<span class="lbl">${f} of ${ENT.length} formed</span>`,
    `<div class="gt-eo"><div class="gt-eb">${ENT.map(e=>`<i class="${e[3]}" title="${e[1]} · ${EST[e[3]][0]}"></i>`).join('')}</div>
      <div class="gt-el">${nf.map(e=>{ const S = ENTF[e[0]].steps, d = S.filter(s=>s[1]).length; return `<button class="gt-er ${e[3]}" data-gent="${e[0]}"><span><b>${e[1]}</b><em>${d} of ${S.length} steps · ${ENTF[e[0]].due ? 'due '+fmtD(ENTF[e[0]].due) : 'when it’s needed'}</em></span><span class="gt-steps">${S.map(s=>`<i class="${s[1]?'on':''}"></i>`).join('')}</span></button>`; }).join('')}</div></div>`,
    `<span class="f-key"><span><i style="background:var(--fg)"></i>Formed ${f}</span><span><i style="background:var(--underway)"></i>Forming ${fg.length}</span><span><i class="hx"></i>Planned ${pl}</span></span><span></span>`);
  document.getElementById('gv').innerHTML = band(deciding + needsCell(), 1) + band(coming + boards) + band(recent + ents);
}
function resoRow(r){
  const b = GBOARDS.find(x=>x[0]===r[1]), y = r[3].filter(x=>x==='y').length, n = r[3].filter(x=>x==='n').length;
  return `<div class="gt-rr">${leaf(r[0])}<span class="gt-rk"><b>${r[2]}</b><span>${b[1]}${r[4]?` · <button class="lnk3 mono" data-gopen="${r[4]}">${r[4]}</button>`:''}</span></span><span class="gt-rv">${votesDots(r[3])}<em>${y} yes${n?` · ${n} no`:''}${r[3].includes('r')?' · 1 recused':''}</em></span></div>`;
}

/* ══ Boards ════════════════════════════════════════════════════════════════════════════════════════════════ */
function renderBoards(){
  const seats = cell('s12','Every seat',`<span class="lbl">${GBOARDS.filter(b=>!b[4]).reduce((a,b)=>a+b[3].length,0)} seats · 3 boards</span>`,
    `<div class="gt-sl">${GBOARDS.map(b=>`<div class="gt-sr ${b[4]?'off':''}"><span class="gt-sk"><b>${b[1]}</b><em>${b[2]}</em></span>${seatChips(b)}<span class="gt-sn"><b>${b[4] ? '0' : b[3].filter(s=>s[1]).length}</b><em>of ${b[3].length}</em></span></div>`).join('')}</div>`,
    `<span class="f-key">${['m','r','c','i','n'].map(k=>`<span><i style="background:${SEATC[k][1]}"></i>${SEATC[k][0]}</span>`).join('')}<span><i class="hx"></i>Open</span></span><span></span>`);
  const M = MEETINGS[0], tot = AGENDA.reduce((a,x)=>a+x[1],0);
  const next = cell('s7','Next meeting',`<span class="lbl">Co-op board · ${WD(M[2])} ${fmtD(M[2])} · ${hm(M[2])}</span>`,
    `<div class="gt-ag"><div class="gt-ag-b">${AGENDA.map(x=>`<i style="flex:${x[1]};background:${AK[x[3]][1]}" title="${x[0]}"></i>`).join('')}</div>
      <div class="gt-ag-l">${AGENDA.map((x,i)=>`<div class="gt-ag-r"><span class="mono">${i+1}</span><span class="gt-ag-k"><b>${x[0]}</b><em>${who(x[2])} · ${x[1]} min</em></span>${x[4] ? `<button class="lnk3 mono" data-gopen="${x[4]}">${x[4]}</button>` : '<span></span>'}<span class="gt-st" style="--c:${AK[x[3]][1]}">${AK[x[3]][0]}</span></div>`).join('')}</div></div>`,
    `<span>${tot} min · open session, broadcast in Community</span><button data-gcomm>Community →</button>`);
  const mtgs = cell('s5','Meetings',`<span class="lbl">Minutes and records</span>`,
    `<div class="gt-ml">${MEETINGS.map(m=>{ const b = GBOARDS.find(x=>x[0]===m[1]); return `<button class="gt-mr ${m[4]}" data-gmt="${m[0]}">${leaf(m[2])}<span class="gt-ck"><b>${b[1]}</b><span>${m[3]}</span></span><span class="gt-st" style="--c:${m[4]==='next'?'var(--live)':m[5]==='approve'?'var(--underway)':'var(--fg)'}">${m[4]==='next' ? 'Next' : m[5]==='approve' ? 'Minutes to approve' : 'Minutes approved'}</span></button>`; }).join('')}</div>`,
    `<span>Minutes are filed in Records once approved</span><span></span>`);
  const resos = cell('s12','Resolutions',`<span class="lbl">${RESOS.length} this quarter</span>`,
    `<div class="gt-rl wide">${RESOS.map(r=>resoRow(r)).join('')}</div>`,
    `<span class="f-key">${['y','n','r'].map(k=>`<span><i style="background:${VOTEC[k][1]}"></i>${VOTEC[k][0]}</span>`).join('')}<span><i class="gt-ab"></i>Absent</span></span><span>Every board vote is on the record by name</span>`);
  document.getElementById('gv').innerHTML = band(seats, 1) + band(next + mtgs) + band(resos);
}

/* ══ Entities ══════════════════════════════════════════════════════════════════════════════════════════════ */
const ENTXY = { coop:[50,14], fdn:[12,14], labs:[12,46], fin:[37,46], hold:[63,46], dt:[88,46], mgr:[40,77], prop:[63,77], lend:[86,77] };
function entFoot(id){
  const e = ENTO[id], F = ENTF[id];
  const r = e[3]==='formed' ? `Since ${fmtD(F.formed)}` : F.steps ? `${F.steps.filter(x=>x[1]).length} of ${F.steps.length} steps${F.due ? ' · '+fmtD(F.due) : ''}` : '';
  return `<span class="gt-nf"><em style="--c:${EST[e[3]][1]}">${EST[e[3]][0]}</em><span>${e[3]==='planned' && !F.due ? 'When needed' : r}</span></span>`;
}
function entMap(){
  const seatsOf = id => { const b = GBOARDS.find(x=>x[0]===id); return b ? `<span class="gt-ns" title="${b[1]}: ${b[3].filter(s=>s[1]).length} of ${b[3].length} seats filled">${b[3].map(st=>`<i class="${st[1]?'on':''}"></i>`).join('')}</span>` : ''; };
  const box = id => { const e = ENTO[id], [x,y] = ENTXY[id];
    return `<button class="gt-n ${e[3]} ${id==='fdn'?'own0':''}" style="left:${x}%;top:${y}%" data-gent="${id}"><span class="gt-nh"><b>${e[1]}</b><span class="gt-nk"><span>${e[2]}</span>${seatsOf(id)}</span></span>${entFoot(id)}</button>`; };
  const H = 9.6; /* half a box's height (46px of 480), in % of the map */
  const lines = Object.entries(PARENT).filter(([k,p])=>p).map(([k,p])=>{ const [x1,y1] = ENTXY[p], [x2,y2] = ENTXY[k], my = (y1+H + y2-H)/2;
    return `<path class="gt-ln" d="M${x1} ${y1+H} V${my} H${x2} V${y2-H}"/>`; }).join('');
  const bus = 93.5, [mx] = ENTXY.mgr, my2 = ENTXY.mgr[1]+H;
  const manages = `<path class="gt-ln mg" d="M${mx} ${my2} V${bus} H${ENTXY.lend[0]} V${my2} M${ENTXY.prop[0]} ${bus} V${my2}"/>`;
  const labels = Object.entries(OWN).map(([k,v])=>{ const [x,y] = ENTXY[k]; return `<span class="gt-own" style="left:${x}%;top:${y-H-1.2}%">${v.split(',')[0]}</span>`; }).join('');
  const cx = ENTXY.fdn[0]-6;
  return `<div class="gt-map"><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${lines}${manages}<path class="gt-ln ct" d="M${cx} ${ENTXY.fdn[1]+H} V${ENTXY.labs[1]-H}"/></svg>${labels}
      <span class="gt-own gt-tl" style="left:${ENTXY.coop[0]}%;top:${ENTXY.coop[1]-H-1.5}%">Owned by the members</span><span class="gt-own gt-tl" style="left:${ENTXY.fdn[0]}%;top:${ENTXY.fdn[1]-H-1.5}%">Outside the tree</span>
      <span class="gt-own ct" style="left:${cx}%;top:${(ENTXY.fdn[1]+ENTXY.labs[1])/2}%">Maintains for</span><span class="gt-own ct mg" style="left:${(ENTXY.prop[0]+ENTXY.lend[0])/2}%;top:${bus}%">Manages</span>${Object.keys(ENTXY).map(box).join('')}</div>
    <div class="gt-mapl">${['coop','fin','dt','hold','mgr','prop','lend','labs','fdn'].map(k=>ENTO[k]).map(e=>{ const depth = e[0]==='coop'||e[0]==='fdn' ? 0 : ['fin','dt','hold','labs'].includes(e[0]) ? 1 : 2;
      const b = GBOARDS.find(x=>x[0]===e[0]);
      return `<button class="gt-ml-r d${depth} ${e[3]}" data-gent="${e[0]}"><i></i><span><b>${e[1]}</b><em>${e[0]==='fdn' ? 'Outside the tree · ownerless · ClearLabs maintains for it' : e[0]==='mgr' ? '100% owned by Clear Capital Holdings · manages both funds' : PARENT[e[0]] ? `${OWN[e[0]].split(',')[0]} owned by ${ENTO[PARENT[e[0]]][1]}` : e[2]}</em></span>${b ? `<span class="gt-ns">${b[3].map(st=>`<i class="${st[1]?'on':''}"></i>`).join('')}</span>` : '<span></span>'}<span class="gt-st" style="--c:${EST[e[3]][1]}">${EST[e[3]][0]}</span></button>`; }).join('')}</div>`;
}
function renderEntities(){
  const map = cell('s12','Who owns what',`<span class="lbl">${ENT.filter(e=>e[3]==='formed').length} of ${ENT.length} formed</span>`, `<div class="gt-mapw">${entMap()}</div>`,
    `<span class="f-key"><span><i style="background:var(--fg)"></i>Formed</span><span><i style="background:var(--underway)"></i>Forming</span><span><i class="hx"></i>Planned</span><span><i class="gt-dash"></i>Ownerless</span></span><span>The co-op owns everything inside the tree</span>`);
  const F = ENT.filter(e=>e[3]!=='formed');
  const forming = cell('s7','Forming',`<span class="lbl">${F.length} entities</span>`,
    `<div class="gt-fl">${F.map(e=>{ const S = ENTF[e[0]].steps, d = S.filter(s=>s[1]).length, nx = S.find(s=>!s[1]);
      return `<button class="gt-fr ${e[3]}" data-gent="${e[0]}"><span class="gt-ck"><b>${e[1]}</b><span>${nx ? `Next: ${nx[0].toLowerCase()}` : 'Done'}${ENTF[e[0]].due ? ` · due ${fmtD(ENTF[e[0]].due)}` : ' · when it’s needed'}</span></span><span class="gt-fs">${S.map((s,i)=>`<i class="${s[1]?'on':i===d?'nx':''}" title="${s[0]}"></i>`).join('')}</span><span class="gt-fn">${d} of ${S.length}</span></button>`; }).join('')}</div>`,
    `<span>Planned entities form when they’re needed, not before</span><span></span>`);
  const res = cell('s5','Reserved matters',`<span class="lbl">The co-op’s veto at Holdings</span>`,
    `<div class="gt-rm">${RESERVED.map(([t,w])=>`<div><span>${t}</span><b class="${/member/.test(w)?'mv':''}">${w}</b></div>`).join('')}</div>`,
    `<span>A veto doesn’t shrink as the board grows</span><span></span>`);
  document.getElementById('gv').innerHTML = band(map, 1) + band(forming + res);
}

/* ══ Agreements ════════════════════════════════════════════════════════════════════════════════════════════ */
function waitOf(a){ return ['out','draft'].includes(a.st) || (VERS[a.id]||[]).some(v=>v[2]==='vote'); }
function nextV(a){ return (VERS[a.id]||[]).find(v=>v[2]==='vote'||v[2]==='draft'); }
function renderAgreements(){
  const F = [['all','All'],['wait','Waiting'],['renew','Renewing'],['signed','Signed']];
  const ok = a => G.ag==='all' || (G.ag==='wait' ? waitOf(a) : a.st===G.ag);
  const L = AGR.filter(ok);
  const list = cell('s12','Every agreement',`<div class="seg sm" role="group" aria-label="Which agreements">${F.map(([k,t])=>`<button data-gag="${k}" aria-pressed="${G.ag===k}">${t} ${k==='all'?AGR.length:AGR.filter(a=>k==='wait'?waitOf(a):a.st===k).length}</button>`).join('')}</div>`,
    `<div class="gt-al">${AGR_T.map(([k,t])=>{ const A = L.filter(a=>a.type===k); return A.length ? `<div class="gv-g">${lbl(`${t} · ${A.length}`)}</div>${A.map(a=>`<button class="gt-ar st-${a.st}" data-gagr="${a.id}"><span class="gt-ck"><b>${a.name}</b><span>${a.party}</span></span><span class="gt-avw"><span class="mono gt-av">${a.ver}</span>${nextV(a) && nextV(a)[0]!==a.ver ? `<em class="gt-nx ${nextV(a)[2]}">${nextV(a)[0]} · ${nextV(a)[2]==='vote'?'vote':'draft'}</em>` : ''}</span>
      <span class="gt-ad">${a.st==='out' ? `Sent ${fmtD(a.sent)}` : a.a ? `Signed ${fmtD(a.a)}${new Date(a.a).getUTCFullYear()<2026?' '+new Date(a.a).getUTCFullYear():''}` : a.st==='vote' ? 'Not adopted yet' : 'Not signed'}<em>${a.b ? `${a.st==='renew'?'Renews':'Runs to'} ${fmtD(a.b)}${new Date(a.b).getUTCFullYear()>2026?' '+new Date(a.b).getUTCFullYear():''}` : a.roll ? 'Month to month' : a.st==='signed' ? 'No end date' : ''}</em></span>
      <span class="gt-st" style="--c:${AST[a.st][1]}">${AST[a.st][0]}</span><span class="gv-go">${ICO.chev}</span></button>`).join('')}` : ''; }).join('') || `<div class="gv-e"><span>Nothing here right now</span></div>`}</div>`,
    `<span>Signed copies come back from the e-signature tool and are kept in Records</span><span class="quiet">${L.length} agreements</span>`);
  const R = AGR.filter(a=>a.st==='renew').sort((a,b)=>a.b-b.b);
  const renew = cell('s7','Renewing',`<span class="lbl">Next 90 days</span>`,
    calList(R.map(a=>({ t:a.b, kind:'renew', title:`${a.name} · ${a.party}`, ent:a.type==='company'?'coop':'fin', st:'next', owner:'kai', at:`data-gagr="${a.id}"` }))),
    `<span>Renewals go to the board when terms change</span><span></span>`);
  const W = AGR.filter(waitOf);
  const wait = cell('s5','Waiting on someone',`<span class="lbl">${W.length} agreements</span>`,
    `<div class="gt-wl">${W.map(a=>`<button class="gt-wr st-${a.st}" data-gagr="${a.id}"><i style="background:${a.st==='out'?AST.out[1]:nextV(a)&&nextV(a)[2]==='vote'?'var(--live)':AST[a.st][1]}"></i><span class="gt-ck"><b>${a.party}</b><span>${a.name} ${nextV(a)&&a.st!=='out'?nextV(a)[0]:a.ver}</span></span><span class="gt-wn">${a.st==='out' ? 'You' : nextV(a)&&nextV(a)[2]==='vote' ? 'Members' : 'Kai · counsel'}</span></button>`).join('')}</div>`,
    `<span>The member agreement changes by member vote</span><span></span>`);
  /* versions of the standard agreements, on one timeline */
  const t0 = D(1,1), t1 = Date.UTC(2027,1,1), X = t => (Math.max(0,Math.min(1,(t-t0)/(t1-t0)))*100).toFixed(2);
  const fam = Object.keys(VERS).map(id=>AGR.find(a=>a.id===id)).filter(Boolean);
  const ticks = [D(1,1),D(3,1),D(5,1),D(7,1),D(9,1),D(11,1),Date.UTC(2027,0,1)];
  const vers = cell('s12','Versions',`<span class="lbl">Standard agreements · 2026</span>`,
    `<div class="gt-vl"><div class="gt-vr hd2"><span>${lbl('Agreement')}</span><span class="gt-vt">${ticks.map(t=>`<span style="left:${X(t)}%">${MON[new Date(t).getUTCMonth()]}</span>`).join('')}<span class="now" style="left:${X(NOW)}%">Today</span></span>${lbl('In force')}${lbl('Who’s on it')}</div>
      ${fam.map(a=>{ const V = VERS[a.id], cur = V.filter(v=>v[2]==='in').pop(), nx = V.find(v=>v[2]==='vote'||v[2]==='draft'), U = VUSE[a.id], ut = U ? U.reduce((s,u)=>s+u[1],0) : 0;
        return `<button class="gt-vr" data-gagr="${a.id}"><span class="gt-ck"><b>${a.name}</b><span>${a.party}</span></span>
          <span class="gt-vt"><i class="g" style="left:${X(NOW)}%"></i><i class="ln" style="left:${X(V[0][1])}%;right:${100-X(NOW)}%"></i>${nx?`<i class="ln f" style="left:${X(NOW)}%;right:${100-X(nx[1])}%"></i>`:''}
            ${V.map(v=>`<i class="dot ${v[2]}" style="left:${X(v[1])}%" title="${v[0]} · ${VST[v[2]][0]}"><em>${v[0]}</em></i>`).join('')}</span>
          <span class="gt-vc"><b class="mono">${cur ? cur[0] : '—'}</b><em>${nx ? `${nx[0]} · ${VST[nx[2]][0].toLowerCase()}` : 'No changes planned'}</em></span>
          <span class="gt-vu">${U ? `<span class="gt-vb">${U.map((u,i)=>`<i style="flex:${u[1]};background:${u[0]===cur[0]?'var(--fg)':'color-mix(in srgb,var(--fg) 30%,transparent)'}" title="${u[0]} · ${u[1]}"></i>`).join('')}</span><em>${U.map(u=>`${u[1]} on ${u[0]}`).join(' · ')}</em>` : `<em>${a.type==='company' ? 'Both companies sign each version' : 'Everyone, once adopted'}</em>`}</span></button>`; }).join('')}</div>`,
    `<span class="f-key"><span><i style="background:var(--fg)"></i>In force</span><span><i class="gt-ko"></i>Replaced</span><span><i class="gt-ko vote"></i>On the ballot</span><span><i class="hx"></i>In draft</span></span><span>Every version is kept, with what changed and who approved it</span>`);
  document.getElementById('gv').innerHTML = band(list, 1) + band(vers) + band(renew + wait);
}

/* ── a month as a grid: Monday first, today marked, up to three things a day ── */
function monthGrid(items, mo, col, more){
  const base = Date.UTC(2026, 9+mo, 1), d0 = new Date(base), y = d0.getUTCFullYear(), m = d0.getUTCMonth(), next = Date.UTC(y, m+1, 1);
  const lead = (d0.getUTCDay()+6)%7, start = base - lead*DAY, weeks = Math.ceil((lead + Math.round((next-base)/DAY))/7);
  const cells = Array.from({length:weeks*7},(_,i)=>{ const t = start + i*DAY, d = new Date(t), out = t<base || t>=next, wk = i%7>=5;
    const es = items.filter(c=>c.t>=t && c.t<t+DAY);
    return `<div class="gm-d ${out?'out':''} ${wk?'wk':''} ${t===TODAY?'today':''} ${t<TODAY?'past':''}"><span class="gm-n">${d.getUTCDate()===1 ? MON[d.getUTCMonth()]+' 1' : d.getUTCDate()}</span>
      ${es.slice(0,3).map(c=>`<button class="gm-e ${col(c)[1]||''}" ${c.at} style="--c:${col(c)[0]}" title="${c.title}"><i></i><span>${c.title}</span></button>`).join('')}${es.length>3?`<span class="gm-more">+${es.length-3} more</span>`:''}</div>`; }).join('');
  return `<div class="gm"><div class="gm-h">${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(x=>`<span>${x}</span>`).join('')}</div><div class="gm-g">${cells}</div></div>`;
}
const monthName = mo => { const d = new Date(Date.UTC(2026, 9+mo, 1)); return `${['January','February','March','April','May','June','July','August','September','October','November','December'][d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
const viewSeg = (key, v) => `<div class="seg sm gm-sw" role="group" aria-label="View"><button data-${key}="list" aria-pressed="${v==='list'}">List</button><button data-${key}="month" aria-pressed="${v==='month'}">Month</button></div>`;
const monthNav = (key, mo, max) => `<span class="pg2"><span>${monthName(mo)}</span>${mo?`<button class="gm-today" data-${key}="0">Today</button>`:''}<button data-${key}="${mo-1}" ${mo<=0?'disabled':''} aria-label="Previous month">${ICO.back}</button><button data-${key}="${mo+1}" ${mo>=max?'disabled':''} aria-label="Next month">${ICO.chev}</button></span>`;

/* ══ Calendar ══════════════════════════════════════════════════════════════════════════════════════════════ */
function renderCalendar(){
  const E = [['all','All'],['coop','Co-op'],['fin','Financial'],['hold','Holdings'],['labs','ClearLabs'],['dt','D&T Co.'],['fdn','Foundation']];
  const all = calItems().filter(c=>c.t>=D(10,1) && (G.cal==='all' || c.ent===G.cal));
  const months = Array.from({length:12},(_,i)=>Date.UTC(2026, 9+i, 1));
  const colOf = c => c.kind==='filing' ? [FST[c.st][1], c.st==='later'?'later':''] : c.st==='late' ? ['var(--absent)'] : [CALK[c.kind][1]];
  const strip = `<div class="gt-ms">${months.map((m,i)=>{ const n = Date.UTC(new Date(m).getUTCFullYear(), new Date(m).getUTCMonth()+1, 1), I = all.filter(c=>c.t>=m && c.t<n);
      return `<button class="gt-m ${m<=NOW && NOW<n?'now':''} ${G.cv==='month' && G.mo===i?'on':''}" data-gmo="${i}" data-gmv="1"><span class="lbl">${MON[new Date(m).getUTCMonth()]}</span><b>${I.length||''}</b><span class="gt-mq">${I.map(c=>`<i style="background:${colOf(c)[0]}" class="${c.st==='later'?'hxl':''}"></i>`).join('')}</span></button>`; }).join('')}</div>`;
  const right = `${viewSeg('gcv', G.cv)}<div class="seg sm" role="group" aria-label="Entity">${E.map(([k,t])=>`<button data-gcal="${k}" aria-pressed="${G.cal===k}">${t}</button>`).join('')}</div>`;
  const key = `<span class="f-key"><span><i style="background:var(--settled)"></i>Ready</span><span><i style="background:var(--underway)"></i>Drafting</span><span><i style="background:var(--absent)"></i>Not started</span><span><i class="hx"></i>Later</span><span><i style="background:var(--live)"></i>Meeting</span></span>`;
  let cal;
  if (G.cv==='month'){
    const m = months[G.mo], n = Date.UTC(new Date(m).getUTCFullYear(), new Date(m).getUTCMonth()+1, 1), I = all.filter(c=>c.t>=m && c.t<n);
    cal = cell('s12', monthName(G.mo), `<div class="gt-cr-h">${right}</div>`,
      `${strip}${monthGrid(all, G.mo, colOf)}<div class="gm-list">${I.length ? calList(I,'flat') : `<div class="gv-e"><span>Nothing in ${monthName(G.mo).split(' ')[0]}</span></div>`}</div>`,
      `${key}${monthNav('gmo', G.mo, 11)}`);
  } else {
    const groups = months.map(m=>{ const n = Date.UTC(new Date(m).getUTCFullYear(), new Date(m).getUTCMonth()+1, 1), I = all.filter(c=>c.t>=m && c.t<n);
      return I.length ? `<div class="gv-g">${lbl(`${MON[new Date(m).getUTCMonth()]} ${new Date(m).getUTCFullYear()} · ${I.length}`)}</div>${calList(I,'flat')}` : ''; }).join('');
    cal = cell('s12','Next 12 months',`<div class="gt-cr-h">${right}</div>`,
      `${strip}<div class="gt-cal">${groups || `<div class="gv-e"><span>Nothing due for this entity</span></div>`}</div>`,
      `${key}<span class="quiet">${all.length} dates</span>`);
  }
  document.getElementById('gv').innerHTML = band(cal, 1);
}

/* ══ Panels ════════════════════════════════════════════════════════════════════════════════════════════════ */
function entPanel(id){
  const e = ENTO[id], F = ENTF[id], kids = Object.keys(PARENT).filter(k=>PARENT[k]===id), fil = FILINGS.filter(f=>f[1]===id && f[4]!=='done');
  const rows = [['Kind',e[2]],['Status',EST[e[3]][0]],['Owned by', id==='fdn' ? 'No one · it’s ownerless' : PARENT[id] ? `${ENTO[PARENT[id]][1]} · ${OWN[id]}` : 'Its members · one member, one vote'],
    ...(kids.length ? [['Owns',kids.map(k=>`<button class="lnk3" data-gent="${k}">${ENTO[k][1]}</button>`).join(', ')]] : []),['Taxed as',F.tax],...(F.formed ? [['Formed',fmtD(F.formed)],['EIN',F.ein],['Officers',F.officers]] : [])];
  return `<div class="pn-hd"><span class="lbl">Entity</span><button class="x" data-gclose aria-label="Close">${ICO.x}</button></div>
    <div class="pn-b"><div><p class="bpn-t">${e[1]}</p><p class="bpn-s">${e[4]}</p></div>
      <div class="led">${rows.map(([k,v])=>`<div><span>${k}</span><b>${v}</b></div>`).join('')}</div>
      ${F.steps ? `<div>${lbl(`Forming${F.due?` · due ${fmtD(F.due)}`:''}`)}<div class="led gv-cl">${F.steps.map(([k,ok])=>`<div><span><i class="${ok?'ok':''}"></i>${k}</span><b>${ok?'Done':'To do'}</b></div>`).join('')}</div></div>` : ''}
      ${F.agr.length ? `<div>${lbl('Agreements')}<div class="led">${F.agr.map(a=>{ const x = AGR.find(y=>y.id===a); return x ? `<div><span><button class="lnk3" data-gagr="${x.id}">${x.name}</button></span><b>${AST[x.st][0]}</b></div>` : ''; }).join('')}</div></div>` : ''}
      ${fil.length ? `<div>${lbl('Due')}${calList(fil.map(f=>({ t:f[3], kind:'filing', title:f[2], ent:f[1], st:f[4], owner:f[5], at:`data-gfile="${f[0]}"` })),'pn')}</div>` : ''}</div>
    <div class="pn-ft"><span class="small quiet" style="margin-right:auto">Documents are kept in Records</span><button class="btn" data-gclose>Close</button></div>`;
}
function agrPanel(id){
  const a = AGR.find(x=>x.id===id), ents = Object.entries(ENTF).filter(([k,f])=>f.agr.includes(id)).map(([k])=>k);
  const rows = [['With',a.party],['Kind',AGR_T.find(t=>t[0]===a.type)[1]],['Version',a.ver],['Status',AST[a.st][0]],...(a.a ? [['Signed',fmtD(a.a)]] : []),...(a.sent ? [['Sent',fmtD(a.sent)]] : []),
    ['Runs to', a.b ? fmtD(a.b)+' '+new Date(a.b).getUTCFullYear() : a.roll ? 'Month to month' : 'No end date'],...(ents.length ? [['Our side',ents.map(k=>`<button class="lnk3" data-gent="${k}">${ENTO[k][1]}</button>`).join(', ')]] : []),
    ...(a.prop ? [['The vote',`<button class="lnk3" data-gopen="${a.prop}">${a.prop} · voting now</button>`]] : [])];
  const ft = a.st==='out' && STAFF() ? `<button class="btn" data-gclose>Not now</button><button class="btn p" data-gsign="${a.id}">Sign it</button>` : VERS[a.id] && STAFF() ? `<button class="btn" data-gcompare="${a.id}">Compare versions</button><button class="btn p" data-gdraft="${a.id}">Start a new version</button>` : `<span class="small quiet" style="margin-right:auto">${AST[a.st][0]}</span><button class="btn" data-gclose>Close</button>`;
  return `<div class="pn-hd"><span class="lbl">Agreement</span><button class="x" data-gclose aria-label="Close">${ICO.x}</button></div>
    <div class="pn-b"><div><p class="bpn-t">${a.name}</p><p class="bpn-s ${a.st==='out'?'me':''}">${a.party}</p></div><p class="bpn-n">${a.note}</p>
      <div class="led">${rows.map(([k,v])=>`<div><span>${k}</span><b>${v}</b></div>`).join('')}</div>
      ${a.st==='out' ? `<p class="bpn-w"><b>Your signature makes it final.</b> Then the shop is added to MerchantRegistry through the Ops Safe, in Build.</p>` : ''}
      ${VERS[a.id] ? `<div class="gt-vh">${lbl(`Versions · ${VERS[a.id].length}`)}${VERS[a.id].slice().reverse().map((v,i)=>`<div class="gt-vh-r ${v[2]}"><span class="gt-vh-d"><i></i></span><span class="gt-vh-k"><span class="gt-vh-t"><b class="mono">${v[0]}</b><span class="gt-st" style="--c:${VST[v[2]][1]}">${VST[v[2]][0]}</span><span class="quiet">${v[2]==='in'||v[2]==='old' ? fmtD(v[1])+(new Date(v[1]).getUTCFullYear()<2026?' '+new Date(v[1]).getUTCFullYear():'') : v[2]==='vote' ? 'Closes '+fmtD(v[1]) : 'For '+fmtD(v[1])}</span></span>
        <em>${v[3]}</em><ul class="gt-chg">${v[4].map(c=>`<li class="${c[0]==='+'?'add':c[0]==='~'?'chg':'del'}"><span>${c[0]==='+'?'+':c[0]==='~'?'~':'−'}</span>${c.slice(2)}</li>`).join('')}</ul></span></div>`).join('')}</div>` : ''}</div>
    <div class="pn-ft">${ft}</div>`;
}
function mtPanel(id){
  const m = MEETINGS.find(x=>x[0]===id), b = GBOARDS.find(x=>x[0]===m[1]);
  return `<div class="pn-hd"><span class="lbl">${b[1]} · meeting</span><button class="x" data-gclose aria-label="Close">${ICO.x}</button></div>
    <div class="pn-b"><div><p class="bpn-t">${WD(m[2])} ${fmtD(m[2])} · ${hm(m[2])}</p><p class="bpn-s">${m[3]}</p></div>
      ${m[4]==='next' ? `<div>${lbl('Agenda')}<div class="led">${AGENDA.map(x=>`<div><span>${x[0]}</span><b>${x[1]} min · ${AK[x[3]][0]}</b></div>`).join('')}</div></div><p class="bpn-n">Members can watch the open session live in Community. Private items, like a named member’s account, are taken in closed session and left out.</p>`
        : `<div class="led">${[['Minutes', m[5]==='approve' ? 'Drafted · approved at the next meeting' : 'Approved and filed in Records'],['Seats present', `${b[3].filter(s=>s[1]).length} of ${b[3].filter(s=>s[1]).length}`],['Decided',`${RESOS.filter(r=>r[1]===m[1] && Math.abs(r[0]-Date.UTC(new Date(m[2]).getUTCFullYear(),new Date(m[2]).getUTCMonth(),new Date(m[2]).getUTCDate()))<DAY).length} resolutions`]].map(([k,v])=>`<div><span>${k}</span><b>${v}</b></div>`).join('')}</div>`}</div>
    <div class="pn-ft">${m[4]==='next' ? `<button class="btn" data-gcomm>Broadcast · Community</button><button class="btn p" data-gclose>Done</button>` : `<span class="small quiet" style="margin-right:auto">${m[5]==='approve'?'Minutes to approve':'Minutes approved'}</span><button class="btn" data-gclose>Close</button>`}</div>`;
}

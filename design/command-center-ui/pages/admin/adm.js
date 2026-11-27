
/* ══ Team, Settings and Records ═════════════════════════════════════════════════════════════════════════════════════
   Team is who: people, the groups they're in, what each group can do, and who can be the second person.
   Settings is what: the numbers every page enforces, sign-in and privacy, connections, the organization.
   Records is the archive and the log: every filed document, every action, every reveal and every export. */
const A = { page:'team', tab:{ team:'overview', settings:'rules', records:'overview' }, panel:null, me:'K', lw:'all', lr:'all', lp:0, df:'all', gd:null };
const TABS = { team:[['overview','Overview'],['people','People'],['groups','Groups'],['rule','Two-person rule']],
  settings:[['rules','Rules and limits'],['security','Security'],['connections','Connections'],['org','Organization']],
  records:[['overview','Overview'],['docs','Documents'],['log','Audit log'],['reveals','Reveals and exports']] };
const ICO = { chev:'<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5"/></svg>', back:'<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3.5 5.5 8l4.5 4.5"/></svg>',
  x:'<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>', lock:'<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3.5" y="7.5" width="9" height="6"/><path d="M5.5 7.5V5.5a2.5 2.5 0 0 1 5 0v2"/></svg>' };
function toast(t){ let el = document.getElementById('toast'); if (!el){ el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el); } el.innerHTML = t; el.classList.add('on'); clearTimeout(el._t); el._t = setTimeout(()=>el.classList.remove('on'), 3400); }
const cell = (cls, title, right, body, foot) => `<div class="cell ${cls}"><div class="hd"><h2>${title}</h2><div class="r">${right}</div></div>${body}<div class="bk-ft">${foot}</div></div>`;
const lbl = t => `<span class="lbl">${t}</span>`;
const band = (cells, first) => `<section class="band"${first?' style="margin-top:0"':''}><div class="bento">${cells}</div></section>`;
const seg = (key, opts, v, aria) => `<div class="seg sm" role="group" aria-label="${aria}">${opts.map(([k,t])=>`<button data-${key}="${k}" aria-pressed="${v===k}">${t}</button>`).join('')}</div>`;
const secRow = (t, r='') => `<div class="ad-sec"><span>${t}</span>${r?`<em>${r}</em>`:''}</div>`;
const rest = () => `<div class="ad-rest" aria-hidden="true"></div>`;
const pager = (p, n, per, key) => { const pages = Math.max(1, Math.ceil(n/per)); return `<span class="pg2"><span>${n ? p*per+1 : 0}–${Math.min(n,(p+1)*per)} of ${n}</span><button data-${key}="-1" ${p===0?'disabled':''} aria-label="Previous">${ICO.back}</button><button data-${key}="1" ${p>=pages-1?'disabled':''} aria-label="Next">${ICO.chev}</button></span>`; };
const NUM = ['No','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten'];
const segs = (arr, col, n) => arr.map((x,i)=>`<i style="left:${i/Math.max(n||0,arr.length)*100}%;width:calc(${100/Math.max(n||0,arr.length)}% - 2px);background:${col(x)}"></i>`).join('');
const sq = (id, cls='') => `<i class="ad-av ${id===A.me?'me':''} ${id==='SY'?'sys':''} ${cls}" title="${pName(id)}">${id}</i>`;
const lvSq = v => `<i class="ad-lv lv${v}" title="${LV[v][0]}"></i>`;
const secIx = k => SECS.findIndex(s=>s[0]===k);
const lvlOf = (id, sec) => PPL[id] ? GROUPS[PPL[id].g][2][secIx(sec)] : 0;
const CAN_ACT = () => lvlOf(A.me, A.page) >= 3;
const GCOL = { admin:'var(--fg)', protocol:'var(--land)', field:'color-mix(in srgb,var(--fg) 50%,transparent)', board:'var(--live)', outside:'var(--line)', investors:'var(--line)' };
const LAB = { merchants:'Merch.', community:'Comm.', governance:'Gov.' };
const SHORT = { home:'Ho', growth:'Gr', field:'Fi', members:'Me', merchants:'Mc', shop:'Sh', money:'Mo', build:'Bu', community:'Co', governance:'Go', records:'Re', team:'Te', settings:'Se' };
const PAGE_N = Object.fromEntries(SECS);
const ENT_SH = { coop:'Co-op', fin:'Financial', dt:'D&T Co.', hold:'Holdings', labs:'ClearLabs', mgr:'Manager', fdn:'Foundation' };

/* settings, formatted */
const unitOf = s => s.v===1 || /le$/.test(s.unit) ? s.unit : s.unit+'s';
const fmtV = (s, v=s.v) => s.kind==='money' ? money(v) : s.kind==='pct' ? v+'%' : s.kind==='hours' ? v+' hours' : s.kind==='days' ? v+' days' : s.kind==='num' ? `${v} ${v===1 || /le$/.test(s.unit) ? s.unit : s.unit+'s'}` : s.kind==='on' ? (v?'On':'Off') : v;
const pendOf = id => PEND.find(p=>p.set===id);
const ruleNum = r => { const s = SETO[r.set]; if (!s) return 'Every change';
  return { money:'Every amount', shopbuy:`Over ${money(s.v)}`, refund:`Over ${money(s.v)}`, safe:'2 of 3 in the Ops Safe', batch:`Every batch of ${s.v}`, exports:'Every list' }[r.set] || fmtV(s); };
const second = () => A.me==='DR' ? 'K' : 'DR';

/* ── header ─────────────────────────────────────────────────────────────────────────────────────────────────────── */
const sc = (go, k, v, small, bar, sub) => `<div class="sc" ${go}><span class="lbl">${k}</span><div class="sc-v">${v} <small>${small}</small></div><div class="mb">${bar}</div><div class="sc-s">${sub}</div></div>`;
const weekN = () => LOG.filter(l=>l[1]>=H2(10,15,0)).length + WEEK.length;
const noReason = () => REVEALS.filter(r=>!r[4]);
function renderHdr(){
  const P = A.page; let brief = '', strip = '';
  if (P==='team'){
    const ones = CAN.filter(c=>c[1].length<2), inv = INVITES[0], wmax = Math.max(...WAITING.map(w=>w[4])), nopk = PEOPLE.filter(p=>!p.passkey);
    brief = `${NUM[ones.length]} things only one person can do. <a data-aopen="i:${inv.id}">${inv.n}’s invite</a> to ${GROUPS[inv.g][0]} expires in ${Math.round((inv.exp-TODAY)/DAY)} days.`;
    strip = sc('data-atab="people"','On the team', PEOPLE.length, `+${INVITES.length} invited`, segs(PEOPLE, p=>GCOL[p.g]) , `${MEMBERS_N} members get the read-only view`)
      + sc('data-atab="rule"','Safe signers', PEOPLE.filter(p=>p.signer).length, 'of 3', segs(PEOPLE.filter(p=>p.signer), ()=>'var(--fg)', 3), PEOPLE.filter(p=>p.signer).map(p=>p.n.split(' ')[0]).join(', '))
      + sc('data-atab="people"','Without a passkey', nopk.length, 'both read-only', segs(PEOPLE, p=>p.passkey?'var(--fg)':'var(--underway)'), nopk.map(p=>p.n).join(', '))
      + sc('data-atab="overview"','Waiting on a second person', WAITING.length, `longest ${wmax} h`, segs(WAITING, w=>w[4]>w[5]*2?'var(--underway)':'var(--live)'), `${WAITING.filter(w=>w[3]===A.me).length} on you`);
  }
  if (P==='settings'){
    const ok = CONN.filter(c=>c.st==='ok' || c.idle).length, p = PEND[0], lock = SETS.filter(s=>s.kind==='lock').length, last = SET_HIST[0];
    brief = `Every change here needs a second person and lands in Records.${p ? ` <a data-aopen="s:${p.set}">${p.label || `Changing ${SETO[p.set].t.toLowerCase()} to ${fmtV(SETO[p.set], p.to)}`}</a> is waiting on ${p.need===A.me?'you':pName(p.need)}.` : ''}`;
    strip = sc('data-atab="rules"','Settings', SETS.length, `${lock} set elsewhere`, segs(SETS, s=>s.kind==='lock'?'var(--line)':'var(--fg)'), 'Locked ones follow a vote, the bylaws or the law')
      + sc('data-atab="rules"','Waiting', PEND.length, PEND.length===1?'change':'changes', segs(PEND, ()=>'var(--underway)', 4), PEND.length ? `On ${PEND.map(x=>x.need===A.me?'you':pName(x.need)).join(', ')}` : 'Nothing waiting')
      + sc('data-atab="connections"','Connections', `${ok} of ${CONN.length}`, 'healthy', segs(CONN, c=>c.st==='behind'?'var(--underway)':c.st==='off' && !c.idle?'var(--absent)':c.idle?'var(--line)':'var(--fg)'), CONN.filter(c=>c.st==='behind').map(c=>`${c.n} is ${c.note.split(' · ')[0]}`).join(', ') || 'All synced')
      + sc('data-atab="rules"','Last change', fmtD(last[1]), last[0], segs(SET_HIST, (_,i)=>`color-mix(in srgb,var(--fg) ${90-i*14}%,transparent)`, 6), `${SETO[last[2]].t} · ${last[3]} → ${last[4]}`);
  }
  if (P==='records'){
    const miss = Object.values(COVER).flat().filter(x=>x==='m').length, wait = LOG.filter(l=>l[7]==='waiting'), nr = noReason(), onfile = Object.values(DCOUNT).reduce((a,b)=>a+b,0);
    brief = `${NUM[miss]} documents are missing, two for <a data-adoc-ent="dt">The Deed &amp; Title Co.</a>${nr.length ? ` ${NUM[nr.length]} reveal this week has <a data-atab="reveals">no reason</a>.` : ''}`;
    const days = Array.from({length:7},(_,d)=>H2(10,15+d,0)), dn = days.map(t=>WEEK.filter(e=>e[0]>=t && e[0]<t+DAY).length + LOG.filter(l=>l[1]>=t && l[1]<t+DAY).length), dm = Math.max(...dn);
    strip = sc('data-atab="log"','Actions this week', weekN(), '15–21 Oct', segs(dn, v=>`color-mix(in srgb,var(--fg) ${Math.round(25+v/dm*65)}%,transparent)`), `${LOG.filter(l=>l[1]>=days[0]).length} key actions, the rest everyday`)
      + sc('data-atab="log"','Waiting on a second person', wait.length, 'in the log', segs(wait, ()=>'var(--underway)', 6), `Oldest ${ago(Math.min(...wait.map(l=>l[1])))}`)
      + sc('data-atab="docs"','Documents', onfile, 'on file', segs(Object.keys(DCOUNT), k=>DT[k][1]), `${miss} missing · ${Object.values(COVER).flat().filter(x=>x==='d').length} in draft`)
      + sc('data-atab="reveals"','Reveals this week', REVEALS.length, `${nr.length} without a reason`, segs(REVEALS, r=>r[4]?'var(--fg)':'var(--absent)'), `${EXPORTS.length} exports · ${EXPORTS.filter(e=>e[5]==='waiting').length} waiting`);
  }
  document.getElementById('hdr').innerHTML = `<span class="when"><span class="dot"></span>${{team:'Team · who can do what',settings:'Settings · admin only',records:'Records · kept seven years'}[P]} · Demo data</span><p class="brief">${brief}</p><div class="strip">${strip}</div>`;
  document.getElementById('atabs').innerHTML = TABS[P].map(([k,t])=>`<button data-atab="${k}" aria-current="${A.tab[P]===k?'page':'false'}">${t}</button>`).join('');
  document.getElementById('atabs').setAttribute('aria-label', `${PAGE_N[P]} views`);
}

/* ══ Team ═════════════════════════════════════════════════════════════════════════════════════════════════════════ */
const mxHead = (first='Person') => `<div class="ad-mx-r ad-mx-g"><span></span>${SEC_GROUP.map(([g,a,b])=>`<span style="grid-column:span ${b-a+1}">${g}</span>`).join('')}</div>
  <div class="ad-mx-r ad-mx-h"><span class="ad-mx-f">${first}</span>${SECS.map(([k,t])=>`<span title="${t}"><b>${LAB[k]||t}</b><i>${SHORT[k]}</i></span>`).join('')}</div>`;
const mxRow = (attrs, av, name, sub, lv, cls='') => `<button class="ad-mx-r ${cls}" ${attrs}><span class="ad-mx-k">${av}<span class="gt-ck"><b>${name}</b><span>${sub}</span></span></span>${lv.map(v=>`<span class="ad-mx-c">${lvSq(v)}</span>`).join('')}</button>`;
const lvKey = () => `<span class="f-key">${LV.map(([t],i)=>`<span>${lvSq(i)}${t}</span>`).join('')}</span>`;
function teamOverview(){
  const rows = mxRow('data-aopen="g:members"', `<i class="ad-av grp">${MEMBERS_N}</i>`, 'Every member', 'Read-only, with a Clear account', GROUPS.members[2], 'all')
    + PEOPLE.map(p=>mxRow(`data-aopen="p:${p.id}"`, sq(p.id), p.n + (p.id===A.me?' · you':''), `${GROUPS[p.g][0]} · ${p.title}`, GROUPS[p.g][2])).join('')
    + INVITES.map(i=>mxRow(`data-aopen="i:${i.id}"`, sq(i.id,'dash'), i.n, `Invited · ${GROUPS[i.g][0]} · until ${fmtD(i.exp)}`, GROUPS[i.g][2], 'inv')).join('');
  const mx = cell('s12','Who can do what',`<span class="lbl">Set per group, never per person</span>`, `<div class="ad-mx">${mxHead()}${rows}</div>`,
    `${lvKey()}<button data-ainvite>Invite someone</button>`);
  const wmax = Math.max(...WAITING.map(w=>w[4]));
  const wait = cell('s7','Waiting on a second person',`<span class="lbl">${WAITING.length} now</span>`,
    `<div class="ad-wl">${WAITING.slice().sort((a,b)=>b[4]-a[4]).map(([t,from,by,on,h,u,r])=>`<button class="ad-wr" ${from==='Settings'?`data-aopen="s:${PEND[0]?PEND[0].set:'shopbuy'}"`:`data-aout="${from}"`}><span class="gt-ck"><b>${t}</b><span>${from} · ${pName(by)} proposed</span></span>
      <span class="ad-wb"><span class="ad-wb-t"><i class="${h>u*2?'late':''}" style="width:${h/wmax*100}%"></i><s style="left:${u/wmax*100}%"></s></span></span><span class="ad-wo"><b>${h} h</b><em>${on===A.me?'on you':'on '+pName(on).split(' ')[0]}</em></span></button>`).join('')}${rest()}</div>`,
    `<span class="f-key"><span><i style="background:var(--live)"></i>Hours waiting</span><span><i style="background:var(--underway)"></i>Over twice the usual</span><span><i class="ad-tick"></i>Usual wait</span></span><button data-atab="rule">Two-person rule →</button>`);
  const one = cell('s5','Only one person can do it',`<span class="lbl">Worth a backup</span>`,
    `<div class="ad-cl">${CAN.slice().sort((a,b)=>a[1].length-b[1].length).map(([t,ids])=>`<div class="ad-cr ${ids.length<2?'one':''}"><span>${t}</span><span class="ad-avs">${ids.map(id=>sq(id)).join('')}${Array.from({length:Math.max(0,3-ids.length)},()=>'<i class="ad-av none"></i>').join('')}</span></div>`).join('')}${rest()}</div>`,
    `<span class="f-key"><span><i style="background:var(--underway)"></i>Only one person</span></span><button data-atab="groups">Groups →</button>`);
  return band(mx, 1) + band(wait + one);
}
function teamPeople(){
  const pRow = p => { const d = p.dev.filter(x=>x[2]).length;
    return `<button class="ad-pr" data-aopen="p:${p.id}">${sq(p.id)}<span class="gt-ck"><b>${p.n}${p.id===A.me?' · you':''}</b><span>${p.title}</span></span><span class="ad-pg"><i style="background:${GCOL[p.g]}"></i>${GROUPS[p.g][0]}</span><span class="mono ad-em">${p.email}</span>
      <span class="ad-pk ${p.passkey?'':'no'}"><b>${p.passkey?'Passkey':'Emailed code'}</b><em>${d} trusted device${d===1?'':'s'}</em></span><span class="ad-pl"><b>${ago(p.last)}</b><em>${p.until?`Access ends ${fmtD(p.until)}`:`Since ${fmtD(p.since)}`}</em></span><span class="gv-go">${ICO.chev}</span></button>`; };
  const order = PEOPLE.slice().sort((a,b)=>GKEYS.indexOf(a.g)-GKEYS.indexOf(b.g));
  const list = secRow('On the team', `${PEOPLE.length} people · ${PEOPLE.filter(p=>!p.passkey).length} read-only`) + order.map(pRow).join('')
    + secRow('Invited', `${INVITES.length} waiting to accept`) + INVITES.map(i=>`<button class="ad-pr inv" data-aopen="i:${i.id}">${sq(i.id,'dash')}<span class="gt-ck"><b>${i.n}</b><span>${i.title}</span></span><span class="ad-pg"><i style="background:${GCOL[i.g]}"></i>${GROUPS[i.g][0]}</span><span class="mono ad-em">${i.email}</span><span class="ad-pk"><b>Not set up</b><em>Passkey on first sign-in</em></span><span class="ad-pl"><b>Sent ${fmtD(i.sent)}</b><em>Expires ${fmtD(i.exp)}</em></span><span class="gv-go">${ICO.chev}</span></button>`).join('');
  const people = cell('s12','Everyone with access',`<span class="lbl">${PEOPLE.length} people · ${INVITES.length} invited</span>`, `<div class="ad-pl-l"><div class="ad-pr hd2"><span></span>${lbl('Person')}${lbl('Group')}${lbl('Email')}${lbl('Sign-in')}${lbl('Last active')}<span></span></div>${list}</div>`,
    `<span>Inviting, turning someone off or changing a group needs a second person</span><button data-ainvite>Invite someone</button>`);
  const ends = [[INVITES[0].exp,`${INVITES[0].n}’s invite expires`,'Resend it, or it lapses','i:PS'],[PPL.LP.until,'Lena Park’s data room access ends','Harbor Capital · investor','p:LP'],[D(1,2,2027),'Quarterly access review','Every person and group, with a second person','g:outside']];
  const end = cell('s7','Access that ends',`<span class="lbl">Next 90 days</span>`,
    `<div class="gt-cl">${ends.map(([t,a,b,o])=>`<button class="gt-cr" data-aopen="${o}">${leaf(t)}<span class="gt-ck"><b>${a}</b><span>${b}</span></span><span class="gt-st" style="--c:${(t-TODAY)/DAY<7?'var(--underway)':'var(--line)'}">${Math.round((t-TODAY)/DAY)} days</span></button>`).join('')}${rest()}</div>`,
    `<span>Read-only access for outside people always has an end date</span><span></span>`);
  const days = Array.from({length:7},(_,d)=>H2(10,15+d,0)), SI = { K:[3,2,1,1,4,3,3], DR:[2,2,0,0,3,2,2], ML:[2,3,2,2,3,1,2], BS:[0,1,0,0,0,1,0], AC:[0,1,0,0,1,1,0], LP:[0,0,0,0,1,1,0] }, smx = 4;
  const si = cell('s5','Sign-ins',`<span class="lbl">Last 7 days</span>`,
    `<div class="ad-si">${PEOPLE.map(p=>`<div class="ad-si-r"><span>${p.n}</span><span class="ad-si-b">${SI[p.id].map((v,i)=>`<i class="${i===6?'now':''}" style="height:${v?Math.max(12,v/smx*100):0}%"></i>`).join('')}</span><b>${SI[p.id].reduce((a,b)=>a+b,0)}</b></div>`).join('')}
      <div class="ad-si-r ad-si-x"><span></span><span class="ad-si-b">${days.map((t,i)=>`<span>${i===6?'Today':WD(t)}</span>`).join('')}</span><b></b></div></div>`,
    `<span>A new device needs a confirmation</span><button data-ago="settings/security">Security →</button>`);
  return band(people, 1) + band(end + si);
}
function teamGroups(){
  const rows = [['members',`<i class="ad-av grp">${MEMBERS_N}</i>`]].concat(GKEYS.map(g=>[g, `<span class="ad-avs">${PEOPLE.filter(p=>p.g===g).map(p=>sq(p.id)).join('')}${INVITES.filter(i=>i.g===g).map(i=>sq(i.id,'dash')).join('')}</span>`]));
  const gl = cell('s12','Groups',`<span class="lbl">${GKEYS.length} groups, and every member</span>`,
    `<div class="ad-mx ad-gx">${mxHead('Group')}${rows.map(([g,av])=>`<button class="ad-mx-r ${g==='members'?'all':''}" data-aopen="g:${g}"><span class="ad-mx-k ad-gk"><span class="gt-ck"><b>${GROUPS[g][0]}</b><span>${GROUPS[g][1]}</span></span>${av}</span>${GROUPS[g][2].map(v=>`<span class="ad-mx-c">${lvSq(v)}</span>`).join('')}</button>`).join('')}</div>`,
    `${lvKey()}<span>Changing a group needs a second person</span>`);
  const EX = ['Not in their menu at all','Members see co-op totals on Money','Outside sees Money and Records','Field proposes a new shop','Dana approves an invite batch'];
  const lv = cell('s7','What each level means',`<span class="lbl">The same five on every page</span>`,
    `<div class="ad-lvl">${LV.map(([t,d],i)=>`<div class="ad-lvr">${lvSq(i)}<span class="gt-ck"><b>${t}</b><span>${d}</span></span><em>${EX[i]}</em></div>`).join('')}</div>`,
    `<span>The server checks the level on every request, not just the menu</span><span></span>`);
  const rv = GKEYS.filter(g=>GROUPS[g][2][secIx('members')]===4);
  const who = cell('s5','Who can reveal personal details',`<span class="lbl">Approve on Members</span>`,
    `<div class="ad-cl">${rv.map(g=>`<div class="ad-cr"><span>${GROUPS[g][0]}</span><span class="ad-avs">${PEOPLE.filter(p=>p.g===g).map(p=>sq(p.id)).join('')}</span></div>`).join('')}
      <div class="ad-cr q"><span>Everyone else</span><span class="ad-avs"><em>Sees masked details only</em></span></div>${rest()}</div>`,
    `<span>Every reveal needs a reason</span><button data-ago="records/reveals">Reveals →</button>`);
  return band(gl, 1) + band(lv + who);
}
function teamRule(){
  const list = cell('s12','The two-person rule',`<span class="lbl">Nobody approves their own</span>`,
    `<div class="ad-rl"><div class="ad-rr hd2"><span>${lbl('Rule')}</span>${lbl('When it applies')}${lbl('Second person')}${lbl('30 days')}${lbl('Usual wait')}<span></span></div>
      ${RULES.map(r=>{ const p = pendOf(r.set); return `<button class="ad-rr" data-aopen="r:${r.id}"><span class="gt-ck"><b>${r.t}</b><span>${r.c}</span></span>
        <span class="ad-rn"><b>${ruleNum(r)}</b>${p ? `<em class="ad-pd">${fmtV(SETO[p.set], p.to)} waiting</em>` : SETO[r.set] && SETO[r.set].kind!=='lock' ? `<em>Set in Settings</em>` : '<em>Always</em>'}</span>
        <span class="ad-avs">${r.who.map(id=>sq(id)).join('')}</span><b class="num">${r.n30}</b><span class="num">${r.med ? r.med.toFixed(1)+' h' : '–'}</span><span class="gv-go">${ICO.chev}</span></button>`; }).join('')}</div>`,
    `<span>Team sets who can be the second person · Settings sets the numbers</span><button data-ago="settings/rules">Settings →</button>`);
  const ppl = [['K','Kai'],['DR','Dana Ruiz'],['ML','Marcus Lee']], appr = [['K','Kai'],['DR','Dana'],['ML','Marcus'],['BS','Board']], mxv = 6;
  const am = cell('s7','Who approves whom',`<span class="lbl">Last 30 days</span>`,
    `<div class="ad-am"><div class="ad-am-r hd2"><span>${lbl('Proposed by')}</span>${appr.map(a=>lbl(a[1])).join('')}${lbl('Total')}</div>
      ${ppl.map(([p,n])=>{ const row = APPR[p]||{}, tot = Object.values(row).reduce((a,b)=>a+b,0);
        return `<div class="ad-am-r"><span>${n}</span>${appr.map(([a])=>a===p ? '<i class="ad-amc self" title="Can’t approve your own"></i>' : `<i class="ad-amc" style="--v:${(row[a]||0)/mxv}"><b class="${(row[a]||0)/mxv>.5?'inv':''}">${row[a]||''}</b></i>`).join('')}<b class="num">${tot}</b></div>`; }).join('')}</div>`,
    `<span class="f-key"><span><i style="background:var(--fg)"></i>More approvals</span><span><i class="ad-self"></i>Can’t approve your own</span></span><span></span>`);
  const rs = RULES.filter(r=>r.n30), mx = Math.max(...rs.map(r=>r.med));
  const sp = cell('s5','How long a second person takes',`<span class="lbl">Usual wait</span>`,
    `<div class="ad-hb">${rs.sort((a,b)=>b.med-a.med).map(r=>`<button class="ad-hb-r" data-aopen="r:${r.id}"><span>${r.t}</span><span class="ad-hb-b"><i style="width:${r.med/mx*100}%"></i></span><b>${r.med.toFixed(1)} h</b></button>`).join('')}</div>`,
    `<span>Over a day, the app nudges the second person</span><span></span>`);
  return band(list, 1) + band(am + sp);
}

/* ══ Settings ═════════════════════════════════════════════════════════════════════════════════════════════════════ */
const usedTxt = s => s.used.map(k=>PAGE_N[k]).join(', ');
function setRow(s){
  const p = pendOf(s.id), lock = s.kind==='lock';
  return `<button class="ad-sr ${lock?'lock':''}" data-aopen="s:${s.id}"><span class="gt-ck"><b>${s.t}</b><span>${s.d}</span></span>
    <span class="ad-sv">${lock ? `<b>${ICO.lock}${s.v}</b><em>${s.why}</em>` : `<b>${fmtV(s)}</b>${p ? `<em class="ad-pd">→ ${fmtV(s, p.to)} · waiting on ${p.need===A.me?'you':pName(p.need).split(' ')[0]}</em>` : `<em>Used in ${usedTxt(s)}</em>`}`}</span><span class="gv-go">${ICO.chev}</span></button>`;
}
const setCell = (sec, w, foot) => { const L = SETS.filter(s=>s.sec===sec);
  return cell(w, SEC_T[sec][0], lbl(SEC_T[sec][1]), `<div class="ad-sl">${L.map(setRow).join('')}${rest()}</div>`, foot || `<span>${L.filter(s=>s.kind!=='lock').length} you can change · ${L.filter(s=>s.kind==='lock').length} set elsewhere</span><span></span>`); };
function setRules(){
  const hist = cell('s12','Changes',`<span class="lbl">Each one had a second person</span>`,
    `<div class="gt-cl">${PEND.map(p=>{ const s = SETO[p.set]; return `<button class="gt-cr ad-pend" data-aopen="s:${s.id}">${leaf(p.at)}<span class="gt-ck"><b>${s.t}</b><span>${fmtV(s,p.from)} → ${fmtV(s,p.to)} · ${pName(p.by)} proposed</span></span><span class="gt-st" style="--c:var(--underway)">Waiting on ${p.need===A.me?'you':pName(p.need).split(' ')[0]}</span></button>`; }).join('')}
      ${SET_HIST.map(([id,t,k,a,b,by,ok])=>`<button class="gt-cr" data-aopen="s:${k}">${leaf(t)}<span class="gt-ck"><b>${SETO[k].t}</b><span>${a} → ${b} · ${pName(by).split(' ')[0]} and ${pName(ok).split(' ')[0]}</span></span><span class="mono ad-id">${id}</span></button>`).join('')}${rest()}</div>`,
    `<span>Every change is in the audit log</span><button data-ago="records/log">Audit log →</button>`);
  return band(setCell('money','s6') + setCell('shop','s6'), 1) + band(setCell('chain','s4') + setCell('members','s4') + setCell('gov','s4')) + band(hist);
}
function setSecurity(){
  const devs = PEOPLE.flatMap(p=>p.dev.map((d,i)=>({p, d, i}))).sort((a,b)=>b.d[1]-a.d[1]);
  const dv = cell('s7','Devices',`<span class="lbl">${devs.filter(x=>x.d[2]).length} trusted</span>`,
    `<div class="ad-dl">${devs.map(({p,d,i})=>`<div class="ad-dr ${NOW-d[1]>7*DAY?'stale':''}">${sq(p.id)}<span class="gt-ck"><b>${d[0]}</b><span>${p.n}${NOW-d[1]>7*DAY ? ` · not seen in ${Math.round((NOW-d[1])/DAY)} days` : ''}</span></span><span class="ad-dt"><b>${ago(d[1])}</b><em>${p.passkey?'Passkey':'Emailed code'}</em></span>${CAN_ACT() ? `<button class="ad-so ${NOW-d[1]>7*DAY?'on':''}" data-asignout="${p.id}:${i}">Sign out</button>` : '<span></span>'}</div>`).join('')}${rest()}</div>`,
    `<span>Signing a device out ends its session right away</span><span></span>`);
  const ev = [[H(10,19,9,41),'Marcus Lee’s new iPhone, confirmed','Kai confirmed it 11 minutes after','p:ML','var(--fg)','Confirmed'],[H(10,19,11,10),'A reveal with no reason','Kai showed M-0044’s email','x:reveals','var(--absent)','Look'],
    [H(10,12,18,0),'Marcus Lee’s old iPhone went quiet','Still trusted · sign it out','p:ML','var(--underway)','Sign out'],[H(10,2,9,0),'The outside accountant joined','Read-only, emailed code','p:AC','var(--line)','Read-only']];
  const se = cell('s5','Worth a look',`<span class="lbl">Last 30 days</span>`,
    `<div class="gt-cl">${ev.map(([t,a,b,o,c,s])=>`<button class="gt-cr" ${o==='x:reveals'?'data-ago="records/reveals"':`data-aopen="${o}"`}>${leaf(t)}<span class="gt-ck"><b>${a}</b><span>${b}</span></span><span class="gt-st" style="--c:${c}">${s}</span></button>`).join('')}${rest()}</div>`,
    `<span>Alerts go to Kai and Dana Ruiz</span><span></span>`);
  return band(setCell('signin','s6') + setCell('privacy','s6'), 1) + band(dv + se);
}
const keyTxt = c => c.key==='@rpc' ? 'Public RPC' : c.key==='@safe' ? 'Signers’ own keys' : c.key ? `Key ••••${c.key}` : 'No key';
function connHrs(c, big){ return `<span class="ad-hr ${big?'big':''}">${c.hrs.map((h,i)=>`<i class="${h===1?'':h===0?(c.idle?'idle':'down'):'slow'}" title="${24-i} h ago"></i>`).join('')}</span>`; }
const CST = c => c.st==='behind' ? ['Behind','var(--underway)'] : c.idle ? ['Asleep','var(--line)'] : c.st==='off' ? ['Down','var(--absent)'] : ['Healthy','var(--settled)'];
function setConnections(){
  const list = cell('s12','Connections',`<span class="lbl">${CONN.length} services</span>`,
    `<div class="ad-cn"><div class="ad-cnr hd2"><span>${lbl('Service')}</span>${lbl('Last 24 hours')}${lbl('Last heard')}${lbl('Status')}<span></span></div>
      ${CONN.map(c=>`<button class="ad-cnr" data-aopen="c:${c.id}"><span class="gt-ck"><b>${c.n}</b><span>${c.what} · ${c.note}</span></span>${connHrs(c)}<span class="ad-dt"><b>${ago(c.last)}</b><em>${keyTxt(c)}</em></span><span class="gt-st" style="--c:${CST(c)[1]}">${CST(c)[0]}</span><span class="gv-go">${ICO.chev}</span></button>`).join('')}</div>`,
    `<span class="f-key"><span><i style="background:color-mix(in srgb,var(--fg) 38%,transparent)"></i>Working</span><span><i style="background:var(--underway)"></i>Slow or behind</span><span><i style="background:var(--absent)"></i>Down</span><span><i class="ad-idle"></i>Asleep</span></span><span>Keys are never shown, only their last four</span>`);
  const pages = ['home','members','merchants','shop','money','build','community','governance','records'];
  const use = cell('s7','Where each one is used',`<span class="lbl">If it goes down, these pages notice</span>`,
    `<div class="ad-ux"><div class="ad-ux-r hd2"><span></span>${pages.map(k=>`<span title="${PAGE_N[k]}"><b>${LAB[k]||PAGE_N[k]}</b><i>${SHORT[k]}</i></span>`).join('')}</div>
      ${CONN.map(c=>`<div class="ad-ux-r"><span>${c.n}</span>${pages.map(k=>`<span>${c.used.includes(k)?`<i class="${c.st==='behind'?'warn':''}"></i>`:''}</span>`).join('')}</div>`).join('')}</div>`,
    `<span class="f-key"><span><i style="background:var(--fg)"></i>Used here</span><span><i style="background:var(--underway)"></i>Behind right now</span></span><span></span>`);
  const rot = SETO.rotate.v, ks = CONN.filter(c=>c.rot).sort((a,b)=>b.rot-a.rot), rmx = Math.max(rot*1.15, ...ks.map(c=>c.rot));
  const keys = cell('s5','Key age',`<span class="lbl">Rotate every ${rot} days</span>`,
    `<div class="ad-hb">${ks.map(c=>`<button class="ad-hb-r" data-aopen="c:${c.id}"><span>${c.n}</span><span class="ad-hb-b ad-kb"><i class="${c.rot>rot?'late':c.rot>rot-14?'soon':''}" style="width:${c.rot/rmx*100}%"></i><s style="left:${rot/rmx*100}%"></s></span><b class="${c.rot>rot?'bad':''}">${c.rot} d</b></button>`).join('')}</div>`,
    `<span class="f-key"><span><i style="background:var(--underway)"></i>Due in two weeks</span><span><i style="background:var(--absent)"></i>Overdue</span></span><span></span>`);
  return band(list, 1) + band(use + keys);
}
function setOrg(){
  const prof = cell('s6','Profile',`<span class="lbl">Shown to members</span>`, `<div class="led ad-led">${PROFILE.map(([k,v])=>`<div><span>${k}</span><b>${v}</b></div>`).join('')}</div>${rest()}`,
    `<span>Changes here need a second person too</span><span></span>`);
  const net = cell('s6','Network',`<span class="lbl">Where the contracts run</span>`,
    `<div class="ad-net"><div class="ad-net-r on"><span class="gt-ck"><b>Base Sepolia · testnet</b><span>Every contract, pool and payout today. Test money only.</span></span><span class="gt-st" style="--c:var(--settled)">Now</span></div>
      <div class="ad-net-r next"><span class="gt-ck"><b>Base · mainnet</b><span>Real money. Needs the audits closed, a board vote, then the Ops Safe.</span></span><span class="gt-st" style="--c:var(--line)">Not yet</span></div>
      <div class="ad-net-c">${[['Audits closed','2 of 3','labs'],['Board vote','Not started','gov'],['Ops Safe','After the vote','safe']].map(([a,b])=>`<span><b>${a}</b><em>${b}</em></span>`).join('')}</div></div>`,
    `<span>${ICO.lock} Set by a board vote, not here</span><button data-aout="Governance">Governance →</button>`);
  const ent = cell('s12','Entities',`<span class="lbl">${ENT.length} entities · tax IDs masked</span>`,
    `<div class="ad-en"><div class="ad-enr hd2"><span>${lbl('Entity')}</span>${lbl('Tax ID')}${lbl('Papers on file')}${lbl('Status')}<span></span></div>
      ${ENT.map(([id,n,k,st,tax])=>{ const c = COVER[id]||[], f = c.filter(x=>x==='f').length, need = c.filter(x=>x!=='n').length, m = c.filter(x=>x==='m').length;
        return `<button class="ad-enr" data-adoc-ent="${id}"><span class="gt-ck"><b>${n}</b><span>${k}</span></span>${tax ? `<span class="mono ad-tax">••-•••${tax}</span>` : '<span class="ad-tax q">Applied for</span>'}
          <span class="ad-pp"><span class="ad-pp-b">${c.map(x=>`<i class="${x}" title="${CV[x][0]}"></i>`).join('')}</span><em class="${m?'bad':''}">${f} of ${need}${m?` · ${m} missing`:''}</em></span><span class="gt-st" style="--c:${st==='formed'?'var(--settled)':'var(--underway)'}">${st==='formed'?'Formed':'Forming'}</span><span class="gv-go">${ICO.chev}</span></button>`; }).join('')}</div>`,
    `<span class="f-key"><span><i style="background:color-mix(in srgb,var(--fg) 30%,transparent)"></i>On file</span><span><i style="background:color-mix(in srgb,var(--underway) 55%,transparent)"></i>Draft</span><span><i style="background:var(--absent)"></i>Missing</span><span><i class="ad-nn"></i>Not needed yet</span></span><button data-aout="Governance">Entities in Governance →</button>`);
  const rec = cell('s6','Records',`<span class="lbl">How things are kept</span>`, `<div class="ad-sl">${setRow(SETO.retain)}
      <div class="ad-sr st"><span class="gt-ck"><b>The audit log can’t be edited</b><span>Each entry is chained to the one before it</span></span><span class="ad-sv"><b>${ICO.lock}Always</b><em>Checked nightly</em></span><span></span></div>
      <div class="ad-sr st"><span class="gt-ck"><b>Backups</b><span>Documents, the log and settings</span></span><span class="ad-sv"><b>Nightly</b><em>Last at 02:00 today</em></span><span></span></div>${rest()}</div>`,
    `<span>Exports need a second person</span><button data-ago="records/reveals">Exports →</button>`);
  const nt = cell('s6','Notifications',`<span class="lbl">Who hears about what</span>`, `<div class="ad-sl">${ALERTS.map(([a,b,ids])=>`<div class="ad-sr st"><span class="gt-ck"><b>${a}</b><span>${b}</span></span><span class="ad-avs">${ids.length ? ids.map(id=>sq(id)).join('') : '<em>Whoever it’s waiting on</em>'}</span><span></span></div>`).join('')}${setRow(SETO.digest)}${rest()}</div>`,
    `<span>Each person can mute their own, not anyone else’s</span><span></span>`);
  return band(prof + nt, 1) + band(net + rec) + band(ent);
}

/* ══ Records ══════════════════════════════════════════════════════════════════════════════════════════════════════ */
const days7 = () => Array.from({length:7},(_,d)=>H2(10,15+d,0));
function lanes(){
  const days = days7(), order = Object.keys(AREAS);
  const cellOf = (w,t) => { const e = t+DAY; return { keys: LOG.filter(l=>l[2]===w && l[1]>=t && l[1]<e), evs: WEEK.filter(x=>x[1]===w && x[0]>=t && x[0]<e) }; };
  const max = Math.max(...WHO.flatMap(([w])=>days.map(t=>{ const c = cellOf(w,t); return c.keys.length + c.evs.length; })));
  return `<div class="ad-wk"><div class="ad-wk-r hd2"><span></span>${days.map((t,i)=>lbl(i===6?'Today':`${WD(t)} ${new Date(t).getUTCDate()}`)).join('')}<span></span></div>
    ${WHO.map(([w,n])=>{ const tot = days.reduce((a,t)=>{ const c = cellOf(w,t); return a + c.keys.length + c.evs.length; }, 0);
      return `<div class="ad-wk-r"><span class="ad-wk-p">${sq(w)}<b>${n}</b></span>${days.map((t,i)=>{ const {keys, evs} = cellOf(w,t), cnt = keys.length + evs.length;
        const mix = order.map(a=>[a, evs.filter(x=>x[2]===a).length + keys.filter(l=>l[3]===a).length]).filter(x=>x[1]);
        return `<button class="ad-wt ${i===6?'now':''}" data-alog="${w}" style="--v:${(cnt/max).toFixed(2)}" title="${n} · ${WD(t)} ${new Date(t).getUTCDate()} · ${cnt} actions"><b>${cnt}</b><span class="ad-wt-m">${mix.map(([a,k])=>`<i style="flex:${k};background:${AREAS[a][1]}"></i>`).join('')}</span>${keys.length?`<span class="ad-wt-k">${keys.map(()=>'<i></i>').join('')}</span>`:''}</button>`; }).join('')}<b class="num">${tot}</b></div>`; }).join('')}</div>`;
}
const resChip = r => `<span class="gt-st" style="--c:${RESULT[r][1]}">${RESULT[r][0]}</span>`;
function recOverview(){
  const wk = cell('s12','This week',`<span class="lbl">15–21 Oct · ${weekN()} actions</span>`, lanes(),
    `<span class="f-key"><span><i class="ad-shade"></i>Darker is busier</span><span><i class="ad-kk"></i>A key action</span><span><i class="ad-mixk"></i>The strip is the kind of work, coloured as below</span></span><button data-atab="log">Audit log →</button>`);
  const keys = cell('s7','Key actions',`<span class="lbl">Newest first</span>`,
    `<div class="ad-ll">${LOG.slice().sort((a,b)=>b[1]-a[1]).slice(0,7).map(logRow).join('')}</div>`,
    `<span>${LOG.filter(l=>l[7]==='waiting').length} still waiting on someone</span><button data-atab="log">All ${LOG.length} →</button>`);
  const from = days7()[0], order = Object.keys(AREAS), by = order.map(a=>[a, WEEK.filter(e=>e[2]===a).length + LOG.filter(l=>l[3]===a && l[1]>=from).length]).filter(x=>x[1]).sort((a,b)=>b[1]-a[1]), bm = by[0][1];
  const kind = cell('s5','Kind of work',`<span class="lbl">This week</span>`,
    `<div class="ad-hb">${by.map(([a,v])=>`<button class="ad-hb-r" data-alr-area="${a}"><span>${AREAS[a][0]}</span><span class="ad-hb-b"><i style="width:${v/bm*100}%;background:${AREAS[a][1]}"></i></span><b>${v}</b></button>`).join('')}</div>`,
    `<span>${Math.round(by[0][1]/weekN()*100)}% was ${AREAS[by[0][0]][0].toLowerCase()}</span><span></span>`);
  return band(wk, 1) + band(keys + kind) + band(paperCell());
}
function paperCell(){
  const ids = Object.keys(COVER), all = Object.values(COVER).flat(), f = all.filter(x=>x==='f').length, need = all.filter(x=>x!=='n').length;
  return cell('s12','Paperwork by entity',`<span class="lbl">${f} of ${need} on file</span>`,
    `<div class="ad-pw"><div class="ad-pw-r hd2"><span></span>${COVER_K.map(k=>lbl(k)).join('')}</div>
      ${ids.map(id=>`<div class="ad-pw-r"><span class="gt-ck"><b>${ENTO[id][1]}</b><span>${ENTO[id][2]}</span></span>${COVER[id].map((x,i)=>`<button class="ad-pt ${x}" ${x==='m'||x==='d'?`data-amiss="${id}:${i}"`:''} title="${COVER_K[i]} · ${CV[x][0]}">${x==='m'?'Missing':x==='d'?'Draft':''}</button>`).join('')}</div>`).join('')}</div>`,
    `<span class="f-key"><span><i style="background:color-mix(in srgb,var(--fg) 30%,transparent)"></i>On file</span><span><i style="background:color-mix(in srgb,var(--underway) 55%,transparent)"></i>Draft</span><span><i class="ad-miss"></i>Missing</span><span><i class="ad-nn"></i>Not needed yet</span></span><button data-aadd>Add a document</button>`);
}
const DONE1 = { agreement:'Agreement', minutes:'Minutes', filing:'Filing', policy:'Policy', bond:'Bond', report:'Payout report' };
const DF = [['all','All'],['agreement','Agreements'],['minutes','Minutes'],['filing','Filings'],['policy','Policies'],['bond','Bonds'],['report','Reports']];
function recDocs(){
  const L = DOCS.filter(d=>A.df==='all' || d[2]===A.df).sort((a,b)=>b[4]-a[4]);
  const monOf = t => t>=D(10,1) ? 'October' : t>=D(9,1) ? 'September' : 'Earlier this year';
  const docRow = d => `<button class="gt-cr ad-dcr" data-aopen="d:${d[0]}">${leaf(d[4])}<span class="gt-ck"><b>${d[1]}</b><span>${ENTO[d[3]][1]} · ${d[6]} · ${d[7]} · ${d[8]} pages</span></span><span class="ad-dk">${DONE1[d[2]]}</span><span class="gt-st" style="--c:${DSTAT[d[5]][1]}">${DSTAT[d[5]][0]}</span></button>`;
  const list = cell('s12','Documents', seg('adf', DF, A.df, 'Which documents'),
    `<div class="gt-cl flat"><div class="gt-cr ad-dcr hd2">${lbl('Filed')}${lbl('Document')}${lbl('Kind')}${lbl('Status')}</div>${(()=>{ let last = null; return L.map(d=>{ const k = monOf(d[4]); const h = k!==last ? secRow(k, `${L.filter(x=>monOf(x[4])===k).length}`) : ''; last = k; return h + docRow(d); }).join(''); })() || `<div class="gv-e"><span>Nothing here</span></div>`}</div>`,
    `<span>The ${L.length} newest · ${A.df==='all' ? Object.values(DCOUNT).reduce((a,b)=>a+b,0) : DCOUNT[A.df]} on file</span><button data-aadd>Add a document</button>`);
  const mx = Math.max(...Object.values(DCOUNT));
  const kinds = cell('s7','On file by kind',`<span class="lbl">${Object.values(DCOUNT).reduce((a,b)=>a+b,0)} documents</span>`,
    `<div class="ad-hb">${Object.keys(DCOUNT).map(k=>{ const dr = DOCS.filter(d=>d[2]===k && d[5]==='draft').length, wt = DOCS.filter(d=>d[2]===k && d[5]==='waiting').length, done = DCOUNT[k]-dr-wt;
      return `<button class="ad-hb-r" data-adf="${k}"><span>${DT[k][0]}</span><span class="ad-hb-b ad-stk"><i style="width:${done/mx*100}%;background:${DT[k][1]}"></i>${dr?`<i style="width:${dr/mx*100}%;background:var(--underway)"></i>`:''}${wt?`<i class="hx" style="width:${wt/mx*100}%"></i>`:''}</span><b>${DCOUNT[k]}</b></button>`; }).join('')}</div>`,
    `<span class="f-key"><span><i style="background:var(--fg)"></i>Final or signed</span><span><i style="background:var(--underway)"></i>Draft</span><span><i class="hx"></i>Waiting on a signature</span></span><span></span>`);
  const miss = Object.entries(COVER).flatMap(([id,c])=>c.map((x,i)=>x==='m'?[id,i]:null).filter(Boolean));
  const ms = cell('s5','Missing',`<span class="lbl">${miss.length} papers</span>`,
    `<div class="ad-cl">${miss.map(([id,i])=>`<button class="ad-cr one" data-amiss="${id}:${i}"><span class="gt-ck"><b>${COVER_K[i]}</b><span>${ENTO[id][1]}</span></span><span class="lnk3">Add it</span></button>`).join('')}${rest()}</div>`,
    `<span>Both entities are still forming</span><button data-atab="overview">Paperwork →</button>`);
  return band(list, 1) + band(kinds + ms);
}
function logRow(l){
  return `<button class="ad-lr" data-aopen="l:${l[0]}"><span class="mono ad-lt">${hm(l[1])}</span>${sq(l[2])}<span class="gt-ck"><b>${l[4]}</b><span>${l[5]}</span></span><span class="ad-la">${AREAS[l[3]][0]}</span>${resChip(l[7])}</button>`;
}
const LW = [['all','Everyone'],['K','Kai'],['DR','Dana'],['ML','Marcus'],['SY','System']], LR = [['all','All'],['waiting','Waiting'],['approved','Approved'],['alert','Alerts']];
function recLog(){
  const L = LOG.filter(l=>(A.lw==='all' || l[2]===A.lw) && (A.lr==='all' || l[7]===A.lr) && (!A.la || l[3]===A.la)).sort((a,b)=>b[1]-a[1]), per = 10, pg = L.slice(A.lp*per, A.lp*per+per);
  const dayOf = t => Date.UTC(2026, new Date(t).getUTCMonth(), new Date(t).getUTCDate());
  let last = null; const rows = pg.map(l=>{ const d = dayOf(l[1]); const n = L.filter(x=>dayOf(x[1])===d).length; const h = d!==last ? secRow(`${WD(d)} ${fmtD(d)}${d===TODAY?' · today':''}`, `${n} key action${n===1?'':'s'}`) : ''; last = d; return h + logRow(l); }).join('');
  const list = cell('s12','Audit log', `<div class="ad-segs">${seg('alw', LW, A.lw, 'Who')}${seg('alr', LR, A.lr, 'Result')}</div>`,
    `<div class="ad-ll"><div class="ad-lr hd2">${lbl('Time')}<span></span>${lbl('Action')}${lbl('Area')}${lbl('Result')}</div>${A.la ? `<div class="ad-fl"><span>Only ${AREAS[A.la][0]}</span><button class="lnk3" data-alr-area="">Show everything</button></div>` : ''}${rows || `<div class="gv-e"><span>Nothing matches</span></div>`}</div>`,
    `<span>${ICO.lock} Can’t be edited or deleted · kept 7 years</span>${pager(A.lp, L.length, per, 'alp')}`);
  return band(list, 1);
}
function recReveals(){
  const rv = cell('s7','Reveals',`<span class="lbl">This week · ${REVEALS.length}</span>`,
    `<div class="gt-cl">${REVEALS.map(([t,w,m,what,why,where])=>`<div class="gt-cr ad-rvr ${why?'':'bad'}">${leaf(t)}<span class="gt-ck"><b>${pName(w)} showed ${m}’s ${what.toLowerCase()}</b><span class="${why?'':'bad'}">${why || 'No reason given'}</span></span><span class="ad-dt"><b>${hm(t)}</b><em>${where}</em></span></div>`).join('')}${rest()}</div>`,
    `<span>${ICO.lock} Details stay masked until someone reveals them with a reason</span><button data-ago="settings/security">Privacy →</button>`);
  const by = ['K','DR'].map(id=>[id, REVEALS.filter(r=>r[1]===id).length, REVEALS.filter(r=>r[1]===id && !r[4]).length]), bm = Math.max(...by.map(b=>b[1]));
  const KINDS = [['Email',r=>/email/i.test(r[3])],['Phone',r=>/phone/i.test(r[3])],['Address',r=>/address/i.test(r[3])]].map(([k,f])=>[k, REVEALS.filter(f).length]), km = Math.max(...KINDS.map(k=>k[1]));
  const bp = cell('s5','Who and what',`<span class="lbl">Only Admin and Protocol can</span>`,
    `${secRow('Who revealed', `${REVEALS.length} this week`)}<div class="ad-hb ad-up">${by.map(([id,n,bad])=>`<div class="ad-hb-r"><span>${pName(id)}</span><span class="ad-hb-b ad-stk"><i style="width:${(n-bad)/bm*100}%"></i>${bad?`<i style="width:${bad/bm*100}%;background:var(--absent)"></i>`:''}</span><b>${n}</b></div>`).join('')}</div>
      ${secRow('What was shown', `${REVEALS.filter(r=>r[5]==='Members').length} members · ${REVEALS.filter(r=>r[5]==='Merchants').length} shop owners`)}<div class="ad-hb ad-up">${KINDS.map(([k,n])=>`<div class="ad-hb-r"><span>${k}</span><span class="ad-hb-b"><i style="width:${n/km*100}%;background:color-mix(in srgb,var(--fg) 45%,transparent)"></i></span><b>${n}</b></div>`).join('')}</div>${rest()}`,
    `<span class="f-key"><span><i style="background:var(--fg)"></i>With a reason</span><span><i style="background:var(--absent)"></i>Without</span></span><span></span>`);
  const ESt = { done:['Done','var(--fg)'], approved:['Approved','var(--settled)'], waiting:['Waiting','var(--underway)'] };
  const ex = cell('s12','Exports',`<span class="lbl">Every list that left the app</span>`,
    `<div class="ad-xl"><div class="ad-xr hd2"><span></span>${lbl('List')}${lbl('Rows')}${lbl('Second person')}${lbl('Status')}</div>
      ${EXPORTS.slice().sort((a,b)=>b[0]-a[0]).map(([t,w,what,n,ok,st,note])=>`<div class="ad-xr ${st==='waiting'?'pend':''}">${leaf(t)}<span class="gt-ck"><b>${what}</b><span>${pName(w)} · ${hm(t)}</span></span><b class="num">${int(n)}</b><span class="ad-xo">${ok ? `${sq(ok)}<em>${pName(ok)}</em>` : `<em>${note}</em>`}</span><span class="gt-st" style="--c:${ESt[st][1]}">${ESt[st][0]}</span></div>`).join('')}</div>`,
    `<span>Lists with names, emails or phone numbers need a second person</span><button data-ago="settings/rules">The rule →</button>`);
  return band(rv + bp, 1) + band(ex);
}

/* ══ Panels ═══════════════════════════════════════════════════════════════════════════════════════════════════════ */
function ensurePanel(){ let pn = document.getElementById('apanel');
  if (!pn){ const sc2 = document.createElement('div'); sc2.id = 'ascrim'; sc2.className = 'scrim'; document.body.appendChild(sc2); pn = document.createElement('aside'); pn.id = 'apanel'; pn.className = 'panel apanel'; document.body.appendChild(pn); }
  return pn; }
const phd = k => `<div class="pn-hd"><span class="lbl">${k}</span><button class="x" data-aclose aria-label="Close">${ICO.x}</button></div>`;
const ro = () => CAN_ACT() ? '' : 'disabled';
const foot = (btns) => `<div class="pn-ft">${CAN_ACT() ? btns : `<span class="small quiet" style="margin-right:auto">Read-only</span><button class="btn" data-aclose>Close</button>`}</div>`;
function renderPanel(){ const pn = ensurePanel(), P = A.panel;
  if (!P){ document.body.classList.remove('pn'); return; }
  const i = P.indexOf(':'), k = P.slice(0,i), id = P.slice(i+1);
  const html = { p:personPanel, i:invitePanel, g:groupPanel, r:rulePanel, s:setPanel, c:connPanel, d:docPanel, l:logPanel }[k];
  if (!html){ A.panel = null; return; }
  document.body.classList.add('pn'); pn.innerHTML = html(id); }
function personPanel(id){
  const p = PPL[id], G = GROUPS[p.g];
  const can = SECS.map(([k,t],i)=>[t, G[2][i]]).filter(x=>x[1]>=3);
  return phd(`Team · ${G[0]}`) + `<div class="pn-b"><div class="ad-ph">${sq(p.id,'lg')}<div><p class="bpn-t">${p.n}</p><p class="bpn-s">${p.title} · <span class="mono">${p.email}</span></p></div></div>
    <div class="led">${[['Group',`${G[0]} · ${G[1]}`],['Sign-in',p.passkey?'Passkey':'Emailed code · read-only'],['Signer in the Ops Safe',p.signer?'Yes':'No'],['On the team since',fmtD(p.since)],['Last active',ago(p.last)],...(p.until?[['Access ends',fmtD(p.until)]]:[])].map(([a,b])=>`<div><span>${a}</span><b>${b}</b></div>`).join('')}</div>
    <div>${lbl('Their level on each page')}<div class="ad-lvs">${SECS.map(([k,t],i)=>`<span title="${t} · ${LV[G[2][i]][0]}">${lvSq(G[2][i])}<em>${SHORT[k]}</em></span>`).join('')}</div>
      <p class="bpn-n">${can.length ? `Can propose or approve on ${can.map(x=>x[0]).join(', ')}.` : 'Read-only everywhere.'} Levels come from the group, so changing them changes everyone in ${G[0]}.</p></div>
    <div>${lbl(`Devices · ${p.dev.length}`)}<div class="led">${p.dev.map((d,i)=>`<div><span>${d[0]}${d[2]?'':' · not trusted'}</span><b>${ago(d[1])}${CAN_ACT()?` · <button class="lnk3" data-asignout="${p.id}:${i}">Sign out</button>`:''}</b></div>`).join('')}</div></div>
    ${CAN_ACT() ? `<div>${lbl('Move to another group')}<div class="ad-mv"><select class="vin" id="agsel">${GKEYS.map(g=>`<option value="${g}" ${g===p.g?'selected':''}>${GROUPS[g][0]}</option>`).join('')}</select><button class="btn sm-b" data-achg="${p.id}">Propose</button></div></div>` : ''}
    <button class="lnk3 ad-out" data-alog="${p.id}">Their actions in the audit log →</button></div>`
    + foot(`${p.id!==A.me ? `<button class="btn" data-aoff="${p.id}">Turn off access</button>` : ''}<button class="btn p" data-aclose>Done</button>`);
}
function invitePanel(id){
  const v = INVITES.find(x=>x.id===id), G = GROUPS[v.g];
  return phd('Invite') + `<div class="pn-b"><div class="ad-ph">${sq(v.id,'lg dash')}<div><p class="bpn-t">${v.n}</p><p class="bpn-s">${v.title} · <span class="mono">${v.email}</span></p></div></div>
    <div class="ad-tl">${[['Kai invited them',fmtD(v.sent),1],['Dana Ruiz approved it',fmtD(v.sent),1],[`${v.n.split(' ')[0]} accepts and sets a passkey`,`by ${fmtD(v.exp)}`,0],['A device is confirmed','after that',0]].map(([a,b,d])=>`<div class="${d?'done':'next'}"><i></i><span><b>${a}</b><em>${b}</em></span></div>`).join('')}</div>
    <div class="led">${[['Group',G[0]],['Expires',`${fmtD(v.exp)} · ${Math.round((v.exp-TODAY)/DAY)} days`]].map(([a,b])=>`<div><span>${a}</span><b>${b}</b></div>`).join('')}</div>
    <p class="bpn-n">Until they accept, the invite shows what ${G[0]} can do but grants nothing.</p></div>`
    + foot(`<button class="btn" data-acancel="${v.id}">Cancel the invite</button><button class="btn p" data-aresend="${v.id}">Resend it</button>`);
}
function groupPanel(g){
  const G = GROUPS[g]; if (!A.gd || A.gd.g!==g) A.gd = { g, lv:[...G[2]] };
  const d = A.gd, changed = d.lv.some((v,i)=>v!==G[2][i]), ppl = PEOPLE.filter(p=>p.g===g);
  return phd(g==='members' ? 'Every member' : 'Group') + `<div class="pn-b"><div><p class="bpn-t">${G[0]}</p><p class="bpn-s">${G[1]}${g==='members' ? ` · ${MEMBERS_N} members` : ppl.length ? ` · ${ppl.map(p=>p.n).join(', ')}` : ''}</p></div>
    <div class="ad-ge">${SEC_GROUP.map(([gn,a,b])=>`<div class="ad-geg">${lbl(gn)}${SECS.slice(a,b+1).map(([k,t],j)=>{ const i = a+j;
      return `<div class="ad-ger ${d.lv[i]!==G[2][i]?'chg':''}"><span>${t}</span><div class="ad-lvp" role="group" aria-label="${t}">${LV.map(([n],v)=>`<button data-agl="${i}:${v}" aria-pressed="${d.lv[i]===v}" title="${n}" ${ro()} ${g==='members' && v>2 ? 'disabled' : ''}>${lvSq(v)}</button>`).join('')}</div><em>${LV[d.lv[i]][0]}</em></div>`; }).join('')}</div>`).join('')}</div>
    <p class="bpn-n">${g==='members' ? 'Members never go above See: they act in the Clear app, not here.' : 'A change applies to everyone in the group once a second person approves it.'}</p></div>`
    + foot(`<button class="btn" data-agreset ${changed?'':'disabled'}>Undo</button><button class="btn p" data-agprop="${g}" ${changed?'':'disabled'}>Propose the change</button>`);
}
function rulePanel(id){
  const r = RULES.find(x=>x.id===id), s = SETO[r.set], p = pendOf(r.set);
  return phd('Two-person rule') + `<div class="pn-b"><div><p class="bpn-t">${r.t}</p><p class="bpn-s">${r.c}</p></div>
    <div class="ad-big"><span><b>${ruleNum(r)}</b><em>${s ? (s.kind==='lock' ? s.why : 'Set in Settings') : 'Every change, always'}</em></span>${p ? `<span class="ad-pd">${fmtV(s,p.to)} waiting on ${pName(p.need)}</span>` : ''}</div>
    <div>${lbl('Who can be the second person')}<div class="led">${r.who.map(id=>`<div><span>${sq(id)} ${pName(id)}</span><b>${GROUPS[PPL[id].g][0]}</b></div>`).join('')}</div></div>
    <div class="led">${[['Last 30 days',`${r.n30} approvals`],['Usual wait',r.med?`${r.med.toFixed(1)} hours`:'None yet'],['Approved their own','Never · the app won’t allow it']].map(([a,b])=>`<div><span>${a}</span><b>${b}</b></div>`).join('')}</div></div>
    <div class="pn-ft">${s && s.kind!=='lock' ? `<button class="btn" data-aopen="s:${s.id}">Change the number</button>` : ''}<button class="btn p" data-aclose>Done</button></div>`;
}
function setPanel(id){
  const s = SETO[id], p = pendOf(id), lock = s.kind==='lock', hist = SET_HIST.filter(h=>h[2]===id);
  const input = s.kind==='on' ? `<div class="seg sm" role="group">${[[1,'On'],[0,'Off']].map(([v,t])=>`<button data-asv="${v}" aria-pressed="${(A.sv??s.v)==v}" ${ro()}>${t}</button>`).join('')}</div>`
    : s.kind==='choice' ? `<select class="vin" id="asnew" ${ro()}>${s.opts.map(o=>`<option ${o===s.v?'selected':''}>${o}</option>`).join('')}</select>`
    : `<input class="vin ad-in" id="asnew" inputmode="decimal" value="${s.v}" ${ro()}><span class="ad-u">${s.kind==='money'?'dollars':s.kind==='pct'?'percent':s.kind==='hours'?'hours':s.kind==='days'?'days':unitOf(s)}</span>`;
  return phd(`Settings · ${SEC_T[s.sec][0]}`) + `<div class="pn-b"><div><p class="bpn-t">${s.t}</p><p class="bpn-s">${s.d}</p></div>
    <div class="ad-big"><span><b>${lock?ICO.lock:''}${fmtV(s)}</b><em>${lock ? s.why : `Now · used in ${usedTxt(s)}`}</em></span></div>
    ${p ? `<div class="ad-pc"><div class="ad-pc-h">${lbl(`Change ${p.id} · waiting`)}<span class="gt-st" style="--c:var(--underway)">On ${p.need===A.me?'you':pName(p.need)}</span></div><p><b>${fmtV(s,p.from)} → ${fmtV(s,p.to)}</b> · ${pName(p.by)} proposed ${ago(p.at)}</p><p class="bpn-n">“${p.why}”</p></div>` : ''}
    ${lock ? `<p class="bpn-n">This one isn’t set here. ${s.where.startsWith('governance') ? 'It changes with a proposal in Governance.' : s.where.startsWith('team') ? 'It follows the Members column in Team.' : 'The policy is in Records.'}</p>` :
      !p ? `<div>${lbl('Change it to')}<div class="ad-ni">${input}</div><label class="ad-why">${lbl('Why')}<textarea class="vin" id="aswhy" rows="2" placeholder="Shown to the second person and kept in the log" ${ro()}></textarea></label></div>` : ''}
    ${hist.length ? `<div>${lbl('Before')}<div class="led">${hist.map(([hid,t,,a,b,by,ok])=>`<div><span>${fmtD(t)} · ${a} → ${b}</span><b>${pName(by).split(' ')[0]}, approved by ${pName(ok).split(' ')[0]}</b></div>`).join('')}</div></div>` : ''}</div>`
    + (lock ? `<div class="pn-ft">${s.where ? `<button class="btn" data-ago="${s.where}">${s.where.startsWith('governance') ? 'Governance' : s.where.startsWith('team') ? 'Team' : 'Records'} →</button>` : ''}<button class="btn p" data-aclose>Done</button></div>`
      : p ? foot(p.need===A.me ? `<button class="btn" data-adecline="${p.id}">Decline</button><button class="btn p" data-aapprove="${p.id}">Approve</button>` : p.by===A.me ? `<button class="btn" data-awithdraw="${p.id}">Withdraw</button><button class="btn p" data-aclose>Done</button>` : `<button class="btn p" data-aclose>Done</button>`)
      : foot(`<button class="btn" data-aclose>Cancel</button><button class="btn p" data-apropose="${s.id}">Propose the change</button>`));
}
function connPanel(id){
  const c = CONN.find(x=>x.id===id);
  return phd(`Connection · ${CST(c)[0]}`) + `<div class="pn-b"><div><p class="bpn-t">${c.n}</p><p class="bpn-s">${c.what} · ${c.note}</p></div>
    <div>${lbl('Last 24 hours')}${connHrs(c, true)}<div class="ad-hr-x"><span>24 h ago</span><span>Now</span></div></div>
    <div class="led">${[['Used in',usedTxt(c)],['Connected by',pName(c.by)],['Key',c.rot ? `${keyTxt(c)} · ${c.rot} days old` : keyTxt(c)],['Last heard',`${fmtD(c.last)}, ${hm(c.last)}`]].map(([a,b])=>`<div><span>${a}</span><b>${b}</b></div>`).join('')}</div>
    ${c.st==='behind' ? `<p class="bpn-w"><b>${c.note}.</b> Balances on Money may be up to 3 hours old until it catches up.</p>` : ''}
    <p class="bpn-n">Swapping a key or disconnecting needs a second person. The old key keeps working until they approve.</p></div>`
    + foot(`${c.rot ? `<button class="btn" data-arotate="${c.id}">Swap the key</button>` : ''}<button class="btn p" data-async="${c.id}">${c.idle?'Wake it':'Check now'}</button>`);
}
function docPanel(id){
  const d = DOCS.find(x=>x[0]===id);
  return phd(`Records · ${DONE1[d[2]]}`) + `<div class="pn-b"><div><p class="bpn-t">${d[1]}</p><p class="bpn-s">${DSTAT[d[5]][0]} · ${d[6]}</p></div>
    <div class="led">${[['Entity',ENTO[d[3]][1]],['Date',fmtD(d[4])],['By',d[7]],['Pages',d[8]],['Kept until',`${fmtD(d[4]).replace(/\d{4}/,'')} ${new Date(d[4]).getUTCFullYear()+7}`]].map(([a,b])=>`<div><span>${a}</span><b>${b}</b></div>`).join('')}</div>
    ${d[9] ? `<p class="bpn-n">This is the filed copy. Versions, redlines and who signed which one are in Governance.</p>` : ''}
    ${d[5]==='waiting' ? `<p class="bpn-w"><b>Waiting on Inland Cycle Works’ signature.</b> It files itself here once they sign.</p>` : ''}</div>
    <div class="pn-ft">${d[9] ? `<button class="btn" data-aout="Governance">Versions in Governance →</button>` : ''}<button class="btn p" data-adl="${d[0]}">Download</button></div>`;
}
function logPanel(id){
  const l = LOG.find(x=>x[0]===id);
  return phd(`Audit log · ${AREAS[l[3]][0]}`) + `<div class="pn-b"><div><p class="bpn-t">${l[4]}</p><p class="bpn-s">${l[5]}</p></div>
    <div class="led">${[['Who',pName(l[2])],['When',`${WD(l[1])} ${fmtD(l[1])}, ${hm(l[1])}`],['From',l[6]],['Result',RESULT[l[7]][0]],...(l[8]?[['Second person',l[8]]]:[]),['Entry',`#${id} · chained to the one before`]].map(([a,b])=>`<div><span>${a}</span><b>${b}</b></div>`).join('')}</div>
    <p class="bpn-n">${ICO.lock} Entries can’t be edited or deleted. A correction is a new entry that points back to this one.</p></div>
    <div class="pn-ft"><button class="btn p" data-aclose>Done</button></div>`;
}

/* ══ render + events ══════════════════════════════════════════════════════════════════════════════════════════════ */
function render(){
  document.getElementById('aw').classList.toggle('ro', !CAN_ACT());
  renderHdr();
  const T = A.tab[A.page];
  document.getElementById('av').innerHTML = ({ team:{overview:teamOverview, people:teamPeople, groups:teamGroups, rule:teamRule}, settings:{rules:setRules, security:setSecurity, connections:setConnections, org:setOrg}, records:{overview:recOverview, docs:recDocs, log:recLog, reveals:recReveals} })[A.page][T]();
  renderPanel();
  syncNav();
  fitRest();
}
function fitRest(){ document.querySelectorAll('.ad-rest').forEach(r=>{ r.classList.remove('thin'); if (r.getBoundingClientRect().height < 12) r.classList.add('thin'); }); }
window.addEventListener('resize', ()=>{ clearTimeout(fitRest.t); fitRest.t = setTimeout(fitRest, 120); });
function syncNav(){ document.querySelectorAll('.nav[data-apage]').forEach(b=>{ if (b.dataset.apage===A.page) b.setAttribute('aria-current','page'); else b.removeAttribute('aria-current'); }); }
const closeA = () => { A.panel = null; A.gd = null; A.sv = undefined; };
const logIt = (what, detail, res, area='team') => { LOG.unshift(['x'+Date.now(), NOW + (LOG.length%7)*60e3, A.me, area, what, detail, A.me==='K'?'Mac · Redlands':'Laptop · Riverside', res, res==='waiting'?'Needs a second person':'']); };
function goIn(path){ const [pg, rest2] = path.split('/'), [tab, op] = (rest2||'').split(':');
  if (!TABS[pg]) return toast(`Goes to ${pg[0].toUpperCase()+pg.slice(1)} in the Command Center`);
  closeA(); A.page = pg; if (tab && TABS[pg].some(t=>t[0]===tab)) A.tab[pg] = tab; if (op){ if (pg==='records' && tab==='docs') A.panel = 'd:'+op; if (pg==='settings') A.panel = 's:'+op; }
  render(); window.scrollTo({top:0}); }
document.addEventListener('click', e => {
  if (e.target.id==='ascrim'){ closeA(); return render(); }
  const t = e.target.closest('button,a,[data-atab],[data-aopen]'); if (!t) return; const d = t.dataset;
  if (d.apage){ closeA(); A.page = d.apage; render(); window.scrollTo({top:0}); return; }
  if (d.atab){ closeA(); A.tab[A.page] = d.atab; A.lp = 0; render(); window.scrollTo({top:0}); return; }
  if (d.ago) return goIn(d.ago);
  if (d.aout) return toast(`Goes to ${d.aout} in the Command Center`);
  if (d.aopen){ const k = d.aopen.split(':')[0]; if (A.panel!==d.aopen){ A.gd = null; A.sv = undefined; } A.panel = d.aopen;
    if (k==='i' || k==='p' || k==='g' || k==='r'){ if (A.page!=='team'){ A.page = 'team'; render(); return; } }
    if (k==='s' && A.page!=='settings'){ A.page = 'settings'; A.tab.settings = ['signin','privacy'].includes(SETO[d.aopen.slice(2)].sec) ? 'security' : ['records','notify'].includes(SETO[d.aopen.slice(2)].sec) ? 'org' : 'rules'; render(); return; }
    return renderPanel(); }
  if (d.aclose!==undefined){ closeA(); return render(); }
  if (d.alog){ closeA(); A.page = 'records'; A.tab.records = 'log'; A.lw = d.alog; A.lr = 'all'; A.la = null; A.lp = 0; render(); window.scrollTo({top:0}); return; }
  if (d.alrArea!==undefined){ closeA(); A.page = 'records'; A.tab.records = 'log'; A.la = d.alrArea || null; A.lw = 'all'; A.lr = 'all'; A.lp = 0; render(); return; }
  if (d.alw){ A.lw = d.alw; A.lp = 0; return render(); }
  if (d.alr){ A.lr = d.alr; A.lp = 0; return render(); }
  if (d.alp){ A.lp = Math.max(0, A.lp + (+d.alp)); return render(); }
  if (d.adf){ A.df = d.adf; if (A.tab.records!=='docs'){ A.tab.records = 'docs'; } return render(); }
  if (d.adocEnt){ closeA(); A.page = 'records'; A.tab.records = 'overview'; render(); const el = document.querySelector('.ad-pw'); if (el) el.scrollIntoView({block:'center'}); return; }
  if (d.amiss) { const [id,i] = d.amiss.split(':'); return toast(`Add the ${COVER_K[+i].toLowerCase()} for ${ENTO[id][1]} · it files under ${ENT_SH[id]}`); }
  if (d.aadd!==undefined) return toast('Opens an upload: pick the entity and kind, and it files with today’s date');
  if (d.ainvite!==undefined) return toast('Opens an invite: name, email and group · it needs a second person');
  if (d.agl){ const [i,v] = d.agl.split(':').map(Number); A.gd.lv[i] = v; return renderPanel(); }
  if (d.agreset!==undefined){ A.gd = null; return renderPanel(); }
  if (d.agprop){ const g = d.agprop, ch = A.gd.lv.map((v,i)=>[i,v]).filter(([i,v])=>v!==GROUPS[g][2][i]);
    logIt(`Proposed changing ${GROUPS[g][0]}`, ch.map(([i,v])=>`${SECS[i][1]}: ${LV[GROUPS[g][2][i]][0]} → ${LV[v][0]}`).join(' · '), 'waiting');
    WAITING.push([`${GROUPS[g][0]} · ${ch.length} page${ch.length>1?'s':''}`,'Team',A.me,second(),0,3.0,'access']); closeA(); render();
    return toast(`Proposed · ${GROUPS[g][0]} changes once ${pName(second())} approves · logged in Records`); }
  if (d.achg){ const p = PPL[d.achg], g = document.getElementById('agsel').value; if (g===p.g) return toast('Pick a different group');
    logIt(`Proposed moving ${p.n} to ${GROUPS[g][0]}`, `From ${GROUPS[p.g][0]}.`, 'waiting'); closeA(); render(); return toast(`Proposed · ${p.n} moves to ${GROUPS[g][0]} once ${pName(second())} approves`); }
  if (d.aoff){ const p = PPL[d.aoff]; logIt(`Proposed turning off ${p.n}`, 'Their sessions end once approved.', 'waiting'); closeA(); render(); return toast(`Proposed · ${p.n}’s access turns off once ${pName(second())} approves`); }
  if (d.asignout){ const [id,i] = d.asignout.split(':'), p = PPL[id], dv = p.dev[+i]; p.dev.splice(+i,1); logIt(`Signed out ${p.n}’s ${dv[0]}`, 'The session ended right away.', 'done'); render(); return toast(`Signed out · ${dv[0]} · logged in Records`); }
  if (d.aresend) return toast('Resent · the link works for 7 more days');
  if (d.acancel){ logIt(`Cancelled ${INVITES[0].n}’s invite`, 'Nothing was granted.', 'done'); INVITES.splice(0,1); closeA(); render(); return toast('Invite cancelled · logged in Records'); }
  if (d.asv!==undefined){ A.sv = +d.asv; return renderPanel(); }
  if (d.apropose){ const s = SETO[d.apropose], el = document.getElementById('asnew'), why = (document.getElementById('aswhy')||{}).value || '';
    let v = s.kind==='on' ? (A.sv ?? s.v) : s.kind==='choice' ? el.value : parseFloat(el.value);
    if (s.kind!=='choice' && s.kind!=='on' && (isNaN(v) || v<0)) return toast('Enter a number');
    if (v===s.v) return toast('That’s what it is now');
    if (!why.trim()) return toast('Add a reason · the second person sees it');
    const id = 'C-0'+(8+SET_HIST.length-5+PEND.length), need = second();
    PEND.push({id, set:s.id, from:s.v, to:v, by:A.me, at:NOW, why, need}); logIt(`Proposed ${s.t.toLowerCase()} ${fmtV(s,v)}`, `Setting ${id} · from ${fmtV(s)}. ${why}`, 'waiting');
    WAITING.push([`${s.t} · ${fmtV(s,v)}`,'Settings',A.me,need,0,6.5,'settings']); render();
    return toast(`Proposed · ${s.t.toLowerCase()} becomes ${fmtV(s,v)} once ${pName(need)} approves · logged in Records`); }
  if (d.aapprove){ const p = PEND.find(x=>x.id===d.aapprove), s = SETO[p.set]; SET_HIST.unshift([p.id, NOW, p.set, fmtV(s,p.from), fmtV(s,p.to), p.by, A.me]); s.v = p.to; PEND.splice(PEND.indexOf(p),1);
    const w = WAITING.findIndex(x=>x[1]==='Settings'); if (w>=0) WAITING.splice(w,1);
    logIt(`Approved ${p.id} · ${s.t} ${fmtV(s)}`, `${pName(p.by)} proposed.`, 'approved'); render(); return toast(`Approved · ${s.t} ${fmtV(s)} · in use on ${usedTxt(s)} now`); }
  if (d.adecline || d.awithdraw){ const p = PEND.find(x=>x.id===(d.adecline||d.awithdraw)), s = SETO[p.set]; PEND.splice(PEND.indexOf(p),1); const w = WAITING.findIndex(x=>x[1]==='Settings'); if (w>=0) WAITING.splice(w,1);
    logIt(`${d.adecline?'Declined':'Withdrew'} ${p.id} · ${s.t.toLowerCase()}`, `Stays at ${fmtV(s)}.`, 'done'); render(); return toast(`${d.adecline?'Declined':'Withdrawn'} · ${s.t} stays ${fmtV(s)}`); }
  if (d.async){ const c = CONN.find(x=>x.id===d.async); return toast(c.st==='behind' ? `${c.n} is catching up · 9 of 12 links now` : `${c.n} answered in 0.4 seconds`); }
  if (d.arotate){ const c = CONN.find(x=>x.id===d.arotate); logIt(`Proposed swapping the ${c.n} key`, `••••${c.key} is ${c.rot} days old.`, 'waiting'); return toast(`Proposed · the new ${c.n} key goes live once ${pName(second())} approves`); }
  if (d.adl){ const doc = DOCS.find(x=>x[0]===d.adl); logIt(`Downloaded ${doc[1]}`, `${doc[6]} · ${doc[8]} pages`, 'done', 'gov'); return toast('Downloaded · logged in Records'); }
});
document.addEventListener('keydown', e => { if (e.key==='Escape' && A.panel){ closeA(); render(); } });
const hs = location.hash.slice(1).split(',');
['team','settings','records'].forEach(p=>{ if (hs.includes(p)) A.page = p; });
hs.forEach(h=>{ const [p,t] = h.split('/'); if (TABS[p] && t){ A.page = p; A.tab[p] = t; } });
if (hs.includes('dana')) A.me = 'DR'; if (hs.includes('viewer')) A.me = 'AC';
if (hs.includes('dark')) document.documentElement.dataset.theme = 'dark';
hs.filter(h=>/^(p|i|g|r|s|c|d|l)-/.test(h)).forEach(h=>{ A.panel = h.replace('-',':'); });
document.querySelectorAll('.nav').forEach(b=>{ const t = b.textContent.trim(); const k = {Records:'records', Team:'team', Settings:'settings'}[t]; if (k) b.dataset.apage = k; });
render();

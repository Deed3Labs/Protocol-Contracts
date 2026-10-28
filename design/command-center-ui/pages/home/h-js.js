/* ── Home ────────────────────────────────────────────────────────────────
   The brief and the status strip, then what needs you, then the pulse of each section, then the timeline.
   Everything below lives in its own scope and is prefixed h- in the CSS. The queue is S.waiting, so the
   rail badge, the inbox and this page always agree; the panel's primary action runs the item's own steps
   and then the original finish(), the same as approving from the inbox. */
const HOME = (() => {
  const HS = { qf:'all', cur:null, busy:false, lastW:0, ro:null };
  const QV = { /* how each waiting item reads on Home */
    payout:   {t:'Rosa’s Panadería payout', m:'September · Dana proposed · <em>due tomorrow</em>', a:'$412.60', btn:'Approve', ct:['live','Due tomorrow'], by:'Dana Ruiz', s:'Send back', go:'merchants'},
    chain:    {t:'Raise Rosa’s cap to $150', m:'MerchantRegistry · 2 of 3 signed · you’re the third', a:'$150.00', btn:'Multisig', ct:['live','2 of 3 signed'], by:'Dana Ruiz', s:'Not now', tool:'the Safe multisig', go:'contracts'},
    invite:   {t:'Batch 13 invites', m:'Oldest on the waitlist first · Marcus proposed', a:'25', u:'people', btn:'Approve', ct:['plain','Two-person'], by:'Marcus Lee', s:'Send back', go:'members'},
    agreement:{t:'Inland Cycle Works agreement', m:'Founding partner · they signed 20 Oct', a:'4/5', u:'seats', btn:'E-sign', ct:['plain','E-signature'], by:'Clear', s:'Not now', tool:'the e-signature tool', go:'contracts'}
  };
  const queue = () => S.waiting.slice().sort((a,b)=>NEED[a.id].order-NEED[b.id].order);
  const shown = () => queue().filter(w => HS.qf==='all' || (HS.qf==='approve' ? w.mode==='approve' : w.mode!=='approve'));

  /* header */
  function brief(){
    const has = id => S.waiting.some(w=>w.id===id);
    const notes = [];
    if (has('payout')) notes.push({w:3, t: vRO() ? 'Rosa’s payout is due tomorrow' : `<button type="button" class="h-blu" data-hrev="payout">Rosa’s payout</button> is due tomorrow`});
    notes.push({w:3, t:`<button type="button" class="h-red" data-go="money">Plaid is 3 hours behind</button>`});
    notes.push({w:2, t:`the <button type="button" data-vpane="votes">member vote</button> closes in 8 days`});
    notes.push({w:1, t:`64 members are stuck before funding`});
    const n = notes.sort((a,b)=>b.w-a.w).slice(0,3).map(x=>x.t);
    const body = n.slice(0,-1).join(', ') + ', and ' + n[n.length-1];
    const cap = body.replace(/^(<button[^>]*>)?(\w)/, (m,a,c)=>(a||'')+c.toUpperCase());
    return `${cap}. <span class="q">${S.waiting.length ? 'Everything else is moving.' : 'Nothing else needs you.'}</span>`;
  }
  function header(){
    const feeds = [['Bridge',1],['Protocol',1],['Plaid',0],['Analytics',1]], bad = feeds.filter(f=>!f[1]).length;
    const cents = v => { const [d,c] = money(v).split('.'); return `<span>${d}<span class="ct">.${c}</span></span>`; };
    return `<header class="h-hdr">
      <span class="h-when"><span class="h-dot" aria-hidden="true"></span>Wed 21 Oct · 16:04 · Testnet</span>
      <p class="h-brief">${brief()}</p>
      <div class="h-strip">
        <button type="button" class="h-sc" data-go="money"><span class="h-lbl">Feeds</span>
          <span class="h-sc-v">${feeds.length-bad} <small>of ${feeds.length}</small></span>
          <span class="h-fd">${feeds.map(f=>`<i class="${f[1]?'':'bad'}" title="${f[0]}${f[1]?' · synced':' · 3 hours behind'}"></i>`).join('')}</span>
          <span class="h-sc-s ${bad?'bad':''}">${bad?'Plaid is 3 hours behind':'All synced'}</span></button>
        <button type="button" class="h-sc" data-npane="reserves"><span class="h-lbl">Reserve</span>
          <span class="h-sc-v">1:1</span>
          <span class="h-mb"><i style="width:100%;background:var(--settled)"></i></span>
          <span class="h-sc-s">Member savings fully backed</span></button>
        <button type="button" class="h-sc" data-npane="overview"><span class="h-lbl">Free to spend</span>
          <span class="h-sc-v">${cents(20669.17)}</span>
          <span class="h-mb"><i style="width:96.2%"></i></span>
          <span class="h-sc-s">Of ${money(21480.75)} operating cash</span></button>
        <button type="button" class="h-sc" data-npane="credit"><span class="h-lbl">Credit headroom</span>
          <span class="h-sc-v">${cents(1527.60)}</span>
          <span class="h-mb"><i style="width:78.5%"></i><span class="hroom" style="left:78.5%;right:0"></span></span>
          <span class="h-sc-s">Before the credit gate shuts</span></button>
      </div></header>`;
  }

  /* needs you + heads-up */
  function qRow(w){ const v = QV[w.id], ext = w.mode!=='approve';
    return `<div class="h-qr${w.urgent?' urgent':''}${HS.cur===w.id?' sel':''}" data-hrev="${w.id}">
      <span class="h-qi">${ic(W_ICON[w.id])}</span>
      <span class="h-qt"><b>${v.t}</b><span>${v.m}</span></span>
      <span class="h-qa h-fig">${v.a}${v.u?`<small>${v.u}</small>`:''}</span>
      <button type="button" class="h-btn${ext?' ext':''}" data-hrev="${w.id}">${v.btn}${ext?ic('out'):''}</button></div>`; }
  function needsCell(){
    const q = queue(), ap = q.filter(w=>w.mode==='approve').length, sg = q.length-ap, list = shown();
    if (HS.qf!=='all' && !list.length) HS.qf = 'all';
    const pills = q.length ? `<div class="h-qf" role="group" aria-label="Filter">${[['all','All'],['approve',`Approve · ${ap}`],['sign',`Sign · ${sg}`]].filter(([k],i)=>!i || (k==='approve'?ap:sg)).map(([k,t])=>`<button type="button" data-hqf="${k}" aria-pressed="${HS.qf===k}">${t}</button>`).join('')}</div>` : '';
    const body = q.length ? shown().map(qRow).join('')
      : `<div class="h-qempty"><b>Nothing needs you.</b><span class="small quiet">Approvals and signatures land here first.</span></div>`;
    return `<section class="h-cell h-s8"><div class="h-hd"><h2>Needs you</h2><span class="h-lbl h-num">${q.length}</span><div class="h-r">${pills}</div></div>
      <div class="h-q">${body}</div>
      <div class="h-rule">${ic('team')}Two-person rule: whoever proposes can’t approve.</div></section>`;
  }
  function headsCell(){
    const capOpen = S.waiting.some(w=>w.id==='chain');
    const rows = [
      {sv:'absent', t:'Plaid is 3 hours behind', age:'3h', m:'Money · operating cash balance is stale', go:'money',
       own:`<div class="h-own"><span>Dana Ruiz is re-syncing</span><span class="pg"><i><b style="width:58%"></b></i>7/12</span></div>`},
      {sv:'underway', t:'Rosa’s hit their cap 3 times', age:'Today', m:'Merchants · sales declined at the counter', go:'merchants',
       own: capOpen ? `<div class="h-own"><span>Fix is waiting on you</span><button type="button" class="lnk" data-hrev="chain">Review ↑</button></div>`
                    : `<div class="h-own done"><span>Fix is with the multisig</span></div>`},
      {sv:'underway', t:'Poster P-044 is sun-faded', age:'2d', m:'Growth · Mesa Laundry · scans down 40%', go:'growth',
       own:`<div class="h-own none"><span>Nobody’s on it</span><button type="button" class="lnk" data-go="field">Add to route →</button></div>`}
    ];
    return `<section class="h-cell h-s4 h-heads"><div class="h-hd"><h2>Heads-up</h2><span class="h-lbl h-num">${rows.length}</span><div class="h-r"><span class="h-lbl">1 has no owner</span></div></div>
      <div class="h-al">${rows.map(r=>`<div class="h-alr"><div class="h-al-m"><button type="button" class="h-al-t" data-go="${r.go}"><i class="sv" style="background:var(--${r.sv})"></i><b>${r.t}</b><span class="age">${r.age}</span></button>
        <span class="m">${r.m}</span></div>${r.own}</div>`).join('')}</div>
      <button type="button" class="h-foot" data-hgo="alerts">Alert history <span aria-hidden="true">→</span></button></section>`;
  }

  /* pulse */
  const F = FUNNEL.map(([n,v])=>[{Activated:'Active','First spend':'Spent'}[n]||n, v]);
  const funnel = (() => {
    const w=100, mid=21, top0=F[0][1], hh=v=>5+37*Math.pow(v/top0,.25); let top='', bot='';
    F.forEach(([n,v],i)=>{ const h=hh(v), x1=i*w+(i<5?66:w), t=mid-h/2, b=mid+h/2;
      top += `${i?'':'M0 '+t}L${x1} ${t}`; if (i<5){ const h2=hh(F[i+1][1]); top += `C${x1+18} ${t} ${(i+1)*w-16} ${mid-h2/2} ${(i+1)*w} ${mid-h2/2}`; }
      let seg = `L${x1} ${b}`; if (i<5){ const h2=hh(F[i+1][1]); seg = `L${(i+1)*w} ${mid+h2/2}C${(i+1)*w-16} ${mid+h2/2} ${x1+18} ${b} ${x1} ${b}`; }
      bot = seg + bot; });
    const hl = hh(F[5][1]);
    return `<div class="h-gf"><svg viewBox="0 0 600 42" preserveAspectRatio="none" aria-hidden="true"><path class="fa" d="${top}L600 ${mid+hl/2}${bot.replace(/^L600 [\d.]+/,'')}L0 ${mid+hh(top0)/2}Z"/><rect class="fb" x="500" y="${mid-hl/2}" width="100" height="${hl}"/></svg>
      <div class="h-gf-l">${F.map(([n,v])=>`<span><b>${int(v)}</b><s>${n}</s></span>`).join('')}</div></div>`;
  })();
  const units = (() => { const u = []; for (let b=0;b<12;b++){ const a=[13,13,12,11,11,10,10,10,9,9,8,8][b], o=[6,6,6,5,5,6,6,5,5,5,5,4][b]; for (let i=0;i<25;i++) u.push(i<a?'h-u-a':i<a+o?'h-u-o':'h-u-n'); } return u; })();
  const CG = [['Access',['','','','','c','']],['Issue',['','','','','']],['Tokens',['','']],['Pools',['','','','','x','f','w','']],['Capital',['f','']],['Deeds',['','','','','','','','c']]];
  const tree = (() => {
    const W=24, H=11, L=[0,20,40,60], cx=170, xs=[98,146,194,242];
    const node = (x,y,c,due) => `<rect class="${c}" x="${x-W/2+.5}" y="${y+.5}" width="${W-1}" height="${H-1}"/>${due?`<rect class="h-due" x="${x+W/2-2}" y="${y-3}" width="5" height="5"/>`:''}`;
    const ln = d => `<path class="h-ln" d="${d}"/>`; let g = '';
    ['Co-op','Subs','Manager','Holdings'].forEach((t,i)=>{ g += `<text x="0" y="${L[i]+9}">${t}</text>`; });
    g += ln(`M${cx} ${L[0]+H}V${L[1]-4.5}M${xs[0]} ${L[1]-4.5}H${xs[3]}`+xs.map(x=>`M${x} ${L[1]-4.5}V${L[1]}`).join(''));
    g += ln(`M${xs[2]} ${L[1]+H}V${L[2]}`);
    g += ln(`M${xs[2]} ${L[2]+H}V${L[3]-4.5}M${xs[2]-24} ${L[3]-4.5}H${xs[2]+24}M${xs[2]-24} ${L[3]-4.5}V${L[3]}M${xs[2]+24} ${L[3]-4.5}V${L[3]}`);
    g += node(cx,L[0],'n',1) + node(xs[0],L[1],'n') + node(xs[1],L[1],'f') + node(xs[2],L[1],'n') + node(xs[3],L[1],'n',1) + node(xs[2],L[2],'f') + node(xs[2]-24,L[3],'p') + node(xs[2]+24,L[3],'p');
    g += `<path class="dv" d="M282.5 0V71"/>` + node(316,L[0],'f') + `<text x="316" y="${L[1]+9}" text-anchor="middle">Outside</text>`;
    return `<svg class="h-gt" width="100%" height="72" viewBox="0 0 342 72" preserveAspectRatio="xMinYMid meet" aria-hidden="true">${g}</svg>`;
  })();
  const sw = (s) => `<i style="${s}"></i>`;
  const TILES = () => [
    {go:'growth', n:'Growth', f:'1,302', s:'joined in 30 days · 109 made a first spend', viz:funnel, key:`<span>Biggest drop is visit → join, 3.6%</span>`},
    {go:'members', n:'Members', chip:['under','64 stuck'], f:'124', fs:' active', s:'of 300 invited · 1,500 on the waitlist',
     viz:`<div class="h-units" style="grid-template-columns:repeat(50,1fr)">${units.map(c=>`<i class="${c}"></i>`).join('')}</div>`,
     key:`<span><i class="h-u-a"></i>Active</span><span><i class="h-u-o"></i>Opened, not funded <b>64</b></span><span><i class="h-u-n"></i>Not opened</span>`},
    {go:'merchants', n:'Merchants', f:'12', fs:' of 30', s:'partner shops transacting · 13 cities',
     viz:`<div class="h-units" style="grid-template-columns:repeat(15,1fr);gap:3px">${Array.from({length:30},(_,i)=>`<i class="${i<12?'h-u-a':i<18?'h-hatch':'h-u-n'}"></i>`).join('')}</div>`,
     key:`<span><i class="h-u-a"></i>Transacting</span><span><i class="h-hatch"></i>Signing</span><span><i class="h-u-n"></i>Signed, idle</span>`},
    {go:'money', n:'Money', f:money(75984.75), s:'held across 6 accounts · +$10,418.55 this week',
     viz:`<div class="h-mz"><div class="h-mz-g" style="flex:55.8"><span>Members’</span><b>$42.4k</b><i></i></div><div class="h-mz-g" style="flex:28.9"><span>Co-op’s</span><b>$22.0k</b><i></i></div><div class="h-mz-g h-rt" style="flex:15.3"><span>Set aside</span><b>$11.7k</b><i></i></div></div>
       <div class="h-comp" title="Savings · Yield pool · Operating · Co-op balance · Payout pool · AssurancePool">${sw('flex:51.2;background:var(--fg)')}${sw('flex:4.5;background:color-mix(in srgb,var(--live) 62%,transparent)')}${sw('flex:28.3;background:var(--land)')}${sw('flex:.6;background:color-mix(in srgb,var(--fg) 30%,transparent)')}${sw('flex:13.5;background:color-mix(in srgb,var(--fg) 58%,transparent)')}${sw('flex:1.9;background:var(--underway)')}</div>`,
     key:`<span>Biggest mover: member savings, +$7,740.20 this week</span>`},
    {go:'contracts', n:'Contracts', chip: !vRO() && S.waiting.some(w=>w.id==='chain') ? ['live','1 on you'] : null, f:'30', fs:' of 31', s:'live on Base Sepolia · 2 changes in flight',
     viz:`<div class="h-pc">${CG.map(([n,a],i)=>`<div class="h-pc-c ${i===5?'h-dd':''}"><div class="h-pc-s">${a.map(c=>`<i class="${c}"></i>`).join('')}</div><s>${n}</s></div>`).join('')}</div>`,
     key:`<span>${sw('box-shadow:inset 0 0 0 2px var(--live)')}On you</span><span>${sw('box-shadow:inset 0 0 0 2px var(--underway)')}Pending</span><span><i class="h-hatch"></i>Not funded</span><span>${sw('outline:1px dashed var(--fg-50);outline-offset:-1px')}Not deployed</span>`},
    {go:'governance', n:'Governance', chip:['under','3 due'], f:'4', fs:' of 9', s:'entities formed · 6 of 15 board seats filled', viz:tree,
     key:`<span>${sw('background:var(--fg)')}Formed</span><span>${sw('outline:1.5px dashed var(--underway);outline-offset:-1.5px')}Forming</span><span>${sw('outline:1px dashed var(--fg-50);outline-offset:-1px')}Planned</span><span>${sw('background:var(--underway);width:6px;height:6px')}Filing due</span>`}
  ];
  const pulse = () => `<div class="h-bento">${TILES().map(t=>`<button type="button" class="h-cell h-s4 h-pt" data-go="${t.go}" aria-label="${t.n}: open the section"><span class="h-pt-in">
    <span class="h-pt-h">${ic(t.go)}<b>${t.n}</b>${t.chip?`<span class="h-chip ${t.chip[0]}">${t.chip[1]}</span>`:''}</span>
    <span class="h-pt-f"><span class="h-fig">${t.f}${t.fs?`<small>${t.fs}</small>`:''}</span><span>${t.s}</span></span>
    <span class="h-viz">${t.viz}</span><span class="h-vk">${t.key}</span></span></button>`).join('')}</div>`;

  /* timeline: 7 days back, 30 ahead */
  const ND = 37, TI = 7, D0 = Date.UTC(2026,9,14);
  const dayAt = i => new Date(D0 + i*864e5);
  const idxOf = d => { const [y,m,dd] = d.split('-').map(Number); return Math.round((Date.UTC(y,m-1,dd)-D0)/864e5); };
  const MO = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const PAST = [ /* date, time, what, detail, lane, go */
    ['2026-10-21','14:00','Mesa Laundry cap → $120','Marcus Lee','Merchants','merchants'],
    ['2026-10-21','12:00','Uptown Barber signed','12 shops now transacting','Merchants','merchants'],
    ['2026-10-21','10:00','Waitlist passed 1,500','At 16:12 yesterday it was 1,482','Growth','members'],
    ['2026-10-20','17:30','Batch 12 invites sent','25 people · Marcus Lee','Members','members'],
    ['2026-10-20','11:05','RevolvingIssuer v1.3 deployed','Base Sepolia · Dana Ruiz','Contracts','contracts'],
    ['2026-10-19','','Board minutes draft shared','for 4 Nov · Ana Ortiz','Governance','governance'],
    ['2026-10-17','','Founding seat 4 offered','Inland Cycle Works','Merchants','merchants'],
    ['2026-10-16','','Riverside poster run done','6 posters up · Marcus Lee','Growth','growth'],
    ['2026-10-15','','Yield pool opened','$8,062.10 from 14 members','Money','money']
  ];
  const DUE = [ /* date, short, long, sub, status, lane, tiny, link attr */
    ['2026-10-29','Closes','Member vote closes','85.2% yes · 61 of 188 voted','m','Governance','','data-vpane="votes"'],
    ['2026-11-01','Annual report','Wyoming annual report','ClearLabs Inc','ok','Governance','Report','data-vpane="calendar"'],
    ['2026-11-02','Payouts clear','Payouts clear','$12,839.25 to 11 shops','m','Money','','data-xpane="payouts"'],
    ['2026-11-04','Board meeting','Board meeting','Co-op board · 18:00','un','Governance','','data-vpane="votes"'],
    ['2026-11-15','Statement','Statement of Information','Clear Co-op','bad','Governance','','data-vpane="calendar"']
  ];
  const RUN = [ /* from, to (null runs past the window), label, value, lane, key, tone */
    ['2026-10-20',null,'Batch 12 activation','14/25 opened','Members','r1',''],
    ['2026-10-21','2026-10-21','Poster route','3/8 shops','Growth','r2',''],
    ['2026-10-21','2026-10-21','Plaid re-sync','7/12','Money','r3',''],
    ['2026-10-19','2026-10-21','AssurancePool v1.3','Waiting on you','Contracts','q0','live'],
    ['2026-10-15','2026-10-29','Member vote','85.2% yes','Governance','d0','']
  ];
  const LANES = ['Growth','Members','Merchants','Money','Contracts','Governance'];
  const STL = {ok:'Ready', un:'Drafting', bad:'Not started'};
  const fmt3 = d => { const x = dayAt(idxOf(d)); return [x.getUTCDate(), MON[x.getUTCMonth()].toUpperCase(), ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][x.getUTCDay()]]; };
  const _cv = document.createElement('canvas').getContext('2d');
  const tw = (t, mono) => { _cv.font = mono ? "500 10px 'IBM Plex Mono', monospace" : "600 12px 'Instrument Sans', system-ui, sans-serif"; return _cv.measureText(mono ? t.toUpperCase() : t).width + (mono ? t.length*0.4 : 0); };
  function drawTimeline(force){
    const host = document.getElementById('h-ax'); if (!host) return;
    const LAB = 92, W = host.clientWidth - LAB; if (W<=0 || (W===HS.lastW && !force && host.firstChild)) return; HS.lastW = W;
    const cw = W/ND, cx = i => (i+.5)*cw, ix = idxOf;
    let days = '', mo = '', cols = `<i class="h-cp" style="width:${TI*cw}px"></i><i class="h-cto" style="left:${TI*cw}px;width:${cw}px"></i>`;
    for (let i=0;i<ND;i++){ const d = dayAt(i), wd = d.getUTCDay();
      days += `<span class="h-tg-d ${i<TI?'past':''} ${i===TI?'today':''} ${wd===0||wd===6?'we':''}">${d.getUTCDate()}</span>`;
      if (d.getUTCDate()===1 || i===0){ mo += `<span style="left:${i*cw}px">${MO[d.getUTCMonth()]}</span>`; if (i) cols += `<i class="h-cm" style="left:${i*cw}px"></i>`; }
      else if (wd===1) cols += `<i class="h-cw" style="left:${i*cw}px"></i>`; }
    const lane = name => {
      const items = [], byDay = {}; let h = '';
      PAST.forEach((p,i)=>{ if (p[4]===name) (byDay[ix(p[0])] = byDay[ix(p[0])] || []).push(i); });
      Object.entries(byDay).forEach(([d,ids])=>{ const x = cx(+d); items.push(x);
        h += `<i class="h-tg-sq ${ids.length>1?'n':''}" data-hk="${ids.map(i=>'e'+i).join(',')}" style="left:${x}px" title="${ids.map(i=>PAST[i][2]).join(' · ')}">${ids.length>1?ids.length:''}</i>`; });
      const dues = DUE.map((p,j)=>[p,j]).filter(([p])=>p[5]===name);
      dues.forEach(([p,j])=>{ const x = cx(ix(p[0])); items.push(x); h += `<i class="h-tg-due ${p[4]}" data-hk="d${j}" style="left:${x}px" title="${p[2]}"></i>`; });
      const occ = items.map(x => [x-7, x+7]);
      const free = (a,b) => a >= 0 && b <= W && !occ.some(([p,q]) => a < q+3 && b > p-3);
      const lbls = [];
      RUN.filter(r=>r[4]===name).forEach(r=>{
        const a = ix(r[0]), b = r[1] ? ix(r[1]) : ND-1, x0 = a*cw+3, x1 = r[1] ? (b+1)*cw-3 : W-2;
        h += `<i class="h-tg-rail ${r[6]} ${r[1]?'cap':'open'}" data-hk="${r[5]}" style="left:${x0}px;width:${x1-x0}px"></i>`;
        lbls.push({x:Math.max(x0,(TI+1)*cw+2), rightOnly:1, b:r[2], st:r[3]+(r[1]?'':' · to 19 Jan'), cls:r[6], k:r[5]}); });
      dues.forEach(([p,j])=>{ if (RUN.some(r=>r[5]==='d'+j)) return; lbls.push({x:cx(ix(p[0])), b:p[1], tiny:p[6], st:STL[p[4]], cls:p[4], k:'d'+j}); });
      lbls.sort((a,b)=>a.x-b.x).forEach(l=>{
        const wT = tw(l.b,0)+12, wF = wT + (l.st ? tw(l.st,1)+6 : 0), wS = l.tiny ? tw(l.tiny,0)+12 : 0;
        const tries = l.rightOnly ? [['r',wF,1],['r',wT,0]] : [['r',wF,1],['r',wT,0],['l',wF,1],['l',wT,0]].concat(l.tiny ? [['r',wS,0,1],['l',wS,0,1]] : []);
        let pick = null;
        for (const [sd,w,st,sm] of tries){ const A = sd==='r' ? l.x+(l.rightOnly?0:12) : l.x-12-w, B = A+w; if (free(A,B)){ pick = [A,B,st,sm]; break; } }
        if (!pick) return; const [A,B,st,sm] = pick; occ.push([A,B]);
        h += `<span class="h-tg-lb ${l.cls||''}" data-hk="${l.k}" style="left:${A}px;width:${B-A}px" title="${l.b}"><b>${sm?l.tiny:l.b}</b>${st&&l.st?`<span>${l.st}</span>`:''}</span>`; });
      return `<div class="h-tg-row h-tg-lane"><span class="h-lbl">${name}</span><div class="h-tg-tr">${h}</div></div>`;
    };
    host.innerHTML = `<div class="h-tg"><div class="h-tg-cols">${cols}</div>
      <div class="h-tg-row h-tg-mo"><div></div><div class="h-tg-tr">${mo}</div></div>
      <div class="h-tg-row h-tg-days"><div></div><div class="h-tg-tr" style="grid-template-columns:repeat(${ND},1fr)">${days}</div></div>
      ${LANES.map(lane).join('')}</div>`;
  }
  const segs = (n,on,g=0) => `<div class="h-segs" aria-hidden="true">${Array.from({length:n},(_,i)=>`<i class="${i<on?'on':i<on+g?'on g':''}"></i>`).join('')}</div>`;
  function timeline(){
    const evRow = p => `<button type="button" class="h-ev" data-hk="e${PAST.indexOf(p)}" data-go="${p[5]}"><span class="w">${p[1] || fmt3(p[0])[2]}</span><span><b>${p[2]}</b><span class="s">${p[3]}</span></span></button>`;
    const td = PAST.filter(p=>p[0]==='2026-10-21'), more = PAST.length - td.length;
    const runs = [['r1','Batch 12 invites','14/25 opened',segs(25,9,5),'9 activated · sent yesterday','data-mpane="batches"'],
      ['r2','Poster route','3/8 shops',segs(8,3),'Marcus Lee · Redlands loop','data-go="field"'],
      ['r3','Plaid re-sync','7/12 links',segs(12,7),'Dana Ruiz · since 22:41','data-go="money"']];
    const due = DUE.map((p,j)=>{ const [dd,mm] = fmt3(p[0]), n = idxOf(p[0])-TI;
      return `<button type="button" class="h-dt" data-hk="d${j}" ${p[7]}><span class="d ${p[4]==='ok'?'k':''}">${dd}<small>${mm}</small></span><span><b>${p[2]}</b><span class="s">In ${n} days · ${p[3]}</span></span>${STL[p[4]]?`<span class="h-chip ${p[4]==='ok'?'ok':p[4]==='un'?'under':'bad'}">${STL[p[4]]}</span>`:''}</button>`; }).join('');
    return `<div class="h-bento h-tl"><section class="h-cell h-s12">
      <div class="h-hd"><h2>Timeline</h2><div class="h-r"><span class="h-tl-key">
        <span><i style="background:var(--fg)"></i>Happened</span><span><i style="height:2px;width:14px;background:var(--fg)"></i>Running</span>
        <span><i style="background:var(--settled)"></i><i style="box-shadow:inset 0 0 0 2px var(--underway)"></i><i style="box-shadow:inset 0 0 0 2px var(--absent)"></i>Due · ready, drafting, not started</span></span></div></div>
      <div class="h-tx"><div class="h-tx-in" id="h-ax"></div></div>
      <div class="h-tl-cols">
        <div class="h-tl-col"><span class="h-lbl">Happened today</span>${td.map(evRow).join('')}<button type="button" class="h-ev-more" data-rpane="log">${more} more this week in the activity log <span aria-hidden="true">→</span></button></div>
        <div class="h-tl-col"><span class="h-lbl">Running · ${runs.length}</span>${runs.map(([k,t,v,bar,s,a])=>`<button type="button" class="h-run" data-hk="${k}" ${a}><span class="h-run-t"><b>${t}</b><span class="h-num">${v}</span></span>${bar}<span class="s">${s}</span></button>`).join('')}</div>
        <div class="h-tl-col"><span class="h-lbl">Coming up</span>${due}</div>
      </div>
      <div class="h-ft" style="grid-template-columns:repeat(3,1fr)"><button type="button" data-rpane="log">Activity log <span aria-hidden="true">→</span></button><button type="button" data-go="records">All running work <span aria-hidden="true">→</span></button><button type="button" data-vpane="calendar">Compliance calendar <span aria-hidden="true">→</span></button></div>
    </section></div>`;
  }

  /* review panel */
  function root(){ let r = document.getElementById('hRoot');
    if (!r){ r = document.createElement('div'); r.id = 'hRoot'; r.innerHTML = `<div class="h-scrim" data-hclose></div><aside class="h-panel" role="dialog" aria-modal="true" aria-label="Review" tabindex="-1"></aside>`; document.body.appendChild(r); }
    return r; }
  const panelEl = () => root().querySelector('.h-panel');
  function openP(id){
    const w = S.waiting.find(x=>x.id===id); if (!w || vRO()) return;
    if (!document.body.classList.contains('h-pn')) HS.back = document.activeElement;
    HS.cur = id; HS.busy = false; const v = QV[id], ext = w.mode!=='approve', list = queue(), n = list.findIndex(x=>x.id===id);
    document.querySelectorAll('.h-qr').forEach(r=>r.classList.toggle('sel', r.dataset.hrev===id));
    panelEl().innerHTML = `<div class="h-pn-hd"><span class="h-lbl">${w.kind}</span><span class="h-chip ${v.ct[0]}">${v.ct[1]}</span><button type="button" class="x" data-hclose aria-label="Close">${ic('close','sm')}</button></div>
      <div class="h-pn-b"><div><h3>${v.t}</h3></div>
        <div class="h-fig" style="font-size:44px;line-height:1">${v.a}${v.u?`<span class="quiet" style="font-size:19px;font-weight:400"> ${v.u}</span>`:''}</div>
        <div class="h-led">${w.ledger.map(([k,val,t])=>`<div class="${t?'h-tot':''}"><span>${k}</span><b>${val}</b></div>`).join('')}</div>
        <div class="h-who2"><div><span class="h-lbl">Proposed by</span><b>${v.by}</b></div><div><span class="h-lbl">Needs</span><b>You</b></div></div>
        ${ext?`<p class="small quiet" style="margin:0">This opens in ${v.tool}. It shows as done here once that tool reports back.</p>`:''}</div>
      <div class="h-pn-ft"><span class="nx">${n+1} of ${list.length} · <span class="h-kbd">J</span> <span class="h-kbd">K</span></span><button type="button" class="h-btn" data-hsec="${id}">${v.s}</button><button type="button" class="h-btn p" data-hgo-step="${id}">${w.primary}${ext?ic('out'):''}</button></div>`;
    document.body.classList.add('h-pn');
    requestAnimationFrame(()=>{ const b = panelEl().querySelector('[data-hgo-step]'); if (b) b.focus(); });
  }
  function closeP(){ if (HS.busy) return; document.body.classList.remove('h-pn'); HS.cur = null;
    document.querySelectorAll('.h-qr.sel').forEach(r=>r.classList.remove('sel')); if (HS.back && document.contains(HS.back)) HS.back.focus(); }
  function runP(id){
    const w = S.waiting.find(x=>x.id===id); if (!w) return; HS.busy = true;
    const p = panelEl(), b = p.querySelector('.h-pn-b'), ft = p.querySelector('.h-pn-ft'), lb = p.querySelector('.h-pn-hd .h-lbl'), x = p.querySelector('.h-pn-hd .x');
    lb.textContent = w.mode==='approve' ? 'Working' : 'Handing off'; ft.innerHTML = ''; x.disabled = true;
    let i = 0;
    const draw = () => { b.innerHTML = `<div><h3>${QV[id].t}</h3></div><div class="h-steps" aria-live="polite">${w.steps.map((s,k)=>`<div class="h-step ${k<i?'done':k===i?'h-now':''}"><span class="h-mk">${k<i?ic('check'):k===i?'<span class="h-dot"></span>':'<span class="h-sq"></span>'}</span><span>${s}</span></div>`).join('')}</div>`; };
    draw();
    const t = setInterval(() => { i++; if (i < w.steps.length) return draw(); clearInterval(t); draw();
      lb.textContent = w.mode==='approve' ? 'Done' : 'Handed off'; x.disabled = false; HS.busy = false;
      const ch = p.querySelector('.h-pn-hd .h-chip'); if (ch){ ch.className = 'h-chip ok'; ch.textContent = w.mode==='approve' ? 'Approved' : 'Sent'; }
      b.insertAdjacentHTML('beforeend', `<div class="h-done"><h3>${w.done[0]}</h3><p>${w.done[1]}</p></div>`);
      const left = S.waiting.length - 1;
      ft.innerHTML = `<span class="nx">${left ? `${left} left` : 'Queue clear'}</span><button type="button" class="h-btn p" data-hfinish="${id}">${left ? 'Next' : 'Done'}</button>`;
      ft.querySelector('button').focus(); }, 750);
  }
  function finishP(id){
    const list = queue(), i = list.findIndex(x=>x.id===id), next = list.filter(x=>x.id!==id)[Math.min(i, list.length-2)];
    finish(id);                            /* the original: logs the update, drops it from S.waiting, re-renders */
    if (next) openP(next.id); else { HS.busy = false; closeP(); }
  }
  function sendBack(id){
    const w = S.waiting.find(x=>x.id===id), v = QV[id]; if (!w) return;
    if (w.mode!=='approve'){ return closeP(); }  /* "Not now" for things signed elsewhere */
    const at = S.waiting.indexOf(w);
    S.waiting = S.waiting.filter(x=>x.id!==id);
    const up = {what:`Sent ${v.t.replace(' payout','’s payout').replace('’s Panadería’s','’s Panadería')} back to ${v.by}`, by:'You', when:'Just now', go:v.go, mine:true};
    S.updates.unshift(up); closeP(); render();
    toast(`Sent back to ${v.by}`, {label:'Undo', fn:()=>{ S.waiting.splice(at,0,w); S.updates = S.updates.filter(u=>u!==up); render(); }});
  }
  function step(d){ const list = queue(); if (!list.length) return; const i = list.findIndex(x=>x.id===HS.cur); openP(list[(i+d+list.length)%list.length].id); }

  document.addEventListener('click', e => {
    const t = e.target.closest('[data-hrev],[data-hclose],[data-hqf],[data-hgo-step],[data-hfinish],[data-hsec],[data-hgo]'); if (!t) return;
    if (t.dataset.hclose !== undefined) return closeP();
    if (t.dataset.hgoStep) return runP(t.dataset.hgoStep);
    if (t.dataset.hfinish) return finishP(t.dataset.hfinish);
    if (t.dataset.hsec) return sendBack(t.dataset.hsec);
    if (t.dataset.hqf){ HS.qf = t.dataset.hqf; return render(); }
    if (t.dataset.hgo==='alerts'){ S.ibx.f = 'alerts'; return go('waiting'); }
    if (t.dataset.hrev){ e.stopPropagation(); return openP(t.dataset.hrev); }
  });
  document.addEventListener('keydown', e => {
    if (!document.body.classList.contains('h-pn') || document.querySelector('.modal')) return;
    if (e.key==='Escape'){ e.stopImmediatePropagation(); return closeP(); }
    if (HS.busy || /INPUT|TEXTAREA/.test((document.activeElement||{}).tagName||'')) return;
    if (e.key==='j' || e.key==='J'){ e.preventDefault(); step(1); }
    if (e.key==='k' || e.key==='K'){ e.preventDefault(); step(-1); }
  }, true);
  document.addEventListener('mouseover', e => { if (S.route!=='home') return;
    const tl = e.target.closest('.h-tl'); const t = tl && e.target.closest('[data-hk]'); const ks = t ? t.dataset.hk.split(',') : [];
    document.querySelectorAll('.h-tl [data-hk]').forEach(x=>x.classList.toggle('on', ks.length>0 && x.dataset.hk.split(',').some(k=>ks.includes(k)))); });

  function html(){
    const ro = vRO();
    if (!ro && HS.cur && !S.waiting.some(w=>w.id===HS.cur) && !HS.busy) { HS.cur = null; document.body.classList.remove('h-pn'); }
    return `<div class="h-home">${header()}
      ${ro ? '' : `<section class="h-band"><div class="h-bento">${needsCell()}${headsCell()}</div></section>`}
      <section class="h-band">${pulse()}</section>
      <section class="h-band">${timeline()}</section></div>`;
  }
  function mount(){
    if (S.route!=='home'){ if (HS.ro){ HS.ro.disconnect(); HS.ro = null; } if (!HS.busy){ document.body.classList.remove('h-pn'); HS.cur = null; } return; }
    HS.lastW = 0; drawTimeline(true);
    if (HS.ro) HS.ro.disconnect();
    const host = document.getElementById('h-ax');
    if (host && typeof ResizeObserver !== 'undefined'){ HS.ro = new ResizeObserver(() => requestAnimationFrame(()=>drawTimeline())); HS.ro.observe(host); }
  }
  return { html, mount };
})();
function home(){ return HOME.html(); }

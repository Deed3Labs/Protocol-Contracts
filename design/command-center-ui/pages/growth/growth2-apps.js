
/* ══ Apps: what do members and merchants do once they're in? ═════════════════════════
   The member app (invite-only since 15 Sep) and the merchant app (tablet, partner shops).
   Daily active counts follow activations and shops going live, so they agree with Cohorts and Merchants.
   Events are first-party: Umami custom events plus Clear's own records. No session replay. */
const APPS = { member:{ n:'Member app', col:'var(--fg)' }, merchant:{ n:'Merchant app', col:'var(--land)' } };
const AS = { feat:'member' };
// cumulative activated members by day, and shops live by day (12 transacting by today)
const actByDay = d => { let s = 0; COH.forEach(c => { if (d >= c.d) s += cum(c, Math.min(d - c.d, TODAY - c.d)) * c.inv; }); return s; };
const shopsByDay = d => d < 44 ? 0 : Math.min(12, Math.round(2 + (d-44) * 10/34));
const dau = d => { const dow = dayDate(d).getDay(), w = dow===0 ? .78 : dow===6 ? .9 : 1; const r = rng(d*7+3)(); return { m: actByDay(d) * (.52 + r*.08) * w, s: shopsByDay(d) * (dow===0 ? .55 : .85 + r*.1) }; };
const FEAT = {
  member:[['Check balance',96,'Opened the home screen'],['Pay at a shop',81,'Clear Pay QR at a partner'],['Move money',54,'In or out of Clear'],['Savings and Earn',22,'Opened or added to savings'],['Invite a friend',18,'Shared a referral code'],['Term plans',9,'Looked at or picked a plan'],['Shop',6,'Bought merch in the app']],
  merchant:[['Take a payment',100,'Charged a member'],['Check payouts',75,'Opened payouts'],['Scan a $10',67,'Redeemed a member’s $10'],['Manage staff',33,'Added or edited staff'],['Refund',17,'Refunded a payment'],['Order hardware',8,'Asked for a counter device']] };
const ONB = [['Opened the invite',188],['Created an account',171],['Verified ID',152],['Funded: bank, $5 or direct deposit',124],['First $10 spend',109]];
const ERRS = [
  { t:'Bank link fails on Samsung Internet', app:'member', n:14, sev:'absent', own:'Dana Ruiz is on it', prog:[3,5] },
  { t:'QR scan is slow in low light', app:'merchant', n:9, sev:'underway', own:'Fix ships Thursday', prog:null },
  { t:'ID check times out on older phones', app:'member', n:6, sev:'underway', own:null, prog:null },
  { t:'Payout email lands in spam', app:'merchant', n:4, sev:'underway', own:'Marcus Lee is on it', prog:null },
  { t:'Balance shows $0 for a second on open', app:'member', n:3, sev:'live', own:null, prog:null } ];

function renderApps(){
  const el = document.getElementById('ap');
  let mult = 1; if (S.F.city.size) mult *= share('city')[4] || 0; if (S.F.source.size) mult *= share('source')[4] || 0;
  const [a,b] = S.range, A0 = Math.max(a, 42);
  const days = []; for (let d=A0; d<=b; d++) days.push(d);
  const live = days.length > 0;
  const dv = days.map(d => { const x = dau(d); return { d, m:x.m*mult, s:x.s }; });
  const avg = k => dv.length ? dv.reduce((s,x)=>s+x[k],0)/dv.length : 0;
  const last7 = dv.slice(-7), wauM = Math.round(actByDay(b) * .79 * mult), dauM = last7.length ? last7.reduce((s,x)=>s+x.m,0)/last7.length : 0;
  const stick = wauM ? dauM / wauM * 100 : 0;
  const shopsLive = shopsByDay(b);

  document.getElementById('hdr').innerHTML = `<span class="when"><span class="dot"></span>Growth · Apps · Demo data</span>
    <p class="brief">${live ? `About ${fmt(dauM)} members open Clear on a typical day, and most of them <a data-ajump="feat">pay at a shop</a>. The biggest drop in onboarding is <a data-ajump="onb">funding the account</a>.` : 'The apps weren’t live yet in this period.'} <span class="q">${perName()}${filterDesc()?' · '+filterDesc():''}.</span></p>
    <div class="strip">
      <div class="sc"><span class="lbl">Active members · this week</span><div class="sc-v">${fmt(wauM)} <small>of ${fmt(actByDay(b)*mult)}</small></div><div class="mb"><i style="width:79%"></i></div><div class="sc-s">79% of activated members</div></div>
      <div class="sc"><span class="lbl">Daily, on average</span><div class="sc-v">${fmt(dauM)} <small>${Math.round(stick)}%</small></div><div class="mb"><i style="width:${stick}%"></i></div><div class="sc-s">of weekly actives, each day</div></div>
      <div class="sc"><span class="lbl">Shops on the merchant app</span><div class="sc-v">${shopsLive} <small>of 30</small></div><div class="mb"><i style="width:${shopsLive/30*100}%;background:var(--land)"></i><i style="left:${shopsLive/30*100}%;width:20%" class="hatch"></i></div><div class="sc-s">6 signing · 19 staff logins</div></div>
      <div class="sc"><span class="lbl">Crash-free sessions</span><div class="sc-v">99.4%</div><div class="mb"><i style="width:99.4%;background:var(--settled)"></i></div><div class="sc-s">${ERRS.length} open issues · ${ERRS.filter(e=>!e.own).length} with no owner</div></div>
    </div>`;
  if (!live){ el.innerHTML = `<div class="bento"><div class="cell s12"><div class="bk-empty">The member app opened to the first batch on 15 Sep. <button class="clear" data-per="all">Show since launch</button></div></div></div>`; return; }

  /* daily active: members and shops side by side; weekly view averages the days */
  const n = days.length, gran = S.gran==='auto' ? (n<=21 ? 'day' : 'week') : S.gran;
  const bk = []; if (gran==='day') dv.forEach(x=>bk.push([x.d,x.d,[x]])); else for (let e=dv.length-1; e>=0; e-=7){ const g = dv.slice(Math.max(0,e-6), e+1); bk.unshift([g[0].d, g[g.length-1].d, g]); }
  const bm = bk.map(([x,y,g]) => ({ x, y, m:g.reduce((s,v)=>s+v.m,0)/g.length, s:g.reduce((s,v)=>s+v.s,0)/g.length }));
  const raw = Math.max(5, ...bm.map(v=>v.m)), mag = Math.pow(10, Math.floor(Math.log10(raw))), step = [1,2,2.5,5,10].map(x=>x*mag).find(s=>raw/s<=4) || mag*10, ymax = Math.ceil(raw*1.12/step)*step;
  const ticks = []; for (let v=0; v<=ymax+1e-9; v+=step) ticks.push(v);
  const every = bm.length <= 12 ? 1 : Math.ceil(bm.length/8);
  const chart = `<div class="tfc"><div class="bc-y">${ticks.map(v=>`<span style="bottom:${v/ymax*100}%">${fmt(v)}</span>`).join('')}</div>
    <div class="bc-p">${ticks.map(v=>`<i class="bc-g" style="bottom:${v/ymax*100}%"></i>`).join('')}
      <div class="bc-cols ${bm.length>16?'dense':''}">${bm.map((v,i)=>`<div class="bc-c ap-c" title="${gran==='day'?dFmt(v.y):'Week of '+dFmt(v.x)} · ${fmt(v.m)} members · ${fmt(v.s)} shops a day">
        <div class="ap-pair"><i style="height:${v.m/ymax*100}%;background:var(--fg)"></i><i style="height:${v.s/ymax*100}%;background:var(--land)"></i></div>
        <span class="bc-x ${i%2?'odd':''}">${i%every===0||i===bm.length-1 ? (gran==='day'?dFmt(v.y):dFmt(v.x)) : ''}</span></div>`).join('')}</div></div></div>`;

  /* features: share of active users who used each, for the chosen app */
  const F = FEAT[AS.feat], fcol = APPS[AS.feat].col;
  const feats = `<div class="ft2">${F.map(([nm,p,s])=>`<div class="ft2-r"><span class="ft2-n"><b>${nm}</b><span>${s}</span></span><span class="shb"><i style="width:${p}%;background:${fcol}"></i></span><b class="ft2-p">${p}%</b></div>`).join('')}</div>`;

  /* onboarding: each step's count, and what fell off between steps */
  const om = ONB[0][1]; let worst = 0, wi = 0; ONB.forEach((s,i)=>{ if (i && ONB[i-1][1]-s[1] > worst){ worst = ONB[i-1][1]-s[1]; wi = i; } });
  const onb = `<div class="ob">${ONB.map(([nm,v],i)=>{ const vv = v*mult, drop = i ? (ONB[i-1][1]-v)*mult : 0;
    return `${i?`<div class="ob-d ${i===wi?'hot':''}"><span>−${fmt(drop)}</span>${i===wi?'<em>Biggest drop</em>':''}</div>`:''}<div class="ob-r"><span class="ob-n">${nm}</span><span class="ob-b"><i style="width:${v/om*100}%;${i===ONB.length-1?'background:var(--fg)':''}"></i></span><b>${fmt(vv)}</b><span class="ob-p">${p1(v/om*100)}</span></div>`; }).join('')}</div>`;

  /* issues: Home's list rule */
  const errs = ERRS.length ? `<div class="isl"><div class="al">${ERRS.map(e=>`<div class="alr"><div class="al-m"><div class="al-t"><i class="sv" style="background:var(--${e.sev})"></i><b>${e.t}</b><span class="age">${e.n} sessions</span></div><span class="m">${APPS[e.app].n}</span></div>
      <div class="own ${e.own?'':'none'}"><span class="who">${e.own || 'Nobody’s on it'}</span>${e.prog?`<span class="pg"><i><b style="width:${e.prog[0]/e.prog[1]*100}%"></b></i>${e.prog[0]}/${e.prog[1]}</span>`:e.own?'':'<button class="lnk">Assign →</button>'}</div></div>`).join('')}</div></div>` : `<div class="bk-empty">No open issues.</div>`;

  el.innerHTML = `
  <section class="band" style="margin-top:0"><div class="bento">
    <div class="cell s8"><div class="hd"><h2>Active each day</h2><div class="r"><span class="lbl">${gran==='week'?'Daily average, by week':'By day'}</span><div class="seg sm" role="group" aria-label="Granularity">${[['auto','Auto'],['day','Daily'],['week','Weekly']].map(([k,t])=>`<button data-gran="${k}" aria-pressed="${S.gran===k}">${t}</button>`).join('')}</div></div></div>
      ${chart}
      <div class="tr-k"><span><i style="background:var(--fg);width:10px;height:10px"></i>Members on the member app</span><span><i style="background:var(--land);width:10px;height:10px"></i>Shops on the merchant app</span></div>
      <button class="foot" data-tab="cohorts"><span>Grows with every batch that activates</span><span>Cohorts →</span></button></div>
    <div class="cell s4" id="onb"><div class="hd"><h2>Onboarding</h2><div class="r"><span class="lbl">Member app · all invites</span></div></div>${onb}
      <button class="foot" data-go="members"><span>${fmt(64*mult)} stuck at funding</span><span>Nudge in Members →</span></button></div>
  </div></section>

  <section class="band"><div class="bento">
    <div class="cell s7" id="feat"><div class="hd"><h2>What they use</h2><div class="r"><div class="seg sm" role="group" aria-label="App">${Object.entries(APPS).map(([k,v])=>`<button data-afeat="${k}" aria-pressed="${AS.feat===k}">${v.n}</button>`).join('')}</div></div></div>${feats}
      <div class="bk-ft"><span>Share of this week’s active ${AS.feat==='member'?'members':'shops'} who used each</span><span></span></div></div>
    <div class="cell s5"><div class="hd"><h2>Issues</h2><div class="r"><span class="lbl">${ERRS.length} open · ${ERRS.filter(e=>!e.own).length} with no owner</span></div></div>${errs}
      <button class="foot"><span>Error log</span><span>→</span></button></div>
  </div></section>

  <div class="src-note"><span><b>Source:</b> first-party events from both apps (Umami custom events) and Clear’s own records. No session recording, nothing sold or shared.</span><button class="btn" style="height:32px">Add a data source</button></div>`;
}

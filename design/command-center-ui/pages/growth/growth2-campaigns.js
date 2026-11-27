
/* ══ Campaigns: what did we do, and what did it get us? ══════════════════════════════
   A campaign is labelled traffic (UTM tags, poster QR codes, referral codes) plus what it cost.
   Numbers are the 30-day base and scale with the period by how much of each campaign's run falls
   inside it. Visits and joins tie back to Traffic's channels and Overview's funnel; "Untagged" is the rest. */
const CAMPS = [
  { id:'pa', n:'The neighbor', sub:'Poster design A', type:'Posters', start:14, end:null, posters:41,
    print:98.40, offer:440, ads:0, credit:0, f:[2011,501,116,73,49,44], utm:'qr · poster · design-a', note:'Neighbor photo, “Your shop is part of this.”' },
  { id:'pb', n:'$10 on us', sub:'Poster design B', type:'Posters', start:21, end:null, posters:38,
    print:91.20, offer:400, ads:0, credit:0, f:[2104,465,107,67,45,40], utm:'qr · poster · design-b', note:'Leads with the $10 to spend at this shop.' },
  { id:'pc', n:'The map', sub:'Poster design C', type:'Posters', start:42, end:null, posters:23,
    print:55.20, offer:130, ads:0, credit:0, f:[697,140,32,20,14,13], utm:'qr · poster · design-c', note:'Map of partner shops nearby.' },
  { id:'rl', n:'Co-op reels', sub:'Instagram + TikTok, organic', type:'Social', start:28, end:null,
    print:0, offer:0, ads:0, credit:0, f:[2640,31,7,5,2,2], utm:'social · reel · coop-reels', note:'Weekly 30-second reels. Time only, no spend.' },
  { id:'nd', n:'Nextdoor posts', sub:'Neighborhood posts, organic', type:'Social', start:35, end:null,
    print:0, offer:0, ads:0, credit:0, f:[1710,18,4,3,1,1], utm:'social · post · nextdoor', note:'One post per neighborhood every two weeks.' },
  { id:'ig', n:'Instagram test ads', sub:'Paid · Redlands + San Bernardino', type:'Ads', start:63, end:77,
    print:0, offer:0, ads:300, credit:0, f:[1410,22,5,3,1,1], utm:'paid · instagram · test-1', note:'Two-week test, $300 budget, ended 20 Oct.' },
  { id:'rf', n:'Member referrals', sub:'Codes, $5 credit when activated', type:'Referrals', start:56, end:null,
    print:0, offer:0, ads:0, credit:45, f:[380,38,9,7,9,6], utm:'referral · code', note:'Members share a code; $5 credit when their invitee activates.' } ];
const UNTAGGED = { n:'Untagged', sub:'Direct, search and links without tags', f:[25458,87,20,10,3,2] };
const TYPE_COL = { Posters:'var(--live)', Social:'var(--land)', Ads:'var(--underway)', Referrals:'var(--fg)' };
const CS = { sort:'joins', open:null };
const spendOf = c => c.print + c.offer + c.ads + c.credit;

/* period scaling: the share of each campaign's 30-day result that falls in the chosen range */
function campScaled(){
  const [a,b] = S.range, P = factor(a,b), base = [TODAY-29, TODAY];
  const ov = (s,e,x,y) => Math.max(0, Math.min(e,y) - Math.max(s,x) + 1);
  let mult = 1; if (S.F.city.size){ const sh = share('city'); mult = sh[1] || 0; }
  const typeOk = c => {
    if (S.F.design.size) return c.type==='Posters' && [...S.F.design].some(d => d.startsWith(c.sub.slice(-1)));
    if (S.F.shop.size) return c.type==='Posters';
    if (S.F.source.size) return [...S.F.source].some(s => s==='Posters' ? c.type==='Posters' : s==='Social' ? (c.type==='Social'||c.type==='Ads') : s==='Direct' ? c.type==='Referrals' : false);
    return true; };
  return CAMPS.filter(typeOk).map(c => {
    const end = c.end ?? TODAY, inBase = ov(c.start,end,...base) || 1, inR = ov(c.start,end,a,b);
    const dayK = inR / inBase;
    // each step scales by the site's own daily shape over the days this campaign ran, so growth and start dates both count
    const vv = c.f.map((x,i)=> { const den = sumR(i, Math.max(c.start, base[0]), Math.min(end, base[1])); const num = sumR(i, Math.max(c.start, a), Math.min(end, b)); return Math.round(x * (den ? num/den : dayK) * mult); });
    const sp = { print: c.start>=a && c.start<=b ? c.print : (S.per==='all' ? c.print : c.print * dayK), offer: c.offer * dayK * mult, ads: c.ads * dayK, credit: c.credit * dayK * mult };
    return { ...c, v: vv, sp, spend: sp.print + sp.offer + sp.ads + sp.credit, inR };
  }).filter(c => c.inR > 0);
}

function renderCampaigns(){
  const rows = campScaled();
  const J = rows.reduce((s,c)=>s+c.v[1],0), SP = rows.reduce((s,c)=>s+c.spend,0), ACT = rows.reduce((s,c)=>s+c.v[4],0);
  const OFFER = rows.reduce((s,c)=>s+c.sp.offer,0), T = totals();
  const cpj = J ? SP/J : 0;
  const posters = rows.filter(c=>c.type==='Posters'), pJ = posters.reduce((s,c)=>s+c.v[1],0), pS = posters.reduce((s,c)=>s+c.spend,0);
  const ads = rows.find(c=>c.id==='ig');
  const money = v => '$' + v.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  const money0 = v => '$' + Math.round(v).toLocaleString('en-US');

  document.getElementById('hdr').innerHTML = `<span class="when"><span class="dot"></span>Growth · Campaigns · Demo data</span>
    <p class="brief">Campaigns cost ${money(SP)} and brought ${fmt(J)} joins, ${money(cpj)} each.${pJ ? ` Posters are the cheapest at about ${money(pS/pJ)} a join` : ''}${ads && ads.v[1] ? `; the <a data-camp="ig">Instagram test ads</a> cost ${money(ads.spend/ads.v[1])} a join.` : '.'} <span class="q">${perName()}${filterDesc()?' · '+filterDesc():''}.</span></p>
    <div class="strip">
      <div class="sc"><span class="lbl">Spent · ${perName()}</span><div class="sc-v"><span>${money0(SP)}<span class="ct">.${(SP%1).toFixed(2).slice(2)}</span></span></div>
        <div class="mb">${(() => { let x = 0; return [['offer','var(--live)'],['print','var(--fg)'],['ads','var(--underway)'],['credit','var(--land)']].map(([k,col])=>{ const t = rows.reduce((s,c)=>s+c.sp[k],0), w = SP ? t/SP*100 : 0, h = `<i style="left:${x}%;width:${w}%;background:${col}"></i>`; x += w; return h; }).join(''); })()}</div>
        <div class="sc-s">${SP ? Math.round(OFFER/SP*100) : 0}% is the $10 offer, spent in shops</div></div>
      <div class="sc"><span class="lbl">Joins from campaigns</span><div class="sc-v">${fmt(J)} <small>${T[1] ? Math.round(J/T[1]*100) : 0}%</small></div>
        <div class="mb"><i style="width:${T[1] ? J/T[1]*100 : 0}%"></i></div><div class="sc-s">of all joins carry a campaign tag</div></div>
      <div class="sc"><span class="lbl">Cost per join</span><div class="sc-v"><span>$${Math.floor(cpj)}<span class="ct">.${(cpj%1).toFixed(2).slice(2)}</span></span></div>
        <div class="mb"><i style="width:${Math.min(100, cpj/5*100)}%"></i></div><div class="sc-s">${ACT ? money(SP/ACT) : '—'} per activated member</div></div>
      <div class="sc"><span class="lbl">Live campaigns</span><div class="sc-v">${CAMPS.filter(c=>!c.end).length} <small>of ${CAMPS.length}</small></div>
        <div class="units cmp-u">${CAMPS.map(c=>`<i style="background:${c.end?'none':TYPE_COL[c.type]};box-shadow:${c.end?'inset 0 0 0 1.5px var(--fg-50)':'none'}"></i>`).join('')}</div><div class="sc-s">Instagram test ended 20 Oct</div></div>
    </div>`;

  /* calendar: one lane per campaign on the shared day grid; joins a day underneath so lift lines up with launches */
  const [a,b] = S.range, n = b-a+1;
  const showA = Math.max(0, a), cols = b - showA + 1;
  const X = d => (Math.max(showA, Math.min(b+1, d)) - showA) / cols * 100;
  const months = []; for (let d=showA; d<=b; d++){ const dt = dayDate(d); if (d===showA || dt.getDate()===1) months.push([d, dt.toLocaleString('en',{month:'long'})]); }
  const dayTicks = []; const stepD = cols <= 10 ? 1 : cols <= 40 ? 7 : 14; for (let d=b; d>=showA; d-=stepD) dayTicks.unshift(d);
  const jd = []; for (let d=showA; d<=b; d++) jd.push(DAILY[1][d]); const jmx = Math.max(...jd, 1);
  const lanes = CAMPS.map(c => {
    const r = rows.find(x=>x.id===c.id), end = c.end ?? TODAY, vis = end >= showA && c.start <= b;
    const x0 = X(c.start), x1 = X(end+1), cut = c.start < showA;
    return `<div class="cg2-l ${CS.open===c.id?'on':''}" data-camp="${c.id}"><span class="cg2-n"><i style="background:${TYPE_COL[c.type]}"></i><b>${c.n}</b><span>${c.type}</span></span>
      <span class="cg2-t">${vis ? `<span class="cg2-bar ${c.end?'ended':''} ${cut?'cut':''}" style="left:${x0}%;width:${Math.max(.8,x1-x0)}%;--c:${TYPE_COL[c.type]}"><span class="cg2-bl">${cut ? '← ' : ''}${r ? fmt(r.v[1])+' joins' : ''}${c.end ? ' · ended '+dFmt(c.end) : ''}</span></span>` : `<span class="cg2-none">${c.start > b ? 'Starts '+dFmt(c.start) : 'Not running in this period'}</span>`}</span></div>`; }).join('');
  // month band: one segment per month in view, alternating tint, label inside; Mondays as faint guides through every lane
  const mSegs = months.map(([d,m],i)=>{ const nx = months[i+1] ? months[i+1][0] : b+1; return `<span class="cg2-ms ${i%2?'alt':''}" style="left:${X(d)}%;width:${X(nx)-X(d)}%"><b>${m}</b></span>`; }).join('');
  const guides = []; for (let d=showA; d<=b; d++) if (dayDate(d).getDay()===1) guides.push(`<i style="left:${(d-showA)/cols*100}%"></i>`);
  const nowX = ((TODAY-showA+.5)/cols*100).toFixed(3);
  const cal = `<div class="cg2">
    <div class="cg2-hd"><span></span><span class="cg2-t"><span class="cg2-mb">${mSegs}</span>${dayTicks.map(d=>`<span class="cg2-dt ${d===TODAY?'td':''}" style="left:${(d-showA+.5)/cols*100}%">${d===TODAY?'Today':dayDate(d).getDate()}</span>`).join('')}</span></div>
    <div class="cg2-body"><span></span><span class="cg2-gd">${guides.join('')}<i class="cg2-now" style="left:${nowX}%"></i></span></div>
    ${lanes}
    <div class="cg2-l cg2-j"><span class="cg2-n"><b>All joins a day</b><span>for lift</span></span><span class="cg2-t"><span class="cg2-jb">${jd.map((v,i)=>`<i style="left:${i/cols*100}%;width:${100/cols}%;height:${Math.max(2,v/jmx*100)}%"></i>`).join('')}</span></span></div></div>`;

  /* table: one row per campaign, untagged at the bottom; cost per join drawn so lower reads as better */
  const key = CS.sort, sorted = rows.slice().sort((x,y)=> key==='cpj' ? ((x.v[1]?x.spend/x.v[1]:1e9)-(y.v[1]?y.spend/y.v[1]:1e9)) : key==='spend' ? y.spend-x.spend : key==='visits' ? y.v[0]-x.v[0] : y.v[1]-x.v[1]);
  const maxC = 5;
  const th = (k,t,cls='') => `<th data-csort="${k}" class="${CS.sort===k?'s':''} ${cls}">${t}${CS.sort===k?' ↓':''}</th>`;
  // two groups: what it got (results) and what it cost; cost per join closes the row as the punchline
  const table = `<div class="bt-wrap"><table class="bt cp">
    <colgroup><col style="width:27%"><col style="width:10%"><col style="width:9%"><col style="width:8%"><col style="width:9%"><col style="width:17%"><col style="width:8%"><col style="width:12%"></colgroup>
    <thead><tr><th class="c-nm">Campaign</th>${th('spend','Spent')}${th('visits','Visits')}${th('joins','Joins')}<th>Join rate</th>${th('cpj','Cost per join')}<th>Activated</th><th>$10 redeemed</th></tr></thead><tbody>
    ${sorted.map(c=>{ const cj = c.v[1] ? c.spend/c.v[1] : null;
      return `<tr data-camp="${c.id}" class="${CS.open===c.id?'sel':''}"><td class="tn"><span class="cp-n"><i class="swt" style="background:${TYPE_COL[c.type]}"></i><b>${c.n}</b>${c.end?'<em class="chip plain nodot">Ended</em>':''}</span><span class="cp-s">${c.sub}</span></td>
        <td>${c.spend ? money(c.spend) : '<span class="quiet">$0</span>'}</td><td>${fmt(c.v[0])}</td><td><b>${fmt(c.v[1])}</b></td><td class="${pct(c.v[1],c.v[0])>10?'good':''}">${p1(pct(c.v[1],c.v[0]))}</td>
        <td>${cj==null ? '—' : c.spend===0 ? '<span class="cpj"><span class="shb nob"></span><b class="quiet">Free</b></span>' : `<span class="cpj"><span class="shb ${cj>maxC?'over':''}"><i class="${cj>maxC?'lo':''}" style="width:${Math.min(cj,maxC)/maxC*100}%"></i></span><b class="${cj>maxC?'warn':''}">${money(cj)}</b></span>`}</td>
        <td>${fmt(c.v[4])}</td><td>${c.sp.offer ? `<span class="rd"><b>${money0(c.sp.offer)}</b><span>${fmt(c.v[5])} spends</span></span>` : '<span class="quiet">—</span>'}</td></tr>`; }).join('')}
    <tr class="untag"><td class="tn"><span class="cp-n"><i class="swt" style="background:var(--hair);box-shadow:inset 0 0 0 1px var(--fg-50)"></i><b>${UNTAGGED.n}</b></span><span class="cp-s">${UNTAGGED.sub}</span></td><td><span class="quiet">—</span></td><td>${fmt(UNTAGGED.f[0]*factor(a,b)[0])}</td><td>${fmt(UNTAGGED.f[1]*factor(a,b)[1])}</td><td>${p1(pct(UNTAGGED.f[1],UNTAGGED.f[0]))}</td><td><span class="quiet">—</span></td><td>${fmt(UNTAGGED.f[4]*factor(a,b)[4])}</td><td><span class="quiet">—</span></td></tr></tbody></table></div>`;

  /* poster design test */
  const des = rows.filter(c=>c.type==='Posters'), dmax = Math.max(...des.map(c=>pct(c.v[1],c.v[0])), 1);
  const best = des.slice().sort((x,y)=>pct(y.v[1],y.v[0])-pct(x.v[1],x.v[0]))[0];
  const design = des.length ? `<div class="ds">${des.map(c=>{ const r = pct(c.v[1],c.v[0]);
    return `<div class="ds-r ${c===best?'win':''}" data-camp="${c.id}"><div class="ds-h"><span class="ds-ic">${c.sub.slice(-1)}</span><span><b>${c.n}</b><span>${c.posters} posters · ${fmt(c.v[0]/c.posters)} scans each</span></span>${c===best?'<span class="chip ok">Best</span>':''}</div>
      <div class="ds-b"><span class="lbl">Join rate</span><span class="shb"><i style="width:${r/dmax*100}%;background:${c===best?'var(--settled)':'var(--fg)'}"></i></span><b>${p1(r)}</b></div>
      <div class="ds-b"><span class="lbl">Per join</span><span class="shb"><i class="q" style="width:${(c.spend/c.v[1])/2*100}%"></i></span><b>${money(c.spend/c.v[1])}</b></div></div>`; }).join('')}</div>` : '<div class="bk-empty">No poster campaigns match these filters.</div>';

  /* where the money went: a waterfall with the hatched drops from the Shop page */
  const parts = [['$10 offer', rows.reduce((s,c)=>s+c.sp.offer,0), 'Spent at partner shops'], ['Printing', rows.reduce((s,c)=>s+c.sp.print,0), 'Posters, $2.40 each'], ['Ads', rows.reduce((s,c)=>s+c.sp.ads,0), 'Instagram test'], ['Referral credit', rows.reduce((s,c)=>s+c.sp.credit,0), '$5 per activation']].filter(p=>p[1]>0);
  let run = SP; const wmax = SP || 1;
  const wf = `<div class="wf2"><div class="wf2-c"><span class="wf2-v">${money0(SP)}</span><i class="tot" style="height:100%"></i><span class="wf2-l">Spent</span></div>
    ${parts.map(([nm,v,s])=>{ const top = run/wmax*100, h = v/wmax*100; run -= v; return `<div class="wf2-c"><span class="wf2-v" style="bottom:calc(${top}% + 6px)">−${money0(v)}</span><i class="drop" style="bottom:${top-h}%;height:${h}%"></i><span class="wf2-l">${nm}</span><b class="wf2-j" style="bottom:${top-h}%"></b></div>`; }).join('')}</div>
    <div class="wf2-k">${parts.map(([nm,v,s])=>`<div><span>${nm}</span><span class="quiet">${s}</span><b>${SP ? Math.round(v/SP*100) : 0}%</b></div>`).join('')}</div>`;

  document.getElementById('cp').innerHTML = `
  <section class="band" style="margin-top:0"><div class="bento"><div class="cell s12">
    <div class="hd"><h2>What ran when</h2><div class="r"><span class="lbl">${perName()} · click a campaign for its detail</span><button class="btn" style="height:32px" data-newcamp>+ New campaign</button></div></div>
    ${cal}
    <div class="bk-ft"><span>${showA > 42 ? 'Every poster design was up this whole period. Pick <b>Since launch</b> to see what each start did to joins.' : 'Joins jumped the week <b>The map</b> went up; the Instagram test barely moved them.'}</span>${showA > 42 ? '<button data-per="all">Since launch →</button>' : '<span></span>'}</div></div></div></section>

  <section class="band"><div class="bento"><div class="cell s12">
    <div class="hd"><h2>Every campaign</h2><div class="r"><span class="lbl">Cost bars run $0–$5 · click a row for detail</span></div></div>
    ${table}
    <div class="bk-ft"><span><b>${T[1] ? Math.round((T[1]-J)/T[1]*100) : 0}%</b> of joins have no tag. Tagging every link you share makes this table more complete.</span><button data-newcamp>Make a tagged link →</button></div></div></div></section>

  <section class="band"><div class="bento">
    <div class="cell s7"><div class="hd"><h2>Poster design test</h2><div class="r"><span class="lbl">Same offer, different poster</span></div></div>${design}
      <div class="bk-ft"><span>${best ? `<b>${best.n}</b> converts best on the same $10 offer` : ''}</span><button>Plan swaps in Field →</button></div></div>
    <div class="cell s5"><div class="hd"><h2>Where the money went</h2><div class="r"><span class="lbl">${perName()}</span></div></div>${wf}
      <div class="bk-ft"><span><b>${money0(OFFER)}</b> went straight to partner shops as $10 spends</span><span></span></div></div>
  </div></section>`;
  renderCampPanel();
}

/* detail panel: the campaign's own funnel, spend and tags */
function renderCampPanel(){
  let p = document.getElementById('cpanel'), sc = document.getElementById('cscrim');
  if (!p){ sc = document.createElement('div'); sc.id='cscrim'; sc.className='scrim'; document.body.appendChild(sc); p = document.createElement('aside'); p.id='cpanel'; p.className='panel'; document.body.appendChild(p); }
  if (!CS.open){ document.body.classList.remove('pn'); return; }
  const money = v => '$' + v.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  if (CS.open==='new'){
    p.innerHTML = `<div class="pn-hd"><span class="lbl">New campaign</span><button class="x" data-cclose aria-label="Close"><svg class="i" viewBox="0 0 20 20"><path d="M5 5l10 10M15 5 5 15"/></svg></button></div>
      <div class="pn-b"><h3>Make a tagged link</h3><p class="small quiet" style="margin:0">Every link you share with these tags shows up here as its own campaign.</p>
        <label class="fld"><span class="lbl">Name</span><input id="nc-n" value="Fall farmers market"></label>
        <label class="fld"><span class="lbl">Type</span><select id="nc-t"><option>Social</option><option>Posters</option><option>Ads</option><option>Referrals</option><option>Event</option></select></label>
        <label class="fld"><span class="lbl">Where it'll be shared</span><input id="nc-s" value="flyer"></label>
        <div class="fld"><span class="lbl">Link</span><code class="lnkc" id="nc-l"></code></div>
        <div class="qr" aria-hidden="true">${Array.from({length:121},(_,i)=>`<i style="background:${(i*37%11+i%7)%3?'var(--fg)':'transparent'}"></i>`).join('')}</div></div>
      <div class="pn-ft"><span class="nx"></span><button class="btn" style="height:40px" data-cclose>Cancel</button><button class="btn p" style="height:40px" data-cclose>Copy link and QR</button></div>`;
    const upd = () => { const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''); document.getElementById('nc-l').textContent = `useclear.org/join?utm_campaign=${slug(document.getElementById('nc-n').value)}&utm_medium=${slug(document.getElementById('nc-t').value)}&utm_source=${slug(document.getElementById('nc-s').value)}`; };
    p.querySelectorAll('input,select').forEach(e=>e.addEventListener('input', upd)); upd();
  } else {
    const c = campScaled().find(x=>x.id===CS.open) || CAMPS.find(x=>x.id===CS.open);
    const v = c.v || c.f, sp = c.sp || {print:c.print, offer:c.offer, ads:c.ads, credit:c.credit}, spend = sp.print+sp.offer+sp.ads+sp.credit;
    const fmax = Math.max(v[0],1), hh = x => 4 + 96*Math.pow(Math.max(x,1)/fmax, .3);
    p.innerHTML = `<div class="pn-hd"><span class="swt" style="width:10px;height:10px;display:inline-block;background:${TYPE_COL[c.type]}"></span><span class="lbl">${c.type}</span>${c.end?'<span class="chip plain nodot">Ended</span>':'<span class="chip ok">Live</span>'}<button class="x" data-cclose aria-label="Close"><svg class="i" viewBox="0 0 20 20"><path d="M5 5l10 10M15 5 5 15"/></svg></button></div>
      <div class="pn-b">
        <div><span class="lbl">${c.sub} · ${dFmt(c.start)} – ${c.end ? dFmt(c.end) : 'now'}</span><h3>${c.n}</h3></div>
        <div class="pn-big"><div><span class="lbl">Cost per join</span><b>${v[1] ? (spend ? money(spend/v[1]) : 'Free') : '—'}</b></div><div><span class="lbl">Joins</span><b>${fmt(v[1])}</b></div></div>
        <div class="pn-fn">${['Visits','Joined','Invited','Opened','Active','Spent $10'].map((s,i)=>`<div><span class="lbl">${s}</span><i style="width:${hh(v[i])}%;background:${i===5?'var(--fg)':TYPE_COL[c.type]};opacity:${i===5?1:.35+.65*(1-i/6)}"></i><b>${fmt(v[i])}</b></div>`).join('')}</div>
        <div class="led">${[['Printing',sp.print],['$10 offer redeemed',sp.offer],['Ads',sp.ads],['Referral credit',sp.credit]].filter(x=>x[1]>0).map(([k,x])=>`<div><span>${k}</span><b>${money(x)}</b></div>`).join('')}<div class="t"><span>Spent</span><b>${money(spend)}</b></div></div>
        ${c.posters ? `<div class="led"><div><span>Posters up</span><b>${c.posters}</b></div><div><span>Scans per poster</span><b>${fmt(v[0]/c.posters)}</b></div></div>` : ''}
        <div class="led"><div><span>Tags</span><b class="mono">${c.utm}</b></div><div><span>Note</span><b>${c.note}</b></div></div>
      </div>
      <div class="pn-ft"><span class="nx"></span><button class="btn" style="height:40px" data-cfilter="${c.id}">Filter Growth to this</button><button class="btn p" style="height:40px" data-cclose>${c.end ? 'Run it again' : 'Edit campaign'}</button></div>`;
  }
  document.body.classList.add('pn');
}

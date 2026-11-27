
/* ══ Traffic: who's coming, from where, on what, and when ═════════════════════════════
   Everything here is what Umami measures: page views, visitors (estimated, no cookies), referrers,
   UTM tags, devices, browsers, cities, pages, events and real-time. 30-day base; the period and
   filters scale it through the same visits figure the funnel uses, so Traffic and Overview agree. */
const PROPS = [ // property, 30-day visits, colour
  ['useclear.org', 24820, 'var(--fg)'], ['Poster pages', 4812, 'var(--live)'], ['Shop', 4236, 'var(--land)'], ['Apps (web)', 2542, 'color-mix(in srgb,var(--fg) 30%,transparent)'] ];
const CHANNELS = [ // channel, 30-day visits, bounce %, join rate %, change, referrers
  ['Direct', 12988, 51, 0.8, 6.2, [['Typed or bookmarked', 9120], ['Untagged links (texts, DMs)', 3868]]],
  ['Social', 10420, 58, 0.6, 18.4, [['instagram.com', 4010, 41.0], ['nextdoor.com', 2400, 22.5], ['facebook.com', 2180, 4.1], ['tiktok.com', 1830, 63.0]]],
  ['Search', 8190, 41, 0.5, 9.8, [['google.com', 7120], ['bing.com', 1070]]],
  ['Posters', 4812, 22, 23.0, 31.6, [['QR scans', 4812]]] ];
const PAGES = [ // path, property, entries, bounce %, avg seconds, joins started here
  ['/join','useclear.org',9600,18,96,1012], ['/','useclear.org',8200,49,64,121], ['/s/:shop','Poster pages',4812,22,41,null],
  ['/how','useclear.org',2900,38,142,74], ['/shop','Shop',2950,44,88,null], ['/shops','useclear.org',1800,40,77,null],
  ['/app','Apps (web)',1820,12,30,null], ['/contribute','useclear.org',1000,46,121,null], ['/housing','useclear.org',820,35,133,58],
  ['/shop/hoodie','Shop',760,52,48,null], ['/merchant','Apps (web)',722,9,25,null], ['/shop/logo-tee','Shop',526,55,41,null], ['/coop','useclear.org',500,42,118,37] ];
const DEV = [['Phone',28545],['Desktop',6590],['Tablet',1275]];
const BROWSERS = [['Safari',15100],['Chrome',14900],['Samsung Internet',3800],['Other',2610]];
const TF_CITY = [['Redlands',11208,33],['San Bernardino',9102,18],['Riverside',6655,13],['Fontana',1850,4],['Rialto',1210,4],['Highland',1120,4],['Loma Linda',1040,4],['Colton',980,4],['Elsewhere',3245,0]];
const W_CH = { Posters:[0,0,180,390,560,720,860,990,1100,1210,1250,1377], Direct:[2100,2150,2230,2310,2400,2520,2640,2760,2880,2900,2960,3204], Social:[900,980,1050,1180,1300,1450,1640,1820,2010,2200,2330,2510], Search:[1200,1230,1260,1300,1360,1420,1500,1560,1630,1700,1699,1815] };
const CH_COL = { Posters:'var(--live)', Direct:'var(--fg)', Social:'var(--land)', Search:'color-mix(in srgb,var(--fg) 30%,transparent)' };
const LIVE = [['/join','Poster · Uptown Barber','Redlands','Phone',0],['/','instagram.com','Riverside','Phone',1],['/s/rosas-panaderia','QR scan','Redlands','Phone',1],['/how','google.com','San Bernardino','Desktop',2],['/shop','Direct','Fontana','Phone',3],['/join','nextdoor.com','Redlands','Phone',4]];
let liveTimer = null;
/* the live view: one square per person on the sites now, grouped by the page they're on, coloured by where they came from */
const LV = { people:[], mins:[], last:null, wk:19 };
(() => { const seed = [['/join','Posters'],['/join','Posters'],['/join','Social'],['/join','Posters'],['/join','Direct'],['/join','Search'],['/join','Posters'],
  ['/','Social'],['/','Direct'],['/','Search'],['/','Social'],['/','Direct'],['/s/:shop','Posters'],['/s/:shop','Posters'],['/s/:shop','Posters'],['/s/:shop','Posters'],
  ['/shop','Direct'],['/shop','Social'],['/shop','Social'],['/how','Search'],['/how','Direct'],['/app','Direct'],['/housing','Search']];
  seed.forEach((p,i)=>LV.people.push({page:p[0], ch:p[1], id:i}));
  const r = rng(77); for (let i=0;i<30;i++) LV.mins.push(Math.round(14 + 8*Math.sin(i/5) + r()*6)); LV.mins[29] = LV.people.length; })();
const LV_PAGES = ['/join','/','/s/:shop','/shop','/how','/app','/housing'];
const LV_FROM = { Posters:['Uptown Barber poster','Rosa’s Panadería poster','Mesa Laundry poster'], Social:['instagram.com','tiktok.com','nextdoor.com'], Search:['google.com'], Direct:['a typed link'] };
const LV_CITY = ['Redlands','San Bernardino','Riverside','Fontana','Colton'];
function renderLive(){
  const el = document.getElementById('live'); if (!el) return;
  const n = LV.people.length, mx = Math.max(...LV.mins, n, 1);
  const groups = LV_PAGES.map(pg => [pg, LV.people.filter(p=>p.page===pg)]).filter(g=>g[1].length).sort((a,b)=>b[1].length-a[1].length);
  const d = n - LV.wk;
  el.innerHTML = `<div class="hd"><h2>Right now</h2><div class="r"><span class="lbl"><span class="dot pulse" style="color:var(--settled)"></span> Live</span></div></div>
    <div class="lv2-top"><span class="big num">${n}</span><span class="lv2-s"><b>on Clear's sites now</b><span class="dl ${d>=0?'up':'dn'}">${d>=0?'+':''}${d} vs this time last week</span></span></div>
    <div class="lv2-m">${LV.mins.map((v,i)=>`<i class="${i===29?'now':''}" style="height:${Math.max(6,v/mx*100)}%"></i>`).join('')}</div>
    <div class="lv2-ax"><span>30 min ago</span><span>Now</span></div>
    <div class="lv2-g">${groups.map(([pg,ps])=>`<div class="lv2-r"><span class="lv2-p">${pg}</span><span class="lv2-u">${ps.map(p=>`<i class="${p.id===LV.last?'new':''}" style="background:${CH_COL[p.ch]}" title="${p.ch}"></i>`).join('')}</span><b>${ps.length}</b></div>`).join('')}</div>
    <div class="lv2-t" id="lvt">${LV.tick || 'Watching for arrivals…'}</div>
    <button class="foot">Open the full live view <span>→</span></button>`;
}
function liveStep(){
  const r = Math.random();
  if (r < .58 || LV.people.length < 14){ const ch = ['Posters','Posters','Social','Direct','Search'][Math.floor(Math.random()*5)];
    const page = ch==='Posters' ? (Math.random()<.6?'/s/:shop':'/join') : LV_PAGES[Math.floor(Math.random()*5)];
    const id = Date.now(); LV.people.push({page, ch, id}); LV.last = id;
    const from = LV_FROM[ch][Math.floor(Math.random()*LV_FROM[ch].length)], city = LV_CITY[Math.floor(Math.random()*LV_CITY.length)];
    LV.tick = `<span class="lv2-dot" style="background:${CH_COL[ch]}"></span><span><b>Just now</b> · someone in ${city} opened <span class="mono">${page}</span> from ${from}</span>`; }
  else { const i = Math.floor(Math.random()*LV.people.length); const p = LV.people.splice(i,1)[0]; LV.last = null; LV.tick = `<span class="lv2-dot" style="background:var(--hair)"></span><span><b>Just now</b> · someone left <span class="mono">${p.page}</span></span>`; }
  LV.mins[29] = LV.people.length;
  if (Math.random() < .2){ LV.mins.shift(); LV.mins.push(LV.people.length); }
  renderLive();
}

const TS = { iso:null, prop:'all', open:new Set(['Social']), heat:'visits', pgSort:'entries' };
const secs = s => `${Math.floor(s/60)}m ${String(s%60).padStart(2,'0')}s`;
function tfScale(){ const T = totals(); return { T, k: T[0] / 36410 }; }
const propShare = () => TS.prop==='all' ? 1 : (PROPS.find(p=>p[0]===TS.prop)[1] / 36410);

function renderTraffic(){
  const { T, k } = tfScale(), ps = propShare(), V = T[0] * ps;
  const chRows = rowsFor('source').map(r => { const c = CHANNELS.find(c=>c[0]===r.n); return { n:r.n, v:r.v[0]*ps, bounce:c[2], join:c[3], chg:c[4], refs:c[5] }; });
  const visitors = V * .69, phone = .784, bounced = chRows.reduce((a,r)=>a + r.v*r.bounce/100, 0) / (V||1);
  const ig = CHANNELS[1][5][0];
  // header
  document.getElementById('hdr').innerHTML = `<span class="when"><span class="dot"></span>Growth · Traffic · Umami, first-party · Demo data</span>
    <p class="brief">${fmt(V)} visits from about ${fmt(visitors)} people, ${Math.round(phone*100)}% on a phone. <a data-ref="tiktok.com">TikTok</a> is the fastest-growing referrer, and <a data-heatjump>Sunday at noon</a> is the busiest hour. <span class="q">${perName()}${filterDesc()?' · '+filterDesc():''}${TS.prop!=='all'?' · '+TS.prop:''}.</span></p>
    <div class="strip">
      <div class="sc"><span class="lbl">Visits · ${perName()}</span><div class="sc-v">${fmt(V)}</div><div class="mb">${PROPS.reduce((acc,p,i)=>{ const w = TS.prop==='all' ? p[1]/36410*100 : (p[0]===TS.prop?100:0); acc.h += `<i style="left:${acc.x}%;width:${w}%;background:${p[2]}"></i>`; acc.x += w; return acc; },{h:'',x:0}).h}</div><div class="sc-s">${TS.prop==='all'?'Across 4 properties':TS.prop}</div></div>
      <div class="sc"><span class="lbl">Visitors · estimated</span><div class="sc-v">${fmt(visitors)}</div><div class="mb"><i style="width:69%"></i><i style="left:69%;width:31%;background:var(--land)"></i></div><div class="sc-s">31% came back more than once</div></div>
      <div class="sc"><span class="lbl">On a phone</span><div class="sc-v">${Math.round(phone*100)}%</div><div class="mb"><i style="width:78.4%"></i><i style="left:78.4%;width:18.1%;background:var(--land)"></i></div><div class="sc-s">Desktop 18% · tablet 4%</div></div>
      <div class="sc"><span class="lbl">Bounced</span><div class="sc-v">${p1(bounced*100)}</div><div class="mb"><i style="width:${bounced*100}%;background:var(--underway)"></i></div><div class="sc-s">Left after one page · posters ${CHANNELS[3][2]}%</div></div>
    </div>`;

  // property switch (Traffic-only lens) + visits over time + live
  const el = document.getElementById('tf');
  const props = `<div class="tf-props seg" role="group" aria-label="Property"><button data-prop="all" aria-pressed="${TS.prop==='all'}">All properties</button>${PROPS.map(p=>`<button data-prop="${p[0]}" aria-pressed="${TS.prop===p[0]}"><i style="background:${p[2]}"></i>${p[0]}</button>`).join('')}</div>`;

  // visits over time, stacked by channel
  const [a,b] = S.range, n = b-a+1, gran = S.gran==='auto' ? (n<=21 ? 'day' : 'week') : S.gran;
  const buckets = []; if (gran==='day') for (let d=a; d<=b; d++) buckets.push([d,d]); else for (let e=b; e>=a; e-=7) buckets.unshift([Math.max(a,e-6), e]);
  const tot0 = sumR(0,a,b) || 1;
  const wkOf = d => Math.max(0, 11 - Math.floor((TODAY-d)/7));
  const chShare = (ch, d) => { const w = wkOf(d), s = W_CH.Posters[w]+W_CH.Direct[w]+W_CH.Social[w]+W_CH.Search[w]; return W_CH[ch][w]/s; };
  const visibleCh = chRows.map(r=>r.n);
  const stacks = buckets.map(([x,y]) => { const out = {}; let tot = 0; visibleCh.forEach(ch => { let v = 0; for (let d=x; d<=y; d++) v += DAILY[0][d]*chShare(ch,d); out[ch] = v; tot += v; }); return {out, tot}; });
  const scaleTo = V / (stacks.reduce((s,x)=>s+x.tot,0) || 1);
  stacks.forEach(s => { Object.keys(s.out).forEach(ch => s.out[ch] *= scaleTo); s.tot *= scaleTo; });
  const pr = prevRange(), prevTot = pr && cmpOn() ? buckets.map(([x,y]) => { const off = n; return sumR(0, x-off, y-off) / tot0 * V; }) : null;
  const isoK = TS.iso && visibleCh.includes(TS.iso) ? TS.iso : null;
  const raw = isoK ? Math.max(5, ...stacks.map(s=>s.out[isoK]), ...(prevTot||[0]).map((v,i)=>v*stacks[i].out[isoK]/(stacks[i].tot||1))) : Math.max(5, ...stacks.map(s=>s.tot), ...(prevTot||[0])), mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1,2,2.5,5,10].map(x=>x*mag).find(s=>raw/s<=4) || mag*10, ymax = Math.ceil(raw*1.18/step)*step;
  const ticks = []; for (let v=0; v<=ymax+1e-9; v+=step) ticks.push(v);
  const every = buckets.length <= 12 ? 1 : Math.ceil(buckets.length/8);
  // each period: last period as a hatched ghost on the left, this period stacked by channel on the right, total on top.
  // Clicking a channel in the key isolates it (the others fade) — the same rows that filter the page below.
  const dense = buckets.length > 16, part = i => gran==='week' && buckets[i][1]-buckets[i][0] < 6;
  const iso = TS.iso && visibleCh.includes(TS.iso) ? TS.iso : null;
  const chart = `<div class="tfc"><div class="bc-y">${ticks.map(v=>`<span style="bottom:${v/ymax*100}%">${fmt(v)}</span>`).join('')}</div>
    <div class="bc-p">${ticks.map(v=>`<i class="bc-g" style="bottom:${v/ymax*100}%"></i>`).join('')}
      <div class="bc-cols ${dense?'dense':''}">${stacks.map((s,i)=>{ const shown = iso ? s.out[iso] : s.tot; const pv = prevTot ? prevTot[i] : null; const ch = pv ? pct(shown - (iso ? pv*(s.out[iso]/s.tot) : pv), iso ? pv*(s.out[iso]/s.tot) : pv) : null;
        return `<div class="bc-c tf-c ${part(i)?'part':''}" tabindex="0" data-tt="${gran==='day'?dFmt(buckets[i][1]):(part(i)?dFmt(buckets[i][0])+' – '+dFmt(buckets[i][1])+' (part week)':'Week of '+dFmt(buckets[i][0]))}|${visibleCh.map(c=>c+':'+Math.round(s.out[c])).join(',')}|${Math.round(s.tot)}|${pv?Math.round(pv):''}">
        <div class="tf-pair">
          ${pv!=null && !dense ? `<div class="tf-gh" style="height:${(iso ? pv*(s.out[iso]/s.tot) : pv)/ymax*100}%"></div>` : ''}
          <div class="tf-st">${(iso?[iso]:visibleCh.slice().reverse()).map(c=>`<i style="height:${s.out[c]/ymax*100}%;background:${CH_COL[c]}"></i>`).join('')}
            ${!dense ? `<span class="tf-tot" style="bottom:${shown/ymax*100}%">${fmt(shown)}${ch!=null&&!part(i)?`<em class="${ch>=0?'up':'dn'}">${ch>=0?'+':''}${ch.toFixed(0)}%</em>`:''}</span>` : ''}</div>
          ${pv!=null && dense ? `<b class="tf-pv" style="bottom:${pv/ymax*100}%"></b>` : ''}
        </div>
        <span class="bc-x ${i%2?'odd':''}">${i%every===0||i===buckets.length-1 ? (gran==='day'?dFmt(buckets[i][1]):dFmt(buckets[i][0])+(part(i)?` · ${buckets[i][1]-buckets[i][0]+1}d`:'')) : ''}</span></div>`; }).join('')}</div>
      <div class="bc-tip" id="tftip" hidden></div></div></div>`;

  // channels with referrers
  // one scale for every bar in the table: share of all visits. A referrer's bar is a slice of its channel's bar,
  // so they line up and nest; "of Social" gives the within-channel share as a second, quieter number.
  const maxS = Math.max(...chRows.map(r=>pct(r.v,V)), 1);
  const chTable = chRows.sort((x,y)=>y.v-x.v).map(r => {
    const open = TS.open.has(r.n), refT = r.refs.reduce((s,x)=>s+x[1],0);
    const refs = open && r.refs.length > 1 ? r.refs.map(([rn,rv,growth]) => { const v = r.v * rv/refT, sAll = pct(v,V);
      return `<tr class="sub" data-ref="${rn}"><td class="tn"><span class="ind">${rn}</span><span class="of">${Math.round(rv/refT*100)}% of ${r.n.toLowerCase()}</span></td><td>${fmt(v)}</td><td><span class="shb thin"><i style="width:${sAll/maxS*100}%;background:${CH_COL[r.n]}"></i></span><span class="shp sub">${p1(sAll)}</span></td><td></td><td></td><td>${growth!=null&&cmpOn()?`<span class="dl up">+${growth.toFixed(1)}%</span>`:''}</td></tr>`; }).join('') : '';
    const canOpen = r.refs.length > 1;
    return `<tr data-row-src="${r.n}" class="${open&&canOpen?'opened':''}"><td class="tn">${canOpen?`<button class="tw" data-twist="${r.n}" aria-expanded="${open}">${open?'−':'+'}</button>`:'<i class="tw-x"></i>'}<i class="swt" style="background:${CH_COL[r.n]}"></i><b>${r.n}</b></td><td>${fmt(r.v)}</td><td><span class="shb"><i style="width:${pct(r.v,V)/maxS*100}%;background:${CH_COL[r.n]}"></i></span><span class="shp">${p1(pct(r.v,V))}</span></td><td>${r.bounce}%</td><td class="${r.join>5?'good':''}">${p1(r.join)}</td><td>${cmpOn()?`<span class="dl ${r.chg>=0?'up':'dn'}">+${r.chg.toFixed(1)}%</span>`:''}</td></tr>${refs}`; }).join('');

  // when: 7×24 heatmap, Sunday noon and weekday evenings
  const days = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const hv = (d,h) => { const ev = Math.exp(-((h-19.5)**2)/6), noon = Math.exp(-((h-12.5)**2)/5), morn = Math.exp(-((h-8)**2)/3)*.35; const night = h<6 ? .04 : 0;
    return d===6 ? .25+noon*1.0+ev*.55+night : d===5 ? .2+noon*.7+ev*.65+night : .12+morn+noon*.35+ev*(d===4?.75:.85)+night; };
  const heatMax = 1.3;
  const heat = `<div class="hmx"><div class="hmx-h"><span></span>${Array.from({length:24},(_,h)=>`<span>${h%3===0?String(h).padStart(2,'0'):''}</span>`).join('')}</div>
    ${days.map((dn,d)=>`<div class="hmx-r"><span>${dn}</span>${Array.from({length:24},(_,h)=>{ const v = Math.min(1, hv(d,h)/heatMax); return `<i class="${hv(d,h) > 0.97 ? 'pk' : ''}" style="background:color-mix(in srgb,var(--fg) ${Math.round(4+v*86)}%,transparent)" title="${dn} ${String(h).padStart(2,'0')}:00 · ${fmt(V/7/24*hv(d,h)/0.42)} visits"></i>`; }).join('')}</div>`).join('')}
    <div class="hmx-k"><span class="pkk"><i class="pk"></i>Busiest hours</span><span>Quiet</span>${[8,30,55,80,90].map(x=>`<i style="background:color-mix(in srgb,var(--fg) ${x}%,transparent)"></i>`).join('')}<span>Busy</span></div></div>`;

  // devices + browsers
  const devT = DEV.reduce((s,d)=>s+d[1],0), brT = BROWSERS.reduce((s,b)=>s+b[1],0);
  const devices = `<div class="dv"><div class="dv-bar">${DEV.map((d,i)=>`<i style="flex:${d[1]};background:${['var(--fg)','var(--land)','color-mix(in srgb,var(--fg) 30%,transparent)'][i]}"></i>`).join('')}</div>
    <div class="dv-k">${DEV.map((d,i)=>`<span><i style="background:${['var(--fg)','var(--land)','color-mix(in srgb,var(--fg) 30%,transparent)'][i]}"></i>${d[0]}<b>${p1(d[1]/devT*100)}</b></span>`).join('')}</div>
    <div class="dv-l"><span class="lbl">Browsers</span>${BROWSERS.map(b=>`<div><span>${b[0]}</span><span class="shb"><i style="width:${b[1]/BROWSERS[0][1]*100}%"></i></span><b>${p1(b[1]/brT*100)}</b></div>`).join('')}</div></div>`;

  // cities
  const cityRows = rowsFor('city').map(r => ({ n:r.n, v:r.v[0]*ps, posters:(TF_CITY.find(c=>c[0]===r.n)||[0,0,0])[2] }));
  const cmax = Math.max(...cityRows.map(c=>c.v),1);
  const cities = cityRows.map(c=>`<div class="cty" data-city="${c.n}"><span class="ct-n">${c.n}</span><span class="shb"><i style="width:${c.v/cmax*100}%"></i></span><b>${fmt(c.v)}</b><span class="ct-p">${c.posters?`${fmt(c.v/c.posters)}/poster`:'no posters'}</span></div>`).join('');

  // pages
  const pg = PAGES.filter(p => TS.prop==='all' || p[1]===TS.prop).map(p => ({ path:p[0], prop:p[1], e:p[2]*k, b:p[3], t:p[4], j:p[5]!=null ? p[5]*k : null }));
  const pgKey = TS.pgSort; pg.sort((x,y)=> pgKey==='bounce' ? y.b-x.b : pgKey==='time' ? y.t-x.t : pgKey==='joins' ? (y.j??-1)-(x.j??-1) : y.e-x.e);
  const pth = (k2,t) => `<th data-pgsort="${k2}" class="${TS.pgSort===k2?'s':''}">${t}${TS.pgSort===k2?' ↓':''}</th>`;
  const pages = `<div class="bt-wrap"><table class="bt pg"><thead><tr><th class="c-nm">Page</th>${pth('entries','Entries')}${pth('bounce','Bounced')}${pth('time','Time on page')}${pth('joins','Joins started')}</tr></thead><tbody>
    ${pg.map(p=>`<tr><td class="tn c-nm"><b class="mono">${p.path}</b><span><i class="swt" style="background:${PROPS.find(x=>x[0]===p.prop)[2]}"></i>${p.prop}</span></td><td>${fmt(p.e)}</td><td class="${p.b>=50?'warn':''}">${p.b}%</td><td>${secs(p.t)}</td><td>${p.j==null?'<span class="quiet small">—</span>':fmt(p.j)}</td></tr>`).join('')}</tbody></table></div>`;

  el.innerHTML = `${props}
  <section class="band" style="margin-top:0"><div class="bento">
    <div class="cell s8"><div class="hd"><h2>Visits over time</h2><div class="r"><span class="lbl">By ${gran}</span><div class="seg sm" role="group" aria-label="Granularity">${[['auto','Auto'],['day','Daily'],['week','Weekly']].map(([k2,t])=>`<button data-gran="${k2}" aria-pressed="${S.gran===k2}">${t}</button>`).join('')}</div></div></div>
      ${chart}
      <div class="tr-k tf-k">${visibleCh.map(ch=>`<button data-iso="${ch}" class="${iso===ch?'on':''} ${iso&&iso!==ch?'off':''}"><i style="background:${CH_COL[ch]};width:10px;height:10px"></i>${ch}</button>`).join('')}${prevTot?`<span class="gh-k"><i class="tf-gh-k"></i>${cmpName()}</span>`:''}${iso?'<button class="clear" data-iso="">Show all</button>':''}</div></div>
    <div class="cell s4" id="live"></div>
  </div></section>

  <section class="band"><div class="bento">
    <div class="cell s12"><div class="hd"><h2>Channels and referrers</h2><div class="r"><span class="lbl">Click a row to filter · + for referrers</span></div></div>
      <div class="bt-wrap"><table class="bt ch"><thead><tr><th class="c-nm">Channel</th><th>Visits</th><th>Share</th><th>Bounced</th><th>Join rate</th><th>${cmpOn()?'Change':''}</th></tr></thead><tbody>${chTable}</tbody></table></div>
      <div class="bk-ft"><span>Posters bring 13% of visits but convert <b>37×</b> better than every other channel combined</span><button data-tab="campaigns">Compare campaigns →</button></div></div>
  </div></section>

  <section class="band"><div class="bento">
    <div class="cell s7" id="heat"><div class="hd"><h2>When they visit</h2><div class="r"><span class="lbl">By hour · ${perName()}</span></div></div>
      ${heat}
      <div class="bk-ft"><span>Busiest: <b>Sunday 12:00–14:00</b> and <b>weekdays 18:00–21:00</b></span><button>Schedule posts for those windows →</button></div></div>
    <div class="cell s5"><div class="hd"><h2>Devices</h2><div class="r"><span class="lbl">${perName()}</span></div></div>${devices}
      <div class="bk-ft"><span>Poster scans are <b>99% phone</b></span><span></span></div></div>
  </div></section>

  <section class="band"><div class="bento">
    <div class="cell s5"><div class="hd"><h2>Where they're from</h2><div class="r"><span class="lbl">City · visits per poster</span></div></div><div class="ct-l">${cities}</div>
      <div class="bk-ft"><span>Riverside gets the most per poster</span><button data-tab="campaigns">Poster placement →</button></div></div>
    <div class="cell s7"><div class="hd"><h2>Pages</h2><div class="r"><span class="lbl">Where visits start · ${TS.prop==='all'?'all properties':TS.prop}</span></div></div>${pages}
      <div class="bk-ft"><span>Pages with <b class="warn">50%+</b> bounced are worth a look</span><span></span></div></div>
  </div></section>

  <div class="src-note"><span><b>Source:</b> Umami, first-party on our servers. No cookies, no ad trackers; visitor counts are estimates and nobody is followed across sites.</span><button class="btn" style="height:32px">Add a data source</button></div>`;

  renderLive(); clearInterval(liveTimer);
  liveTimer = setInterval(() => { if (S.tab!=='traffic' || !document.getElementById('live')) return clearInterval(liveTimer); liveStep(); }, 3200);
}
document.addEventListener('mouseover', e => { const c = e.target.closest('.tf-c'); const tip = document.getElementById('tftip'); if (!tip) return;
  if (!c){ tip.hidden = true; return; }
  const [t, parts, tot, prev] = c.dataset.tt.split('|'); const p = c.parentElement.getBoundingClientRect(), r = c.getBoundingClientRect();
  tip.innerHTML = `<b>${t}</b>${parts.split(',').map(x=>{ const [ch,v] = x.split(':'); return `<span><i style="background:${CH_COL[ch]}"></i>${ch}<em>${fmt(+v)}</em></span>`; }).join('')}<span class="nt">Total<em style="color:var(--fg)">${fmt(+tot)}</em></span>${prev?`<span>${cmpName()}<em>${fmt(+prev)}</em></span>`:''}`;
  tip.hidden = false; const tw = tip.offsetWidth; let x = r.right - p.left + 8; if (x + tw > p.width) x = r.left - p.left - tw - 8; tip.style.left = Math.max(0,x) + 'px'; });

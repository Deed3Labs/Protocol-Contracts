
/* ══ Members: where you deal with people ═════════════════════════════════════════════
   Everyone from the waitlist to active, as one set. Counts match Growth: 1,800 joined, 1,500 waiting,
   300 invited in 12 batches, 188 opened, 124 activated (64 opened but not funded), 109 first $10 spends.
   Names and contacts are masked; every reveal is logged. Account changes need a second person. */
const TODAY = 78;
const dayDate = i => new Date(2026, 7, 4 + i);
const dFmt = i => { const d = dayDate(i); return `${d.getDate()} ${d.toLocaleString('en',{month:'short'})}`; };
const tFmt = jt => { const h = (jt%1)*24, hh = Math.floor(h), mm = Math.floor((h-hh)*60); return `${(hh%12)||12}:${String(mm).padStart(2,'0')}${hh<12?'am':'pm'}`; };
const fmt = n => Math.round(n).toLocaleString('en-US');
const pct = (a,b) => b ? a/b*100 : 0;
const p1 = v => v.toFixed(1) + '%';
function rng(seed){ let s=seed; return () => (s = (s*16807) % 2147483647, (s-1)/2147483646); }

const CITIES = [['Redlands',.31],['San Bernardino',.25],['Riverside',.18],['Fontana',.06],['Highland',.05],['Rialto',.04],['Loma Linda',.04],['Colton',.04],['Yucaipa',.03]];
const SHOPS = [["Rosa’s Panadería",'Redlands'],['Inland Cycle Works','Redlands'],['Uptown Barber','Redlands'],['State St. Books','Redlands'],['Mesa Laundry','San Bernardino'],['La Michoacana','San Bernardino'],['Arrowhead Nails','San Bernardino'],['Citrus Bowl Café','Riverside'],['Orange St. Laundromat','Redlands'],['Redlands Tire & Lube','Redlands']];
const LET = 'ABCDEFGHJKLMNPRSTVWY';
const STAGES = [ // key, label, colour, steps done (of invited · opened · funded · spent)
  ['waiting','On the waitlist','color-mix(in srgb,var(--fg) 14%,transparent)',0],
  ['invited','Invited, not opened','color-mix(in srgb,var(--fg) 34%,transparent)',1],
  ['opened','Opened, not funded','var(--land)',2],
  ['active','Active, no spend yet','color-mix(in srgb,var(--fg) 70%,transparent)',3],
  ['spent','Active and spending','var(--fg)',4] ];
const STG = Object.fromEntries(STAGES.map(s=>[s[0],s]));
const BATCH = [ // batch, invite day, invited, opened, activated, spent
  [1,42,25,16,13,12],[2,49,25,16,13,12],[3,56,25,17,13,12],[4,56,25,17,13,12],[5,63,25,19,13,12],[6,63,25,18,13,11],[7,63,25,18,12,10],
  [8,70,25,17,11,9],[9,70,25,17,10,9],[10,70,25,17,10,8],[11,77,25,8,2,1],[12,77,25,8,1,1] ]; // 300 · 188 · 124 · 109
const FUND = ['Bank','Bank','Bank','$5','$5','Deposit'];

/* build the 1,800 people once */
const PEOPLE = (() => {
  const r = rng(909), out = []; let id = 1;
  const pickCity = () => { let x = r(), a = 0; for (const [c,w] of CITIES){ a += w; if (x < a) return c; } return 'Redlands'; };
  const mk = (joined, extra) => { const city = pickCity(); const src = r() < .824 ? 'Poster' : r() < .5 ? 'Website' : r() < .6 ? 'Social' : 'Search';
    const shopPool = SHOPS.filter(s=>s[1]===city); const shop = src==='Poster' ? (shopPool.length ? shopPool[Math.floor(r()*shopPool.length)][0] : SHOPS[Math.floor(r()*SHOPS.length)][0]) : null;
    const p = { id:'M-'+String(id++).padStart(4,'0'), f:LET[Math.floor(r()*LET.length)], l:LET[Math.floor(r()*LET.length)], city, src, shop, joined,
      phone: r() < .62, notes:[], tags:[], log:[], ...extra };
    p.name = p.f + '•'.repeat(3+Math.floor(r()*4)) + ' ' + p.l + '•'.repeat(2+Math.floor(r()*4)); return p; };
  // the first 300 joined before the posters went up (18 Aug – 13 Sep) and were invited batch by batch
  let jd = 14;
  BATCH.forEach(([b,day,n,o,a,s]) => { for (let i=0;i<n;i++){ jd += .07 + r()*.035;
    const stage = i < s ? 'spent' : i < a ? 'active' : i < o ? 'opened' : 'invited';
    const opened = stage!=='invited' ? day + Math.floor(r()*Math.min(5, TODAY-day+1)) : null;
    const act = (stage==='active'||stage==='spent') ? Math.min(TODAY, opened + Math.floor(r()*6)) : null;
    out.push(mk(Math.floor(jd), { jt:jd, stage, batch:b, invited:day, opened, act, fund: act ? FUND[Math.floor(r()*FUND.length)] : null,
      spentAt: stage==='spent' ? SHOPS[Math.floor(r()*SHOPS.length)][0] : null, app: stage!=='invited',
      lastSeen: act ? TODAY - Math.floor(r()*(r()<.12 ? 24 : 9)) : opened, nudges: stage==='opened' && r()<.5 ? 1 : 0 })); } });
  // the 1,500 waiting: a slow first week, then joins climb from ~40 to 49 a day (Growth's weekly joins)
  // the last seven days are fixed to Growth's 318 joins a week (49 today); the weeks before take the rest of the 1,500
  const LAST7 = [41,43,44,46,47,48,49], perDay = [];
  for (let d=40; d<=TODAY; d++) perDay.push([d, d < 47 ? 9 : d > TODAY-7 ? LAST7[d-(TODAY-6)] : Math.round(42 + (d-47)*2/24)]);
  let short = 1500 - perDay.reduce((s,x)=>s+x[1],0); for (let i=7; short!==0; i = i < perDay.length-8 ? i+1 : 7){ perDay[i][1] += Math.sign(short); short -= Math.sign(short); }
  perDay.forEach(([d,n]) => { for (let k=0;k<n;k++) out.push(mk(d, { jt: d + (8 + r()*13)/24, stage:'waiting', app:false })); });
  out.filter(p=>p.stage==='waiting').sort((a,b)=>a.jt-b.jt).forEach((p,i)=>{ p.pos = i+1; if (i < 25) p.b13 = true; });
  // a couple of records with history, so the panel has something to show
  const ex = out.find(p=>p.stage==='opened'); ex.notes.push({by:'Marcus Lee', at:TODAY-3, t:'Said the bank link kept failing on their phone. Suggested the $5 option.'}); ex.tags.push('Bank link issue'); ex.nudges = 1;
  ex.log.push({at:TODAY-5, t:'Nudged by email · opened it, didn’t act'});
  return out;
})();
const WAITING = PEOPLE.filter(p=>p.stage==='waiting').sort((a,b)=>a.pos-b.pos);
const JOINS = WAITING.filter(p=>p.joined > TODAY-7).length;           // joins this week (~320)
const QUIET = p => p.act && TODAY - p.lastSeen >= 21;
const LEFT = p => p.invited!=null ? 90 - (TODAY - p.invited) : null;
const median = a => { const s = a.slice().sort((x,y)=>x-y); return s.length ? s[Math.floor(s.length/2)] : 0; };

/* state */
const M = { tab:'people', q:'', F:{ city:new Set(), src:new Set(), shop:new Set() }, stage:'all', sort:'joined', page:0, open:null, bopen:null, reveal:new Set(), audit:[],
  b:{ size:25, how:'oldest', cities:new Set(['Riverside']), shops:new Set(), picked:[], pace:50, proposed:false, hq:'' }, b13:'pending',
  ng:'opened', msg:{}, wqx:{}, force:null, when:'now', pv:'push', sent:[], approvals:[], wq:'next' };
const passF = p => (!M.F.city.size || M.F.city.has(p.city)) && (!M.F.src.size || M.F.src.has(p.src)) && (!M.F.shop.size || M.F.shop.has(p.shop));
const cnt = (st, list=PEOPLE) => list.filter(p=>p.stage===st).length;
const fdesc = () => { const p = []; if (M.F.city.size) p.push(M.F.city.size===1?[...M.F.city][0]:M.F.city.size+' cities'); if (M.F.src.size) p.push([...M.F.src].join(' + ')); if (M.F.shop.size) p.push(M.F.shop.size===1?[...M.F.shop][0]:M.F.shop.size+' shops'); return p.join(' · '); };
const waitWeeks = () => Math.ceil(Math.max(0, WAITING.length - (M.b13==='pending'?25:0)) / M.b.pace);
const ICON = {
  x:'<svg class="i" viewBox="0 0 20 20"><path d="M5 5l10 10M15 5 5 15"/></svg>',
  lock:'<svg class="i" viewBox="0 0 20 20" style="width:14px;height:14px;vertical-align:-2px"><path d="M5 9h10v8H5z"/><path d="M7 9V6.5a3 3 0 0 1 6 0V9"/></svg>',
  eye:'<svg class="i" viewBox="0 0 20 20" style="width:14px;height:14px"><path d="M2 10s3-5.5 8-5.5S18 10 18 10s-3 5.5-8 5.5S2 10 2 10z"/><circle cx="10" cy="10" r="2.5"/></svg>',
  warn:'<svg class="i" viewBox="0 0 20 20" style="width:15px;height:15px;flex:none"><path d="M10 3l8 14H2z"/><path d="M10 8v4M10 14v1"/></svg>' };

/* ── header ── */
function renderHdr(){
  const L = PEOPLE.filter(passF), W = L.filter(p=>p.stage==='waiting'), w = W.length, inv = L.length - w, o = cnt('opened',L), act = cnt('active',L)+cnt('spent',L), nev = cnt('invited',L);
  const old = W.filter(p=>TODAY-p.joined>=28).length, med = median(W.map(p=>TODAY-p.joined));
  const byCity = CITIES.map(([c])=>[c, W.filter(p=>p.city===c)]).filter(x=>x[1].length).sort((a,b)=>b[1].length-a[1].length);
  const S = {
    people:`${fmt(L.length)} people have joined. <a data-mtab="nudges">${fmt(o)} opened the app but haven’t funded</a>, and ${fmt(nev)} haven’t opened their invite.`,
    batches: M.b13==='pending' ? `<a data-bjump="b13">Batch 13 is waiting for your approval.</a> At ${M.b.pace} invites a week, someone who joins today waits about ${waitWeeks()} weeks.` : `At ${M.b.pace} invites a week, someone who joins today waits about ${waitWeeks()} weeks. <a data-bjump="b14">Batch 14</a> is next.`,
    nudges:`${fmt(nev)} people never opened their invite and <a data-ng="opened">${fmt(o)} stopped before funding</a>. Push works best: 31–44% act within a week.`,
    waitlist:`${fmt(w)} people are waiting, ${fmt(old)} of them for four weeks or more.${byCity.length>1?` ${byCity[0][0]} has the most, ${fmt(byCity[0][1].length)}.`:''}`
  }[M.tab];
  document.getElementById('hdr').innerHTML = `<span class="when"><span class="dot"></span>Members · Demo data${fdesc()&&M.tab!=='batches'?' · '+fdesc():''}</span><p class="brief">${S}</p>
    <div class="strip">
      <div class="sc"><span class="lbl">Waitlist</span><div class="sc-v">${fmt(w)} <small>+${fmt(JOINS)} this week</small></div><div class="mb"><i style="width:${pct(old,w)}%"></i></div><div class="sc-s">${fmt(old)} waited 4+ weeks · median ${med} days</div></div>
      <div class="sc"><span class="lbl">Invited</span><div class="sc-v">${fmt(inv)} <small>12 batches</small></div><div class="mb"><i style="width:${pct(inv-nev,inv)}%"></i><span class="hroom" style="left:${pct(inv-nev,inv)}%;right:0"></span></div><div class="sc-s">${fmt(nev)} haven’t opened yet</div></div>
      <div class="sc"><span class="lbl">Active</span><div class="sc-v">${fmt(act)} <small>${p1(pct(act,inv))}</small></div><div class="mb"><i style="width:${pct(act,inv)}%"></i><i style="left:${pct(act,inv)}%;width:${pct(o,inv)}%;background:var(--land)"></i></div><div class="sc-s">${fmt(cnt('spent',L))} have spent their $10</div></div>
      <div class="sc"><span class="lbl">Stuck at funding</span><div class="sc-v">${fmt(o)}</div><div class="mb"><i style="width:${pct(o,inv)}%;background:var(--land)"></i></div><div class="sc-s">Opened the app, no money in yet</div></div>
    </div>`;
}

/* ── control bar: search + filters (People, Nudges, Waitlist) ── */
const caret = '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 4.5l3 3 3-3"/></svg>';
const FDEF = { city:['City', CITIES.map(c=>c[0])], src:['Joined from', ['Poster','Website','Social','Search']], shop:['Poster shop', SHOPS.map(s=>s[0])] };
let openMenu = null;
function renderCtl(){
  const el = document.getElementById('ctl'); el.hidden = M.tab==='batches'; if (el.hidden) return;
  const fl = k => { const set = M.F[k], [n,opts] = FDEF[k];
    const label = set.size===0 ? n : set.size===1 ? `${n}: <b>${[...set][0]}</b>` : `${n}: <b>${set.size}</b>`;
    const menu = openMenu===k ? `<div class="menu">${opts.map(o=>`<label><input type="checkbox" data-mf="${k}" value="${o}" ${set.has(o)?'checked':''}><span>${o}</span><span class="n">${fmt(PEOPLE.filter(p=>(k==='city'?p.city:k==='src'?p.src:p.shop)===o).length)}</span></label>`).join('')}<div class="mf"><button data-mfclear="${k}">Clear</button><button data-mfclose>Done</button></div></div>` : '';
    return `<div class="fl"><button class="${set.size?'on':''}" data-mfopen="${k}">${label}${caret}</button>${menu}</div>`; };
  const any = Object.values(M.F).some(s=>s.size);
  el.innerHTML = `<label class="msearch"><svg class="i" viewBox="0 0 20 20"><circle cx="9" cy="9" r="5"/><path d="M13 13l4 4"/></svg><input id="mq" placeholder="Find someone by member ID, city or shop" value="${M.q.replace(/"/g,'&quot;')}"></label>
    ${['city','src','shop'].map(fl).join('')}${any?'<button class="clear" data-mfall>Clear filters</button>':''}`;
}

/* ── People ── */
const PAGE = 12;
const pips = p => { const n = STG[p.stage][3]; return `<span class="pips" title="${n} of 4 steps">${[0,1,2,3].map(i=>`<i class="${i<n?'on':''}" style="${i<n?`background:${STG[p.stage][2]}`:''}"></i>`).join('')}</span>`; };
function stageCell(p){ return `<span class="stg">${pips(p)}${STG[p.stage][1]}</span>`; }
function nextCell(p){
  const left = LEFT(p);
  if (p.stage==='waiting') return p.b13 && M.b13==='pending' ? `<span class="nx2"><b class="tlv">Batch 13</b><span>#${fmt(p.pos)} · needs approval</span></span>` : `<span class="nx2"><b>#${fmt(p.pos)}</b><span>in line · ${p.joined===TODAY?'joined today':'waited '+(TODAY-p.joined)+'d'}</span></span>`;
  if (p.stage==='spent') return `<span class="nx2"><b>Done</b><span>Spent at ${p.spentAt}</span></span>`;
  if (p.stage==='active') return `<span class="nx2"><b>Spend $10</b><span>Funded by ${p.fund==='Deposit'?'direct deposit':p.fund==='$5'?'$5':'bank'}</span></span>`;
  return `<span class="nx2 w"><span class="wrow"><span class="wbar ${left<30?'lo':''}"><i style="width:${(90-left)/90*100}%"></i></span><b class="${left<30?'warn':''}">${left}d left</b></span><span>${p.stage==='invited'?'Open the invite':'Fund the account'}</span></span>`;
}
function renderPeople(){
  const L = PEOPLE.filter(passF);
  const q = M.q.trim().toLowerCase();
  let rows = L.filter(p => M.stage==='all' || (M.stage==='quiet' ? QUIET(p) : p.stage===M.stage)).filter(p => !q || p.id.toLowerCase().includes(q) || p.city.toLowerCase().includes(q) || (p.shop||'').toLowerCase().includes(q));
  const order = {spent:0,active:1,opened:2,invited:3,waiting:4};
  rows.sort((a,b)=> M.sort==='window' ? ((LEFT(a)??999)-(LEFT(b)??999)) || a.pos-b.pos : M.sort==='stage' ? order[a.stage]-order[b.stage] : b.jt-a.jt);
  const pages = Math.max(1, Math.ceil(rows.length/PAGE)); M.page = Math.min(M.page, pages-1);
  const view = rows.slice(M.page*PAGE, M.page*PAGE+PAGE);
  const tot = L.length, quiet = L.filter(QUIET).length;
  const tiles = `<div class="sb-tiles">${STAGES.map(([k,lab,col])=>{ const n = cnt(k,L); return `<button class="sb-t ${M.stage===k?'on':''}" data-mstage="${k}" aria-pressed="${M.stage===k}"><span class="sb-l"><i style="background:${col}"></i>${lab}</span><b>${fmt(n)}</b><span class="sb-p">${p1(pct(n,tot))} of everyone</span></button>`; }).join('')}</div>`;
  document.getElementById('mv').innerHTML = `
  <section class="band" style="margin-top:0"><div class="bento"><div class="cell s12">
    <div class="hd"><h2>${M.stage==='all'?'Everyone':M.stage==='quiet'?'Quiet for 3+ weeks':STG[M.stage][1]}</h2><div class="r">${M.stage!=='all'?'<button class="clear" data-mstage="all">Show everyone</button>':quiet?`<button class="clear" data-mstage="quiet">${quiet} quiet for 3+ weeks</button>`:''}<div class="seg sm" role="group" aria-label="Sort">${[['joined','Newest'],['stage','Stage'],['window','Window left']].map(([k,t])=>`<button data-msort="${k}" aria-pressed="${M.sort===k}">${t}</button>`).join('')}</div></div></div>
    ${tiles}
    <div class="bt-wrap"><table class="bt pp"><colgroup><col style="width:27%"><col style="width:23%"><col style="width:11%"><col style="width:20%"><col style="width:19%"></colgroup>
      <thead><tr><th class="c-nm">Member</th><th style="text-align:left">Stage</th><th>Joined</th><th style="text-align:left">From</th><th>Next</th></tr></thead><tbody>
      ${view.map(p=>{ const shown = M.reveal.has(p.id);
        return `<tr data-mp="${p.id}" class="${M.open===p.id?'sel':''}"><td class="tn"><span class="pn"><b class="${shown?'':'msk'}">${shown ? realName(p) : p.name}</b><span>${p.id} · ${p.city}</span></span></td>
        <td style="text-align:left">${stageCell(p)}${QUIET(p)?'<em class="m-qt">Quiet</em>':''}</td><td>${dFmt(p.joined)}</td><td style="text-align:left" class="fr">${p.src==='Poster'?`<span class="sub">Poster ·</span> ${p.shop}`:p.src}</td>
        <td>${nextCell(p)}</td></tr>`; }).join('') || `<tr><td colspan="5" class="tn"><span class="quiet">Nobody matches.</span></td></tr>`}
      </tbody></table></div>
    <div class="bk-ft"><span>${ICON.lock} Names are masked · showing one is logged in Records</span>
      <span class="pg2"><span>${rows.length ? fmt(M.page*PAGE+1) : 0}–${fmt(Math.min(rows.length,(M.page+1)*PAGE))} of ${fmt(rows.length)}</span><button data-mpage="-1" ${M.page===0?'disabled':''} aria-label="Previous"><svg viewBox="0 0 16 16"><path d="M10 3.5 5.5 8l4.5 4.5"/></svg></button><button data-mpage="1" ${M.page>=pages-1?'disabled':''} aria-label="Next"><svg viewBox="0 0 16 16"><path d="M6 3.5 10.5 8 6 12.5"/></svg></button></span></div>
  </div></div></section>`;
}
const realName = p => { const F = ['Maria','James','Ana','Kevin','Lena','Sam','Tomas','Grace','Rosa','Eli','Nadia','Victor','Diane','Marco','Tasha','Hugo','Iris','Omar','Paula','Wes']; const Lx = ['Torres','Ortiz','Reyes','Walker','Hughes','Nguyen','Brooks','Kim','Alvarez','Vega','Patel','Lopez','Diaz','Price','Young','Stone','Moreno','Wright','Bell','Cruz'];
  return F[LET.indexOf(p.f)%F.length] + ' ' + Lx[LET.indexOf(p.l)%Lx.length]; };

/* member record: side panel */
function ensurePanel(){ let pn = document.getElementById('mpanel');
  if (!pn){ const sc = document.createElement('div'); sc.id='mscrim'; sc.className='scrim'; document.body.appendChild(sc); pn = document.createElement('aside'); pn.id='mpanel'; pn.className='panel mpanel'; document.body.appendChild(pn); }
  return pn; }
function renderPanel(){
  const pn = ensurePanel();
  if (!M.open && !M.nudge && !M.bopen){ document.body.classList.remove('pn'); return; }
  document.body.classList.add('pn');
  if (M.nudge) return renderComposer(pn);
  if (M.bopen) return renderBatchPanel(pn);
  const p = PEOPLE.find(x=>x.id===M.open), shown = M.reveal.has(p.id), left = LEFT(p);
  const steps = [['Joined',p.joined],['Invited',p.invited],['Opened the app',p.opened],[`Funded${p.fund?' · '+(p.fund==='Deposit'?'direct deposit':p.fund==='$5'?'$5':'bank'):''}`,p.act],[`First $10 spend${p.spentAt?' · '+p.spentAt:''}`,p.stage==='spent'?Math.min(TODAY,(p.act||TODAY)+2):null]];
  const pend = M.approvals.filter(a=>a.id===p.id);
  const ch = chanFor(p), inB14 = batchPool().pick.includes(p);
  const place = p.stage!=='waiting' ? `<div><span>Batch</span><b>${p.batch} · sent ${dFmt(p.invited)}</b></div>` : `<div><span>Place in line</span><b>#${fmt(p.pos)} of ${fmt(WAITING.length)}${p.b13&&M.b13==='pending'?' · batch 13':inB14?' · batch 14':''}</b></div>`;
  pn.innerHTML = `<div class="pn-hd"><span class="lbl">${p.id}</span>${stageCell(p)}<button class="x" data-mclose aria-label="Close">${ICON.x}</button></div>
  <div class="pn-b">
    <div class="who3"><h3 class="${shown?'':'msk'}">${shown ? realName(p) : p.name}</h3>
      ${shown ? `<div class="ct3"><span>${realName(p).split(' ')[0].toLowerCase()}@gmail.com</span>${p.phone?'<span>(909) 555-01'+String(LET.indexOf(p.f)).padStart(2,'0')+'</span>':''}</div><span class="lg3">You showed this at ${new Date().toTimeString().slice(0,5)} · logged</span>` : `<button class="btn" style="height:30px;font-size:13px" data-mreveal="${p.id}">${ICON.eye}Show name and contact</button><span class="lg3">Showing is logged in Records</span>`}</div>
    <div class="led"><div><span>City</span><b>${p.city}</b></div><div><span>Joined from</span><b>${p.src==='Poster'?'Poster at '+p.shop:p.src}</b></div><div><span>Reachable by</span><b>${['Email', p.phone?'Text':null, p.app?'Push':null].filter(Boolean).join(' · ')}</b></div>${place}</div>
    <div><span class="lbl">Journey</span><div class="jy">${steps.map(([t,d],i)=>`<div class="jy-r ${d!=null?'done':''} ${d==null && (i===0||steps[i-1][1]!=null)?'next':''}"><i></i><span>${t}</span><b>${d!=null?dFmt(d):d==null && (i===0||steps[i-1][1]!=null)?'Next step':''}</b></div>`).join('')}</div></div>
    ${left!=null && !p.act ? `<div class="w90"><div class="w90-h"><span class="lbl">90-day window</span><b class="${left<30?'warn':''}">${left} days left</b></div><span class="wbar big ${left<30?'lo':''}"><i style="width:${(90-left)/90*100}%"></i></span><span class="small quiet">Closes ${dFmt(p.invited+90)}</span></div>` : ''}
    <div><span class="lbl">Notes and tags</span>
      <div class="tg3">${p.tags.map(t=>`<span class="chip plain nodot">${t}</span>`).join('')}<button class="chip plain nodot addtag" data-maddtag="${p.id}">+ Tag</button></div>
      ${p.notes.map(n=>`<div class="nt3"><p>${n.t}</p><span>${n.by} · ${dFmt(n.at)}</span></div>`).join('') || '<p class="small quiet" style="margin:6px 0 0">No notes yet.</p>'}
      <div class="nt3-in"><textarea id="mnote" rows="2" placeholder="Add a note for the team"></textarea><button class="btn" style="height:32px" data-mnote="${p.id}">Add</button></div></div>
    ${p.log.length||pend.length ? `<div><span class="lbl">History</span>${pend.map(a=>`<div class="hs3 pend"><b>${a.what}</b><span>Proposed by you · waiting for a second person</span></div>`).join('')}${p.log.map(l=>`<div class="hs3"><b>${l.t}</b><span>${dFmt(l.at)}</span></div>`).join('')}</div>` : ''}
  </div>
  <div class="pn-ft mft">
    ${p.stage==='waiting' && !p.b13 ? `<button class="btn ${inB14?'':'p'}" data-mpick="${p.id}" ${inB14?'disabled':''}>${inB14?'In batch 14 ✓':'Add to batch 14'}</button>` : ''}
    ${['invited','opened','active'].includes(p.stage) ? `<button class="btn p" data-mnudge1="${p.id}">Nudge by ${ch}</button>` : ''}
    <div class="more3"><button class="btn" data-mmore aria-expanded="false">More ▾</button><div class="mm3" hidden>
      ${p.invited!=null && !p.act ? `<button data-mprop="Resend the invite|${p.id}">Resend the invite <span>2nd approval</span></button><button data-mprop="Extend the window 30 days|${p.id}">Extend the window 30 days <span>2nd approval</span></button>` : ''}
      ${p.act ? `<button data-mprop="Freeze the account|${p.id}">Freeze the account <span>2nd approval</span></button>` : ''}
      <button data-mprop="Close the account|${p.id}" class="dz">Close the account <span>2nd approval</span></button></div></div>
  </div>`;
}
/* best channel each person has, given what Clear has set up */
const SETUP = { email:true, text:false, push:true };
const chanFor = p => p.app && SETUP.push ? 'push' : p.phone && SETUP.text ? 'text' : 'email';
const CH = { push:'Push', text:'Text', email:'Email' };
const CHCOL = { push:'var(--fg)', email:'color-mix(in srgb,var(--fg) 40%,transparent)', text:'var(--land)' };

/* ── Batches ── */
function batchPool(){
  const W = WAITING.filter(p => !(p.b13 && M.b13==='pending'));
  let pool = W;
  if (M.b.how==='city') pool = W.filter(p=>M.b.cities.has(p.city));
  if (M.b.how==='shop') pool = W.filter(p=>p.shop && M.b.shops.has(p.shop));
  if (M.b.how==='picked') pool = M.b.picked.map(id=>PEOPLE.find(p=>p.id===id));
  const pick = pool.slice(0, M.b.size);
  const last = pick.length ? Math.max(...pick.map(x=>x.pos)) : 0;
  const skipped = M.b.how==='oldest' ? 0 : W.filter(p=>p.pos < last && !pick.includes(p)).length;
  return { W, pick, skipped };
}
const mix = (key, list) => { const m = {}; list.forEach(p=>{ const k = key(p); m[k] = (m[k]||0)+1; }); const e = Object.entries(m).sort((x,y)=>y[1]-x[1]); return e.length>4 ? e.slice(0,3).concat([['Other', e.slice(3).reduce((s,x)=>s+x[1],0)]]) : e; };
const MCOL = ['var(--fg)','var(--land)','color-mix(in srgb,var(--fg) 45%,transparent)','color-mix(in srgb,var(--fg) 20%,transparent)'];
const mixBar = (label, C) => `<div class="mx"><span class="lbl">${label}</span><div class="mb2">${C.map(([k,v],i)=>`<i style="flex:${v};background:${MCOL[i]}" title="${k} ${v}"></i>`).join('')}</div><div class="mk2">${C.map(([k,v],i)=>`<span><i style="background:${MCOL[i]}"></i>${k} <b>${v}</b></span>`).join('')}</div></div>`;
const personRow = (p, extra='') => `<button class="pr3" data-mp="${p.id}"><span class="pr3-n"><b class="msk">${p.name}</b><span>${p.city} · ${p.src==='Poster'?p.shop:p.src}</span></span>${extra}<span class="pr3-w">${TODAY-p.joined}d</span></button>`;

function pipeline(){
  const pace = M.b.pace, per = pace/25, H = 150;
  const byDay = {}; BATCH.forEach(b=>{ (byDay[b[1]] ||= []).push({kind:'sent', b}); });
  const weeks = Object.keys(byDay).map(Number).sort((a,b)=>a-b).map(d=>({ label:dFmt(d), items:byDay[d] }));
  const now = []; if (M.b13!=='back') now.push({kind: M.b13==='approved' ? 'go' : 'b13', n:13}); now.push({kind:'b14', n:14});
  weeks.push({ label:'This week', now:true, items:now });
  let n = 15; for (let w=1; w<=2; w++){ weeks.push({ label:dFmt(TODAY+7*w), fut:true, items: per > 3 ? [{kind:'next', n, many:per}] : Array.from({length:per},()=>({kind:'next', n:n++})) }); if (per>3) n += per; }
  const col = it => {
    if (it.kind==='sent'){ const [b,d,i,o,a,s] = it.b; const seg = (v,c,cls='') => v ? `<i class="${cls}" style="height:${v/25*100}%;${c?'background:'+c:''}"></i>` : '';
      return `<button class="pl-c" data-bopen="${b}" title="Batch ${b} · sent ${dFmt(d)} · ${o} opened · ${a} active · ${s} spent"><span class="pl-v">${a}</span><span class="pl-b">${seg(s,'var(--fg)')}${seg(a-s,'color-mix(in srgb,var(--fg) 62%,transparent)')}${seg(o-a,'var(--land)')}${seg(i-o,'','hatch')}</span><span class="pl-n">${b}</span></button>`; }
    if (it.kind==='b13') return `<button class="pl-c" data-bjump="b13" title="Batch 13 · needs your approval"><span class="pl-v tlv">25</span><span class="pl-b pend"></span><span class="pl-n tlv">13</span></button>`;
    if (it.kind==='go') return `<button class="pl-c" data-bjump="b13" title="Batch 13 · approved, sending tomorrow"><span class="pl-v ok">25</span><span class="pl-b m-go"></span><span class="pl-n">13</span></button>`;
    if (it.kind==='b14'){ const k = batchPool().pick.length; return `<button class="pl-c" data-bjump="b14" title="Batch 14 · planning, ${k} of ${M.b.size}"><span class="pl-v">${M.b.size}</span><span class="pl-b plan"></span><span class="pl-n">14</span></button>`; }
    return `<span class="pl-c fut" title="${it.many?`${it.many} batches`:'Batch '+it.n} at this pace"><span class="pl-v">${it.many?'×'+it.many:''}</span><span class="pl-b ghost"></span><span class="pl-n">${it.many?`${it.n}–${it.n+it.many-1}`:it.n}</span></span>`;
  };
  const ax = `<div class="pl-w pl-ax"><div class="pl-cs"><span class="pl-c"><span class="pl-v">Active</span><span class="pl-b"></span><span class="pl-n">Batch</span></span></div><span class="pl-d">Sent</span></div>`;
  return `<div class="pl" style="--h:${H}px">${weeks.map(w=>`<div class="pl-w ${w.now?'m-now':''} ${w.fut?'fut':''}" style="flex:${w.items.length}"><div class="pl-cs">${w.items.map(col).join('')}</div><span class="pl-d">${w.label}</span></div>`).join('')}</div>`;
}
function renderBatches(){
  const { pick, skipped, W } = batchPool(), b = M.b, net = JOINS - b.pace;
  const B13 = WAITING.filter(p=>p.b13);
  const sizeSeg = `<div class="seg sm" role="group" aria-label="Batch size">${[25,50,75,100].map(n=>`<button data-bsize="${n}" aria-pressed="${b.size===n}">${n}</button>`).join('')}</div>`;
  const HOW = [['oldest','Oldest first','Whoever has waited longest. Nothing to explain.'],['city','By city','Where a shop just went live or posters just went up.'],['shop','By poster shop','People who signed up at one shop’s poster.'],['picked','Hand-picked','Choose people yourself. Each pick is logged.']];
  const opts = b.how==='city' ? `<div class="chips2">${CITIES.map(([c])=>`<button class="${b.cities.has(c)?'on':''}" data-bcity="${c}">${c} <span>${fmt(W.filter(p=>p.city===c).length)}</span></button>`).join('')}</div>`
    : b.how==='shop' ? `<div class="chips2">${SHOPS.map(([s])=>`<button class="${b.shops.has(s)?'on':''}" data-bshop="${s}">${s} <span>${fmt(W.filter(p=>p.shop===s).length)}</span></button>`).join('')}</div>` : '';
  // right side of Plan: the people in it, or the queue to pick from
  const hq = b.hq.trim().toLowerCase();
  const cand = b.how==='picked' ? [...b.picked.map(id=>PEOPLE.find(p=>p.id===id)), ...W.filter(p=>!b.picked.includes(p.id))].filter(p=>!hq || p.id.toLowerCase().includes(hq) || p.city.toLowerCase().includes(hq) || (p.shop||'').toLowerCase().includes(hq)).slice(0,40) : [];
  const from = p => p.src==='Poster' ? p.shop : p.src;
  const pkRow = p => { const on = b.picked.includes(p.id), full = !on && b.picked.length>=b.size;
    return `<label class="br5 m-pk ${on?'on':''} ${full?'m-off':''}"><input type="checkbox" data-bpick="${p.id}" ${on?'checked':''} ${full?'disabled':''}><span class="br5-p">#${fmt(p.pos)}</span><span class="pr3-n"><b class="msk">${p.name}</b><span>${p.city}</span></span><span class="br5-f">${from(p)}</span><span class="br5-w">${TODAY-p.joined}d</span></label>`; };
  const pRow = p => `<button class="br5" data-mp="${p.id}"><span class="br5-p">#${fmt(p.pos)}</span><span class="pr3-n"><b class="msk">${p.name}</b><span>${p.city}</span></span><span class="br5-f">${from(p)}</span><span class="br5-w">${TODAY-p.joined}d</span></button>`;
  const lh = pk => `<div class="br5-h ${pk?'m-pk':''}">${pk?'<span></span>':''}<span>In line</span><span>Member</span><span>Came from</span><span>Waited</span></div>`;
  const list = b.how==='picked'
    ? `${lh(true)}<div class="bp5-list">${cand.map(pkRow).join('') || '<p class="small quiet" style="padding:14px 0;margin:0">Nobody in the queue matches.</p>'}</div>`
    : pick.length ? `${lh(false)}<div class="bp5-list">${pick.map(pRow).join('')}</div>`
    : '<div class="bp5-list"><p class="small quiet" style="padding:14px 0;margin:0">Nobody matches yet. Pick a city or shop above.</p></div>';
  const waits = pick.map(p=>TODAY-p.joined);
  const ready = pick.length===b.size;
  const b13cell = M.b13==='pending'
    ? `<div class="hd"><h2>Batch 13</h2><div class="r"><span class="chip live">Needs your approval</span></div></div>
      <div class="b3">
        <div class="b3-top"><div class="ugrid pend">${B13.map(()=>'<i></i>').join('')}</div>
          <div class="b3-s"><div class="m-big">25 <small>people</small></div><span>Proposed by <b>Marcus Lee</b> on 19 Oct · oldest first</span><span>You’d be the second person. Invites go out the next morning.</span></div></div>
        <div class="led"><div><span>Joined</span><b>${dFmt(Math.min(...B13.map(p=>p.joined)))} · the first week of posters</b></div><div><span>Window would close</span><b>${dFmt(TODAY+1+90)}</b></div></div>
        ${mixBar('Where they live', mix(p=>p.city, B13))}
        <div class="b3-l">${B13.map(p=>personRow(p)).join('')}</div>
      </div>
      <div class="b3-ft"><button class="lnk3" data-b13="back">Send it back</button><button class="btn p" data-b13="approve">Approve batch 13</button></div>`
    : M.b13==='approved'
    ? `<div class="hd"><h2>Batch 13</h2><div class="r"><span class="chip ok">Approved</span></div></div>
      <div class="b3"><div class="b3-top"><div class="ugrid m-go">${B13.map(()=>'<i></i>').join('')}</div><div class="b3-s"><div class="m-big">25 <small>people</small></div><span>Approved by you · proposed by Marcus Lee</span><span>Invites go out tomorrow at 9:00am. Their 90 days start then.</span></div></div>
        <div class="b3-done">Logged in Records as <b>Kai approved batch 13</b>.</div></div>
      <div class="b3-ft"><span class="small quiet">Two people signed off</span><button class="lnk3" data-b13="undo">Undo</button></div>`
    : `<div class="hd"><h2>Batch 13</h2><div class="r"><span class="chip under">Sent back</span></div></div>
      <div class="b3"><div class="b3-done">Marcus Lee gets a note. The 25 people go back to the front of the queue, so batch 14 now starts with them.</div></div>
      <div class="b3-ft"><span class="small quiet">Logged in Records</span><button class="lnk3" data-b13="undo">Undo</button></div>`;
  document.getElementById('mv').innerHTML = `
  <section class="band" style="margin-top:0"><div class="bento">
    <div class="cell s12"><div class="hd"><h2>Every batch</h2><div class="r"><span class="lbl">Invites a week</span><div class="seg sm" role="group" aria-label="Invites a week">${[25,50,100,200,325].map(n=>`<button data-bpace="${n}" aria-pressed="${b.pace===n}">${n}</button>`).join('')}</div></div></div>
      <div class="pl-wrap">
        <div class="pl-main">${pipeline()}
          <div class="pl-k"><span><b class="pl-kn">13</b>active of 25</span><span><i style="background:var(--fg)"></i>Spent $10</span><span><i style="background:color-mix(in srgb,var(--fg) 62%,transparent)"></i>Active</span><span><i style="background:var(--land)"></i>Not funded</span><span><i class="hatch"></i>Not opened</span><span><i class="kpend"></i>Needs approval</span><span><i class="kplan"></i>Planning</span><span><i class="kghost"></i>At this pace</span></div></div>
        <div class="pl-side">
          <span class="lbl">At ${b.pace} a week</span>
          <div class="pl-big"><b>${waitWeeks()}</b> weeks</div>
          <span class="pl-sub">for someone who joins today</span>
          <div class="pl-rows">
            <div><span>Waitlist in 4 weeks</span><b class="${net>0?'warn':'ok'}">${fmt(Math.max(0, WAITING.length + 4*net))}</b></div>
            <div><span>Joins a week</span><b>${fmt(JOINS)}</b></div>
            <div><span>To keep up</span><b>${fmt(Math.ceil(JOINS/25)*25)} a week</b></div>
          </div>
        </div>
      </div>
      <div class="bk-ft"><span>Batches 11 and 12 went out on 20 Oct, so most of them haven’t opened yet. Click a batch to see who’s in it.</span><button data-gto="cohorts">How each week activates · Cohorts →</button></div></div>
  </div></section>

  <section class="band"><div class="bento">
    <div class="cell s5" id="b13">${b13cell}</div>
    <div class="cell s7" id="b14"><div class="hd"><h2>Plan batch 14</h2><div class="r"><span class="lbl">Size</span>${sizeSeg}</div></div>
      <div class="hw4" role="group" aria-label="Who goes first">${HOW.map(([k,t])=>`<button data-bhow="${k}" aria-pressed="${b.how===k}">${t}</button>`).join('')}</div>
      <div class="bp5">
        <div class="bp5-rule"><p>${HOW.find(h=>h[0]===b.how)[2]}</p>${b.how==='picked' ? `<label class="msearch sm"><svg class="i" viewBox="0 0 20 20"><circle cx="9" cy="9" r="5"/><path d="M13 13l4 4"/></svg><input id="bq" placeholder="Search the queue: ID, city or shop" value="${b.hq.replace(/"/g,'&quot;')}"></label>` : opts}</div>
        <div class="bp5-sum">
          <div class="bp5-c"><div class="ugrid sz" style="--cols:${b.size/5}">${Array.from({length:b.size},(_,i)=>`<i class="${i<pick.length?'on':''}"></i>`).join('')}</div>
            <div><div class="m-big">${pick.length} <small>of ${b.size}</small></div>
              <span>${pick.length ? `Waited ${Math.min(...waits)===Math.max(...waits)?Math.min(...waits):Math.min(...waits)+'–'+Math.max(...waits)} days` : 'Nobody picked yet'}</span>
              ${b.how==='picked'&&b.picked.length?'<button class="lnk3" data-bclearpick>Clear picks</button>':''}</div></div>
          ${pick.length ? `<div class="bp5-mx">${mixBar('Where they live', mix(p=>p.city, pick))}${mixBar('How they joined', mix(p=>p.src, pick))}</div>` : ''}
        </div>
        ${skipped ? `<div class="fair">${ICON.warn}<span>Skips <b>${fmt(skipped)}</b> people who’ve waited longer. You’ll say why when you propose it.</span></div>` : ''}
        ${list}
      </div>
      <button class="foot ${b.proposed?'done':''}" data-bpropose ${!ready||b.proposed?'disabled':''}><span>${b.proposed ? 'Batch 14 proposed · waiting for a second person' : !ready ? `Pick ${b.size-pick.length} more to propose it` : `Propose batch 14 · ${b.size} people · needs a second person`}</span><span>${b.proposed?'✓':'→'}</span></button></div>
  </div></section>`;
}
function renderBatchPanel(pn){
  const row = BATCH.find(x=>x[0]===M.bopen), [bn,d,i,o,a,s] = row, ppl = PEOPLE.filter(p=>p.batch===bn), left = 90-(TODAY-d);
  const order = {spent:0,active:1,opened:2,invited:3}; ppl.sort((x,y)=>order[x.stage]-order[y.stage]);
  const notOpened = ppl.filter(p=>p.stage==='invited'), notFunded = ppl.filter(p=>p.stage==='opened');
  pn.innerHTML = `<div class="pn-hd"><span class="lbl">Batch ${bn}</span><span class="chip plain nodot">Sent ${dFmt(d)}</span><button class="x" data-mclose aria-label="Close">${ICON.x}</button></div>
  <div class="pn-b">
    <h3>Batch ${bn}</h3>
    <div class="bx4">${[['Invited',i],['Opened',o],['Funded',a],['Spent $10',s]].map(([t,v])=>`<div><span class="lbl">${t}</span><b>${v}</b></div>`).join('')}</div>
    <div class="w90"><div class="w90-h"><span class="lbl">90-day window</span><b class="${left<30?'warn':''}">${left} days left</b></div><span class="wbar big ${left<30?'lo':''}"><i style="width:${(90-left)/90*100}%"></i></span><span class="small quiet">Closes ${dFmt(d+90)} for anyone who hasn’t funded</span></div>
    <div><span class="lbl">Who’s in it</span><div class="bpl">${ppl.map(p=>`<button class="bpl-r" data-mp="${p.id}"><b class="msk">${p.name}</b>${stageCell(p)}</button>`).join('')}</div></div>
  </div>
  <div class="pn-ft">${notOpened.length ? `<button class="btn p" style="height:40px" data-mnudgeids="invited|${notOpened.map(p=>p.id).join(',')}">Nudge the ${notOpened.length} who haven’t opened</button>` : notFunded.length ? `<button class="btn p" style="height:40px" data-mnudgeids="opened|${notFunded.map(p=>p.id).join(',')}">Nudge the ${notFunded.length} who haven’t funded</button>` : ''}<button class="btn" style="height:40px;margin-left:auto" data-mclose>Close</button></div>`;
}

/* ── Nudges ── */
const GROUPS = [
  { k:'invited', t:'Invited, never opened', short:'never opened', msg:'Your spot at Clear is ready. It takes two minutes to set up, and there’s $10 waiting at {shop}.', sub:'Your spot at Clear is ready', cta:'Open Clear', last:['9 Oct',18,'Email',96,52] },
  { k:'opened', t:'Opened, not funded', short:'didn’t fund', msg:'You’re one step away. Link a bank or add $5 to unlock your $10 at {shop}. {days} days left.', sub:'One step left to unlock your $10', cta:'Finish setting up', last:['12 Oct',31,'Push',41,78] },
  { k:'active', t:'Funded, no spend yet', short:'haven’t spent', msg:'Your $10 is still waiting at {shop}. Show the QR at the counter.', sub:'Your $10 is waiting', cta:'Show my QR', last:['14 Oct',44,'Push',22,86] },
  { k:'quiet', t:'Quiet for 3+ weeks', short:'quiet 3+ weeks', msg:'It’s been a while. Here’s what’s new at Clear this month.', sub:'What’s new at Clear', cta:'See what’s new', last:null } ];
const FLOWS = [
  { k:'f1', day:2, when:'2 days after the invite', who:'Hasn’t opened it', ch:'Email', on:true, wk:38, acted:21 },
  { k:'f2', day:7, when:'7 days after the invite', who:'Still hasn’t opened', ch:'Email', on:true, wk:24, acted:9 },
  { k:'f3', day:10, when:'3 days after opening', who:'Hasn’t funded', ch:'Push', on:true, wk:17, acted:29 },
  { k:'f4', day:13, when:'5 days after funding', who:'Hasn’t spent the $10', ch:'Push', on:false, wk:0, acted:null },
  { k:'f5', day:75, when:'15 days before the window closes', who:'Hasn’t funded', ch:'Email and push', on:true, wk:0, acted:null, first:'First ones go out 30 Nov' } ];
const grpList = (k, L) => k==='quiet' ? L.filter(QUIET) : L.filter(p=>p.stage===k);
const fill = (t, p) => t.replace(/\{shop\}/g, p ? (p.shop || 'a Clear shop near you') : 'their poster shop').replace(/\{days\}/g, p && LEFT(p)!=null ? LEFT(p) : '54').replace(/\{first\}/g, 'Maria');
function renderNudges(){
  const L = PEOPLE.filter(passF), inv = L.filter(p=>p.invited!=null);
  const N = { inv:inv.length, op:inv.filter(p=>p.opened!=null).length, fd:inv.filter(p=>p.act).length, sp:cnt('spent',L) }, quiet = L.filter(QUIET).length;
  const max = Math.max(N.inv,1);
  const gstat = g => { const sent = M.sent.find(s=>s.k===g.k), list = grpList(g.k, L), u30 = list.filter(p=>LEFT(p)!=null && LEFT(p)<30).length;
    return sent ? `<span class="ok">Sent ${sent.when} · results in 7 days</span>` : `${g.last ? `Last ${g.last[0]} · <b>${g.last[1]}% acted</b>` : 'Never nudged'}${u30?` · <span class="warn">${u30} under 30 days</span>`:''}`; };
  // left: the funnel, one step a row; the hatched gap is the group that stopped there
  const step = (label, v, prev, gk) => { const on = gk && M.ng===gk, pc = prev ? Math.round(v/prev*100) : null;
    const inner = `<span class="nf5-s"><span>${label}</span><span class="nf5-p">${pc==null ? 'Everyone we invited' : `${pc}% of the step before`}</span></span><b class="nf5-v">${fmt(v)}</b>
      <span class="nf-b"><i class="m-v" style="width:${v/max*100}%"></i>${prev!=null&&prev>v?`<i class="m-gap ${on?'m-sel':''}" style="left:${v/max*100}%;width:${(prev-v)/max*100}%"></i>`:''}</span>`;
    return gk ? `<button class="nf5-r ${on?'on':''}" data-ng="${gk}" aria-pressed="${on}">${inner}</button>` : `<div class="nf5-r">${inner}</div>`; };
  // right: the groups, as a list
  const META = { invited:'Got the invite, never opened the app', opened:'Opened the app, no money in yet', active:'Funded, haven’t used their $10', quiet:'Funded, not seen in 3+ weeks' };
  const grow = (gk, n) => { const g = GROUPS.find(x=>x.k===gk), on = M.ng===gk;
    return `<button class="ng5 ${on?'on':''}" data-ng="${gk}" aria-pressed="${on}"><span class="ng5-t"><i class="ng5-sw ${gk==='quiet'?'q':''}"></i><b>${fmt(n)}</b> ${g.short}<span class="ng5-ar">${on?'Nudging ↓':'Nudge →'}</span></span>
      <span class="ng5-m">${META[gk]}</span><span class="ng5-s">${gstat(g)}</span></button>`; };
  const g = GROUPS.find(x=>x.k===M.ng), list = grpList(g.k, L), msg = M.msg[g.k] ?? g.msg, sample = list[0];
  const m = {push:0,email:0,text:0}; list.forEach(p=>m[M.force||chanFor(p)]++);
  const sent = M.sent.find(s=>s.k===g.k);
  const exp = g.last ? Math.round(list.length * g.last[1]/100) : null;
  const deed = {invited:'open the app', opened:'fund', active:'spend their $10', quiet:'come back'}[g.k];
  const pvCh = M.pv==='push' && !m.push && m.email ? 'email' : M.pv;
  const preview = pvCh==='push'
    ? `<div class="pv-ph"><span class="pv-tm">12:00</span><span class="pv-dt">Sunday, 25 October</span>
        <div class="pv-nt"><span class="pv-ic">C</span><div><div class="pv-nh"><b>Clear</b><span>now</span></div><b class="pv-st">${fill(g.sub, sample)}</b><p>${fill(msg, sample)}</p></div></div></div>`
    : `<div class="pv-em"><div class="pv-eh"><div><span>From</span><b>Clear &lt;hello@useclear.org&gt;</b></div><div><span>Subject</span><b>${fill(g.sub, sample)}</b></div></div>
        <div class="pv-eb"><p>Hi ${fill('{first}', sample)},</p><p>${fill(msg, sample)}</p><span class="pv-cta">${g.cta}</span><p class="pv-fine">You’re getting this because you joined Clear at useclear.org. Unsubscribe</p></div></div>`;
  const fon = FLOWS.filter(f=>f.on), fx = d => d<=14 ? d/14*32 : 32 + (d-14)/76*68; // first two weeks get a third of the axis
  document.getElementById('mv').innerHTML = `
  <section class="band" style="margin-top:0"><div class="bento">
    <div class="cell s12"><div class="hd"><h2>Where people stop</h2><div class="r"><span class="lbl">Pick a group to nudge</span></div></div>
      <div class="nf5">
        <div class="nf5-f">
          ${step('Invited', N.inv, null, null)}
          ${step('Opened the app', N.op, N.inv, 'invited')}
          ${step('Funded', N.fd, N.op, 'opened')}
          ${step('Spent their $10', N.sp, N.fd, 'active')}
        </div>
        <div class="nf5-g">
          ${grow('invited', N.inv-N.op)}${grow('opened', N.op-N.fd)}${grow('active', N.fd-N.sp)}${grow('quiet', quiet)}
        </div>
      </div>
      <div class="bk-ft"><span>The hatched part of each bar is who stopped there. Follow-ups below already reach most of them.</span><button data-ngjump>Write the nudge ↓</button></div></div>
  </div></section>

  <section class="band"><div class="bento">
    <div class="cell s7" id="ncomp"><div class="hd"><h2>Nudge ${fmt(list.length)} ${list.length===1?'person':'people'}</h2><span class="chip plain nodot">${g.t}</span></div>
      <div class="nc">
        <div class="nc-r"><span class="lbl">Message</span><div><textarea id="ncmsg" rows="3">${msg}</textarea>
          <div class="nc-tk"><span>Fill in per person</span>${[['{shop}','Their poster shop'],['{days}','Days left'],['{first}','First name']].map(([t,n])=>`<button data-tok="${t}">${n}</button>`).join('')}</div></div></div>
        <div class="nc-r"><span class="lbl">Send by</span><div><div class="seg sm" role="group" aria-label="Channel">${[['','Best for each'],['push','Push'],['email','Email'],['text','Text']].map(([k,t])=>`<button data-mforce="${k}" aria-pressed="${(M.force||'')===k}" ${k==='text'&&!SETUP.text?'disabled title="Texting isn’t set up"':''}>${t}</button>`).join('')}</div>
          <div class="nc-mx"><span class="mb2">${['push','email'].map(c=>m[c]?`<i style="flex:${m[c]};background:${CHCOL[c]}"></i>`:'').join('')}</span><span class="mk2">${['push','email'].filter(c=>m[c]).map(c=>`<span><i style="background:${CHCOL[c]}"></i>${CH[c]} <b>${m[c]}</b></span>`).join('')}<span class="z">Text isn’t set up</span></span></div>
          <p class="nc-h">${M.force ? `Everyone gets ${CH[M.force].toLowerCase()}.` : 'Push if they have the app, otherwise email.'}</p></div></div>
        <div class="nc-r"><span class="lbl">When</span><div><div class="seg sm" role="group" aria-label="When">${[['now','Now'],['sun','Sunday, noon'],['tue','Tuesday, 6pm']].map(([k,t])=>`<button data-mwhen="${k}" aria-pressed="${M.when===k}">${t}</button>`).join('')}</div>
          <p class="nc-h">${M.when==='now'?'Goes out as soon as you send.':M.when==='sun'?'Sunday at noon is when most people open the app.':'Tuesday evening gets the most email opens.'}</p></div></div>
      </div>
      <div class="nc-ft"><span>${sent ? `<b class="ok">Sent ${sent.when}</b> · logged in Records` : exp!=null ? `If it does as well as last time, about <b>${fmt(exp)}</b> will ${deed} this week.` : 'Never nudged before. Results show up here after a week.'}</span>
        <button class="btn p" data-ngsend ${!list.length||sent?'disabled':''}>${sent?'Sent ✓':`${M.when==='now'?'Send to':'Schedule for'} ${fmt(list.length)}`}</button></div></div>
    <div class="cell s5"><div class="hd"><h2>Preview</h2><div class="r"><div class="seg sm" role="group" aria-label="Preview">${['push','email'].map(c=>`<button data-pv="${c}" aria-pressed="${pvCh===c}" ${!m[c]&&!M.force?'':''}>${CH[c]}</button>`).join('')}</div></div></div>
      <div class="pv">${preview}</div>
      <div class="bk-ft"><span>Filled in for ${sample ? sample.id : 'a sample person'}${sample&&sample.shop?' · '+sample.shop:''}</span><button data-mtab="people" data-mstagego="${g.k}">All ${fmt(list.length)} in People →</button></div></div>
  </div></section>

  <section class="band"><div class="bento">
    <div class="cell s7"><div class="hd"><h2>Follow-ups that run on their own</h2><div class="r"><span class="lbl">${fon.length} on · ${fmt(fon.reduce((s,f)=>s+f.wk,0))} sent this week</span></div></div>
      <div class="fu-tr"><div class="fu-ax"><i class="fu-gap" style="left:${fx(13)}%;width:${fx(75)-fx(13)}%"><span>Nothing for ${75-13} days</span></i>
        ${FLOWS.map((f,i)=>`<b class="fu-m ${f.on?'':'m-off'}" style="left:${fx(f.day)}%">${i+1}</b>`).join('')}</div>
        <div class="fu-sc"><span style="left:0">Invited</span><span style="left:${fx(7)}%">Day 7</span><span style="left:${fx(14)}%">Day 14</span><span style="left:${fx(30)}%">Day 30</span><span style="left:${fx(60)}%">Day 60</span><span style="right:0">Day 90 · closes</span></div></div>
      <div class="fu-l">${FLOWS.map((f,i)=>`<div class="fu-r ${f.on?'':'m-off'}"><b class="fu-n">${i+1}</b><span class="fu-t"><b>${f.when}</b><span>${f.who} · ${f.ch}</span></span>
        <span class="fu-s">${f.first && f.on ? f.first : f.on ? `${f.wk} this week${f.acted!=null?` · <b>${f.acted}% acted</b>`:''}` : 'Off'}</span>
        <button class="sw4" role="switch" aria-checked="${f.on}" aria-label="${f.when}" data-flow="${f.k}"><i></i></button></div>`).join('')}</div>
      <div class="bk-ft"><span>Between day 13 and day 75 nobody hears from Clear.</span><button data-fuadd>Add a follow-up at day 30 →</button></div></div>
    <div class="cell s5"><div class="hd"><h2>How the last nudges did</h2><div class="r"><span class="lbl">Acted within 7 days</span></div></div>
      <div class="pn3">${[...M.sent.map(s=>({t:GROUPS.find(x=>x.k===s.k).t, d:s.when, ch:Object.keys(s.mix).filter(c=>s.mix[c]).map(c=>CH[c]).join(' + '), n:s.n, o:null, a:null})),
        ...GROUPS.filter(x=>x.last).sort((x,y)=>parseInt(y.last[0])-parseInt(x.last[0])).map(x=>({t:x.t, d:x.last[0], ch:x.last[2], n:x.last[3], o:x.last[4], a:x.last[1]}))].map(r=>`
        <div class="pn3-r"><div class="pn3-t"><b>${r.t}</b><span>${r.d} · ${r.ch} · ${fmt(r.n)} people</span></div>
          ${r.a==null ? '<div class="pn3-w">Waiting on results</div>' : `<div class="pn3-b"><span class="pn3-bar"><i class="o" style="width:${r.o}%"></i><i class="a" style="width:${r.a}%"></i></span><span class="pn3-n"><span>${r.o}% opened</span><b>${r.a}% acted</b></span></div>`}</div>`).join('')}</div>
      <div class="bk-ft"><span>Push gets about twice the action email does.</span><button data-gto="settings">Set up texting →</button></div></div>
  </div></section>`;
}
function renderComposer(pn){
  const g = GROUPS.find(x=>x.k===M.nudge.k) || GROUPS[1];
  const L = M.nudge.ids.map(id=>PEOPLE.find(p=>p.id===id));
  const m = {push:0,text:0,email:0}; L.forEach(p=>m[M.nudge.force||chanFor(p)]++);
  pn.innerHTML = `<div class="pn-hd"><span class="lbl">Nudge</span><span class="chip plain nodot">${L.length===1?L[0].id:g.t}</span><button class="x" data-mclose aria-label="Close">${ICON.x}</button></div>
  <div class="pn-b"><h3>${L.length===1?'Nudge one person':`Nudge ${fmt(L.length)} people`}</h3>
    <div><span class="lbl">Message</span><textarea class="cmp" rows="4">${g.msg}</textarea><span class="small quiet">{shop} and {days} fill in per person. The message links straight to the next step in the app.</span></div>
    <div><span class="lbl">Send by</span><div style="margin-top:8px" class="seg sm">${[['','Best for each'],['push','Push'],['email','Email'],['text','Text']].map(([k,t])=>`<button data-mforce1="${k}" aria-pressed="${(M.nudge.force||'')===k}" ${k==='text'&&!SETUP.text?'disabled title="Texting isn’t set up"':''}>${t}</button>`).join('')}</div>
      <p class="small quiet" style="margin:10px 0 0">${['push','email'].filter(c=>m[c]).map(c=>`${CH[c]} to ${m[c]}`).join(' · ')}</p></div>
  </div><div class="pn-ft"><span class="nx">Logged in Records</span><button class="btn" style="height:40px" data-mclose>Cancel</button><button class="btn p" style="height:40px" data-msend>Send${L.length===1?'':' to '+fmt(L.length)}</button></div>`;
  M.nudge._n = L.length; M.nudge._mix = m;
}

/* ── Waitlist ── */
function renderWaitlist(){
  const W = WAITING.filter(passF), pace = M.b.pace;
  const { pick } = batchPool(), in14 = new Set(pick.map(p=>p.id));
  const wk = [[0,7,'This week'],[7,14,'1 week'],[14,21,'2 weeks'],[21,28,'3 weeks'],[28,35,'4 weeks'],[35,99,'5+ weeks']].map(([a,b,t])=>[t, W.filter(p=>TODAY-p.joined>=a && TODAY-p.joined<b).length, a>=28]);
  const bm = Math.max(...wk.map(x=>x[1]),1), med = median(W.map(p=>TODAY-p.joined)), old = wk[4][1]+wk[5][1];
  const qrow = (p, right) => `<button class="qr3" data-mp="${p.id}"><span class="qp">#${fmt(p.pos)}</span><span class="pr3-n"><b class="msk">${p.name}</b><span>${p.city} · ${p.src==='Poster'?p.shop:p.src} · joined ${dFmt(p.joined)}, ${tFmt(p.jt)}</span></span>${right}</button>`;
  let body;
  if (M.wq==='next'){
    const g13 = M.b13==='pending' ? W.filter(p=>p.b13) : [], g14 = W.filter(p=>in14.has(p.id)), rest = W.filter(p=>!(p.b13&&M.b13==='pending') && !in14.has(p.id));
    const per = pace/25, nb = i => 15 + Math.floor(i/25), nd = i => TODAY + 7 + 7*Math.floor(Math.floor(i/25)/per);
    // each group shows 2 at first; small groups open fully, the long tail opens 20 at a time
    const grp = (k, t, s, cls, ppl, right) => { if (!ppl.length) return ''; const n = Math.min(ppl.length, M.wqx[k] || 2), left = ppl.length - n, step = ppl.length <= 100 ? left : Math.min(20, left);
      return `<div class="qg ${cls}"><span class="qg-t"><b>${t}</b><span>${s}</span></span><span class="qg-n">${fmt(ppl.length)}</span></div>${ppl.slice(0,n).map(right).join('')}
        ${left || n > 2 ? `<div class="qm">${left ? `<button data-wqmore="${k}|${n+step}">${step===left?`Show ${left===ppl.length-2?'the other ':''}${fmt(left)}`:`Show ${step} more`}<span>${step===left?'':` · ${fmt(left)} left`}</span></button>` : ''}${n > 2 ? `<button data-wqmore="${k}|2" class="lss">Show fewer</button>` : ''}</div>` : ''}`; };
    body = grp('b13','Batch 13','Waiting on your approval','tlv', g13, p=>qrow(p, `<span class="qw">${TODAY-p.joined}d</span>`))
      + grp('b14','Batch 14', M.b.how==='oldest'?'As planned, oldest first':'As planned, '+{city:'by city',shop:'by poster shop',picked:'hand-picked'}[M.b.how], '', g14, p=>qrow(p, `<span class="qw">${TODAY-p.joined}d</span>`))
      + grp('rest',`Then, at ${pace} a week`, `The rest, in the order they joined`, 'fut', rest, p=>{ const i = rest.indexOf(p); return qrow(p, `<span class="qw"><b>Batch ${nb(i)}</b><span>about ${dFmt(nd(i))}</span></span>`); });
  } else {
    body = W.slice().sort((a,b)=>b.jt-a.jt).slice(0,11).map(p=>qrow(p, `<span class="qw"><b>${p.joined===TODAY?'Today':dFmt(p.joined)}</b><span>${tFmt(p.jt)}</span></span>`)).join('');
  }
  // by city
  const cities = CITIES.map(([c])=>{ const ppl = W.filter(p=>p.city===c); return { c, n:ppl.length, old:ppl.filter(p=>TODAY-p.joined>=28).length, wk:ppl.filter(p=>p.joined>TODAY-7).length, post:ppl.filter(p=>p.src==='Poster').length, shops:SHOPS.filter(s=>s[1]===c).length, med:median(ppl.map(p=>TODAY-p.joined)) }; }).filter(x=>x.n).sort((a,b)=>b.n-a.n);
  const cm = Math.max(...cities.map(x=>x.n),1);
  document.getElementById('mv').innerHTML = `
  <section class="band" style="margin-top:0"><div class="bento">
    <div class="cell s7"><div class="hd"><h2>The queue</h2><div class="r"><div class="seg sm" role="group" aria-label="Queue view"><button data-wq="next" aria-pressed="${M.wq==='next'}">Next in line</button><button data-wq="new" aria-pressed="${M.wq==='new'}">Just joined</button></div></div></div>
      <div class="ql3">${body || '<p class="small quiet" style="padding:22px;margin:0">Nobody matches.</p>'}</div>
      <button class="foot" data-mtab="people" data-mstagego="waiting"><span>All ${fmt(W.length)} on the waitlist</span><span>People →</span></button></div>
    <div class="cell s5"><div class="hd"><h2>How long they’ve waited</h2><div class="r"><span class="lbl">Median ${med} days</span></div></div>
      <div class="wt3">${wk.map(([t,v,o])=>`<div class="wt3-r ${o?'old':''}"><span class="wt3-l">${t}</span><span class="wt3-b"><i style="width:${v/bm*100}%"></i></span><b>${fmt(v)}</b></div>`).join('')}</div>
      <div class="bk-ft"><span><b>${fmt(old)}</b> have waited four weeks or more</span><button data-mtab="batches">Plan batch 14 →</button></div></div>
  </div></section>
  <section class="band"><div class="bento"><div class="cell s12">
    <div class="hd"><h2>Where they’re waiting</h2><div class="r"><span class="lbl">For batches by city</span></div></div>
    <div class="bt-wrap"><table class="bt wc"><colgroup><col style="width:18%"><col style="width:26%"><col style="width:11%"><col style="width:12%"><col style="width:11%"><col style="width:10%"><col style="width:12%"></colgroup>
      <thead><tr><th class="c-nm">City</th><th style="text-align:left">Waiting</th><th>4+ weeks</th><th>This week</th><th>Posters</th><th>Shops live</th><th></th></tr></thead><tbody>
      ${cities.map(x=>`<tr><td class="tn"><b>${x.c}</b></td><td style="text-align:left"><span class="wc-b"><span class="m-bar"><i style="width:${x.n/cm*100}%"></i></span><b>${fmt(x.n)}</b></span></td><td>${fmt(x.old)}</td><td>+${fmt(x.wk)}</td><td>${Math.round(pct(x.post,x.n))}%</td><td>${x.shops || '<span class="quiet">None</span>'}</td><td><button class="lnk4" data-bcitygo="${x.c}">Plan a batch →</button></td></tr>`).join('')}
    </tbody></table></div>
    <div class="bk-ft"><span>Cities with no live shop can’t spend their $10 nearby yet. Invite them once a shop signs.</span><button data-gto="merchants">Shops signing · Merchants →</button></div></div></div></section>`;
}

/* ── render + events ── */
function render(){
  document.querySelectorAll('.gtabs [data-mtab]').forEach(b=>b.setAttribute('aria-current', b.dataset.mtab===M.tab?'page':'false'));
  renderHdr(); renderCtl();
  ({people:renderPeople, batches:renderBatches, nudges:renderNudges, waitlist:renderWaitlist})[M.tab]();
  renderPanel();
}
function toast(t){ let el = document.getElementById('toast'); if (!el){ el = document.createElement('div'); el.id='toast'; document.body.appendChild(el); } el.innerHTML = t; el.classList.add('on'); clearTimeout(el._t); el._t = setTimeout(()=>el.classList.remove('on'), 2600); }
const closeAll = () => { M.open = null; M.nudge = null; M.bopen = null; };
document.addEventListener('click', e => {
  if (e.target.id==='mscrim'){ closeAll(); return render(); }
  const t = e.target.closest('button,[data-mp],a,input,label'); if (!t){ if (openMenu){ openMenu=null; renderCtl(); } const mm = document.querySelector('.mm3'); if (mm) mm.hidden = true; return; }
  const d = t.dataset;
  if (d.mtab){ M.tab = d.mtab; if (d.mstagego){ M.stage = d.mstagego; M.page = 0; } closeAll(); window.scrollTo({top:0}); return render(); }
  if (d.mfopen){ openMenu = openMenu===d.mfopen ? null : d.mfopen; return renderCtl(); }
  if (d.mf){ const s = M.F[d.mf]; t.checked ? s.add(t.value) : s.delete(t.value); M.page = 0; const o = openMenu; render(); openMenu = o; renderCtl(); return; }
  if (d.mfclear){ M.F[d.mfclear].clear(); return render(); }
  if (t.hasAttribute('data-mfclose')){ openMenu = null; return renderCtl(); }
  if (t.hasAttribute('data-mfall')){ Object.values(M.F).forEach(s=>s.clear()); return render(); }
  if (d.mstage){ M.stage = M.stage===d.mstage && d.mstage!=='all' ? 'all' : d.mstage; M.page = 0; return render(); }
  if (d.msort){ M.sort = d.msort; return render(); }
  if (d.mpage){ M.page += +d.mpage; return render(); }
  if (d.mp){ closeAll(); M.open = d.mp; return render(); }
  if (t.hasAttribute('data-mclose')){ closeAll(); return render(); }
  if (d.mreveal){ M.reveal.add(d.mreveal); M.audit.push({id:d.mreveal, at:new Date()}); toast(`Shown · logged in Records as <b>Kai showed ${d.mreveal}</b>`); return render(); }
  if (d.mnote){ const v = document.getElementById('mnote').value.trim(); if (!v) return; PEOPLE.find(p=>p.id===d.mnote).notes.push({by:'Kai', at:TODAY, t:v}); return render(); }
  if (d.maddtag){ const p = PEOPLE.find(x=>x.id===d.maddtag); const opts = ['Follow up','Bank link issue','Spanish speaker','VIP','Shop owner']; const nx = opts.find(o=>!p.tags.includes(o)); if (nx) p.tags.push(nx); return render(); }
  if (t.hasAttribute('data-mmore')){ const mm = t.parentElement.querySelector('.mm3'); mm.hidden = !mm.hidden; return; }
  if (d.mprop){ const [what,id] = d.mprop.split('|'); M.approvals.push({what,id}); toast(`<b>${what}</b> proposed · it needs a second person in Needs you`); return render(); }
  if (d.mpick){ if (!M.b.picked.includes(d.mpick)) M.b.picked.push(d.mpick); M.b.how = 'picked'; M.b.proposed = false; toast(`Added to batch 14 · ${M.b.picked.length} hand-picked`); return render(); }
  if (d.mnudge1){ M.nudge = { k: PEOPLE.find(p=>p.id===d.mnudge1).stage, ids:[d.mnudge1] }; return render(); }
  if (d.mnudgeids){ const [k,ids] = d.mnudgeids.split('|'); M.nudge = { k, ids:ids.split(',') }; M.bopen = null; return render(); }
  if (d.mforce1!==undefined){ M.nudge.force = d.mforce1 || null; return renderPanel(); }
  if (t.hasAttribute('data-msend')){ const n = M.nudge._n, mix = M.nudge._mix;
    M.nudge.ids.forEach(id=>{ const p = PEOPLE.find(x=>x.id===id); p.log.unshift({at:TODAY, t:`Nudged by ${CH[M.nudge.force||chanFor(p)].toLowerCase()} · just now`}); });
    const one = M.nudge.ids.length===1 ? M.nudge.ids[0] : null; M.nudge = null; if (one) M.open = one; toast(`Nudge sent to <b>${fmt(n)}</b> · logged in Records`); return render(); }
  // nudges tab
  if (d.ng){ if (M.tab!=='nudges'){ M.tab = 'nudges'; } M.ng = d.ng; M.force = null; render(); if (t.closest('.brief')) document.getElementById('ncomp').scrollIntoView({behavior:'smooth', block:'start'}); return; }
  if (t.hasAttribute('data-ngjump')){ document.getElementById('ncomp').scrollIntoView({behavior:'smooth', block:'start'}); return; }
  if (d.mforce!==undefined){ M.force = d.mforce || null; return render(); }
  if (d.mwhen){ M.when = d.mwhen; return render(); }
  if (d.pv){ M.pv = d.pv; return render(); }
  if (d.tok){ const ta = document.getElementById('ncmsg'), s = ta.selectionStart ?? ta.value.length; ta.value = ta.value.slice(0,s) + d.tok + ta.value.slice(ta.selectionEnd ?? s); M.msg[M.ng] = ta.value; render(); const n2 = document.getElementById('ncmsg'); n2.focus(); n2.setSelectionRange(s+d.tok.length, s+d.tok.length); return; }
  if (t.hasAttribute('data-ngsend')){ const L = grpList(M.ng, PEOPLE.filter(passF)), mx = {push:0,email:0,text:0}; L.forEach(p=>mx[M.force||chanFor(p)]++);
    const when = M.when==='now' ? 'today' : M.when==='sun' ? 'for Sunday noon' : 'for Tuesday 6pm'; M.sent.unshift({k:M.ng, n:L.length, mix:mx, when});
    toast(`Nudge ${M.when==='now'?'sent':'scheduled'} to <b>${fmt(L.length)}</b> · logged in Records`); return render(); }
  if (d.flow){ const f = FLOWS.find(x=>x.k===d.flow); f.on = !f.on; toast(`${f.when} · <b>${f.on?'on':'off'}</b> · logged in Records`); return render(); }
  if (t.hasAttribute('data-fuadd')){ toast('Opens the follow-up editor'); return; }
  // batches
  if (d.bopen){ closeAll(); M.bopen = +d.bopen; return render(); }
  if (d.bjump){ if (M.tab!=='batches'){ M.tab='batches'; render(); } document.getElementById(d.bjump).scrollIntoView({behavior:'smooth', block:'center'}); return; }
  if (d.bpace){ M.b.pace = +d.bpace; return render(); }
  if (d.b13){ M.b13 = d.b13==='undo' ? 'pending' : d.b13==='approve' ? 'approved' : 'back'; M.b.proposed = false;
    if (d.b13==='approve') toast('Batch 13 approved · invites go out tomorrow at 9:00am'); if (d.b13==='back') toast('Batch 13 sent back to Marcus Lee'); return render(); }
  if (d.bsize){ M.b.size = +d.bsize; M.b.proposed = false; if (M.b.picked.length > M.b.size) M.b.picked.length = M.b.size; return render(); }
  if (d.bhow){ M.b.how = d.bhow; M.b.proposed = false; return render(); }
  if (d.bcity){ const s = M.b.cities; s.has(d.bcity) ? s.delete(d.bcity) : s.add(d.bcity); M.b.proposed = false; return render(); }
  if (d.bcitygo){ M.b.how = 'city'; M.b.cities = new Set([d.bcitygo]); M.b.proposed = false; M.tab = 'batches'; render(); document.getElementById('b14').scrollIntoView({block:'center'}); return; }
  if (d.bshop){ const s = M.b.shops; s.has(d.bshop) ? s.delete(d.bshop) : s.add(d.bshop); M.b.proposed = false; return render(); }
  if (d.bpick){ const a = M.b.picked, i = a.indexOf(d.bpick); i>=0 ? a.splice(i,1) : a.push(d.bpick); M.b.proposed = false; return render(); }
  if (t.hasAttribute('data-bclearpick')){ M.b.picked = []; return render(); }
  if (t.hasAttribute('data-bpropose')){ M.b.proposed = true; toast('Batch 14 proposed · it shows in Needs you for a second person'); return render(); }
  if (d.wq){ M.wq = d.wq; return render(); }
  if (d.wqmore){ const [k,n] = d.wqmore.split('|'); M.wqx[k] = +n; const sc = document.querySelector('.ql3').scrollTop; render(); document.querySelector('.ql3').scrollTop = sc; return; }
  if (d.go || d.gto){ toast(`Goes to ${d.go||d.gto} in the Command Center`); return; }
});
document.addEventListener('input', e => {
  if (e.target.id==='mq'){ M.q = e.target.value; M.page = 0; if (M.tab!=='people'){ M.tab = 'people'; render(); } else { renderHdr(); renderPeople(); } const i = document.getElementById('mq'); i.focus(); i.setSelectionRange(i.value.length,i.value.length); }
  if (e.target.id==='bq'){ M.b.hq = e.target.value; renderBatches(); const i = document.getElementById('bq'); i.focus(); i.setSelectionRange(i.value.length,i.value.length); }
  if (e.target.id==='ncmsg'){ M.msg[M.ng] = e.target.value; const g = GROUPS.find(x=>x.k===M.ng), L = grpList(M.ng, PEOPLE.filter(passF)), s = L[0];
    document.querySelectorAll('.pv-nt p, .pv-eb p:nth-child(2)').forEach(p=>p.textContent = fill(e.target.value, s)); }
});
document.addEventListener('keydown', e => { if (e.key==='Escape'){ if (M.open||M.nudge||M.bopen){ closeAll(); render(); } else if (openMenu){ openMenu = null; renderCtl(); } } });
window.addEventListener('scroll', () => { const c = document.getElementById('ctl'); c.classList.toggle('stuck', !c.hidden && c.getBoundingClientRect().top <= .5); }, {passive:true});
const hs = location.hash.slice(1).split(',');
['people','batches','nudges','waitlist'].forEach(t=>{ if (hs.includes(t)) M.tab = t; });
if (hs.includes('rec')) M.open = PEOPLE.find(p=>p.tags.length).id;
if (hs.includes('bpanel')) M.bopen = 7;
if (hs.includes('city')) M.b.how = 'city';
if (hs.includes('picked')){ M.b.how = 'picked'; M.b.picked = WAITING.slice(30,36).map(p=>p.id); }
if (hs.includes('email')) M.pv = 'email';
if (hs.includes('inv')) M.ng = 'invited';
render();

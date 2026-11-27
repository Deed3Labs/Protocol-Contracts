
/* ══ Field data — copied from the Command Center so every number matches ═══════════════════════════
   102 posters · 94 up, 4 swap due, 3 faded, 1 missing · 4,812 scans in 30 days · route of 8 stops, Marcus Lee, 3 done.
   Demo "today" is Wed 21 Oct 2026. */
function rng(seed){ let s = seed; return () => (s = (s * 16807) % 2147483647, (s - 1) / 2147483646); }
function series(n, total, shape, seed){
  const r = rng(seed); const w = []; for (let i=0;i<n;i++) w.push(shape(i) * (0.85 + 0.3*r()));
  const sw = w.reduce((a,b)=>a+b,0); const v = w.map(x => Math.round(x/sw*total));
  v[n-1] += total - v.reduce((a,b)=>a+b,0); return v;
}
const int = n => Math.round(n).toLocaleString('en-US');
const SHOPS = [
  ['rosas',"Rosa’s Panadería",4,842,219,26,22,'Redlands'],['icw','Inland Cycle Works',3,611,128,14,11,'Redlands'],['mesa','Mesa Laundry',3,530,127,13,10,'San Bernardino'],
  ['uptown','Uptown Barber',3,402,125,16,13,'Redlands'],['citrus','Citrus Bowl Café',3,366,70,7,6,'Riverside'],['tire','Redlands Tire & Lube',2,301,36,3,2,'Redlands'],
  ['books','State St. Books',3,288,81,9,7,'Redlands'],['mich','La Michoacana',3,254,64,7,6,'San Bernardino'],['nails','Arrowhead Nails',2,221,40,4,3,'San Bernardino'],
  ['orange','Orange St. Laundromat',2,197,39,4,3,'Redlands'] ];
const BOARDS = ['boards','Community boards',6,314,47,5,3,'6 boards'];
const OTHERS = ['others','20 more shops',68,486,130,16,11,'Inland Empire'];
const OTHER_SHOPS = ['Fontana Tacos','Highland Hardware','Yucaipa Feed & Seed','Loma Linda Pharmacy','Colton Cuts','Rialto Donuts','Bloomington Market','Mentone Coffee',
  'Calimesa Cleaners','Grand Terrace Deli','Muscovy Tea','Sixth St. Tailor','Brookside Pet Wash','Cajon Phone Repair','Valley Shoe Repair','Kendall Thrift',
  'Tippecanoe Tires','Victoria Ave. Florist','Base Line Pho','Citrus Plaza Optical'];
const OTHER_CITY = ['Fontana','Highland','Yucaipa','Loma Linda','Colton','Rialto','Bloomington','Mentone','Calimesa','Grand Terrace','Redlands','Riverside','Redlands','San Bernardino','Redlands','San Bernardino','Redlands','Riverside','San Bernardino','Riverside'];
const BOARD_SITES = ['Smiley Library','UR Commons','Sylvan Park','Ed Hales Park','Feldheym Library','Riverside Main Library'];
const BOARD_CITY = ['Redlands','Redlands','Redlands','Redlands','San Bernardino','Riverside'];
const DESIGNS = { A:{name:'The neighbor', posters:41, scans:2011, joined:501}, B:{name:'$10 on us', posters:38, scans:2104, joined:465}, C:{name:'The map', posters:23, scans:697, joined:140} };
const TODAY = Date.UTC(2026,9,21), DAY = 864e5, MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'], WD = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const fmtD = t => { const d = new Date(t); return d.getUTCDate() + ' ' + MON[d.getUTCMonth()]; };
const fmtWD = t => { const d = new Date(t); return WD[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + MON[d.getUTCMonth()]; };
const daysTo = t => Math.round((t - TODAY)/DAY);
const POSTERS = (() => {
  const r = rng(41); const list = [];
  const split = (total, n) => { const w = Array.from({length:n},()=>0.6+r()); const sw = w.reduce((a,b)=>a+b,0);
    const v = w.map(x=>Math.floor(x/sw*total)); let k = total - v.reduce((a,b)=>a+b,0); for (let i=0;k>0;i=(i+1)%n,k--) v[i]++; return v; };
  SHOPS.forEach(s => split(s[3], s[2]).forEach(v => list.push({shop:s[1], shopId:s[0], city:s[7], scans:v})));
  const otherCounts = OTHER_SHOPS.map((_,i)=> i<8 ? 4 : 3);
  const otherScans = split(OTHERS[3], 68); let k = 0;
  OTHER_SHOPS.forEach((n,i)=>{ for (let j=0;j<otherCounts[i];j++) list.push({shop:n, shopId:'o'+i, city:OTHER_CITY[i], scans:otherScans[k++]}); });
  split(BOARDS[3], 6).forEach((v,i)=> list.push({shop:BOARD_SITES[i], shopId:'b'+i, city:BOARD_CITY[i], scans:v, board:true}));
  const des = [...Array(41).fill('A'), ...Array(38).fill('B'), ...Array(23).fill('C')];
  for (let i=des.length-1;i>0;i--){ const j = Math.floor(r()*(i+1)); [des[i],des[j]] = [des[j],des[i]]; }
  list.forEach((p,i)=>{ p.n = i+1; p.design = des[i];
    p.hung = TODAY - (6 + Math.floor(r()*50))*DAY; p.checked = TODAY - Math.floor(r()*12)*DAY; p.status = 'up'; });
  const mesa = list.filter(p=>p.shopId==='mesa')[2], p44 = list.find(p=>p.n===44); [mesa.n, p44.n] = [44, mesa.n];
  const byN = n => list.find(p=>p.n===n);
  [[44,'faded',-64],[71,'faded',-40],[90,'faded',-35],[63,'missing',-30]].forEach(([n,st,h])=>{ const p = byN(n); p.status = st; p.hung = TODAY + h*DAY; });
  [[12,-57],[27,-56],[55,-55],[81,-54]].forEach(([n,h])=>{ const p = byN(n); p.status = 'due'; p.hung = TODAY + h*DAY; });
  list.forEach(p=>{ p.swap = p.hung + 60*DAY; if (p.status==='up' && daysTo(p.swap) < 8) p.hung += 10*DAY, p.swap += 10*DAY; });
  byN(44).checked = TODAY - 2*DAY;
  return list.sort((a,b)=>a.n-b.n);
})();
const pid = n => 'P-' + String(n).padStart(3,'0');
const ST = {up:['settled','Up'], due:['underway','Swap due'], faded:['underway','Faded'], missing:['absent','Missing']};
function designThumb(k, size=40){
  const h = size*1.3;
  const inner = k==='A' ? `<rect x="5" y="8" width="22" height="5" style="fill:var(--fg)"/><rect x="5" y="16" width="16" height="5" style="fill:var(--fg)"/><circle cx="25" cy="34" r="5" style="fill:none;stroke:var(--fg);stroke-width:1.5"/><rect x="5" y="44" width="10" height="2" style="fill:var(--fg-50)"/>`
    : k==='B' ? `<text x="5" y="27" style="font:800 15px var(--f-display);fill:var(--fg);letter-spacing:-.04em">$10</text><rect x="5" y="33" width="20" height="3" style="fill:var(--fg)"/><rect x="5" y="44" width="10" height="2" style="fill:var(--fg-50)"/>`
    : `<path d="M5 12h22M5 20h22M5 28h22M11 6v32M19 6v32" style="stroke:var(--fg-50);stroke-width:1;fill:none"/><rect x="16" y="17" width="6" height="6" style="fill:var(--fg)"/><rect x="5" y="44" width="10" height="2" style="fill:var(--fg-50)"/>`;
  return `<svg class="thumb" viewBox="0 0 32 52" width="${size}" height="${h}" aria-hidden="true"><rect x=".5" y=".5" width="31" height="51" style="fill:var(--raised);stroke:var(--line)"/>${inner}</svg>`;
}

/* a spare Clear Point battery, drawn in the same frame as the poster designs so the van list reads as one set */
function batteryThumb(size=40, charge=3){
  const h = size*1.3;
  return `<svg class="thumb" viewBox="0 0 32 52" width="${size}" height="${h}" aria-hidden="true"><rect x=".5" y=".5" width="31" height="51" style="fill:var(--raised);stroke:var(--line)"/>
    <rect x="13" y="8" width="6" height="3" style="fill:var(--fg)"/><rect x="9" y="11" width="14" height="28" style="fill:none;stroke:var(--fg);stroke-width:1.6"/>
    ${[0,1,2].map(i=>`<rect x="12" y="${31-i*8}" width="8" height="5" style="fill:${i<charge?'var(--fg)':'none'};stroke:${i<charge?'none':'var(--fg-50)'};stroke-width:1"/>`).join('')}
    <rect x="5" y="44" width="10" height="2" style="fill:var(--fg-50)"/></svg>`;
}

/* today's route (Marcus Lee, started 08:50) */
const posterAt = (shop, n) => n ? POSTERS.find(p=>p.n===n) : POSTERS.find(p=>p.shop===shop);
const STOPS = [
  {id:'uptown', name:'Uptown Barber', city:'Redlands', where:'E Citrus Ave', eta:'09:05', tasks:[{kind:'poster', n:12, t:'Swap P-012', done:'09:12', out:'Replaced', photo:1}]},
  {id:'shoe', name:'Valley Shoe Repair', city:'Redlands', where:'State St', eta:'09:30', tasks:[{kind:'poster', n:81, t:'Swap P-081', done:'09:41', out:'Replaced', photo:1}]},
  {id:'pet', name:'Brookside Pet Wash', city:'Redlands', where:'Brookside Ave', eta:'10:00', tasks:[{kind:'poster', shop:'Brookside Pet Wash', t:'Check the poster', done:'10:08', out:'Checked'}]},
  {id:'orange', name:'Orange St. Laundromat', city:'Redlands', where:'N Orange St', eta:'10:30', tasks:[{kind:'poster', n:27, t:'Swap P-027'},{kind:'device', t:'Plug in the counter Clear Point', note:'Offline since 08:40'}]},
  {id:'mesa', name:'Mesa Laundry', city:'San Bernardino', where:'W Highland Ave', eta:'11:15', tasks:[{kind:'poster', n:44, t:'Replace P-044', note:'Sun-faded, 4 days late'}]},
  {id:'bmkt', name:'Bloomington Market', city:'Bloomington', where:'Valley Blvd', eta:'11:50', tasks:[{kind:'poster', n:55, t:'Swap P-055'}]},
  {id:'citrus', name:'Citrus Bowl Café', city:'Riverside', where:'Main St', eta:'12:40', tasks:[{kind:'device', t:'Swap the battery on table 4', note:'Battery low since 19:12'}]},
  {id:'tailor', name:'Sixth St. Tailor', city:'Riverside', where:'Sixth St', eta:'13:20', tasks:[{kind:'poster', n:71, t:'Replace P-071', note:'Faded'},{kind:'merchant', t:'Follow up on the merchant app', note:'From Merchants · signed in Sep, hasn’t charged anyone yet'}]} ];
STOPS.forEach(s=>s.tasks.forEach(t=>{ if (t.kind==='poster'){ const p = posterAt(t.shop, t.n); t.p = p; if (t.shop) t.t = `Check ${pid(p.n)}`; } }));
const SHOP_INFO = {uptown:['8 pm','Andre','12 Sep'], shoe:['6 pm','Luis','2 Sep'], pet:['7 pm','Kim','29 Sep'], orange:['10 pm','Ms. Tran','26 Aug'], mesa:['11 pm','Dana','19 Oct'], bmkt:['9 pm','Hector','24 Aug'], citrus:['3 pm','Sofia','14 Oct'], tailor:['6 pm','Mr. Ruiz','30 Aug']};
const OUT = {Checked:['settled','Up and fine'], Damaged:['underway','Torn, faded or wet'], Replaced:['settled','New poster up'], Missing:['absent','Gone from the window']};
const VAN = {A:4, B:3, C:2};
const PEOPLE_F = { marcus:['Marcus Lee','ML'], dana:['Dana Ruiz','DR'], kai:['Kai','KK'] };
/* who can take routes: anyone whose group has Field access (set in Permissions). Priya is on the team but has no Field access. */
const TEAM = { kai:{ n:'Kai', ini:'KK', role:'Admin', field:true, admin:true }, marcus:{ n:'Marcus Lee', ini:'ML', role:'Field', field:true }, dana:{ n:'Dana Ruiz', ini:'DR', role:'Ops', field:true }, priya:{ n:'Priya Shah', ini:'PS', role:'Finance', field:false } };

/* waiting by city — Members' waitlist (1,500) */
const WAITING_BY_CITY = { Redlands:447, 'San Bernardino':389, Riverside:265, Fontana:94, 'Loma Linda':68, Colton:63, Highland:62, Rialto:60, Yucaipa:52 };
/* merchants in each city: live on the merchant app, and signing (Merchants page) */
const LIVE_BY_CITY = { Redlands:7, 'San Bernardino':4, Riverside:1, Highland:1 };
const SIGNING_BY_CITY = { Redlands:1 };

/* geography: a drawn map, not a street map. lat/lon of each city's centre */
const GEO = { Riverside:[33.9806,-117.3755], 'Grand Terrace':[34.0339,-117.3134], Colton:[34.0739,-117.3137], Bloomington:[34.0703,-117.3959], Fontana:[34.0922,-117.4350],
  Rialto:[34.1064,-117.3703], 'San Bernardino':[34.1083,-117.2898], Highland:[34.1283,-117.2086], 'Loma Linda':[34.0483,-117.2611], Redlands:[34.0556,-117.1825],
  Mentone:[34.0700,-117.1340], Yucaipa:[34.0336,-117.0431], Calimesa:[34.0039,-117.0617] };
/* the same drawn geography as Merchants' corridor map: hills, badlands, the Santa Ana River, the street grid and the freeways */
const GEO2 = {
  hills: [[-117.70,34.40],[-117.70,34.19],[-117.55,34.185],[-117.45,34.178],[-117.36,34.172],[-117.30,34.168],[-117.25,34.155],[-117.20,34.142],[-117.14,34.128],[-117.07,34.118],[-116.98,34.105],[-116.85,34.10],[-116.85,34.40]],
  badl: [[-117.30,33.985],[-117.27,34.012],[-117.22,34.026],[-117.15,34.020],[-117.095,34.004],[-117.075,33.975],[-117.09,33.93],[-117.20,33.90],[-117.29,33.93]],
  jurupa: [[-117.52,34.032],[-117.46,34.046],[-117.42,34.040],[-117.41,34.020],[-117.45,34.004],[-117.52,34.008]],
  river: [[-116.98,34.115],[-117.09,34.098],[-117.15,34.088],[-117.21,34.080],[-117.26,34.072],[-117.30,34.058],[-117.33,34.035],[-117.36,34.008],[-117.40,33.988],[-117.44,33.964],[-117.52,33.930],[-117.60,33.90]],
  fwy: {
    '10':  [[-117.70,34.071],[-117.47,34.070],[-117.40,34.068],[-117.33,34.066],[-117.29,34.064],[-117.25,34.062],[-117.20,34.059],[-117.15,34.050],[-117.10,34.038],[-117.06,34.010],[-117.04,33.975],[-117.00,33.93],[-116.90,33.90]],
    '215': [[-117.22,33.84],[-117.30,33.94],[-117.33,33.975],[-117.325,34.02],[-117.31,34.05],[-117.305,34.075],[-117.295,34.11],[-117.31,34.15],[-117.38,34.24]],
    '210': [[-117.70,34.132],[-117.47,34.131],[-117.38,34.130],[-117.30,34.131],[-117.24,34.128],[-117.20,34.118],[-117.185,34.09],[-117.18,34.062]],
    '60':  [[-117.70,34.02],[-117.47,34.005],[-117.40,33.99],[-117.345,33.978],[-117.33,33.975],[-117.30,33.94],[-117.22,33.937],[-116.95,33.93]],
    '15':  [[-117.55,33.80],[-117.53,33.98],[-117.52,34.07],[-117.48,34.20]] },
  shields: [['10',-117.375,34.067],['215',-117.326,34.0],['210',-117.42,34.1305],['60',-117.455,33.999],['10',-117.08,34.026],['215',-117.30,34.095],['210',-117.215,34.123]] };
const pip = (pt, poly) => { let ins = false; for (let i=0, j=poly.length-1; i<poly.length; j=i++){ const [xi,yi] = poly[i], [xj,yj] = poly[j]; if (((yi>pt[1])!==(yj>pt[1])) && (pt[0] < (xj-xi)*(pt[1]-yi)/(yj-yi)+xi)) ins = !ins; } return ins; };
const KX = Math.cos(34.05*Math.PI/180), FULL = [-117.47,-117.01,33.955,34.150];
/* where the route's shops actually are (approximately, on the streets the route names) */
const SHOP_LL = { 'Uptown Barber':[34.0560,-117.1795], 'Valley Shoe Repair':[34.0556,-117.1838], 'Brookside Pet Wash':[34.0478,-117.2032], 'Orange St. Laundromat':[34.0628,-117.1828],
  'Mesa Laundry':[34.1361,-117.3002], 'Bloomington Market':[34.0641,-117.3960], 'Citrus Bowl Café':[33.9818,-117.3754], 'Sixth St. Tailor':[33.9853,-117.3718],
  'Victoria Ave. Florist':[33.9310,-117.4040], 'Magnolia Laundry':[33.9440,-117.4010], 'Calimesa Cleaners':[34.0040,-117.0600], 'Cajon Phone Repair':[34.1205,-117.2990],
  'Highland Hardware':[34.1290,-117.2070], 'Sierra Lakes Barber':[34.1440,-117.4380] };
const hashN = s => { let h = 7; for (const c of s) h = (h*31 + c.charCodeAt(0)) % 9973; return h; };
const shopLL = (name, city) => { if (SHOP_LL[name]) return SHOP_LL[name]; const [la,lo] = GEO[city];
  const h = hashN(name), a = (h % 360)*Math.PI/180, d = .004 + (h % 9)*.001; return [la + Math.sin(a)*d, lo + Math.cos(a)*d/KX]; };
/* a map is a projection fitted to some bounds at a given width:height. Lines are SVG; pins and labels are HTML laid over it,
   so they keep their size whatever the map's size. */
function mkMap(bounds, aspect){
  let [lo0,lo1,la0,la1] = bounds; const w = (lo1-lo0)*KX, h = la1-la0;
  if (w/h < aspect){ const d = (h*aspect - w)/KX/2; lo0 -= d; lo1 += d; } else { const d = (w/aspect - h)/2; la0 -= d; la1 += d; }
  const W = 1000, H = W/aspect, p = (la,lo) => [ (lo-lo0)/(lo1-lo0)*W, (la1-la)/(la1-la0)*H ];
  return { W, H, aspect, p, at:(la,lo) => { const [x,y] = p(la,lo); return `left:${(x/W*100).toFixed(2)}%;top:${(y/H*100).toFixed(2)}%`; }, inside:(la,lo)=>lo>lo0&&lo<lo1&&la>la0&&la<la1 };
}
const boundsOf = (pts, pad=.02) => { const lo = pts.map(p=>p[1]), la = pts.map(p=>p[0]); return [Math.min(...lo)-pad, Math.max(...lo)+pad, Math.min(...la)-pad, Math.max(...la)+pad]; };
function areaMap(m, { svg='', pins='', cls='', labelGap=null } = {}){
  const G = GEO2, P = (pts, close) => 'M' + pts.map(([g,t])=>m.p(t,g).map(v=>v.toFixed(1)).join(',')).join(' L') + (close?' Z':'');
  const h = (a,b) => { const s = Math.sin(a*12.9898+b*78.233)*43758.5453; return s-Math.floor(s); };
  const off = (g,t) => pip([g,t], G.hills) || pip([g,t], G.badl) || pip([g,t], G.jurupa) || t<33.92 || (g>-117.13 && t<34.0);
  const st = []; // minor streets: a broken grid, thinner to the east where it is less built up
  for (let t=33.93; t<=34.17; t+=0.0065) for (let g=-117.62; g<-116.96; g+=0.026){ const g2 = g+0.026; if (h(g,t) > (g>-117.15 ? .62 : .28) && !off(g,t) && !off(g2,t)) st.push(P([[g,t],[g2,t]])); }
  for (let g=-117.62; g<=-116.96; g+=0.0075) for (let t=33.93; t<34.17; t+=0.022){ const t2 = t+0.022; if (h(t,g) > (g>-117.15 ? .62 : .28) && !off(g,t) && !off(g,t2)) st.push(P([[g,t],[g,t2]])); }
  const ar = []; // main roads on the real grid
  [34.136,34.106,34.077,34.048].forEach(t=>ar.push(P([[-117.66,t],[t>34.06?-117.12:-117.24,t]])));
  ar.push(P([[-117.52,33.975],[-117.30,33.975]]));
  [-117.435,-117.37,-117.31,-117.27,-117.20,-117.16].forEach(g=>ar.push(P([[g, g>-117.3?34.03:33.99],[g, g>-117.22?34.135:34.162]])));
  [-117.40,-117.36].forEach(g=>ar.push(P([[g,33.93],[g,34.0]])));
  ar.push(P([[-117.085,34.085],[-117.06,34.04],[-117.04,33.995]]));
  const fw = Object.values(G.fwy).map(p=>P(p)).join(' ');
  const base = `<path class="fb-hl" d="${P(G.hills,1)}"/><path class="fb-hl lo" d="${P(G.badl,1)}"/><path class="fb-hl lo" d="${P(G.jurupa,1)}"/>
    <path class="fb-st" d="${st.join(' ')}"/><path class="fb-wt" d="${P(G.river)}"/><path class="fb-ar" d="${ar.join(' ')}"/><path class="fb-fc" d="${fw}"/><path class="fb-fw" d="${fw}"/>`;
  const shields = G.shields.filter(([,g,t])=>m.inside(t,g)).map(([n,g,t])=>{ const [x,y] = m.p(t,g); return x > m.W*.06 && x < m.W*.94 && y > m.H*.06 && y < m.H*.94 ? `<span class="fm-fl" style="${m.at(t,g)}">${n}</span>` : ''; }).join('');
  const cities = Object.entries(GEO).filter(([c,[la,lo]])=>m.inside(la,lo)).map(([c,[la,lo]])=>`<span class="fm-cl" style="${m.at(la,lo)};${labelGap ? `--g:${labelGap(c)}px` : ''}">${c}</span>`).join('');
  return `<div class="fmw ${cls}" style="aspect-ratio:${m.aspect.toFixed(3)}"><svg viewBox="0 0 ${m.W} ${m.H.toFixed(1)}" preserveAspectRatio="none" aria-hidden="true">${base}${svg}</svg>${shields}${cities}${pins}</div>`;
}
/* things that need a visit but aren't on today's route — the Plan tab's pool */
const POOL = (() => {
  const onToday = new Set(STOPS.flatMap(s=>s.tasks.filter(t=>t.p).map(t=>t.p.n)));
  const out = [];
  POSTERS.filter(p=>!onToday.has(p.n) && (p.status!=='up' || daysTo(p.swap) <= 12)).sort((a,b)=>a.swap-b.swap).forEach(p=>{
    const st = p.status==='missing' ? 'Missing' : p.status==='faded' ? 'Faded' : daysTo(p.swap) < 0 ? 'Swap late' : 'Swap due';
    out.push({ id:'p'+p.n, kind:'poster', shop:p.shop, city:p.city, what:`${st==='Missing'?'Put up a new':st==='Faded'?'Replace':'Swap'} ${pid(p.n)}`, why: st==='Missing' ? 'Gone from the window' : st==='Faded' ? 'Faded in the sun' : daysTo(p.swap)<=0 ? `${-daysTo(p.swap)} days late` : `Due ${fmtD(p.swap)}`, design:p.design, sev: st==='Missing'?'absent':st==='Faded'||st==='Swap late'?'underway':'line', mins:18, n:p.n }); });
  // merchant work, from the Merchants pipeline: prospect walk-ins, follow-ups, demos, signings
  [['m1','Mission Auto Care','Redlands','Demo the merchant app','Demo set for Thu 22 Oct','talking','marcus',9000,40],
   ['m2','Orange Show Tires','San Bernardino','Bring the numbers','Asked for pricing','talking','marcus',7500,30],
   ['m3','Sun Valley HVAC','Highland','Ride-along with the owner','Set for Fri','talking','marcus',12000,60],
   ['m4','Barton Rd. Appliance','Grand Terrace','Second visit','Liked the first pitch','talking','dana',5500,30],
   ['m5','Tri-City Transmission','San Bernardino','Talk terms','Wants NET-14 instead of NET-30','talking','marcus',8000,30],
   ['m6','Inland Cycle Works','Redlands','Sign the agreement','Founding seat 4 of 5','signing','kai',0,30],
   ['m7','Cypress Dental','Redlands','Meet the owner','Owner call Mon, visit after','talking','kai',6000,30],
   ['m8','Redlands Smog & Brake','Redlands','Walk in','Prospect · never visited','prospect','marcus',5000,15],
   ['m9','IE Mattress Outlet','Colton','Walk in','Prospect · never visited','prospect','dana',6500,15],
   ['m10','Fontana Furniture','Fontana','Walk in','Prospect · never visited','prospect','dana',7000,15]]
  .forEach(([id,shop,city,what,why,stage,owner,val,mins])=>out.push({ id, kind:'merchant', shop, city, what, why, stage, owner, val, mins, sev: stage==='signing' ? 'underway' : stage==='talking' ? 'live' : 'line' }));
  out.push({ id:'d1', kind:'device', shop:'Cajon Phone Repair', city:'San Bernardino', what:'Re-pair the Tap reader', why:'From Merchants · since Monday', sev:'underway', mins:20 });
  out.push({ id:'d2', kind:'device', shop:'Highland Hardware', city:'Highland', what:'Drop off a receipt roll', why:'From Merchants · asked yesterday', sev:'line', mins:10 });
  out.push({ id:'n1', kind:'new', shop:'Magnolia Laundry', city:'Riverside', what:'Put up a first poster', why:'From Placement · owner said yes', sev:'live', mins:25, design:'B' });
  out.push({ id:'n2', kind:'new', shop:'Sierra Lakes Barber', city:'Fontana', what:'Put up a first poster', why:'From Placement · owner said yes', sev:'live', mins:25, design:'B' });
  return out;
})();
/* the coming week: routes already planned */
const WEEK = [ // day offset, who, stop ids (from POOL), planned
  {d:0, who:'marcus', live:true}, {d:1, who:'marcus', ids:[]}, {d:2, who:'dana', ids:[]}, {d:5, who:'marcus', ids:[]}, {d:6, who:null, ids:[]}, {d:7, who:null, ids:[]} ];


/* ══ Shop data — products built from materials, the materials library, suppliers, batches and orders ═════════════
   Demo "today" is Wed 21 Oct 2026, 14:00. The shop opened 1 Sep. Costs use the average of what's on hand; the last price
   paid shows beside it. Materials kept on hand are used up when a batch is made; made-to-order costs are charged per piece. */
const DAY = 864e5, TODAY = Date.UTC(2026,9,21), NOW = TODAY + 14*3600e3;
const D = (m, d, y=2026) => Date.UTC(y, m-1, d);
const H = (m, d, h, mi=0) => Date.UTC(2026, m-1, d, h, mi);
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const fmtD = t => `${new Date(t).getUTCDate()} ${MON[new Date(t).getUTCMonth()]}`;
const WD = t => new Date(t).toLocaleDateString('en-US',{weekday:'short', timeZone:'UTC'});
const hm = t => new Date(t).toISOString().slice(11,16);
const leaf = t => `<span class="leaf"><span>${WD(t)}</span><b>${new Date(t).getUTCDate()}</b><span>${MON[new Date(t).getUTCMonth()]}</span></span>`;
const ago = t => { const m = Math.round((NOW - t)/6e4); if (m < 60) return `${Math.max(1,m)} min ago`; const h = Math.round(m/60); if (h < 24) return `${h} h ago`; const d = Math.round(h/24); return d===1 ? 'yesterday' : `${d} days ago`; };
const money = n => (n<0?'−':'') + '$' + Math.abs(n).toLocaleString('en-US',{minimumFractionDigits:2, maximumFractionDigits:2});
const money0 = n => '$' + Math.round(n).toLocaleString('en-US');
const pct = (a,b,d=0) => (b ? a/b*100 : 0).toFixed(d) + '%';
const int = n => Math.round(n).toLocaleString('en-US');

const SIZES = ['XS','S','M','L','XL','XXL'];
const WEEKS = ['1 Sep','8 Sep','15 Sep','22 Sep','29 Sep','6 Oct','13 Oct','20 Oct'];
const TARGET = 0.60;                          /* the shop-wide margin the co-op aims for */
const PPL = { kai:{n:'Kai', ini:'K', staff:true}, dana:{n:'Dana Ruiz', ini:'DR', staff:true}, viewer:{n:'Viewer', ini:'VW'} };

/* who sells us what */
const SUPPLIERS = [
  { id:'wcb', n:'Westcoast Blanks', city:'Los Angeles', what:'Tees, long sleeves and turtlenecks', lead:7, terms:'Net 15', min:'24 per colour', breaks:[[24,0],[72,.04],[144,.08]], last:D(10,14) },
  { id:'hws', n:'Heavyweight Supply', city:'Commerce', what:'Fleece hoodies', lead:14, terms:'Paid upfront', min:'60', breaks:[[60,0],[120,.05]], last:D(10,2) },
  { id:'isp', n:'Inland Screen Print', city:'San Bernardino', what:'Screen and photo printing, per piece', lead:5, terms:'Net 7', min:'12 per run', breaks:[[12,0],[48,.06],[96,.10]], last:D(10,14) },
  { id:'sth', n:'Stitch House', city:'Riverside', what:'Embroidery, per piece', lead:6, terms:'Net 7', min:'12 per run', breaks:[[12,0],[36,.05]], last:D(9,24) },
  { id:'pwc', n:'Patchworks Co.', city:'Online', what:'Woven patches', lead:21, terms:'Paid upfront', min:'200', breaks:[[200,0],[500,.12]], last:D(8,28) },
  { id:'rlc', n:'Redlands Label Co.', city:'Redlands', what:'Neck labels and hem tags', lead:10, terms:'Net 15', min:'500', breaks:[[500,0],[1000,.10]], last:D(8,22) },
  { id:'pac', n:'Pacific Packaging', city:'Ontario', what:'Mailers, bags, tissue and labels', lead:4, terms:'Card', min:'None', breaks:[[100,0],[500,.07]], last:D(10,9) } ];
const SUP = Object.fromEntries(SUPPLIERS.map(s=>[s.id,s]));

/* the materials library. kind: stock (kept on hand) · mto (made to order, charged per piece) · order (once per order).
   avg: average cost of what's on hand · last: last price paid · var: extra cost for some sizes or colours
   buys: [date, units, paid] · hand: on hand · min: reorder point · unit: what one is */
const INPUTS = [
  { id:'blk-ss', n:'Blank tee · short sleeve', kind:'stock', unit:'tee', sup:'wcb', avg:10.18, last:10.40, hand:46, var:{XXL:1.20, Cobalt:0.40},
    buys:[[D(8,20),144,1411.20],[D(10,14),72,748.80]], note:'Heavyweight 6.5 oz, long body. Westcoast raised the price 40¢ on 14 Oct.' },
  { id:'blk-ls', n:'Blank tee · long sleeve', kind:'stock', unit:'tee', sup:'wcb', avg:11.90, last:11.90, hand:30, var:{XXL:1.40}, buys:[[D(9,8),72,856.80]] },
  { id:'blk-tn', n:'Turtleneck blank · rib knit', kind:'stock', unit:'piece', sup:'wcb', avg:16.40, last:16.40, hand:3, var:{XXL:1.60}, buys:[[D(8,25),24,393.60],[D(9,30),12,196.80]] },
  { id:'blk-hd', n:'Hoodie blank · heavy fleece', kind:'stock', unit:'piece', sup:'hws', avg:26.80, last:25.46, hand:0, var:{XXL:2.00}, buys:[[D(8,18),24,643.20]], incoming:[120,D(10,30),3055.20], note:'120 on the way at $25.46, the 120-piece price. The average drops when they land.' },
  { id:'prt-1', n:'Screen print · one colour', kind:'mto', unit:'print', sup:'isp', avg:4.60, last:4.60, note:'Chest logo. A $35.00 screen fee per new design, already paid for the logo.' },
  { id:'prt-dtg', n:'Photo print · full colour', kind:'mto', unit:'print', sup:'isp', avg:5.80, last:5.80, var:{XXL:0.60} },
  { id:'prt-hd', n:'Puff print · chest and back', kind:'mto', unit:'print', sup:'isp', avg:6.40, last:6.40 },
  { id:'emb', n:'Embroidered logo', kind:'mto', unit:'piece', sup:'sth', avg:5.20, last:5.20 },
  { id:'lbl-n', n:'Woven neck label', kind:'stock', unit:'label', sup:'rlc', avg:0.85, last:0.85, hand:612, buys:[[D(8,22),1000,850.00]] },
  { id:'lbl-h', n:'Hem tag', kind:'stock', unit:'tag', sup:'rlc', avg:0.35, last:0.35, hand:540, buys:[[D(8,22),1000,350.00]] },
  { id:'bag', n:'Fold bag · clear', kind:'stock', unit:'bag', sup:'pac', avg:0.30, last:0.28, hand:260, buys:[[D(8,30),300,90.00],[D(10,9),200,56.00]] },
  { id:'pt-sq', n:'Woven patch · square', kind:'stock', unit:'patch', sup:'pwc', avg:1.60, last:1.60, hand:136, buys:[[D(8,28),200,320.00]] },
  { id:'pt-ci', n:'Woven patch · circle', kind:'stock', unit:'patch', sup:'pwc', avg:1.60, last:1.60, hand:142, buys:[[D(8,28),200,320.00]] },
  { id:'card', n:'Backer card', kind:'stock', unit:'card', sup:'pac', avg:0.20, last:0.20, hand:150, buys:[[D(8,30),400,80.00]] },
  { id:'mail', n:'Poly mailer · 10 × 13', kind:'order', stock:1, unit:'mailer', sup:'pac', avg:0.42, last:0.42, hand:140, buys:[[D(8,30),300,126.00]] },
  { id:'tis', n:'Tissue and sticker', kind:'order', stock:1, unit:'set', sup:'pac', avg:0.18, last:0.18, hand:180, buys:[[D(8,30),300,54.00]] },
  { id:'thl', n:'Thermal label · 4 × 6', kind:'order', stock:1, unit:'label', sup:'pac', avg:0.04, last:0.04, hand:410, buys:[[D(8,30),500,20.00]] } ];
const INP = Object.fromEntries(INPUTS.map(i=>[i.id,i]));
const KIND = { stock:['Kept on hand','Bought ahead and counted. Used up when a batch is made.'], mto:['Made to order','Charged per piece when it’s made. Nothing on hand.'], order:['Once per order','Packing for the whole order, not each item.'] };
const MIN_WEEKS = 1;                           /* reorder when stock lasts less than the supplier's lead time plus this */

/* products. cost: 'recipe' (built from materials: [input, amount]) or 'flat' (one cost per product; est = an estimate) */
const LINES = { logo:['Logo Tees','var(--fg)'], graphic:['Graphic Tees','var(--land)'], layers:['Layers','color-mix(in srgb,var(--fg) 55%,transparent)'], patch:['Patches','var(--underway)'], hw:['Hardware pre-orders','var(--line)'] };
const SHELF = { on:['On the shelf','var(--settled)'], off:['Off the shelf','var(--underway)'], draft:['Draft','var(--line)'], arch:['Archived','var(--line)'] };
const PR = [
  {id:'lts', n:'Logo Tee', v:'Short sleeve', line:'logo', g:'tee', price:46, st:'on', cols:['Black','White'], wk:[6,9,8,7,8,9,7,7],
    recipe:[['blk-ss',1],['prt-1',1],['lbl-n',1],['lbl-h',1],['bag',1]]},
  {id:'ltl', n:'Logo Tee', v:'Long sleeve', line:'logo', g:'ls', price:54, st:'on', cols:['Black','White'], wk:[0,0,3,4,3,4,3,4],
    recipe:[['blk-ls',1],['prt-1',1],['lbl-n',1],['lbl-h',1],['bag',1]]},
  {id:'tn', n:'Turtleneck', v:'Rib knit', line:'layers', g:'turtle', price:72, st:'on', cols:['Black'], wk:[2,3,2,3,2,2,3,2],
    recipe:[['blk-tn',1],['emb',1],['lbl-n',1],['lbl-h',1],['bag',1]]},
  {id:'hd', n:'Hoodie', v:'Heavy fleece', line:'layers', g:'hood', price:98, st:'off', cols:['Black'], wk:[3,4,3,4,4,2,0,0], why:'Sold out 9 Oct · 120 arrive 30 Oct',
    recipe:[['blk-hd',1],['prt-hd',1],['lbl-n',1],['lbl-h',1],['bag',1]]},
  {id:'gcm', n:'Graphic Tee', v:'Carousel Mall', line:'graphic', g:'gtee', price:44, st:'on', cols:['Black','Cobalt','White'], wk:[0,0,0,0,4,5,4,4],
    recipe:[['blk-ss',1],['prt-dtg',1],['lbl-n',1],['lbl-h',1],['bag',1]]},
  {id:'gtt', n:'Graphic Tee', v:'Two Ten Overpass', line:'graphic', g:'gtee', price:44, st:'on', cols:['Black','Cobalt','White'], wk:[0,0,0,0,4,3,0,2],
    recipe:[['blk-ss',1],['prt-dtg',1],['lbl-n',1],['lbl-h',1],['bag',1]]},
  {id:'gdv', n:'Graphic Tee', v:'Devore', line:'graphic', g:'gtee', price:44, st:'draft', cols:['Black','Cobalt','White'], wk:[0,0,0,0,0,0,0,0], why:'Sample arrives 28 Oct',
    flat:18.20, est:1, note:'Quoted by Inland Screen Print before the sample. Build it from materials once it’s priced.'},
  {id:'psq', n:'Clear patch', v:'Square', line:'patch', g:'psq', price:9, st:'on', cols:['One size'], wk:[0,4,5,6,5,6,5,6], recipe:[['pt-sq',1],['card',1],['bag',1]]},
  {id:'pci', n:'Clear patch', v:'Circle', line:'patch', g:'pci', price:9, st:'on', cols:['One size'], wk:[0,3,4,5,4,5,5,5], recipe:[['pt-ci',1],['card',1],['bag',1]]},
  {id:'cpt', n:'Clear Point', v:'Counter or table', line:'hw', g:'point', price:60, dep:1, st:'on', cols:['Counter','Table'], wk:[0,0,0,0,0,3,0,0], flat:52, est:1, note:'Deposit. Costed when the first build is quoted in November.'},
  {id:'c8', n:'Clear Counter', v:'8-inch', line:'hw', g:'tab', price:140, dep:1, st:'on', cols:['8-inch'], wk:[0,0,0,0,0,1,1,0], flat:118, est:1, note:'Deposit. Refurbished tablet, case and mount.'},
  {id:'c10', n:'Clear Counter', v:'10-inch', line:'hw', g:'tab', price:180, dep:1, st:'draft', cols:['10-inch'], wk:[0,0,0,0,0,0,0,0], flat:150, est:1, why:'Waiting on the enclosure'} ];
const PRO = Object.fromEntries(PR.map(p=>[p.id,p]));
const STK = { /* finished goods on hand, by colour, XS → XXL */
  lts:{Black:[4,11,18,16,9,3], White:[2,6,9,3,5,1]}, ltl:{Black:[3,8,12,10,6,2], White:[1,4,6,5,3,0]}, tn:{Black:[0,1,2,1,1,0]}, hd:{Black:[0,0,0,0,0,0]},
  gcm:{Black:[2,5,7,6,4,1], Cobalt:[1,4,5,4,2,0], White:[2,4,6,5,3,1]}, gtt:{Black:[1,3,4,4,2,1], Cobalt:[2,6,9,8,4,2], White:[0,2,3,2,1,0]},
  gdv:{Black:[0,0,0,0,0,0], Cobalt:[0,0,0,0,0,0], White:[0,0,0,0,0,0]}, psq:{'One size':[64]}, pci:{'One size':[58]} };

/* batches: made from materials, cost locked at the time */
const BATCHES = [ /* id, product, colour, units, date, cost per unit, state */
  ['B-016','lts','White',24,D(10,14),16.38,'done'], ['B-015','gtt','Cobalt',36,D(10,19),17.10,'done'], ['B-014','gcm','Black',36,D(9,29),16.90,'done'],
  ['B-013','psq','',100,D(9,8),2.10,'done'], ['B-012','hd','Black',120,D(10,30),33.36,'planned'], ['B-017','tn','Black',12,D(10,28),23.10,'short'] ];

/* orders and the costs that come once per order */
const SHIP = { charged:6.00, label:7.40 };       /* flat $6 shipping charged; the label costs more */
const FEE = { pct:0.029, fixed:0.30 };
const ORDERS = [ /* id, time, who, member, items [product, colour, size, qty], paid with, how, state */
  ['1094',H(10,21,12,40),'Ana R.',1,[['lts','Black','M',1],['pci','One size','',1]],'clear','ship','paid'],
  ['1093',H(10,21,10,5),'Jordan P.',0,[['gcm','Cobalt','L',1]],'card','ship','paid'],
  ['1092',H(10,20,19,22),'Mia T.',1,[['ltl','White','S',1]],'clear','pickup','paid'],
  ['1091',H(10,20,16,10),'Chris D.',0,[['tn','Black','M',1]],'wallet','ship','paid'],
  ['1090',H(10,20,9,30),'Leo M.',1,[['psq','One size','',2],['pci','One size','',1]],'clear','ship','paid'],
  ['1089',H(10,19,18,0),'Sam K.',1,[['lts','White','L',2]],'clear','ship','packed'],
  ['1088',H(10,19,13,15),'Nina V.',0,[['gtt','Black','M',1]],'card','pickup','ready'],
  ['1087',H(10,19,11,0),'Omar H.',1,[['ltl','Black','L',1],['psq','One size','',1]],'clear','ship','packed'],
  ['1086',H(10,18,15,30),'Tess W.',1,[['lts','Black','S',1]],'clear','pickup','ready'],
  ['1085',H(10,18,9,45),'Ben A.',0,[['tn','Black','L',1]],'card','ship','shipped'],
  ['1084',H(10,17,17,20),'Kim L.',1,[['gcm','White','M',1]],'clear','ship','shipped'],
  ['1083',H(10,17,12,0),'Ray C.',0,[['lts','Black','XXL',1]],'wallet','ship','shipped'],
  ['1082',H(10,16,20,10),'Ivy N.',1,[['pci','One size','',3]],'clear','ship','shipped'],
  ['1081',H(10,16,14,0),'Dev S.',1,[['ltl','Black','M',1]],'clear','ship','shipped'],
  ['1080',H(10,15,11,40),'Lia F.',0,[['gcm','Black','S',1]],'card','ship','done'],
  ['1079',H(10,9,10,15),'Theo B.',1,[['hd','Black','M',1]],'clear','ship','refund'] ];
const OST = { paid:['To pack','var(--live)'], packed:['Packed','var(--fg)'], shipped:['On the way','var(--fg-50)'], ready:['Ready for pickup','var(--underway)'], done:['Delivered','var(--settled)'], refund:['Refund waiting','var(--absent)'] };
const PAY = { clear:'Clear', card:'Card', wallet:'Apple or Google Pay' };
/* pickup points: partner shops that hold orders; held 14 days, then we message the member */
const POINTS = { mesa:{ n:'Mesa Laundry', city:'San Bernardino', wk4:8 }, tire:{ n:'Redlands Tire & Lube', city:'Redlands', wk4:6 } };
const PICKUP_AT = { '1092':'mesa', '1088':'mesa', '1086':'tire' }, HOLD_DAYS = 14;
const LINE_COSTS = [['Samples and proofs',185],['Photos for new products',240],['Shop software',39],['Label printer rolls',36]];

/* cost changes, for the record */
const CHANGES = [ /* date, material, from, to, why */
  [D(10,14),'blk-ss',9.80,10.40,'Westcoast raised the short-sleeve price'], [D(10,9),'bag',0.30,0.28,'Bought 200 at the 500 price'], [D(10,2),'blk-hd',26.80,25.46,'Ordered 120, the volume price'], [D(9,8),'prt-dtg',6.20,5.80,'Moved photo prints to Inland'] ];

/* line drawings, one per kind of product */
const GLY = {
  tee:'<path d="M14 7 6.5 11l3 6 3.5-1.6V33h14V15.4l3.5 1.6 3-6L26 7c-1.2 2-3.4 3-6 3s-4.8-1-6-3Z"/><path d="M15.6 7.6c1.1 1.5 2.6 2.2 4.4 2.2s3.3-.7 4.4-2.2"/>',
  gtee:'<path d="M14 7 6.5 11l3 6 3.5-1.6V33h14V15.4l3.5 1.6 3-6L26 7c-1.2 2-3.4 3-6 3s-4.8-1-6-3Z"/><rect x="16" y="15" width="8" height="7"/>',
  ls:'<path d="M14 7 8.5 9.5 5 30l3.6.8L13 16.5V33h14V16.5l4.4 14.3L35 30 31.5 9.5 26 7c-1.2 2-3.4 3-6 3s-4.8-1-6-3Z"/><path d="M15.6 7.6c1.1 1.5 2.6 2.2 4.4 2.2s3.3-.7 4.4-2.2"/>',
  turtle:'<path d="M15.5 8 8.5 10 5 30l3.6.8L13 16.5V33h14V16.5l4.4 14.3L35 30 31.5 10l-7-2"/><path d="M16 3.5h8V8c-1.1 1-2.5 1.6-4 1.6S17.1 9 16 8Z"/>',
  hood:'<path d="M14.5 7.5 8.5 10 5 30l3.6.8L13 16.5V33h14V16.5l4.4 14.3L35 30 31.5 10l-6-2.5"/><path d="M14.5 9.5C14 5 16.6 2.5 20 2.5s6 2.5 5.5 7c-1.4 1.3-3.4 2-5.5 2s-4.1-.7-5.5-2Z"/><path d="M15.5 25h9l1 5h-11Z"/>',
  psq:'<rect x="8.5" y="8.5" width="23" height="23"/><rect x="12" y="12" width="16" height="16" stroke-dasharray="2 2.2"/><circle cx="20" cy="20" r="3.2"/>',
  pci:'<circle cx="20" cy="20" r="12"/><circle cx="20" cy="20" r="8.6" stroke-dasharray="2 2.2"/><circle cx="20" cy="20" r="3.2"/>',
  point:'<rect x="6.5" y="9" width="27" height="17"/><path d="M10.5 13.5h9M10.5 17h13M10.5 20.5h6"/><rect x="25.5" y="17.5" width="4.5" height="4.5"/><path d="M15 31h10M20 26v5"/>',
  tab:'<rect x="9" y="6.5" width="22" height="27" rx="1.5"/><path d="M18 30.2h4"/><path d="M12.5 10.5h15v16h-15Z" stroke-dasharray="2 2.2"/>' };

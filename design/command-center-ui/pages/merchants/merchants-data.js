
/* ══ Merchants data — the artifact's own figures, joined to Field's leads, visits and routes ══════════════
   30 partners: 12 transacting (Uptown Barber signed today), 1 signing (Inland Cycle Works, founding seat 4 of 5), 17 signed for posters
   and $10 redemptions only. 14 prospects in the pipeline (7 talking, 7 not visited yet). Oct cleared $19,825.70.
   Next monthly run Mon 2 Nov $9,510.65; Rosa's NET-14 payout $412.60 tomorrow; $430.00 in $10 redemptions owed across 11 shops. */
const shim = { F:null };
const money = n => (n<0?'−':'') + '$' + Math.abs(n).toLocaleString('en-US',{minimumFractionDigits:2, maximumFractionDigits:2});
const TX = [ // id, name, kind, city, founding, fee %, terms, cap, cap hits (7d), originations, lost, Oct cleared, Oct txns, Sept cleared, hardware
  ['rosas',"Rosa’s Panadería",'Bakery','Redlands',1,2.0,'NET-14',100,3,41,0,1284.40,23,372.60,'Point · Tap'],
  ['uptown','Uptown Barber','Barber','Redlands',1,0,'NET-30',100,0,7,0,412.00,7,0,'Point'],
  ['mesa','Mesa Laundry','Laundromat','San Bernardino',1,2.0,'NET-30',120,1,36,0,968.10,29,640.20,'Point'],
  ['tire','Redlands Tire & Lube','Auto and tires','Redlands',0,2.5,'NET-30',500,2,22,1,7940.00,19,5210.00,'Tap · Counter'],
  ['citrus','Citrus Bowl Café','Café','Riverside',0,2.5,'NET-30',100,0,31,1,702.50,27,588.40,'Point · 6 tables'],
  ['books','State St. Books','Books','Redlands',0,2.5,'NET-30',150,0,19,0,611.80,16,402.90,'Point'],
  ['mich','La Michoacana','Ice cream','San Bernardino',0,2.5,'NET-30',100,1,44,0,498.20,38,455.10,'Point'],
  ['nails','Arrowhead Nails','Nail salon','San Bernardino',0,2.5,'NET-14',150,0,14,0,1036.00,14,720.00,'Point'],
  ['hdw','Highland Hardware','Hardware','Highland',0,2.5,'NET-30',300,1,17,0,2310.40,17,1488.60,'Tap · Counter'],
  ['phone','Cajon Phone Repair','Phone repair','San Bernardino',0,2.5,'NET-14',300,2,21,1,3120.00,21,2240.00,'Tap'],
  ['pet','Brookside Pet Wash','Pet care','Redlands',0,2.5,'NET-30',150,0,12,0,540.00,12,310.00,'Point'],
  ['orange','Orange St. Laundromat','Laundromat','Redlands',0,2.5,'NET-30',100,0,15,0,402.30,15,286.80,'Point'] ];
const SIGNED = [['icw','Inland Cycle Works','Bikes and repair','Redlands','signing'],['shoe','Valley Shoe Repair','Shoe repair','Redlands'],['tacos','Fontana Tacos','Restaurant','Fontana'],
  ['feed','Yucaipa Feed & Seed','Farm supply','Yucaipa'],['pharm','Loma Linda Pharmacy','Pharmacy','Loma Linda'],['cuts','Colton Cuts','Barber','Colton'],['donut','Rialto Donuts','Bakery','Rialto'],
  ['bmkt','Bloomington Market','Grocery','Bloomington'],['mcof','Mentone Coffee','Café','Mentone'],['clean','Calimesa Cleaners','Dry cleaning','Calimesa'],['deli','Grand Terrace Deli','Deli','Grand Terrace'],
  ['tea','Muscovy Tea','Tea','Redlands'],['tailor','Sixth St. Tailor','Tailor','Riverside'],['thrift','Kendall Thrift','Thrift','San Bernardino'],['tires2','Tippecanoe Tires','Auto and tires','San Bernardino'],
  ['flor','Victoria Ave. Florist','Florist','Riverside'],['pho','Base Line Pho','Restaurant','San Bernardino'],['opt','Citrus Plaza Optical','Optical','Redlands']];
const PROSPECTS = [ /* name, kind, city, est financed/mo, owner, next step, stage, source */
  ['Mission Auto Care','Auto repair','Redlands',9000,'marcus','Demo the merchant app','talking','walkin'],['Orange Show Tires','Tires','San Bernardino',7500,'marcus','Bring the numbers','talking','walkin'],
  ['Cypress Dental','Dental','Redlands',6000,'kai','Meet the owner','talking','hand'],['Sun Valley HVAC','HVAC','Highland',12000,'marcus','Ride-along with the owner','talking','enquiry'],
  ['Barton Rd. Appliance','Appliances','Grand Terrace',5500,'dana','Second visit','talking','walkin'],['Tri-City Transmission','Auto repair','San Bernardino',8000,'marcus','Talk terms · wants NET-14','talking','walkin'],
  ['Kingston Vet','Veterinary','Redlands',4500,'kai','Visit after the intro email','talking','enquiry'],
  ['Redlands Smog & Brake','Auto repair','Redlands',5000,'marcus','Walk in','prospect','hand'],['IE Mattress Outlet','Mattresses','Colton',6500,'dana','Walk in','prospect','enquiry'],
  ['Lugonia Auto Glass','Auto glass','Redlands',4000,'marcus','Walk in','prospect','poster'],['Sunset Muffler','Auto repair','Rialto',3500,'marcus','Walk in','prospect','hand'],
  ['University Optometry','Optical','Redlands',3000,'dana','Walk in','prospect','enquiry'],['Fontana Furniture','Furniture','Fontana',7000,'dana','Walk in','prospect','poster'],['Yucaipa Pet Clinic','Veterinary','Yucaipa',4000,'kai','Walk in','prospect','hand']];
const OWED = {mesa:80, icw:60, rosas:40, uptown:50, tire:20, citrus:30, books:20, mich:40, nails:30, hdw:20, tacos:40};
const SRC = { walkin:'Field walk-in', enquiry:'Shop enquiry', poster:'Next to a poster shop', hand:'Added by hand' };
const FLEET = { citrus:{P:['on'], t:['on','on','on','low','on','off'], note:'Table 4 battery low · table 6 offline since Tue', seen:'2 min ago'},
  orange:{P:['off'], note:'Point unplugged since 08:40', seen:'08:40'}, rosas:{P:['on'], T:['on'], seen:'Now'}, tire:{T:['on'], C:['on'], seen:'Now'}, hdw:{T:['on'], C:['on'], seen:'1 min ago'},
  uptown:{P:['on'], seen:'Now'}, mesa:{P:['on'], seen:'3 min ago'}, books:{P:['on'], seen:'Now'}, mich:{P:['on'], seen:'Now'}, nails:{P:['on'], seen:'4 min ago'}, phone:{T:['on'], seen:'Now'}, pet:{P:['on'], seen:'1 min ago'} };
const DTYPE = [['P','Clear Point','At the counter'],['t','Table Point','At the table'],['T','Tap dock','Card reader'],['C','Counter','Tablet']];
const OWNER_TX = { rosas:'kai', uptown:'marcus', mesa:'dana', tire:'marcus', citrus:'dana', books:'marcus', mich:'dana', nails:'dana', hdw:'dana', phone:'dana', pet:'marcus', orange:'marcus' };

/* one list of every shop, every stage */
const MS = (() => {
  const out = [];
  const lead = n => LEADS.find(l=>l.shop===n);
  const lastVisit = n => { const v = VLOG.filter(x=>x.shop===n); return v.length ? -Math.max(...v.map(x=>x.d)) : null; };
  TX.forEach(r=>{ const [id,name,kind,city,founding,fee,terms,cap,hits,orig,lost,oct,octN,sept,hw] = r;
    out.push({ id, name, kind, city, stage:'transacting', founding:!!founding, fee, terms, cap, hits, orig, lost, oct, octN, sept, hw, owed:OWED[id]||0, owner:OWNER_TX[id],
      posters:POSTERS.filter(p=>p.shop===name).length, next: id==='orange' ? 'Plug the Clear Point back in' : id==='citrus' ? 'Swap table 4’s battery' : null, due: id==='orange'||id==='citrus' ? 0 : null, last: lastVisit(name) ?? (id==='uptown'?0:6+hashN(name)%20), source: id==='uptown'||id==='rosas'||id==='mesa' ? 'poster' : 'walkin', since: founding ? ['Aug','Sep','Today'][['rosas','mesa','uptown'].indexOf(id)] : 'Sep' }); });
  SIGNED.forEach(([id,name,kind,city,st])=>{ const l = lead(name);
    out.push({ id, name, kind, city, stage: st==='signing' ? 'signing' : 'signed', founding: st==='signing', owed:OWED[id]||0, owner: l ? l.owner : ['marcus','dana'][hashN(name)%2],
      posters:POSTERS.filter(p=>p.shop===name).length, next: l ? l.next : st==='signing' ? 'Sign the agreement' : 'Pitch card payments', due: l ? l.due : null, last: l ? l.last : lastVisit(name) ?? 8+hashN(name)%30, source:'poster', hw:'Poster only' }); });
  PROSPECTS.forEach(([name,kind,city,val,owner,next,stage,source])=>{ const l = lead(name);
    out.push({ id:'p-'+hashN(name), name, kind, city, stage, val, owner, next: l ? l.next : next, due: l ? l.due : null, last: l ? l.last : null, source, posters:0, hw:'–' }); });
  return out;
})();
const MSBY = Object.fromEntries(MS.map(m=>[m.id,m]));
const TXO = MS.filter(m=>m.stage==='transacting');
const capRaise = m => m.id==='rosas' ? 'pending' : m.hits>0 && m.lost===0 && m.orig>=15 ? 'raise' : m.hits>0 ? 'hold' : 'ok';
const payOf = m => { const fee = m.id==='rosas' ? 0 : +(m.sept*m.fee/100).toFixed(2); return {sales:m.sept, fee, red:OWED[m.id]||0, total:+(m.sept - fee + (OWED[m.id]||0)).toFixed(2)}; };
/* shop enquiries from useclear.org/shops (names masked until shown) */
const ENQ = [
  { id:'e1', name:'Sixth St. Tailor', mask:'S•••• T•••••', city:'Riverside', kind:'Tailor', from:'/shops', when:'Today 21:58', msg:'Already have your poster. How do card payments work?', st:'new', known:'tailor' },
  { id:'e2', name:'Brockton Coffee', mask:'B•••••• C•••••', city:'Riverside', kind:'Café', from:'Poster · Citrus Bowl Café', when:'Today 14:12', msg:'Saw the poster next door. Do you work with coffee shops?', st:'new' },
  { id:'e3', name:'Mountain View Auto', mask:'M••••••• V••• A•••', city:'Redlands', kind:'Auto repair', from:'/shops', when:'Tue', msg:'Customers keep asking for financing on brake jobs.', st:'new' },
  { id:'e4', name:'Pepper Ave. Nails', mask:'P••••• A••. N••••', city:'Colton', kind:'Nail salon', from:'/shops', when:'Mon', msg:'Interested in the $10 thing for new customers.', st:'replied' },
  { id:'e5', name:'Rancho Liquor', mask:'R••••• L•••••', city:'Fontana', kind:'Liquor store', from:'/shops', when:'Sun', msg:'How much does it cost?', st:'notfit', why:'We don’t take liquor stores' } ];

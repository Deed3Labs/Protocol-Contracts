
/* ══ Community data — the forum, live events and the co-op's channel on Dial ═══════════════════════════════════
   Demo "today" is Wed 21 Oct 2026, 14:00. Community is where members talk, meet and watch; Governance tracks what
   gets decided. Members are masked here as everywhere in the Command Center; the app shows the name each one picks. */
const DAY = 864e5, TODAY = Date.UTC(2026,9,21), NOW = TODAY + 14*3600e3;
const D = (m, d, y=2026) => Date.UTC(y, m-1, d);
const H = (m, d, h, mi=0) => Date.UTC(2026, m-1, d, h, mi);
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const fmtD = t => `${new Date(t).getUTCDate()} ${MON[new Date(t).getUTCMonth()]}`;
const WD = t => new Date(t).toLocaleDateString('en-US',{weekday:'short', timeZone:'UTC'});
const hm = t => new Date(t).toISOString().slice(11,16);
const leaf = t => `<span class="leaf"><span>${WD(t)}</span><b>${new Date(t).getUTCDate()}</b><span>${MON[new Date(t).getUTCMonth()]}</span></span>`;
const ago = t => { const m = Math.round((NOW - t)/6e4); if (m < 60) return `${Math.max(1,m)} min ago`; const h = Math.round(m/60); if (h < 24) return `${h} h ago`; const d = Math.round(h/24); return d===1 ? 'yesterday' : `${d} days ago`; };
const int = n => Math.round(n).toLocaleString('en-US');
const pct = (a,b) => b ? Math.round(a/b*100) + '%' : '–';
const MEMBERS = 188;

const PPL = {
  kai:  { n:'Kai', ini:'K', role:'Admin', staff:true },
  dana: { n:'Dana Ruiz', ini:'DR', role:'Ops', staff:true },
  m1:   { n:'Member M•••a4', ini:'A4', role:'Member' } };
const who = k => k==='kai' ? 'You' : PPL[k] ? PPL[k].n : `Member M•••${k}`;

/* the forum */
const CATS = [['all','All'],['proposals','Proposals'],['ideas','Ideas'],['places','Neighborhoods'],['help','Questions'],['shops','Shops'],['news','From Clear']];
const CAT = Object.fromEntries(CATS);
const THREADS = [ /* id, cat, title, by, replies, readers, last post, flags: pin | hot | answered | locked | staff, proposal */
  { id:'T-412', cat:'proposals', t:'Adopt member agreement v2.2', by:'kai', r:42, rd:131, last:H(10,21,12,40), pin:1, prop:'P-012', note:'Open during the vote · text frozen' },
  { id:'T-438', cat:'help', t:'Does a late payment in my first month count against the $150 limit?', by:'2d', r:3, rd:44, last:H(10,21,11,5), prop:'P-016' },
  { id:'T-421', cat:'proposals', t:'Reprint the window posters for Cajon Blvd', by:'a4', r:12, rd:58, last:H(10,21,9,30), prop:'P-015', hot:1 },
  { id:'T-436', cat:'ideas', t:'A tool library at the Highland community room', by:'e1', r:8, rd:61, last:H(10,20,19,10), hot:1 },
  { id:'T-430', cat:'places', t:'Highland: who’s at the coffee hour today?', by:'3c', r:19, rd:47, last:H(10,21,13,52) },
  { id:'T-417', cat:'shops', t:'Rosa’s now takes Clear Pay at the counter, not just the window', by:'b8', r:6, rd:72, last:H(10,20,16,30), answered:1 },
  { id:'T-415', cat:'proposals', t:'Raise the starter credit limit to $150.00', by:'7c', r:27, rd:96, last:H(10,20,15,0), prop:'P-016' },
  { id:'T-409', cat:'news', t:'October town hall: send your questions', by:'dana', r:17, rd:140, last:H(10,20,10,0), staff:1, pin:1 },
  { id:'T-433', cat:'help', t:'How do I move savings into Earn?', by:'9b', r:4, rd:29, last:H(10,19,20,15), answered:1 },
  { id:'T-402', cat:'places', t:'Uptown Barber launch photos', by:'e1', r:11, rd:84, last:H(10,18,12,0) },
  { id:'T-398', cat:'ideas', t:'Saturday mornings for the annual meeting', by:'3c', r:5, rd:33, last:H(10,20,10,0), prop:'P-017' },
  { id:'T-391', cat:'shops', t:'Which shops do term plans?', by:'5f', r:9, rd:51, last:H(10,17,18,40), answered:1 },
  { id:'T-380', cat:'help', t:'Locked: shared someone’s address', by:'b8', r:2, rd:12, last:H(10,20,15,20), locked:1 } ];
const POSTS_WK = [118, 142, 131, 164, 189, 176, 214], WEEKS = ['7 Sep','14 Sep','21 Sep','28 Sep','5 Oct','12 Oct','19 Oct'];
const IDEAS = 23;

/* what moderators see. Nothing is deleted: hiding is logged with a reason, and the author is told why. */
const FLAGS = [
  { id:'F-88', thread:'T-412', by:'b8', at:H(10,20,15,20), why:'Shared another member’s address', src:'Caught automatically', st:'hidden', mod:'dana', t:'…she lives on 1400 block of…' },
  { id:'F-91', thread:'T-430', by:'6a', at:H(10,21,13,40), why:'Selling something', src:'2 members reported it', st:'open', t:'Anyone want to buy a couch? DM me, $80' },
  { id:'F-92', thread:'T-421', by:'4f', at:H(10,21,12,10), why:'Rude to another member', src:'1 member reported it', st:'open', t:'That’s a dumb idea and you know it' },
  { id:'F-93', thread:'T-438', by:'2d', at:H(10,21,11,6), why:'Might include an account number', src:'Caught automatically', st:'open', t:'my card ends in •••• and the limit still says $100' },
  { id:'F-85', thread:'T-402', by:'e1', at:H(10,18,12,5), why:'Photo with a child’s face', src:'Caught automatically', st:'kept', mod:'kai', t:'Photo: the launch morning, with the owner’s family' } ];

/* live: town halls, audio spaces, presentations, hearings and meetings */
const KIND = { town:['Town hall','Video · questions from members'], space:['Space','Audio · anyone can raise a hand'], talk:['Presentation','Slides and video'], hearing:['Hearing','On a proposal, during its discussion'], board:['Board meeting','Open session · the record is in Governance'], annual:['Annual meeting','Live · votes are signed in the app'] };
const EVENTS = [
  { id:'E-33', kind:'space', t:'Highland coffee hour', host:'3c', co:['dana'], at:H(10,21,13,18), len:60, st:'live', live:18, peak:24, hands:3, req:true, place:'Highland', chan:true },
  { id:'E-34', kind:'town', t:'October town hall: credit limits and the starter tier', host:'kai', co:['dana'], at:H(10,22,18), len:60, st:'next', rsvp:54, q:17, qSorted:6, prop:'P-016', chan:true, prep:[['Slides',1],['Questions sorted','6 of 17'],['Captions','On'],['On the channel','Live at 18:00']] },
  { id:'E-36', kind:'space', t:'Poster walk: Cajon Blvd', host:'a4', at:H(10,24,10), len:90, st:'request', place:'Cajon Blvd', why:'Walk the poster route and swap the faded ones, live from the street.', prop:'P-015' },
  { id:'E-37', kind:'talk', t:'How the AssurancePool works', host:'dana', at:H(10,27,18), len:40, st:'next', rsvp:21, chan:true },
  { id:'E-38', kind:'board', t:'Co-op board · open session', host:'kai', at:H(11,4,18), len:90, st:'next', rsvp:12, chan:true, gov:'Agenda: P-016 and the 2027 budget' },
  { id:'E-39', kind:'space', t:'New members: ask anything', host:'a4', at:H(10,29,19), len:45, st:'request', why:'Monthly drop-in for people who joined this month.' },
  { id:'E-40', kind:'annual', t:'Annual member meeting', host:'kai', at:Date.UTC(2027,0,15,18), len:120, st:'next', rsvp:0, chan:true, gov:'Board elections · P-014' },
  { id:'E-31', kind:'hearing', t:'Hearing: member agreement v2.2', host:'kai', co:['dana'], at:H(10,19,18), len:55, st:'past', came:46, peak:41, q:22, qAns:19, prop:'P-012', rec:'On the channel · 212 views' },
  { id:'E-30', kind:'talk', t:'Term plans, start to finish', host:'dana', at:H(10,13,18), len:35, st:'past', came:29, peak:27, q:9, qAns:9, rec:'On the channel · 148 views' },
  { id:'E-29', kind:'town', t:'September town hall', host:'kai', co:['dana'], at:H(9,24,18), len:70, st:'past', came:61, peak:52, q:31, qAns:24, rec:'On the channel · 390 views' } ];
const EV = Object.fromEntries(EVENTS.map(e=>[e.id,e]));
/* the live space, minute by minute */
const LIVE_CURVE = [4,7,11,14,17,19,22,24,23,21,20,19,18,18];
/* last town hall: how many were in the room, minute by minute */
const TH_CURVE = [12,31,44,49,52,51,50,48,47,46,44,41,38];

/* the channel: Clear on Dial. One station now; a station per community once there are councils. */
const CH = { name:'Clear', num:'Channel 4', call:'CLR', viewers:23, wk:312, comments:96, relay:'Off · Dial only' };
const SCHED = [ /* start hour, length in hours, title, kind: loop | live | replay | show | off */
  [0,6,'Off air','off'],[6,3,'How Clear works','loop','Five explainers on repeat'],[9,3,'Shop spotlights','show','Rosa’s, Uptown Barber, Highland Hardware'],
  [12,1.3,'Member stories','show','Three members, three neighborhoods'],[13.3,1.2,'Highland coffee hour','live','From the Space · audio with captions'],
  [14.5,1.5,'Hearing: agreement v2.2','replay','Recorded Mon 19 Oct'],[16,2,'Shop spotlights','show','Repeat'],[18,1,'How the AssurancePool works','replay','Preview of Tue’s talk'],
  [19,3,'How Clear works','loop','Five explainers on repeat'],[22,2,'Off air','off'] ];
const LIB = [ ['Hearing: member agreement v2.2','Recording · 55 min',212,H(10,19,19)], ['September town hall','Recording · 70 min',390,H(9,24,19)], ['Term plans, start to finish','Presentation · 35 min',148,H(10,13,19)],
  ['How Clear works','Explainers · 5 parts',1240,D(9,1)], ['Shop spotlight: Rosa’s Panadería','Story · 6 min',301,D(10,2)], ['Member stories: Highland','Story · 12 min',176,D(10,9)] ];
const VIEW_HR = [0,0,0,0,0,0,4,7,9,8,10,12,14,21,23];   /* viewers by hour, today */

/* who takes part, by week: wrote in the forum, came to something live, watched the channel (members, not views) */
const PART = { posted:[31,36,34,41,47,44,52], came:[18,0,29,22,0,29,46], watched:[22,25,27,30,33,38,44], any:[48,51,55,60,66,71,78] };

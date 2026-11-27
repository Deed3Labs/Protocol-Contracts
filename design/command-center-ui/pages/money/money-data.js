
/* ══ Money data — the Command Center's own figures (Money page, v5), so every number matches ══════════════
   Demo "today" is Wed 21 Oct 2026. Day offsets count from today. */
const money = n => (n<0?'−':'') + '$' + Math.abs(n).toLocaleString('en-US',{minimumFractionDigits:2, maximumFractionDigits:2});
const money0 = n => '$' + Math.round(n).toLocaleString('en-US');
const pct = (a,b,d=1) => (b ? a/b*100 : 0).toFixed(d) + '%';
const TODAY = Date.UTC(2026,9,21), DAY = 864e5;
const dOf = d => new Date(TODAY + d*DAY);
const WD = d => dOf(d).toLocaleDateString('en-US',{weekday:'short', timeZone:'UTC'});
const MON = d => dOf(d).toLocaleDateString('en-US',{month:'short', timeZone:'UTC'});
const MONL = d => dOf(d).toLocaleDateString('en-US',{month:'long', timeZone:'UTC'});
const DD = d => dOf(d).getUTCDate();
const dayD = d => `${DD(d)} ${MON(d)}`;
const leaf = (d, month=true) => `<span class="leaf"><span>${WD(d)}</span><b>${DD(d)}</b>${month?`<span>${MON(d)}</span>`:''}</span>`;
const rel = d => d===0 ? 'today' : d===1 ? 'tomorrow' : d===-1 ? 'yesterday' : d>0 ? `in ${d} days` : `${-d} days ago`;

const M = {
  savings:38940.20, cash:21480.75, payout:10240.00, assurance:1420.00, coop:476.20,
  credit:14212.40, savingsBacked:8640.00, unsecured:5572.40, limits:41600.00, lost:612.00,
  owed14:12839.25, dueMembers:1482.36, bonds:25000.00, bv:25000.00, floor:0.20, members:124, autopay:98
};
/* the yield pool (LendingPool, ERC-4626): funds unsecured credit, takes its first loss. Rates follow the contract's curve. */
const Y = { assets:9000.00, principal:8962.10, lent:M.unsecured, depositors:18, pledged:1200.00, queued:0, opened:'15 Oct', cycleDays:30, curve:{base:25, s1:75, s2:900, kink:0.80} };
Y.cash = Y.assets - Y.lent; Y.util = Y.lent / Y.assets; Y.earned = Y.assets - Y.principal; Y.price = Y.assets / Y.principal;
const yBorrowBps = u => u <= Y.curve.kink ? Y.curve.base + Y.curve.s1*u/Y.curve.kink : Y.curve.base + Y.curve.s1 + Y.curve.s2*(u-Y.curve.kink)/(1-Y.curve.kink);
const yApr = bps => bps/10000 * 365/Y.cycleDays;
const yApy = bps => Math.pow(1 + bps/10000, 365/Y.cycleDays) - 1;
Y.borrowBps = yBorrowBps(Y.util); Y.supplyBps = Y.borrowBps * Y.util; Y.apy = yApy(Y.supplyBps); Y.apr = yApr(Y.borrowBps);
M.rtd = M.assurance / M.unsecured;
M.room = M.assurance / M.floor - M.unsecured;
M.short = Math.max(0, M.owed14 - M.payout - M.dueMembers);
Y.toPayout = Math.min(M.short, Y.cash); Y.utilAfter = (Y.lent + Y.toPayout) / Y.assets; Y.apyAfter = yApy(yBorrowBps(Y.utilAfter)*Y.utilAfter);

/* weekly history, 8 Sep → 20 Oct */
const NW = ['8 Sep','15 Sep','22 Sep','29 Sep','6 Oct','13 Oct','20 Oct'];
const AP_BAL = [0,400,520,690,860,1110,M.assurance], UNSEC = [0,900,2050,3450,4400,5100,M.unsecured];
const RTD_W = AP_BAL.map((v,i)=>UNSEC[i] ? v/UNSEC[i] : null);
const COOP_W = [22.40,39.40,78.40,109.20,126.80,100.00];

/* the next 30 days, day 0 = 21 Oct: [day, in|out, amount, what, detail, from|to] */
const FLOWS = [[1,'out',412.60,'Rosa’s Panadería','NET-14 payout'],[3,'in',592.94,'Member repayments','Autopay batch'],[9,'in',889.42,'Member repayments','Autopay batch'],
  [12,'out',9510.65,'Monthly run','11 shops · NET-30'],[14,'out',732.00,'Arrowhead Nails','NET-14 payout'],[14,'out',2184.00,'Cajon Phone Repair','NET-14 payout'],[16,'in',2310.20,'Member repayments','Autopay batch'],[28,'out',1140.80,'NET-14 shops','Next NET-14 round · estimate']];
const BONDS = [ /* id, face, issued, matures, months to maturity from today, term in months, internal rate, holder */
  ['BB-0001',2500,'14 Aug','14 Dec',54,4,6.0,'Member'],['BB-0002',5000,'21 Aug','21 Jan',92,5,6.5,'Founding lender'],['BB-0003',2500,'2 Sep','2 Mar',132,6,7.0,'Member'],
  ['BB-0004',2500,'9 Sep','9 Mar',139,6,7.0,'Member'],['BB-0005',7500,'1 Oct','1 Jun',223,8,7.5,'Founding lender'],['BB-0006',5000,'15 Oct','15 Sep',329,11,8.0,'Member']];
/* every account, in the order the bar draws them: whose money it is decides the bracket */
const ACCTS = [ /* id, name, what it's for, group, source, balance, 7 weeks, colour */
  ['sav','Member savings','CLRUSD, backed 1:1 by USDC at Bridge','members','bridge',M.savings,[0,2100,6400,13900,22800,31200,M.savings],'var(--fg)'],
  ['yld','Yield pool','Members’ deposits not lent out yet','members','protocol',Y.cash,[0,0,0,0,0,2180,Y.cash],'color-mix(in srgb,var(--live) 60%,transparent)'],
  ['pay','Payout pool','Pays shops for financed sales, oldest first','set','protocol',M.payout,[0,1200,3900,5200,7800,9600,M.payout],'color-mix(in srgb,var(--fg) 45%,transparent)'],
  ['ap','AssurancePool','Covers unsecured losses after the yield pool','set','protocol',M.assurance,AP_BAL,'var(--underway)'],
  ['bv','BondVault','Bond buyers’ money · paid back at maturity','set','protocol',M.bv,[10000,12500,12500,12500,20000,20000,M.bv],'color-mix(in srgb,var(--fg) 28%,transparent)'],
  ['ops','Operating cash','Business checking · the co-op’s own money','coop','plaid',M.cash,[16800,17900,18600,19800,20400,21100,M.cash],'var(--land)'],
  ['coop','Co-op balance','Discounts on member purchases, held for a vote','coop','protocol',M.coop,[0,22.40,61.80,140.20,249.40,376.20,M.coop],'color-mix(in srgb,var(--land) 45%,transparent)']];
const GROUPS = { members:['Members’ money','Owed back to members on request'], set:['Set aside','Only for shops, losses and bondholders'], coop:['The co-op’s','Ours to run on'] };
const ASIDE = [['Sales tax held',351.58,'Shop · paid with the quarterly return'],['Pre-order deposits',460.00,'Hardware · refundable until made']];
const SRC = { protocol:['Protocol','12 s'], bridge:['Bridge','2 min'], plaid:['Plaid','3 h', 'late'], lithic:['Lithic','1 min'] };
const srcTxt = k => SRC[k][0] + ' · ' + SRC[k][1];
const acctOf = id => ACCTS.find(a=>a[0]===id);

/* credit, October */
const CR = { start:7040.00, spent:19825.70, aging:[['Current',12480.20],['1–30 days',1310.40],['31–60 days',421.80],['Over 60',0]],
  losses:[[-29,'Redlands Tire & Lube','tire',204],[-15,'Citrus Bowl Café','citrus',204],[-7,'Cajon Phone Repair','phone',204]],
  limits:[['$100',38],['$250',46],['$500',28],['$1,000+',12]],
  shops:[['Redlands Tire & Lube',7940.00,1],['Cajon Phone Repair',3120.00,1],['Highland Hardware',2310.40,0],['Rosa’s Panadería',1284.40,0],['Arrowhead Nails',1036.00,0],['Mesa Laundry',968.10,0],['6 more shops',3166.80,0]] };
CR.repaid = CR.start + CR.spent - M.credit;
CR.sched = FLOWS.filter(f=>f[1]==='in' && f[0]<=9).reduce((a,f)=>a+f[2],0);
CR.due = CR.repaid + CR.sched;

/* depositors, masked; earned split pro rata so rows reconcile to the pool */
const Y_DEP = [['4f',1500,'15 Oct',600],['a2',1000,'15 Oct',400],['c9',1000,'15 Oct',0],['17',750,'15 Oct',0],['e0',600,'15 Oct',200],['5b',500,'15 Oct',0],['9d',500,'15 Oct',0],['b3',500,'20 Oct',0],['61',400,'15 Oct',0],['2e',350,'15 Oct',0],['d8',300,'15 Oct',0],['7a',300,'15 Oct',0],['f4',250,'15 Oct',0],['0c',250,'20 Oct',0],['8b',200,'15 Oct',0],['3f',200,'15 Oct',0],['c1',200,'20 Oct',0],['6e',200,'20 Oct',0]]
  .map(([id,w,since,pl])=>{ const e = w*Y.earned/Y.assets; return {id,w,since,pl,e,d:w-e}; });

/* the people who can move money: the Ops Safe, two of three signers */
const PPL = { kai:{n:'Kai', f:'Kai', ini:'KK', role:'Admin', sign:true}, dana:{n:'Dana Ruiz', f:'Dana', ini:'DR', role:'Ops', sign:true}, priya:{n:'Priya Shah', f:'Priya', ini:'PS', role:'Finance', sign:true}, marcus:{n:'Marcus Lee', f:'Marcus', ini:'ML', role:'Field', sign:false} };
/* money moves: [id, kind, what, from, to, amount, proposed by, day proposed, approver (null = any other signer), note, status, link] */
const MOVES = [
  { id:'mv-tax', kind:'bill', t:'Pay the Q3 sales tax return', from:'ops', to:'CDTFA', amt:351.58, by:'dana', d:0, why:'Q3 return is due 31 Oct. This is the amount held from Shop sales.', due:10, st:'waiting' },
  { id:'mv-rosa', kind:'payout', t:'Rosa’s Panadería · NET-14 payout', from:'pay', to:'Rosa’s Panadería', amt:412.60, by:'dana', d:-1, why:'September sales on NET-14 terms.', due:1, st:'merchants' } ];
const DONE = [
  { d:-3, t:'Yield pool withdrawal', from:'Yield pool', to:'A member', amt:250.00, auto:'Paid at once by the contract', tx:'0x9c1e…41d2' },
  { d:-6, t:'BB-0006 issued', from:'A member', to:'BondVault', amt:5000.00, by:'kai', ok:'dana', tx:'0x5b07…aa19' },
  { d:-7, t:'Loss absorbed · Cajon Phone Repair', from:'AssurancePool', to:'Credit ledger', amt:204.00, auto:'Member 90 days late', tx:'0x77d0…0e3c' },
  { d:-8, t:'Top up the payout pool', from:'Operating cash', to:'Payout pool', amt:2600.00, by:'dana', ok:'kai', tx:'0x3a92…c1f7' },
  { d:-15, t:'Loss absorbed · Citrus Bowl Café', from:'AssurancePool', to:'Credit ledger', amt:204.00, auto:'Member 90 days late', tx:'0xe41b…7d20' },
  { d:-19, t:'Monthly run · August', from:'Payout pool', to:'4 shops', amt:1904.10, by:'dana', ok:'kai', tx:'0x18f3…92be' },
  { d:-20, t:'BB-0005 issued', from:'Founding lender', to:'BondVault', amt:7500.00, by:'kai', ok:'priya', tx:'0xc8a0…3f55' },
  { d:-21, t:'Top up the payout pool', from:'Operating cash', to:'Payout pool', amt:3000.00, by:'kai', ok:'dana', tx:'0x2d6c…b804' },
  { d:-26, t:'Rejected · move $5,000.00 to the yield pool', from:'Operating cash', to:'Yield pool', amt:5000.00, by:'priya', no:'kai', why:'The co-op shouldn’t be a depositor in its own pool', tx:null },
  { d:-29, t:'Loss absorbed · Redlands Tire & Lube', from:'AssurancePool', to:'Credit ledger', amt:204.00, auto:'Member 90 days late', tx:'0x60fd…e2a1' },
  { d:-30, t:'Top up the payout pool', from:'Operating cash', to:'Payout pool', amt:2500.00, by:'dana', ok:'kai', tx:'0x91b4…5c0e' } ];
/* what someone can propose */
const KINDS = {
  topup:   { t:'Top up the payout pool', from:'ops', to:'pay', amt:()=>M.short, why:'Cover the 4 Nov gap from operating cash instead of borrowing it from the yield pool.' },
  bondvault:{ t:'Use spare bond money', from:'bv', to:'pay', amt:()=>Math.min(5000, Math.max(0, M.bv-BV_NEED())), why:'Spare bond money, above what BondVault keeps for bondholders.' },
  bill:    { t:'Pay a bill from operating cash', from:'ops', to:'out', amt:()=>0, why:'' },
  move:    { t:'Move between the co-op’s accounts', from:'ops', to:'pay', amt:()=>0, why:'' } };
const PLACES = { ops:'Operating cash', pay:'Payout pool', bv:'BondVault', out:'Someone outside the co-op', ap:'AssurancePool' };

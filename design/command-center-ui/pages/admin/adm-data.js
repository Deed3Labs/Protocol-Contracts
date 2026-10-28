
/* ══ Admin data — Team (who), Settings (what) and Records (the archive and the log) ════════════════════════════════
   Demo "today" is Wed 21 Oct 2026, 14:00. Permissions are set per group, never per person. Settings hold the numbers
   every page enforces; changing one needs a second person and lands in the audit log. */
const DAY = 864e5, TODAY = Date.UTC(2026,9,21), NOW = TODAY + 14*3600e3;
const D = (m, d, y=2026) => Date.UTC(y, m-1, d);
const H = (m, d, h, mi=0) => Date.UTC(2026, m-1, d, h, mi), H2 = H;
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const fmtD = t => `${new Date(t).getUTCDate()} ${MON[new Date(t).getUTCMonth()]}`;
const WD = t => new Date(t).toLocaleDateString('en-US',{weekday:'short', timeZone:'UTC'});
const hm = t => new Date(t).toISOString().slice(11,16);
const leaf = t => `<span class="leaf"><span>${WD(t)}</span><b>${new Date(t).getUTCDate()}</b><span>${MON[new Date(t).getUTCMonth()]}</span></span>`;
const ago = t => { const m = Math.round((NOW - t)/6e4); if (m < 60) return `${Math.max(1,m)} min ago`; const h = Math.round(m/60); if (h < 24) return `${h} h ago`; const d = Math.round(h/24); return d===1 ? 'yesterday' : `${d} days ago`; };
const money = n => (n<0?'−':'') + '$' + Math.abs(n).toLocaleString('en-US',{minimumFractionDigits:2, maximumFractionDigits:2});
const int = n => Math.round(n).toLocaleString('en-US');
function rng(seed){ let s = seed; return () => (s = (s * 16807) % 2147483647, (s - 1) / 2147483646); }

/* ── who: sections, levels, groups, people ─────────────────────────────────────────────────────────────────────── */
const SECS = [['home','Home'],['growth','Growth'],['field','Field'],['members','Members'],['merchants','Merchants'],['shop','Shop'],['money','Money'],['build','Build'],['community','Community'],['governance','Governance'],['records','Records'],['team','Team'],['settings','Settings']];
const SEC_GROUP = [['Grow',0,5],['Hold',6,6],['Rules',7,9],['Admin',10,12]];
const LV = [['None','Not in their menu'],['Totals','Co-op numbers, no names or personal details'],['See','Everything on the page, can’t change it'],['Propose','Can start a change · someone else approves'],['Approve','Can be the second person']];
const GROUPS = { /* name, who it's for, a level per section, everyone */
  members:  ['Members','Everyone with a Clear account',[0,1,0,0,1,1,1,2,2,2,2,0,0], 1],
  admin:    ['Admin','Runs the co-op day to day',[4,4,4,4,4,4,4,4,4,4,4,4,4]],
  protocol: ['Protocol','Contracts and the money they hold',[2,2,0,4,2,1,4,4,2,2,2,4,4]],
  field:    ['Field','Shops, posters and the route',[2,3,4,2,3,3,1,2,2,2,2,0,0]],
  board:    ['Board','Signs for the co-op board',[2,1,0,0,1,1,2,4,3,4,2,0,4]],
  outside:  ['Outside','Read-only, for an accountant or counsel',[0,1,0,0,1,2,2,2,0,2,2,0,0]],
  investors:['Investors','Data room for investors, lenders and property contributors',[0,1,0,0,1,1,2,2,0,2,2,0,0]] };
const GKEYS = Object.keys(GROUPS).filter(k=>!GROUPS[k][3]);
const PEOPLE = [
  {id:'K',  email:'kai@useclear.org',   n:'Kai',                g:'admin',    title:'Founder', since:D(6,12), last:H(10,21,13,58), passkey:1, signer:1,
    dev:[['Mac · Redlands',H(10,21,13,58),1],['iPhone · Redlands',H(10,21,7,58),1]]},
  {id:'DR', email:'dana@useclear.org',  n:'Dana Ruiz',          g:'protocol', title:'Protocol lead · ClearLabs', since:D(8,5), last:H(10,21,13,40), passkey:1, signer:1,
    dev:[['Laptop · Riverside',H(10,21,13,40),1]]},
  {id:'ML', email:'marcus@useclear.org',n:'Marcus Lee',         g:'field',    title:'Partnerships and field', since:D(8,18), last:H(10,21,12,47), passkey:1, signer:0,
    dev:[['iPhone · Redlands',H(10,21,12,47),1],['Old iPhone',H(10,12,18,0),1]]},
  {id:'BS', email:'board@useclear.org', n:'Board signer',       g:'board',    title:'Co-op board', since:D(9,1), last:H(10,18,20,10), passkey:1, signer:1,
    dev:[['Laptop · Redlands',H(10,18,20,10),1]]},
  {id:'AC', email:'books@ledgerline.co',n:'Outside accountant', g:'outside',  title:'Ledgerline · Money and Records', since:D(10,2), last:H(10,20,16,30), passkey:0, signer:0,
    dev:[['Laptop · Ontario',H(10,20,16,30),1]]},
  {id:'LP', email:'lena@harborcap.com', n:'Lena Park',          g:'investors',title:'Harbor Capital · data room', since:D(10,14), last:H(10,20,11,5), passkey:0, signer:0, until:D(11,21),
    dev:[['Laptop · Irvine',H(10,20,11,5),1]]} ];
const INVITES = [{id:'PS', n:'Priya Shah', email:'priya@useclear.org', g:'field', title:'Riverside route', sent:D(10,19), exp:D(10,26), by:'K', ok:'DR'}];
const PPL = Object.fromEntries(PEOPLE.map(p=>[p.id,p]));
const pName = id => id==='SY' ? 'System' : (PPL[id]||INVITES.find(i=>i.id===id)||{n:id}).n;
const MEMBERS_N = 188;

/* ── what: the rules every page enforces. Team shows who can approve each; Settings holds the numbers ─────────────── */
const RULES = [ /* id, rule, what it covers, approvers (groups at Approve), last 30 days, median hours to a second person, setting it reads */
  {id:'money',  t:'Money moves',          c:'Top-ups, payout runs, bond issues, sales tax', who:['K','DR'], n30:6, med:4.2, set:'money'},
  {id:'shopbuy',t:'Shop buys and reorders',c:'Blanks, prints and packing from suppliers',   who:['K','DR'], n30:2, med:1.1, set:'shopbuy'},
  {id:'refund', t:'Shop refunds',          c:'Back the way the member paid',               who:['K','DR'], n30:0, med:0,   set:'refund'},
  {id:'chain',  t:'On-chain changes',      c:'Upgrades, caps and shop terms, in the Ops Safe',who:['K','DR','BS'], n30:9, med:7.8, set:'safe'},
  {id:'invites',t:'Invite batches',        c:'Each batch, oldest on the waitlist first',    who:['K','DR'], n30:3, med:2.1, set:'batch'},
  {id:'exports',t:'Member data exports',   c:'Any list with names, emails or phone numbers', who:['K','DR'], n30:2, med:0.5, set:'exports'},
  {id:'access', t:'Access changes',        c:'Inviting, turning off, or changing a group',  who:['K','DR'], n30:1, med:3.0, set:'access'},
  {id:'settings',t:'Settings changes',     c:'Any number on the Settings page',             who:['K','DR','BS'], n30:1, med:6.5, set:'settings'} ];
const CAN = [ /* things a person does, not approves: who can */
  ['Start a money move',['K','DR']],['Sign in the Ops Safe',['K','DR','BS']],['Deploy a contract',['DR']],['Reveal personal details',['K','DR']],
  ['Sign agreements for the co-op',['K']],['File for an entity',['K']],['Invite or turn off a person',['K']],['Confirm a new device',['K','DR']]];
const APPR = { /* proposer → approver, last 30 days */ K:{DR:6, BS:1}, DR:{K:5, BS:1}, ML:{K:3, DR:4} };
const WAITING = [ /* what, from, proposed by, waiting on, hours, usual hours, rule */
  ['PayoutPool top-up · $1,116.89','Money','K','DR',20,4.2,'money'],['AssurancePool v1.3','Build','DR','K',30,7.8,'chain'],
  ['Refund · order #1079 · $98.00','Shop','K','DR',3,1.6,'refund'],['Shop buys over $500.00','Settings','K','DR',5,6.5,'settings'] ];

/* ── settings ───────────────────────────────────────────────────────────────────────────────────────────────────── */
/* kind: money | num | pct | hours | days | choice | on | lock. lock: set somewhere else (a vote, the bylaws, the law) */
const SETS = [
  {id:'money',   sec:'money', t:'Second person on money moves', d:'Every move out of a co-op account, any amount', kind:'lock', v:'Always', why:'Set by the two-person rule policy v1.2', where:'records/docs:d15', used:['money']},
  {id:'shopbuy', sec:'money', t:'Shop buys need a second person over', d:'Supplier orders and recorded buys', kind:'money', v:250, used:['shop','money'], pend:'C-07'},
  {id:'refund',  sec:'money', t:'Shop refunds need a second person over', d:'Smaller refunds go back right away', kind:'money', v:50, used:['shop']},
  {id:'spend',   sec:'money', t:'Spending the co-op balance', d:'Member discounts collected at partner shops', kind:'lock', v:'Member vote', why:'Set by the co-op agreement', where:'governance/proposals', used:['money','governance']},
  {id:'safe',    sec:'chain', t:'Ops Safe signatures', d:'Upgrades, caps and shop terms', kind:'lock', v:'2 of 3', why:'Changed by a board vote, then in the Ops Safe', where:'governance/proposals', used:['build']},
  {id:'wait',    sec:'chain', t:'Wait before a change goes live', d:'After the last signature', kind:'hours', v:24, used:['build']},
  {id:'cap',     sec:'chain', t:'Starting cap for a new shop', d:'What a partner can extend before a raise', kind:'money', v:100, used:['merchants','build']},
  {id:'batch',   sec:'members', t:'Invite batch size', d:'Oldest on the waitlist first', kind:'num', v:25, unit:'people', used:['members']},
  {id:'exports', sec:'members', t:'Data exports need a second person', d:'Any list with names, emails or phone numbers', kind:'lock', v:'Always', why:'Set by the privacy policy', where:'records/docs:d15', used:['members','records']},
  {id:'margin',  sec:'shop', t:'Target margin', d:'Products under it are flagged', kind:'pct', v:60, used:['shop']},
  {id:'buffer',  sec:'shop', t:'Reorder buffer', d:'On top of the supplier’s lead time', kind:'num', v:1, unit:'week', used:['shop']},
  {id:'hold',    sec:'shop', t:'Pickup hold', d:'Then we message the member', kind:'days', v:14, used:['shop']},
  {id:'ship',    sec:'shop', t:'Flat shipping charged', d:'The label costs $7.40 on average', kind:'money', v:6, used:['shop']},
  {id:'cosign',  sec:'gov', t:'Co-signers to take a board decision to a vote', d:'Any member can start one', kind:'lock', v:'10 members', why:'Set by the bylaws', where:'governance/proposals', used:['governance','community']},
  {id:'quiet',   sec:'gov', t:'Discussion before a vote opens', d:'Proposals stay open for comment', kind:'days', v:7, used:['governance','community']},
  /* security */
  {id:'passkey', sec:'signin', t:'Passkey for anyone who can propose or approve', d:'Read-only people can use an emailed code', kind:'on', v:1, used:['team']},
  {id:'session', sec:'signin', t:'Stay signed in for', d:'On a trusted device', kind:'hours', v:12, used:['team']},
  {id:'again',   sec:'signin', t:'Ask again before money moves and signing', d:'Passkey every time', kind:'on', v:1, used:['money','build']},
  {id:'rotate',  sec:'signin', t:'Rotate connection keys every', d:'A reminder, then a second person swaps it', kind:'days', v:90, used:['settings']},
  {id:'newdev',  sec:'signin', t:'New devices need a confirmation', d:'From someone who can confirm devices', kind:'on', v:1, used:['team']},
  {id:'mask',    sec:'privacy', t:'Personal details masked everywhere', d:'Names, emails, phones and addresses', kind:'lock', v:'Always', why:'The server enforces it on every request', where:'records/reveals', used:['members','merchants','records']},
  {id:'reason',  sec:'privacy', t:'Ask for a reason on every reveal', d:'Skipping it is allowed in a rush, then flagged', kind:'on', v:1, used:['members','records']},
  {id:'revealers',sec:'privacy',t:'Who can reveal', d:'Groups at Approve on Members', kind:'lock', v:'Admin, Protocol', why:'Follows the Members column in Team', where:'team/groups', used:['members']},
  {id:'retain',  sec:'records', t:'Keep records for', d:'Documents, the audit log and reveals', kind:'lock', v:'7 years', why:'Required for the co-op and the money program', where:'records/docs', used:['records']},
  {id:'digest',  sec:'notify', t:'Daily digest', d:'What’s waiting, alerts and the day’s numbers', kind:'choice', v:'07:00', opts:['06:00','07:00','08:00','Off'], used:['home']} ];
const SETO = Object.fromEntries(SETS.map(s=>[s.id,s]));
const SEC_T = { money:['Money','Second person and spending'], chain:['On-chain','The Ops Safe and the wait'], members:['Members','Invites and lists'], shop:['Shop','Costing, stock and pickups'], gov:['Governance','Votes and discussion'],
  signin:['Sign-in','Passkeys, sessions and devices'], privacy:['Personal details','Masking and reveals'], records:['Records','How long things are kept'], notify:['Notifications','Who hears about what'] };
const PEND = [ /* setting changes waiting on a second person */
  {id:'C-07', set:'shopbuy', label:'Raising the shop buy limit to $500.00', from:250, to:500, by:'K', at:H(10,21,9,10), why:'Blank orders for the holiday run are mostly $300 to $900, so every one waits.', need:'DR'} ];
const SET_HIST = [ /* id, when, setting, from, to, by, approved by */
  ['C-06',H(10,9,15,0),'cap','$75.00','$100.00','DR','K'], ['C-05',H(10,2,10,30),'margin','55%','60%','K','DR'], ['C-04',H(9,28,9,0),'hold','10 days','14 days','K','DR'],
  ['C-03',H(9,14,11,0),'session','24 hours','12 hours','DR','K'], ['C-02',H(9,1,12,0),'batch','20 people','25 people','K','DR'] ];
const ALERTS = [ /* alert, when, who hears it */ ['Something is waiting on you','As soon as it’s yours to approve',[]],['A connection falls behind','Over an hour behind',['K','DR']],['A device goes offline','A Clear Point stops reporting',['ML','K']],['A reveal without a reason','Within the hour',['K']],['A sign-in from a new device','Until someone confirms it',['K','DR']] ];

/* connections: status ok | behind | off; hourly health for the last 24 hours (1 ok, 0.5 slow, 0 down) */
const CONN = [
  {id:'plaid',   n:'Plaid', what:'Bank data · 12 bank links', st:'behind', note:'3 hours behind · 7 of 12 links refreshed', last:H(10,21,11,0), by:'K', key:'4f2a', used:['money','members'], rot:41, hrs:[...Array(21).fill(1),0.5,0.5,0.5]},
  {id:'lithic',  n:'Lithic', what:'Card program', st:'ok', note:'Events every few seconds', last:H(10,21,13,58), by:'K', key:'91c0', used:['money','merchants'], rot:12, hrs:Array(24).fill(1)},
  {id:'bridge',  n:'Bridge', what:'Stablecoin services', st:'ok', note:'Last transfer 13:12', last:H(10,21,13,12), by:'K', key:'e7d3', used:['money'], rot:63, hrs:Array(24).fill(1)},
  {id:'base',    n:'Base Sepolia', what:'Testnet · contracts and pools', st:'ok', note:'1 second behind the chain', last:H(10,21,13,59), by:'DR', key:'@rpc', used:['build','money'], hrs:[...Array(9).fill(1),0.5,...Array(14).fill(1)]},
  {id:'safe',    n:'Ops Safe', what:'2 of 3 signers', st:'ok', note:'2 changes waiting to be signed', last:H(10,21,10,0), by:'DR', key:'@safe', used:['build','money'], hrs:Array(24).fill(1)},
  {id:'esign',   n:'E-signature', what:'Agreements and minutes', st:'ok', note:'1 envelope out · Inland Cycle Works', last:H(10,20,9,0), by:'K', key:'2b88', used:['governance','records'], rot:84, hrs:Array(24).fill(1)},
  {id:'opencast',n:'Opencast', what:'Live streams for Community', st:'ok', note:'Next stream Thu 22 Oct, 18:00', last:H(10,19,20,0), by:'K', key:'c4d1', used:['community'], rot:20, hrs:Array(24).fill(1)},
  {id:'store',   n:'Shop software', what:'useclear.org/shop', st:'ok', note:'5 orders today', last:H(10,21,12,40), by:'K', key:'77ab', used:['shop'], rot:30, hrs:Array(24).fill(1)},
  {id:'email',   n:'Email', what:'Invites, receipts and the digest', st:'ok', note:'99.6% delivered this week', last:H(10,21,13,30), by:'K', key:'05fe', used:['members','home'], rot:97, hrs:Array(24).fill(1)},
  {id:'printer', n:'Label printer', what:'Thermal, at the studio', st:'off', note:'Asleep since 18:00 yesterday · wakes when a label prints', last:H(10,20,18,0), by:'K', key:'', used:['shop'], hrs:[...Array(4).fill(1),...Array(20).fill(0)], idle:1} ];

/* organization */
const ENT = [ /* id, name, kind, status, tax id last 4, state filed */
  ['coop','Clear Co-op','Wyoming LLC · co-op','formed','4417'],['fin','Clear Financial Co.','Wyoming LLC','formed','8820'],['dt','The Deed & Title Co.','Wyoming LLC','forming',''],
  ['hold','Clear Capital Holdings','Wyoming C-corp','formed','3051'],['labs','ClearLabs Inc.','Wyoming C-corp','formed','6602'],['mgr','Manager LLC','Wyoming LLC','forming',''],['fdn','Clear Foundation','Wyoming foundation','forming',''] ];
const ENTO = Object.fromEntries(ENT.map(e=>[e[0],e]));
const PROFILE = [['Name','Clear Co-op'],['Website','useclear.org'],['Help email','help@useclear.org'],['Time zone','Pacific · Los Angeles'],['Fiscal year','January to December'],['Currency','US dollars']];

/* ── records: documents ─────────────────────────────────────────────────────────────────────────────────────────── */
const DT = { agreement:['Agreements','var(--fg)'], minutes:['Minutes','var(--land)'], filing:['Filings','color-mix(in srgb,var(--fg) 50%,transparent)'], policy:['Policies','var(--underway)'], bond:['Bonds','var(--live)'], report:['Payout reports','color-mix(in srgb,var(--fg) 25%,transparent)'] };
const DSTAT = { signed:['Signed','var(--fg)'], filed:['Filed','var(--settled)'], draft:['Draft','var(--underway)'], waiting:['Waiting on a signature','var(--live)'], final:['Final','var(--fg)'] };
const DOCS = [ /* id, title, type, entity, date, status, version, by, pages, governance link */
  ['d1','Merchant partner agreement · Inland Cycle Works','agreement','coop',D(10,20),'waiting','v1.1','Inland Cycle Works',6,'icw'],
  ['d2','Minutes · Co-op board, 7 Oct','minutes','coop',D(10,8),'draft','v0.2','Kai',4],
  ['d19','Shop returns and refunds · policy','policy','coop',D(9,28),'final','v1.0','Kai',2],
  ['d3','RevolvingIssuer v1.3 · audit notes','policy','labs',D(10,19),'final','v1.0','Dana Ruiz',9],
  ['d4','Merchant partner agreement · Uptown Barber','agreement','coop',D(10,20),'signed','v1.1','Uptown Barber · Kai',6],
  ['d5','Bond certificate · BB-0006','bond','hold',D(10,15),'signed','v1.0','Kai · Dana Ruiz',2],
  ['d6','Payout report · September','report','fin',D(10,2),'final','v1.0','System',3],
  ['d7','Minutes · ClearLabs board, 7 Oct','minutes','labs',D(10,8),'signed','v1.0','Kai',3],
  ['d8','Annual report · ClearLabs Inc.','filing','labs',D(10,16),'draft','v1.0','Kai',2],
  ['d9','Intercompany pricing policy','policy','hold',D(10,12),'draft','v0.3','Kai',5],
  ['d10','Program services agreement','agreement','fin',D(1,1),'signed','v1.0','Kai',14,'psa'],
  ['d11','Minutes · Holdings board, 16 Sep','minutes','hold',D(9,17),'signed','v1.0','Kai',5],
  ['d12','Holdings bylaws','policy','hold',D(9,16),'final','v1.0','Holdings board',22],
  ['d13','Cooperative operating agreement','agreement','coop',D(6,12),'signed','v1.0','Founding members',31,'coop-oa'],
  ['d14','Articles of organization · Manager LLC','filing','mgr',D(10,9),'filed','v1.0','Accountant',3],
  ['d15','Two-person rule','policy','coop',D(8,1),'final','v1.2','Co-op board',4] ];
const DCOUNT = { agreement:41, minutes:12, filing:7, policy:9, bond:6, report:14 };
const COVER_K = ['Formation papers','Operating rules','EIN letter','Board minutes','Annual report','Bank resolution'];
const COVER = { /* f on file · d draft · m missing · n not needed yet */
  coop:['f','f','f','d','n','f'], fin:['f','f','f','n','f','f'], dt:['d','f','m','n','n','m'], hold:['f','f','f','f','n','f'],
  labs:['f','f','f','f','d','f'], mgr:['f','d','m','n','n','m'], fdn:['d','n','n','n','n','n'] };
const CV = { f:['On file','var(--fg)'], d:['Draft','var(--underway)'], m:['Missing','var(--absent)'], n:['Not needed yet',''] };

/* ── records: the audit log ─────────────────────────────────────────────────────────────────────────────────────── */
const AREAS = { chain:['On-chain','var(--fg)'], money:['Money','var(--underway)'], members:['Members','var(--land)'], field:['Shops and field','color-mix(in srgb,var(--fg) 50%,transparent)'], shop:['Shop','var(--settled)'],
  gov:['Governance','color-mix(in srgb,var(--fg) 25%,transparent)'], team:['Team and settings','var(--live)'], system:['System','var(--line)'], alert:['Alert','var(--absent)'] };
const WHO = [['K','Kai'],['DR','Dana Ruiz'],['ML','Marcus Lee'],['SY','System']];
const LOG = [ /* id, time, who, area, action, detail, from, result, approver */
  ['n0',H2(10,21,13,40),'DR','money','Proposed paying the Q3 sales tax','$351.58 from operating cash to CDTFA, due 31 Oct.','Laptop · Riverside','waiting','Needs a second person'],
  ['a2',H2(10,21,13,10),'K','money','Drafted the PayoutPool top-up','$1,116.89 from operating cash, due 30 Oct.','Mac · Redlands','waiting','Needs a second person'],
  ['s1',H2(10,21,11,20),'K','shop','Proposed a refund on order #1079','$98.00 · Hoodie, wrong size. Needs a second person.','Mac · Redlands','waiting','Needs a second person'],
  ['a3',H2(10,21,10,0),'SY','chain','RevolvingIssuer v1.3 went live','After the 24-hour wait. Signed by Dana Ruiz and Kai.','Ops Safe','done',''],
  ['c7',H2(10,21,9,10),'K','team','Proposed raising shop buys to $500.00','Setting C-07 · from $250.00. Blank orders for the holiday run are mostly $300 to $900.','Mac · Redlands','waiting','Needs a second person'],
  ['a4',H2(10,21,9,12),'ML','field','Replaced poster P-012 at Uptown Barber','Photo attached. Next swap 20 Dec.','iPhone · Redlands','done',''],
  ['a5',H2(10,21,8,40),'SY','alert','Orange St. Point went offline','Counter device stopped reporting.','Device','alert',''],
  ['a6',H2(10,20,22,41),'SY','system','Plaid re-sync started','7 of 12 bank links refreshed so far.','Plaid','running',''],
  ['a7',H2(10,20,18,0),'DR','chain','Signed “Raise Rosa’s cap to $150.00”','First of two signatures. Waiting on you.','Laptop · Riverside','signed','Marcus Lee proposed'],
  ['a8',H2(10,20,16,0),'ML','field','Drafted “Add Inland Cycle Works”','Waits on the merchant agreement.','iPhone · Redlands','waiting',''],
  ['s2',H2(10,20,11,0),'K','shop','Put Graphic Tee · Two Ten Overpass on the shelf','Photos, price and stock checked.','Mac · Redlands','done',''],
  ['a9',H2(10,20,10,0),'K','chain','Signed RevolvingIssuer v1.3','Second of two signatures.','Mac · Redlands','approved','Dana Ruiz proposed'],
  ['a10',H2(10,20,9,0),'DR','chain','Signed AssurancePool v1.3','First of two. Waiting on you.','Laptop · Riverside','signed',''],
  ['t2',H2(10,19,10,5),'DR','team','Approved inviting Priya Shah to Field','Kai proposed. The invite expires 26 Oct.','Laptop · Riverside','approved','Kai proposed'],
  ['a11',H2(10,19,12,0),'DR','field','Approved “Add Uptown Barber”','Second signature on Marcus Lee’s change.','Laptop · Riverside','approved','Marcus Lee proposed'],
  ['a12',H2(10,19,9,30),'ML','system','Signed in from a new device','iPhone. Confirmed by Kai at 09:41.','iPhone · Redlands','confirmed',''],
  ['a13',H2(10,18,15,0),'K','gov','Sent the Inland Cycle Works agreement','Out for signature in the e-signature tool.','Mac · Redlands','done',''],
  ['a14',H2(10,18,11,0),'DR','members','Approved invite batch 12','25 people, oldest first. Kai proposed.','Laptop · Riverside','approved','Kai proposed'],
  ['a15',H2(10,15,9,0),'K','gov','Opened the member vote on v2.2','188 members can vote until 29 Oct.','Mac · Redlands','done',''],
  ['a16',H2(10,14,18,0),'DR','money','Approved issuing BB-0006','$5,000.00 face value. Kai proposed.','Laptop · Riverside','approved','Kai proposed'] ];
const RESULT = { approved:['Approved','var(--settled)'], waiting:['Waiting','var(--underway)'], done:['Done','var(--fg)'], alert:['Alert','var(--absent)'], running:['Running','var(--live)'], signed:['Signed','var(--fg)'], confirmed:['Confirmed','var(--fg)'] };
/* everyday actions, so the week reads true to life */
const WEEK = (()=>{ const r = rng(2026), out = [], prof = {K:[['chain',2],['money',2],['members',2],['gov',2],['field',1],['shop',1]], DR:[['chain',4],['money',3],['members',1]], ML:[['field',6],['members',1]], SY:[['system',3],['money',1],['chain',1],['shop',2]]};
  for (let d=0; d<7; d++) WHO.forEach(([w])=>{ const dw = new Date(H2(10,15+d,0)).getUTCDay(), we = dw===0||dw===6; const n = w==='SY' ? (we?3:5) : w==='ML' ? (we?3:7) : (we?1:5);
    for (let i=0;i<n;i++){ const pool = prof[w].flatMap(([a,k])=>Array(k).fill(a)); out.push([H2(10,15+d, 8 + Math.floor(r()*12), Math.floor(r()*60)), w, pool[Math.floor(r()*pool.length)]]); } });
  return out; })();

/* reveals and exports: personal details are masked; every reveal and every list that leaves is here */
const REVEALS = [ /* time, who, member, what, reason, where */
  [H(10,21,12,5),'K','M-0412','Email','Their card was declined twice; writing back about the hold','Members'],
  [H(10,21,10,40),'DR','M-0388','Phone','Confirming a payout to a new bank link','Members'],
  [H(10,20,15,20),'K','M-0157','Email and phone','Hardship pause request, from the help inbox','Members'],
  [H(10,20,9,55),'K','Rosa’s Panadería','Owner phone','Cap raise call, before signing','Merchants'],
  [H(10,19,17,30),'DR','M-0921','Address','Returned card, checking where it was sent','Members'],
  [H(10,19,11,10),'K','M-0044','Email','',  'Members'],
  [H(10,17,14,0),'K','Inland Cycle Works','Owner email','Sending the agreement for signature','Merchants'] ];
const EXPORTS = [ /* time, who, what, rows, approved by, state */
  [H(10,21,8,15),'K','Members who can vote on v2.2 · ids only',188,'','done', 'Ids only · not needed'],
  [H(10,19,16,0),'K','Waitlist · Redlands, for poster batch 14',312,'DR','approved',''],
  [H(10,16,10,0),'AC','Payout report · September',3,'','done','Totals only'],
  [H(10,12,9,30),'DR','Bondholders · BB-0001 to BB-0006',6,'K','approved',''],
  [H(10,21,13,50),'ML','Shop owners on the Riverside route · phone numbers',14,'','waiting','Needs a second person'] ];

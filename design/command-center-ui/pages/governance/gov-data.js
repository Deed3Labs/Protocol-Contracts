
/* ══ Governance data — proposals, who decides what, discussion ══════════════════════════════════════════════
   Demo "today" is Wed 21 Oct 2026, 14:00. 188 members can vote. A proposal reaches a vote once 10 members co-sign it
   (2% of members or 10, whichever is more). Member ballots are sealed until the vote closes; board votes are on the record. */
const DAY = 864e5, TODAY = Date.UTC(2026,9,21), NOW = TODAY + 14*3600e3;
const D = (m, d, y=2026) => Date.UTC(y, m-1, d);
const H = (m, d, h, mi=0) => Date.UTC(2026, m-1, d, h, mi);
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const fmtD = t => `${new Date(t).getUTCDate()} ${MON[new Date(t).getUTCMonth()]}`;
const WD = t => new Date(t).toLocaleDateString('en-US',{weekday:'short', timeZone:'UTC'});
const hm = t => new Date(t).toISOString().slice(11,16);
const leaf = t => `<span class="leaf"><span>${WD(t)}</span><b>${new Date(t).getUTCDate()}</b><span>${MON[new Date(t).getUTCMonth()]}</span></span>`;
const ago = t => { const m = Math.round((NOW - t)/6e4); if (m < 60) return `${Math.max(1,m)} min ago`; const h = Math.round(m/60); if (h < 24) return `${h} h ago`; const d = Math.round(h/24); return d===1 ? 'yesterday' : `${d} days ago`; };
const left = t => { const d = Math.ceil((t - NOW)/DAY); return d<=0 ? 'today' : d===1 ? 'tomorrow' : `in ${d} days`; };
const int = n => Math.round(n).toLocaleString('en-US');
const pct = (a,b) => b ? Math.round(a/b*100) + '%' : '–';

const MEMBERS = 188, SPONSORS = Math.max(10, Math.ceil(MEMBERS*0.02));

/* people. Members are masked here as everywhere in the Command Center; the forum in the app shows the name each member picks. */
const PPL = {
  kai:  { n:'Kai', ini:'K', role:'Admin · co-op board', board:true, staff:true },
  dana: { n:'Dana Ruiz', ini:'DR', role:'Ops', staff:true },
  m1:   { n:'Member M•••a4', ini:'A4', role:'Co-op board', board:true },
  m2:   { n:'Member M•••7c', ini:'7C', role:'Co-op board', board:true } };
const who = k => k==='kai' ? 'You' : PPL[k] ? PPL[k].n : k;
const mm = id => `Member M•••${id}`;

/* the stages a proposal moves through. Discussion runs alongside every one of them. */
const STAGES = [
  ['draft','Draft','Written with co-authors'],
  ['sponsor','Co-signing',`Needs ${SPONSORS} members to reach a vote`],
  ['check','Check','Who votes and what it takes'],
  ['vote','Voting','Text frozen · ballots sealed'],
  ['decided','Decided','Passed or failed'],
  ['done','Carried out','Tasks with owners and dates'] ];
const STG = Object.fromEntries(STAGES.map(s=>[s[0],s]));

/* who decides what: type → who votes, what it takes to pass, turnout needed (quorum), how long the vote runs */
const RULES = {
  spend:   { t:'Spending the co-op balance', body:'Members', pass:'More yes than no', q:0.10, days:7, note:'The co-op balance is held for a member vote' },
  bylaw:   { t:'Co-op agreement or bylaws', body:'Members, after the board', pass:'Two-thirds yes', q:0.20, days:14, note:'The board reviews it first; it can’t block it' },
  elect:   { t:'Board elections', body:'Members · the Assembly elects a third', pass:'Most votes per seat', q:0.10, days:14, note:'Nominations open 6 weeks before the meeting' },
  policy:  { t:'Policies and day-to-day decisions', body:'Co-op board', pass:'Majority of seats filled', q:null, days:null, note:'At a meeting or by written consent' },
  setting: { t:'Network settings', body:'Co-op board', pass:'Majority of seats filled', q:null, days:null, note:'Then signed in the Ops Safe, in Build' },
  reserved:{ t:'Holdings reserved matters', body:'Holdings board, then the co-op', pass:'The co-op’s yes', q:null, days:null, note:'Selling land or going under the 25% floor needs a member vote' },
  assembly:{ t:'Delegate Assembly matters', body:'Council chairs', pass:'Majority of chairs', q:null, days:null, note:'Switches on at 5 communities · 1 today', off:true } };
const PETITION = 'Members can take any board decision to a member vote with the same 10 co-signers.';

/* proposals. st: draft | sponsor | check | vote | decided | done | withdrawn | expired */
const PROPS = [
  { id:'P-012', type:'bylaw', t:'Adopt member agreement v2.2', by:'kai', st:'vote', opened:D(9,22), ver:3, frozen:D(10,15),
    sum:'Plain-language rewrite of the member agreement. Adds the hardship pause, the 90-day window to activate, and how member votes are counted.',
    sponsors:SPONSORS, voteOpen:D(10,15), voteClose:H(10,29,23,59), cast:61, castBy:[9,21,30,38,47,55,61], boardRec:'for', boardVote:[3,0], posts:42, hidden:1, mine:false, live:'Hearing held Mon 19 Oct · 46 came · recording in Community' },
  { id:'P-015', type:'spend', t:'Reprint the window posters for Cajon Blvd', by:'a4', st:'sponsor', opened:D(10,14), ver:2, amt:300,
    sum:'$300.00 from the co-op balance for 60 reprints. The first run faded in the sun; three shops asked for new ones.',
    sponsors:7, sponsorBy:D(11,13), posts:12, coauth:['3c'] },
  { id:'P-016', type:'setting', t:'Raise the starter credit limit to $150.00', by:'7c', st:'check', opened:D(10,6), ver:2,
    sum:'Starter limits go from $100.00 to $150.00 for members past their first full cycle with no late payments.',
    sponsors:13, checker:'kai', checkDue:D(10,23), checks:[['Type','Network setting · the board decides',1],['Fits the agreement','Section 6, credit limits',1],['Money','Room under the 20% RTD floor: $1,527.60',0],['Conflicts','None found yet',0]], posts:27, live:'On the agenda of Thu’s town hall · 22 Oct, 18:00' },
  { id:'P-017', type:'policy', t:'Hold the annual meeting on a Saturday', by:'3c', st:'draft', opened:D(10,19), ver:1, coauth:['a4','e1'],
    sum:'Move the annual member meeting from a weekday evening to a Saturday morning, with the online option kept.', posts:5 },
  { id:'P-014', type:'elect', t:'Elect three co-op board seats', by:'kai', st:'check', opened:D(10,1), ver:1,
    sum:'Three seats are on the ballot at the annual meeting on 15 Jan. Nominations are open until 4 Dec.', sponsors:null, checker:'dana', checkDue:D(12,4), nominations:4, checks:[['Type','Board election',1],['Seats','3 of 5',1],['Nominations','4 so far · open to 4 Dec',0]], posts:9 },
  { id:'P-013', type:'setting', t:'Register The Deed & Title Co. as a validator', by:'kai', st:'done', opened:D(9,28), ver:2, decidedAt:D(10,12), result:'passed', boardVote:[3,0],
    sum:'Lets D&T Co. review title before a deed is minted. It signs as a validator in ValidatorRegistry.', posts:8,
    tasks:[['Form The Deed & Title Co.','Governance · Entities','dana',D(11,30),'doing'],['Sign the change in the Ops Safe','Build · Ops Safe','kai',D(12,7),'waits','Waits on formation']] },
  { id:'P-009', type:'reserved', t:'Name the co-op’s second reserved seat on the Holdings board', by:'kai', st:'done', opened:D(9,15), ver:1, decidedAt:D(10,2), result:'passed', boardVote:[3,0],
    sum:'The co-op holds two reserved seats on the Holdings board. This names who sits in the second one.', posts:6,
    tasks:[['Pick the appointee','Co-op board','kai',D(10,15),'late'],['Record the appointment','Governance · Boards','dana',D(10,22),'waits','Waits on the pick']] },
  { id:'P-007', type:'policy', t:'Adopt the hardship pause', by:'m1', st:'done', opened:D(8,25), ver:2, decidedAt:D(9,10), result:'passed', boardVote:[3,0],
    sum:'A member who loses income can pause repayments for one cycle without it counting as late.', posts:19,
    tasks:[['Add the pause to the member app','Build · Member app','kai',D(9,30),'done'],['Write it into agreement v2.2','Governance · Proposals','kai',D(10,15),'done']] },
  { id:'P-010', type:'spend', t:'Put $100.00 toward the Uptown Barber launch', by:'e1', st:'decided', opened:D(9,8), ver:1, amt:100, decidedAt:D(10,4), result:'quorum',
    sum:'Coffee and printing for the launch morning at Uptown Barber.', sponsors:SPONSORS, voteOpen:D(9,27), voteClose:D(10,4), cast:16, tally:[13,2,1], boardRec:null, posts:11 },
  { id:'P-018', type:'policy', t:'Move the co-op’s bank account', by:'9b', st:'withdrawn', opened:D(10,9), ver:1, endedAt:D(10,17), why:'Withdrawn by the author · Clear Financial Co. holds member funds, not the co-op',
    sum:'Move the co-op’s operating account to a credit union.', posts:14 },
  { id:'P-011', type:'spend', t:'Sponsor a youth soccer team', by:'5f', st:'expired', opened:D(9,1), ver:1, endedAt:D(10,1), sponsors:4, why:'Expired with 4 of 10 co-signers',
    sum:'$400.00 toward jerseys for the Highland youth league.', posts:7 } ];
const PROP = Object.fromEntries(PROPS.map(p=>[p.id,p]));

/* the forum. Posts belong to a proposal (or to Ideas, before there is one). */
const POSTS = [
  { p:'P-012', by:'kai', at:H(10,21,12,40), t:'Turnout is 32% with eight days left. The two-thirds bar counts only yes and no, not abstentions.', staff:true },
  { p:'P-016', by:'2d', at:H(10,21,11,5), t:'Does the higher limit apply if I was late once in my first month but not since?', r:3 },
  { p:'P-015', by:'a4', at:H(10,21,9,30), t:'Added photos of the faded posters at Rosa’s and the laundromat. Three more co-signers and it goes to a vote.', r:5 },
  { p:'idea', by:'e1', at:H(10,20,19,10), t:'Idea: a tool library at the Highland community room, paid from the co-op balance.', r:8 },
  { p:'P-012', by:'7c', at:H(10,20,17,0), t:'Section 9 now says votes are counted at the close, not as they come in. That answers the question from last week.', r:2 },
  { p:'P-012', by:'b8', at:H(10,20,15,20), hidden:'Dana Ruiz · shared another member’s address' },
  { p:'P-017', by:'3c', at:H(10,20,10,0), t:'Draft is up. Saturday 10am, with the stream kept for anyone who can’t come.', r:4 } ];
const IDEAS = 23;

/* ── entities: who owns what. The Foundation sits outside the tree and answers to no one. ── */
const ENT = [ /* id, name, kind, status, what it does */
  ['coop','Clear Co-op','Wyoming LLC · co-op','formed','The parent. One member, one vote. Taxed as a corporation.'],
  ['fin','Clear Financial Co.','Wyoming LLC','formed','Runs the card and money programs. Holds member funds for their benefit.'],
  ['dt','The Deed & Title Co.','Wyoming LLC','forming','Keeps title records and will review deeds as a validator. Does not hold escrow.'],
  ['hold','Clear Capital Holdings','Wyoming C-corp','formed','Holds the economics of both funds. The co-op holds its governance class.'],
  ['labs','ClearLabs Inc.','Wyoming C-corp','formed','Research and development. Maintains the protocol for the Foundation.'],
  ['mgr','Manager LLC','Wyoming LLC','forming','Manages both funds and holds a small share of Clear Properties Co. Owned by Holdings.'],
  ['prop','Clear Properties Co.','Wyoming LLC · partnership','planned','Takes property contributions for OP units.'],
  ['lend','Clear Lending Co.','Wyoming LLC','planned','The credit book, bond series and pool shares.'],
  ['fdn','Clear Foundation','Wyoming foundation','forming','Holds the protocol. Ownerless, outside the tree.'] ];
const ENTO = Object.fromEntries(ENT.map(e=>[e[0],e]));
const EST = { formed:['Formed','var(--fg)'], forming:['Forming','var(--underway)'], planned:['Planned','var(--line)'] };
const PARENT = { coop:null, fin:'coop', dt:'coop', hold:'coop', labs:'coop', mgr:'hold', lend:'hold', prop:'hold', fdn:null };
const OWN = { fin:'100%', dt:'100%', hold:'100%', labs:'Majority', mgr:'100%', lend:'100%', prop:'Majority, shrinking as contributors join' };
const ENTF = {
  coop:{ formed:D(6,12), tax:'Corporation, by election', ein:'••-•••4821', officers:'Kai, president', agr:['coop-oa','psa','mem21','ics'] },
  fin:{ formed:D(2,3), tax:'Disregarded', ein:'••-•••1907', officers:'Kai, manager', agr:['psa','lithic','bridge','plaid'] },
  dt:{ tax:'Disregarded', steps:[['Name reserved',1],['Operating agreement',1],['Articles filed',0],['EIN',0],['Bank account',0]], due:D(11,30), agr:[] },
  hold:{ formed:D(7,20), tax:'C-corp', ein:'••-•••6630', officers:'Kai, president', agr:['ics'] },
  labs:{ formed:D(8,5), tax:'C-corp', ein:'••-•••3315', officers:'Kai, CEO · Dana Ruiz, protocol lead', agr:['pma'] },
  mgr:{ tax:'Disregarded', steps:[['Name reserved',1],['Articles filed',1],['Operating agreement',0],['EIN',0],['Bank account',0]], due:D(12,15), agr:[] },
  prop:{ tax:'Partnership', steps:[['Name reserved',0],['Articles filed',0],['Operating agreement',0],['EIN',0],['First contribution',0]], agr:[] },
  lend:{ tax:'Disregarded', steps:[['Name reserved',0],['Articles filed',0],['Operating agreement',0],['EIN',0],['Bank account',0]], agr:[] },
  fdn:{ tax:'Not taxed as a business', steps:[['Charter drafted',1],['Founder’s letter',0],['Filed with the state',0],['First council',0]], due:D(12,15), agr:['pma'] } };
const RESERVED = [['Selling or transferring land','Needs a member vote'],['New share classes, or the co-op under its 25% floor','Needs a member vote'],['Changing the charter or its purpose','Co-op board'],['Selling, merging or closing Holdings','Co-op board'],['Replacing the Manager','Co-op board'],['Related-party deals over $25,000.00','Co-op board'],['Borrowing over $250,000.00','Co-op board']];

/* ── boards: seats as fractions, terms, meetings, resolutions ── */
const SEATC = { c:['Chair','var(--live)'], m:['Member-elected','var(--fg)'], a:['Elected by the Assembly','color-mix(in srgb,var(--fg) 60%,transparent)'], r:['Co-op reserved','var(--land)'], i:['Investor','color-mix(in srgb,var(--fg) 45%,transparent)'], n:['Neutral','var(--underway)'], f:['Open seat','var(--line)'], t:['Team','color-mix(in srgb,var(--fg) 45%,transparent)'] };
const GBOARDS = [ /* id, name, who it answers to, seats: [class, holder, from, to, note] */
  ['coop','Co-op board','Member-elected · the Assembly elects a third once it’s switched on', [['m','kai',D(6,12),Date.UTC(2028,0,15)],['m','m1',D(8,20),Date.UTC(2028,0,15)],['m','m2',D(8,20),Date.UTC(2027,0,15)],['m',null,0,0,'Elected 15 Jan'],['m',null,0,0,'Elected 15 Jan']]],
  ['hold','Holdings board','The co-op holds reserved seats, the chair and a veto on reserved matters', [['c',null,0,0,'Elected directly'],['r','kai',D(7,20),Date.UTC(2028,6,20)],['r',null,0,0,'P-009 · pick is late'],['i',null,0,0,'After the financial class sells'],['i',null,0,0,'After the financial class sells'],['n',null,0,0,'Picked jointly'],['f',null,0,0,'Open to anyone']]],
  ['labs','ClearLabs board','Majority owned by the co-op', [['r','kai',D(8,5),Date.UTC(2028,7,5)],['r','dana',D(8,5),Date.UTC(2028,7,5)],['t',null,0,0,'When a protocol lead joins']]],
  ['asm','Delegate Assembly','Council chairs · switches on at 5 communities', [['a',null,0,0,'Highland council'],['a',null,0,0,'Switches on at 5'],['a',null,0,0,'Switches on at 5'],['a',null,0,0,'Switches on at 5'],['a',null,0,0,'Switches on at 5']], true] ];
const MEETINGS = [ /* id, board, when, kind, status, minutes */
  ['M-14','coop',H(11,4,18),'Open session · broadcast in Community','next',null],
  ['M-13','coop',H(10,7,18),'Open session','held','approve'],
  ['M-12','hold',H(9,16,17),'First meeting','held','approved'],
  ['M-11','labs',H(10,7,16),'Regular','held','approved'],
  ['M-10','coop',H(9,2,18),'Open session','held','approved'] ];
const AGENDA = [ /* item, minutes, owner, kind, link */
  ['Approve the 7 Oct minutes',5,'kai','vote'],['P-016 · raise the starter credit limit',15,'kai','vote','P-016'],['Result of the vote on agreement v2.2',10,'kai','report','P-012'],
  ['Q3 money review',15,'dana','report'],['Intercompany pricing policy',15,'kai','vote'],['Pick the Holdings appointee',10,'kai','vote','P-009'],['Open seats and the annual meeting',10,'kai','discuss','P-014'] ];
const AK = { vote:['Vote','var(--fg)'], report:['Report','var(--land)'], discuss:['Discuss','var(--line)'] };
const RESOS = [ /* date, board, title, votes by seat, proposal */
  [D(10,12),'coop','Register The Deed & Title Co. as a validator',['y','y','y'],'P-013'],
  [D(10,7),'coop','Member fee schedule',['y','y','y']],
  [D(10,7),'labs','Protocol maintenance terms',['r','y']],
  [D(10,2),'coop','Name the second reserved Holdings seat',['y','y','y'],'P-009'],
  [D(9,16),'hold','Adopt the bylaws',['y']],
  [D(9,10),'coop','Adopt the hardship pause',['y','y','y'],'P-007'],
  [D(9,2),'coop','Issue ClearLabs shares to the co-op',['r','y','y']] ];
const VOTEC = { y:['Yes','var(--fg)'], n:['No','var(--absent)'], r:['Recused','var(--line)'], a:['Absent','transparent'] };

/* ── agreements: moved here from Contracts ── */
const AGR_T = [['company','Between our companies'],['provider','Providers'],['member','Members'],['merchant','Shops']];
const AGR = [
  {id:'coop-oa', name:'Cooperative operating agreement', party:'Clear Co-op', type:'company', st:'signed', a:D(6,12), b:null, ver:'v1.0', next:'v1.1', note:'Adopted by the founding members. Changes need a member vote.'},
  {id:'psa', name:'Program services agreement', party:'Clear Financial Co.', type:'company', st:'renew', a:D(1,1), b:Date.UTC(2027,0,1), ver:'v1.0', note:'Clear Financial Co. runs the card and money programs for the co-op.'},
  {id:'pma', name:'Protocol maintenance', party:'ClearLabs Inc.', type:'company', st:'renew', a:Date.UTC(2025,11,15), b:D(12,15), ver:'v1.0', next:'v1.1', note:'ClearLabs maintains the protocol for the Foundation, which can hire other maintainers too.'},
  {id:'ics', name:'Intercompany services', party:'Clear Capital Holdings', type:'company', st:'draft', a:null, b:null, ver:'v0.3', note:'Pricing for services between the co-op and Holdings, at arm’s length. On the 4 Nov agenda.'},
  {id:'lithic', name:'Card program agreement', party:'Lithic', type:'provider', st:'signed', a:D(3,2), b:Date.UTC(2027,2,1), ver:'v2.0', note:'Cards and authorizations.'},
  {id:'bridge', name:'Stablecoin services', party:'Bridge', type:'provider', st:'signed', a:D(7,18), b:Date.UTC(2027,6,18), ver:'v1.0', note:'USDC on and off ramps. Holds the reserve behind member savings.'},
  {id:'plaid', name:'Bank data', party:'Plaid', type:'provider', st:'renew', a:Date.UTC(2025,10,12), b:D(11,12), ver:'v1.0', note:'Bank links for members and the business account.'},
  {id:'print', name:'Poster printing', party:'Inland Print Co.', type:'provider', st:'renew', a:Date.UTC(2025,10,30), b:D(11,30), ver:'v1.0', note:'Window posters, printed in batches of 25.'},
  {id:'esign', name:'E-signature', party:'E-signature tool', type:'provider', st:'signed', a:D(8,1), b:null, roll:1, ver:'—', note:'Month to month. Signed copies come back here.'},
  {id:'mem21', name:'Member agreement', party:'Every member', type:'member', st:'signed', a:D(8,14), b:null, ver:'v2.1', next:'v2.2', note:'Every member accepts it when they open an account. v2.2 is being voted on as P-012.', prop:'P-012'},
  {id:'shops', name:'Merchant partner agreement', party:'12 shops', type:'merchant', st:'signed', a:D(8,3), b:null, ver:'v1.1', note:'NET-30 or NET-14, a fee of up to 2.5% and a cap per sale, set per shop in MerchantRegistry.'},
  {id:'icw', name:'Merchant partner agreement', party:'Inland Cycle Works', type:'merchant', st:'out', a:null, b:null, sent:D(10,18), ver:'v1.1', note:'They signed 20 Oct. Founding seat 4 of 5 once you sign; the shop is added in the Ops Safe after.'} ];
const AST = { signed:['Signed','var(--fg)'], renew:['Renew soon','var(--underway)'], draft:['Drafting','var(--line)'], out:['Waiting on you','var(--live)'], vote:['Being voted on','var(--live)'] };

/* ── the calendar: filings, meetings and votes across every entity ── */
const FILINGS = [ /* id, entity, title, due, status, owner */
  ['f1','labs','Annual report',D(11,1),'ready','kai'],['f2','coop','Board minutes · 7 Oct',D(11,4),'draft','kai'],['f3','coop','Statement of Information',D(11,15),'none','Accountant'],
  ['f4','dt','Formation filing',D(11,30),'draft','Accountant'],['f5','fdn','Foundation charter',D(12,15),'draft','Counsel'],['f6','fin','Program review',D(12,31),'none','dana'],
  ['f16','coop','Sales tax return · Q3',D(10,31),'ready','dana'],
  ['f7','coop','Annual member meeting',Date.UTC(2027,0,15),'none','kai'],['f15','coop','Sales tax return · Q4',Date.UTC(2027,0,31),'later','Accountant'],['f8','fin','Annual report',Date.UTC(2027,2,1),'later','Accountant'],
  ['f9','fin','Program review',Date.UTC(2027,2,31),'later','dana'],['f10','coop','Federal return',Date.UTC(2027,3,15),'later','Accountant'],['f11','hold','Federal return',Date.UTC(2027,3,15),'later','Accountant'],
  ['f12','labs','Federal return',Date.UTC(2027,3,15),'later','Accountant'],['f13','coop','Annual report',Date.UTC(2027,5,1),'later','Accountant'],['f14','hold','Annual report',Date.UTC(2027,6,1),'later','Accountant'],
  ['f0','coop','Board minutes · 2 Sep',D(9,30),'done','kai'],['f00','hold','Bylaws filed',D(9,30),'done','Accountant'] ];
const FST = { ready:['Ready to file','var(--settled)'], draft:['Drafting','var(--underway)'], none:['Not started','var(--absent)'], later:['Later','var(--line)'], done:['Filed','var(--fg)'] };
const ESHORT = { coop:'Co-op', fin:'Financial', dt:'D&T Co.', hold:'Holdings', labs:'ClearLabs', mgr:'Manager', prop:'Properties', lend:'Lending', fdn:'Foundation' };

/* ── versions of the standard agreements. st: in (in force) · old (replaced) · vote · draft. Changes: + added · ~ changed · − removed ── */
const VERS = {
  'coop-oa':[ ['v1.0',D(6,12),'in','Founding members',['+ One member, one vote','+ Taxed as a corporation, by election','+ Changes need a member vote']],
              ['v1.1',Date.UTC(2027,0,15),'draft','Goes to a member vote at the annual meeting',['+ The Delegate Assembly, switched on at 5 communities','+ Members can take a board decision to a vote with 10 co-signers','~ Board seats written as fractions, not counts']] ],
  'mem21':  [ ['v1.0',D(3,1),'old','Clear Financial Co., before the co-op',['+ Savings account and card','+ Bank links through Plaid']],
              ['v2.0',D(6,12),'old','Adopted with the co-op',['~ Members join the co-op, not a company','+ One member, one vote','+ Savings reserved 1 : 1']],
              ['v2.1',D(8,14),'in','Co-op board · 12 Aug',['+ Savings-backed credit','+ Clear Pay at partner shops','~ Fees move to a schedule the board sets']],
              ['v2.2',H(10,29,23,59),'vote','P-012 · member vote, closes 29 Oct',['+ Hardship pause, one cycle (from P-007)','+ 90 days to activate a new account','+ How member votes are counted, sealed until the close','~ Sections 1 to 6 rewritten in plain language','− The paper statement fee']] ],
  'shops':  [ ['v1.0',D(8,3),'old','Standard terms · Kai',['+ NET-30 payouts','+ A fee of up to 2.5%','+ A cap per sale']],
              ['v1.1',D(9,15),'in','Co-op board · 2 Sep',['+ NET-14 for small tickets','+ Clear Pay at the counter','~ Founding partner terms written in']] ],
  'pma':    [ ['v1.0',Date.UTC(2025,11,15),'in','ClearLabs board',['+ ClearLabs maintains the protocol','+ Hourly, billed monthly']],
              ['v1.1',D(12,15),'draft','For the 15 Dec renewal',['~ The Foundation can hire other maintainers too','~ A fixed monthly fee instead of hourly','+ Security reviews before every upgrade']] ],
  'psa':    [ ['v1.0',D(1,1),'in','Clear Financial Co. and the co-op',['+ Clear Financial Co. runs the card and money programs','+ Member funds held for their benefit']] ],
  'ics':    [ ['v0.3',D(11,4),'draft','On the 4 Nov board agenda',['+ Prices for shared staff and systems','+ An arm’s-length test, checked every year','~ Related-party deals over $25,000.00 go to the co-op board']] ] };
/* who is on which version, where people accept it one by one */
const VUSE = { 'mem21':[['v2.1',188]], 'shops':[['v1.0',3],['v1.1',9]] };
const VST = { in:['In force','var(--fg)'], old:['Replaced','var(--line)'], vote:['Being voted on','var(--live)'], draft:['Drafting','var(--underway)'] };

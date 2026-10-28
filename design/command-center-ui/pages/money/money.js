
/* ══ Money — is everything covered, where it sits, and the moves that need two people ══════════════════════
   Tabs answer one question each: Overview (covered?), Cash flow (what moves in the next 30 days), Credit (the book),
   Pools (AssurancePool, Payout, Yield, Bonds), Moves (propose, approve, history). The two checks stay apart on purpose:
   RTD gates credit; claims-in-order only reports and is never summed. */
const N = { tab:'overview', pool:'yield', panel:null, me:'kai', dp:0, mp:0, mf:'all', rej:false };
const ME = () => PPL[N.me], CAN = () => ME().sign;
const firstN = k => k===N.me ? 'You' : PPL[k].f;
const ICO = { chev:'<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5"/></svg>', back:'<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3.5 5.5 8l4.5 4.5"/></svg>', x:'<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>' };
function toast(t){ let el = document.getElementById('toast'); if (!el){ el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el); } el.innerHTML = t; el.classList.add('on'); clearTimeout(el._t); el._t = setTimeout(()=>el.classList.remove('on'), 3200); }
const cell = (cls, title, right, body, foot, id='') => `<div class="cell ${cls}"${id?` id="${id}"`:''}><div class="hd"><h2>${title}</h2><div class="r">${right}</div></div>${body}<div class="bk-ft">${foot}</div></div>`;
const lbl = t => `<span class="lbl">${t}</span>`;
const band = (cells, first) => `<section class="band"${first?' style="margin-top:0"':''}><div class="bento">${cells}</div></section>`;
const waiting = () => N.moves.filter(m=>m.st==='waiting'), pend = () => N.moves.filter(m=>m.st==='waiting'||m.st==='merchants'), forMe = () => waiting().filter(m=>m.by!==N.me && CAN() && (!m.wait || m.wait===N.me));
const freeCash = () => M.cash - ASIDE.reduce((a,x)=>a+x[1],0);
const pager = (p, n, per, key) => { const pages = Math.max(1, Math.ceil(n/per)); return `<span class="pg2"><span>${n ? p*per+1 : 0}–${Math.min(n,(p+1)*per)} of ${n}</span><button data-${key}="-1" ${p===0?'disabled':''} aria-label="Previous">${ICO.back}</button><button data-${key}="1" ${p>=pages-1?'disabled':''} aria-label="Next">${ICO.chev}</button></span>`; };

/* ── the header: one sentence, then four vitals ─────────────────────────────────────── */
function renderHdr(){
  const w = pend(), mine = forMe(), tier3 = Math.min(1,M.bv/M.bonds);
  const B = {
    overview:`Member savings, shops and bondholders are ${tier3>=1?'all':'mostly'} covered. ${w.some(m=>m.kind==='topup'||m.kind==='bondvault') ? `On 4 Nov the payout pool borrows ${money(M.short)} from the yield pool unless <a data-ntab="moves">the top-up</a> is signed.` : 'Nothing borrows from the yield pool on 4 Nov.'}`,
    cash:`${money(13980.05)} goes to shops in the next 30 days and ${money(3792.56)} comes in. On 4 Nov the payout pool <a data-ntab="cash" data-njump="ngap">borrows ${money(M.short)}</a> from the yield pool.`,
    credit:`${money(M.credit)} is owed by ${M.members} members. ${pct(M.savingsBacked,M.credit,0)} is backed by their own savings and ${pct(CR.aging[0][1],M.credit,0)} is current.`,
    pools:`The yield pool is ${pct(Y.lent,Y.assets,0)} lent out and pays depositors ${(Y.apy*100).toFixed(2)}% a year. <a data-npool="bonds">BondVault</a> holds ${money(M.bv)} for ${BONDS.length} bonds and keeps ${money(BV_NEED())} of it back.`,
    moves: w.length ? `${w.length===1?'One move waits':`${['','One','Two','Three','Four','Five'][w.length]||w.length} moves wait`} for a second person.${mine.length ? ` <a data-nopen="${mine[0].id}">${mine[0].t}</a> needs you.` : ''}` : 'Nothing is waiting for a second person.'
  }[N.tab];
  const rtdW = Math.min(1, M.rtd/0.4)*100, flr = M.floor/0.4*100;
  document.getElementById('hdr').innerHTML = `<span class="when"><span class="dot"></span>Money · Wed 21 Oct · Demo data</span><p class="brief">${B}</p>
    <div class="strip">
      <div class="sc"><span class="lbl">Credit gate</span><div class="sc-v">${(M.rtd*100).toFixed(1)}% <small>RTD</small></div><div class="mb"><i style="width:${rtdW}%;background:var(--live)"></i><s class="nflr" style="left:${flr}%"></s></div><div class="sc-s">Floor 20% · ${money(M.room)} can still issue</div></div>
      <div class="sc"><span class="lbl">Member savings</span><div class="sc-v">${money(M.savings).replace(/\.\d+$/,'')}<small class="ct">${money(M.savings).match(/\.\d+$/)[0]}</small></div><div class="mb"><i style="width:100%"></i></div><div class="sc-s">Reserved 1 : 1 · checked 2 min ago</div></div>
      <div class="sc"><span class="lbl">Next 30 days</span><div class="sc-v">${money(13980.05).replace(/\.\d+$/,'')}<small>out</small></div><div class="mb"><i style="width:${3792.56/13980.05*100}%;background:var(--land)"></i><span class="hroom" style="left:${(M.payout+3792.56)/13980.05*100}%;right:0;box-shadow:inset 0 0 0 1px var(--underway);background:repeating-linear-gradient(45deg,var(--underway) 0 1.5px,transparent 1.5px 5px)"></span></div><div class="sc-s">${money(3792.56)} in · ${money(M.short)} short on 4 Nov</div></div>
      <div class="sc"><span class="lbl">Moves</span><div class="sc-v">${w.length} <small>waiting</small></div><div class="mb">${w.map((m,i)=>`<i style="left:${i/Math.max(3,w.length)*100}%;width:calc(${100/Math.max(3,w.length)}% - 2px);background:${forMe().includes(m)?'var(--underway)':m.st==='merchants'?'var(--live)':'color-mix(in srgb,var(--fg) 40%,transparent)'}"></i>`).join('')}</div><div class="sc-s">${mine.length ? `${mine.length} for you` : 'None for you'}${w.some(m=>m.st==='merchants')?` · ${w.filter(m=>m.st==='merchants').length} in Merchants`:''}</div></div>
    </div>`;
}

/* ══ Overview: is everything covered? ══════════════════════════════════════════════ */
function claimsCell(){
  const C = [['Member savings','USDC reserve at Bridge',M.savings,M.savings],['Shops, by 4 Nov','Payout pool, then the yield pool',M.owed14,M.payout+M.dueMembers+Y.toPayout],
    ['Bondholders','BondVault',M.bonds,Math.min(M.bonds,M.bv)],['Yield pool deposits','Pool cash, then loans out',Y.assets,Y.assets,Y.cash-Y.toPayout]];
  return cell('s7','Claims in order','<span class="lbl">Who gets paid first</span>',
    `<div class="ncl">${C.map(([k,by,owed,held,liq],i)=>{ const c = Math.min(1, held/owed), gap = Math.max(0, owed-held);
      return `<div class="ncl-r ${c<1?'part':''}"><span class="ncl-n">${i+1}</span><span class="ncl-k"><b>${k}</b><span>${by}</span></span>
        <span class="ncl-b">${liq!=null ? `<i style="width:${liq/owed*100}%"></i><i style="width:${(held-liq)/owed*100}%;background:var(--land)"></i>` : `<i style="width:${c*100}%"></i>${c<1?`<em style="left:${c*100}%;right:0"></em>`:''}`}</span>
        <span class="ncl-p"><b>${c>=1?'100%':pct(held,owed)}</b><span>${gap ? money(gap)+' short' : 'covered'}</span></span><b class="ncl-v">${money(owed)}</b></div>`; }).join('')}</div>`,
    `<span class="f-key"><span><i style="background:var(--fg)"></i>Cash or reserve</span><span><i style="background:var(--land)"></i>Out on loan</span><span><i class="hatch"></i>Not covered yet</span></span><button data-ntab="pools">Pools →</button>`);
}
function gateCell(){
  const W = 100, H = 36, mx = .4, pts = RTD_W.map((v,i)=>v==null?null:[i/(RTD_W.length-1)*W, H-(v/mx)*H]).filter(Boolean), dip = RTD_W.findIndex(v=>v!=null && v<M.floor);
  const spark = `<svg class="ngs" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><line x1="0" x2="${W}" y1="${H-(M.floor/mx)*H}" y2="${H-(M.floor/mx)*H}" class="fl"/><path d="M${pts.map(p=>p.map(v=>v.toFixed(1)).join(',')).join(' L')}"/></svg>`;
  return cell('s5','Credit gate','<span class="lbl">Protocol · 12 s</span>',
    `<div class="ngt"><div class="ngt-top"><div class="m-big">${(M.rtd*100).toFixed(1)}% <small>RTD</small></div><span class="fst ok">Open</span></div>
      <div class="ngt-eq"><span><b>${money(M.assurance)}</b>AssurancePool</span><i>÷</i><span><b>${money(M.unsecured)}</b>Unsecured credit</span></div>
      <div class="ngt-m"><div class="ngt-t"><i style="width:${M.rtd/mx*100}%"></i><s style="left:${M.floor/mx*100}%"><em>20% floor</em></s></div><div class="ngt-ax"><span>0</span><span>40%</span></div></div>
      <div class="ngt-h">${spark}<span><b>${NW[dip]}</b> fell to ${(RTD_W[dip]*100).toFixed(1)}% and paused new credit for a week</span></div></div>`,
    `<span>${money(M.room)} more unsecured credit can issue</span><button data-npool="ap" data-ntab="pools">AssurancePool →</button>`);
}
function runwayChart(h=200){
  let b = M.payout; const pts = [[0,b]]; for (let d=1; d<=30; d++){ FLOWS.filter(f=>f[0]===d).forEach(f=>{ pts.push([d,b]); b += f[1]==='in'?f[2]:-f[2]; pts.push([d,b]); }); } pts.push([30,b]);
  const mx = 12000, mn = -4000, W = 1000, x = d => d/30*W, y = v => (mx-v)/(mx-mn)*h, z = y(0), pc = v => (y(v)/h*100).toFixed(2)+'%';
  const line = 'M'+pts.map(([d,v])=>`${x(d).toFixed(1)},${y(v).toFixed(1)}`).join(' L');
  const lo = Math.min(...pts.map(p=>p[1])), g0 = 14, g1 = 16;
  const area = `M0,${z} L`+pts.map(([d,v])=>`${x(d).toFixed(1)},${y(Math.max(0,v)).toFixed(1)}`).join(' L')+` L${W},${z} Z`;
  const marks = FLOWS.map(([d,k,v])=>`<i class="${k}" style="left:${d/30*100}%" title="${dayD(d)} · ${k==='in'?'+':'−'}${money(v)}"></i>`).join('');
  return `<div class="nrw"><div class="nrw-p">
      <svg viewBox="0 0 ${W} ${h}" preserveAspectRatio="none" aria-hidden="true">
        <defs><pattern id="nhu" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="7" class="hxu"/></pattern></defs>
        ${[5000,10000].map(v=>`<line x1="0" x2="${W}" y1="${y(v)}" y2="${y(v)}" class="grid"/>`).join('')}
        <path d="${area}" class="ar"/>
        <rect x="${x(g0)}" y="${z}" width="${x(g1)-x(g0)}" height="${y(lo)-z}" class="gap"/>
        <line x1="0" x2="${W}" y1="${z}" y2="${z}" class="zero"/>
        <path d="${line}" class="ln"/></svg>
      ${[[10000,'$10k'],[5000,'$5k'],[0,'$0']].map(([v,t])=>`<span class="nrw-y" style="top:${pc(v)}">${t}</span>`).join('')}
      <span class="nrw-c" style="left:${(x(g0)+x(g1))/2/W*100}%;top:calc(${pc(lo)} + 8px)"><b>Borrows ${money(-lo)}</b><span>${dayD(g0)} → ${dayD(g1)}, from the yield pool</span></span>
      <span class="nrw-e" style="top:${pc(b)}"><b>${money(b)}</b></span>
</div>
    <div class="nrw-x"><div class="nrw-m">${marks}</div>${[0,7,14,21,28].map(d=>`<span style="left:${d/30*100}%">${dayD(d)}</span>`).join('')}</div></div>`;
}
function renderOverview(){
  const run = cell('s8','The payout pool, next 30 days','<span class="lbl">Projected from the schedule</span>',
    `<div class="nrun"><div class="nrun-h"><div class="m-big">${money(52.51)} <small>left on 20 Nov, after it borrows and pays back</small></div></div>${runwayChart()}
      <div class="f-key nrun-k"><span><i style="background:var(--land)"></i>Repayments in</span><span><i style="background:var(--fg)"></i>Payouts to shops</span><span><i class="hatch"></i>Borrowed from the yield pool</span><span><i style="background:color-mix(in srgb,var(--fg) 12%,transparent);box-shadow:inset 0 0 0 1px var(--fg-50)"></i>In the pool</span></div></div>`,
    `<span>${money(13980.05)} out · ${money(3792.56)} in</span><button data-ntab="cash">Cash flow →</button>`);
  const w = pend(), mine = forMe();
  const NEED = [
    ...mine.map(m=>['underway', `Approve: ${m.t}`, `${money(m.amt)} · ${firstN(m.by)} proposed ${rel(m.d)}${m.due!=null?' · due '+dayD(m.due):''}`, rel(m.d)==='today'?'Today':WD(m.d), `<span class="who">Needs you</span><button class="lnk" data-nopen="${m.id}">Review →</button>`]),
    ...w.filter(m=>m.st==='waiting' && m.by===N.me).map(m=>['line', m.t, `${money(m.amt)} · you proposed ${rel(m.d)}`, WD(m.d), `<span class="who">Waiting on ${firstN(m.wait||'dana')}</span><button class="lnk" data-ntab="moves">Moves →</button>`]),
    ...w.filter(m=>m.st==='merchants').map(m=>['live', m.t, `${money(m.amt)} · ${firstN(m.by)} proposed · goes ${rel(m.due)}`, 'Tomorrow', `<span class="who">Approved in Merchants</span><button class="lnk" data-ngo="merchants/payouts">Merchants →</button>`]),
    ['absent', 'Operating cash is 3 hours old', 'Plaid last synced at 08:12 · the bank feed is behind', '3 h', `<span class="who none">Not synced</span><button class="lnk" data-nsync>Sync now →</button>`],
    ['line', 'The first bond matures 14 Dec', `BB-0001 · ${money(2500)} · paid from what BondVault keeps back`, '54 d', `<button class="lnk" data-npool="bonds">Bonds →</button>`]];
  const need = cell('s4','Needs you',`<span class="lbl">${NEED.length} things</span>`,
    `<div class="al">${NEED.map(([sv,t,m,age,own])=>`<div class="alr"><div class="al-m"><div class="al-t"><i class="sv" style="background:${({underway:'var(--underway)',live:'var(--live)',absent:'var(--absent)',line:'var(--line)'})[sv]}"></i><b>${t}</b><span class="age">${age}</span></div><span class="m">${m}</span></div><div class="own ${own.includes('none')?'none':''}">${own}</div></div>`).join('')}</div>`,
    `<span>Every move needs two people</span><button data-ntab="moves">All moves →</button>`);
  document.getElementById('nv').innerHTML = band(claimsCell()+gateCell(), 1) + band(run+need) + band(holdingsCell());
}
/* BondVault keeps back what's due to bondholders within 90 days, or 30% of all owed, whichever is more; the Safe can take the rest */
const BV_NEED = () => Math.max(7500, M.bonds*0.3);
const bvSub = () => { const bv = M.bv||0, kept = Math.min(bv, BV_NEED()), use = Math.max(0, bv-BV_NEED());
  return [['Kept for bondholders','Due within 90 days, or 30% of all owed', bv>=BV_NEED() ? 'Kept back' : `Needs ${money(BV_NEED())}`, money(kept)],
    ['The Safe can take','For operations, growth or the pools','Usable',money(use)]]
    .map(([k,s,t,v])=>`<div class="nh-r sub"><span></span><span class="nh-k"><b>${k}</b><span>${s}</span></span><span></span><span></span><span class="nh-ch">${t}</span><b class="nh-v">${v}</b></div>`).join(''); };
function holdingsCell(){
  const tot = ACCTS.reduce((a,x)=>a+x[5],0); let c = 0;
  const seg = ACCTS.map(a=>{ const w = a[5]/tot*100, l = c; c += w; return {a,l,w}; });
  const grp = Object.keys(GROUPS).map(g=>{ const ss = seg.filter(x=>x.a[3]===g); return {g, l:ss[0].l, w:ss.reduce((s,x)=>s+x.w,0), v:ss.reduce((s,x)=>s+x.a[5],0)}; });
  const sp = v => { const mx = Math.max(...v)||1, mn = Math.min(...v); return `<svg class="nh-sp" viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true"><path d="M${v.map((y,i)=>`${(i/(v.length-1)*100).toFixed(1)},${(22-(y-mn)/((mx-mn)||1)*20).toFixed(1)}`).join(' L')}"/></svg>`; };
  return cell('s12','Where it sits',`<span class="lbl">${ACCTS.length} accounts · ${money(tot)}</span>`,
    `<div class="nh"><div class="nh-bar">${seg.map(({a,w})=>`<button data-nacct="${a[0]}" style="flex:${w};--c:${a[7]}" title="${a[1]} · ${money(a[5])}">${w>13?`<span>${a[1]}</span><b>${pct(a[5],tot,0)}</b>`:''}</button>`).join('')}</div>
      <div class="nh-br">${grp.map(({g,l,w,v})=>`<span style="left:${l}%;width:${w}%"><i></i><b>${GROUPS[g][0]}</b><em>${money(v)}</em></span>`).join('')}</div></div>
     <div class="nh-l"><div class="nh-r nh-hd"><span></span>${lbl('Account')}${lbl('Source')}${lbl('7 weeks')}${lbl('This week')}${lbl('Balance')}</div>
      ${ACCTS.map(a=>{ const [id,n,why,g,src,bal,wk,col] = a, ch = wk[wk.length-1]-wk[wk.length-2];
        return `<button class="nh-r ${N.panel&&N.panel.acct===id?'on':''}" data-nacct="${id}"><i class="nh-sw" style="background:${col}"></i><span class="nh-k"><b>${n}</b><span>${why}</span></span>
          <span class="nh-src ${SRC[src][2]||''}"><i></i>${srcTxt(src)}</span>${sp(wk)}<span class="nh-ch ${ch>0?'up':''}">${ch>0?'+':''}${money(ch)}</span><b class="nh-v">${money(bal)}</b></button>`
          + (id==='bv' ? bvSub() : '') + (id==='ops' ? ASIDE.map(([k,v,s])=>`<div class="nh-r sub"><span></span><span class="nh-k"><b>${k}</b><span>${s}</span></span><span></span><span></span><span class="nh-ch">Set aside</span><b class="nh-v">${money(v)}</b></div>`).join('') : ''); }).join('')}</div>`,
    `<span>${money(freeCash())} of operating cash is free to spend, after tax and deposits</span><button data-nacct="ops">Operating cash →</button>`);
}

/* ══ Cash flow: what moves in the next 30 days ═════════════════════════════════════ */
function renderCash(){
  let b = M.payout; const rows = FLOWS.map((f,i)=>{ b += f[1]==='in'?f[2]:-f[2]; return [...f, b, i]; });
  const L = rows.map(([d,k,v,n,s,bal,i])=>{ const same = i && FLOWS[i-1][0]===d, grp = FLOWS[i+1] && FLOWS[i+1][0]===d, newM = !i || MON(FLOWS[i-1][0])!==MON(d);
    const mt = FLOWS.filter(f=>MON(f[0])===MON(d)), mIn = mt.filter(f=>f[1]==='in').reduce((a,f)=>a+f[2],0), mOut = mt.filter(f=>f[1]==='out').reduce((a,f)=>a+f[2],0);
    return `${newM ? `<div class="nfw-m"><span class="lbl">${MONL(d)}</span><span>${money(mOut)} out · ${money(mIn)} in</span></div>` : ''}
      <div class="nfw-r ${same?'same':''} ${grp?'grp':''} ${d===1?'soon':''}"><span class="nfw-d">${same ? '<i class="tie"></i>' : `<span class="leaf"><span>${WD(d)}</span><b>${DD(d)}</b></span>`}</span>
        <span class="nfw-k"><b>${n}</b><span>${s} · ${same?'same day':rel(d)}</span></span><b class="nfw-v ${k}">${k==='in'?'+':'−'}${money(v)}</b>
        <span class="nfw-b ${bal<0?'neg':''}">${bal<0 ? `<b>${money(bal)}</b><span>yield pool lends it</span>` : `<b>${money(bal)}</b><span>in the pool after</span>`}</span></div>`; }).join('');
  const list = cell('s7','Every movement','<span class="lbl">Next 30 days</span>', `<div class="nfw">${L}</div>`,
    `<span>NET-14 shops are paid every other Wednesday</span><button data-ngo="merchants/payouts">Payouts · Merchants →</button>`);
  const term = (k,v,n,cls='') => `<div class="${cls}">${lbl(k)}<b>${v}</b><span>${n}</span></div>`;
  const tot = M.owed14, seg = [['In the pool',M.payout,''],['Coming in',M.dueMembers,'in'],['Borrowed',M.short,'gap']];
  const gap = cell('s5','The 4 Nov gap','<span class="lbl">PayoutPool</span>',
    `<div class="ngp"><div class="m-big">${money(M.short)} <small>short on 4 Nov · the yield pool covers it</small></div>
      <div class="ngb"><div class="ngb-bar">${seg.map(([k,v,c])=>`<i class="${c}" style="flex:${v}"></i>`).join('')}</div>
        <div class="ngb-o"><span>Owed to shops by 4 Nov</span><b>${money(tot)}</b></div>
        <div class="ngb-k">${seg.map(([k,v,c])=>`<div class="${c}"><i></i><span>${k}</span><b>${money(v)}</b></div>`).join('')}</div></div>
      <div class="ngp-l">${[[14,'Yield pool lends it','Shops are paid on time','+'+money(Y.toPayout),'in'],[16,'Repayments pay it back','Pool left at '+money(1193.31),'−'+money(Y.toPayout),'']].map(([d,t,sub,v,k])=>`<div class="ngp-r">${leaf(d)}<span><b>${t}</b><span>${sub}</span></span><b class="${k}">${v}</b></div>`).join('')}</div></div>`,
    `<span>No top-up needed</span><button class="btn sm-b" data-npropose="topup">Top up instead</button>`, 'ngap');
  const wk = [['This week',[592.94],[412.60]],['26 Oct',[889.42],[]],['2 Nov',[2310.20],[9510.65,2916.00]],['9 Nov',[],[]],['16 Nov',[],[1140.80]]];
  const wmx = 12500;
  const weeks = cell('s7','In and out, by week','<span class="lbl">Next 5 weeks</span>',
    `<div class="nwk">${wk.map(([t,i,o])=>{ const ti = i.reduce((a,b)=>a+b,0), to = o.reduce((a,b)=>a+b,0); return `<div class="nwk-c"><div class="nwk-u"><i style="height:${ti/wmx*100}%"></i>${ti?`<span>+${money0(ti)}</span>`:''}</div><div class="nwk-d"><i class="${t==='16 Nov'?'hx':''}" style="height:${to/wmx*100}%"></i>${to?`<span>−${money0(to)}</span>`:''}</div><span class="nwk-t">${t}</span></div>`; }).join('')}</div>`,
    `<span class="f-key"><span><i style="background:var(--land)"></i>In from members</span><span><i style="background:var(--fg)"></i>Out to shops</span><span><i class="hx"></i>Estimate</span></span><span></span>`);
  const later = cell('s5','After that','<span class="lbl">Next 90 days</span>',
    `<div class="nl">${[[54,'BB-0001 matures','Member · 4 months at 6.0%',2500],[92,'BB-0002 matures','Founding lender · 5 months at 6.5%',5000],[41,'Monthly run','October sales · NET-30 · estimate',19825.70*0.98]].sort((a,b)=>a[0]-b[0]).map(([d,t,s,v])=>`<div class="nl-r">${leaf(d)}<span><b>${t}</b><span>${s} · ${rel(d)}</span></span><b>−${money(v)}</b></div>`).join('')}</div>`,
    `<span>Bonds are paid from what BondVault keeps back</span><button data-npool="bonds">Bonds →</button>`);
  document.getElementById('nv').innerHTML = band(list + gap, 1) + band(weeks + later);
}

/* ══ Credit: how much is out, and how safe ════════════════════════════════════════ */
function renderCredit(){
  const t4 = (k,v,n,cls='') => `<div class="${cls}">${lbl(k)}<b>${v}</b><span>${n}</span></div>`;
  const oct = cell('s12','October','<span class="lbl">Protocol · 12 s</span>',
    `<div class="ncr"><div class="ncr-rp"><div class="ncr-h"><div class="m-big">100% <small>of this cycle’s repayments are in or on autopay</small></div><span>Due 31 Oct · ${money(CR.due)}</span></div>
        <div class="ncr-t"><i style="width:${CR.repaid/CR.due*100}%"></i><i class="s hx" style="width:${CR.sched/CR.due*100}%"></i></div>
        <div class="f-key"><span><i style="background:var(--fg)"></i>Collected <b>${money(CR.repaid)}</b></span><span><i class="hx"></i>On autopay, 24 and 30 Oct <b>${money(CR.sched)}</b></span></div></div>
      <div class="ngp-eq ncr-eq">${t4('Owed on 1 Oct',money(CR.start),'start of the month')}<i>+</i>${t4('Spent',money(CR.spent),'at 12 shops')}<i>−</i>${t4('Repaid',money(CR.repaid),'by members')}<i>=</i>${t4('Owed now',money(M.credit),`by ${M.members} members`,'hi')}</div></div>`,
    `<span>${money(M.limits)} in limits · ${pct(M.credit,M.limits)} drawn · ${M.autopay} members on autopay</span><button data-ngo="members">Members →</button>`);
  /* one shape for the row: a figure, one bar, then a ledger whose rows match the bar's colours */
  const lrow = (col, k, sub, v, cls='') => `<div class="${cls}"><span><i class="nsw" style="background:${col}"></i>${k}${sub?`<em>${sub}</em>`:''}</span><b>${v}</b></div>`;
  const back = cell('s4','What backs it','<span class="lbl">If a member stops paying</span>',
    `<div class="ncb"><div class="m-big">${pct(M.savingsBacked,M.credit)} <small>backed by their own savings</small></div>
      <div class="ncb-bar"><i style="flex:${M.savingsBacked}"></i><i style="flex:${M.unsecured};background:var(--underway)"></i></div>
      <div class="led ncb-l">${lrow('var(--fg)','Savings-backed','Their own savings pay it',money(M.savingsBacked))}${lrow('var(--underway)','Unsecured','Yield pool, then AssurancePool',money(M.unsecured))}</div></div>`,
    `<span>Only unsecured counts for RTD</span><button data-npool="ap" data-ntab="pools">Gate →</button>`);
  const AC = ['var(--fg)','color-mix(in srgb,var(--fg) 45%,transparent)','var(--underway)','var(--absent)'];
  const age = cell('s4','How old','<span class="lbl">What’s owed</span>',
    `<div class="ncb"><div class="m-big">${pct(CR.aging[0][1],M.credit)} <small>is current</small></div>
      <div class="ncb-bar">${CR.aging.filter(a=>a[1]).map(([k,v],i)=>`<i style="flex:${v};background:${AC[i]}"></i>`).join('')}</div>
      <div class="led ncb-l">${CR.aging.map(([k,v],i)=>lrow(AC[i],k,'',v?money(v):'None', v?'':'z')).join('')}</div></div>`,
    `<span>${money(1310.40+421.80)} late · nothing over 60 days</span><span></span>`);
  const loss = cell('s4','Losses','<span class="lbl">All time</span>',
    `<div class="ncb"><div class="m-big">${money(M.lost)} <small>3 members · paid by the AssurancePool</small></div>
      <div class="ncb-bar">${CR.losses.map(()=>`<i style="flex:1;background:var(--absent)"></i>`).join('')}</div>
      <div class="led ncb-l">${CR.losses.map(([d,n,id,v])=>lrow('var(--absent)',n,`${dayD(d)} · 90 days late`,money(v))).join('')}</div></div>`,
    `<span>Loss rate 1.1% · recovered $0.00</span><button data-npool="ap" data-ntab="pools">AssurancePool →</button>`);
  const smx = CR.shops[0][1];
  const shops = cell('s7','Where it was spent','<span class="lbl">October · Lithic · 1 min</span>',
    `<div class="nsh">${CR.shops.map(([n,v,l],i)=>`<div class="nsh-r ${i===CR.shops.length-1?'rest':''}"><span>${n}</span><span class="nsh-b"><i style="width:${v/smx*100}%;${l?'background:var(--underway)':''}"></i></span><b>${money(v)}</b></div>`).join('')}</div>`,
    `<span class="f-key"><i style="background:var(--fg)"></i>No losses <i style="background:var(--underway)"></i>A loss on its book</span><button data-ngo="merchants/partners">Partners →</button>`);
  const lmx = Math.max(...CR.limits.map(x=>x[1]));
  const lim = cell('s5','Limit sizes',`<span class="lbl">${M.members} members</span>`,
    `<div class="nlm">${CR.limits.map(([k,v])=>`<div><span>${v}</span><i style="height:${v/lmx*100}%" class="${v===lmx?'hi':''}"></i><s>${k}</s></div>`).join('')}</div>`,
    `<span>Most common limit $250 · 46 members</span><span></span>`);
  document.getElementById('nv').innerHTML = band(oct, 1) + band(back + age + loss) + band(shops + lim);
}

/* ══ Pools ═════════════════════════════════════════════════════════════════════════ */
const POOLS = [
  ['ap','AssurancePool',()=>M.assurance,'Covers unsecured losses after the yield pool',()=>`<i style="width:${M.unsecured*M.floor/M.assurance*100}%"></i><i style="width:${(1-M.unsecured*M.floor/M.assurance)*100}%;background:var(--land)"></i>`,()=>`${money(M.assurance-M.unsecured*M.floor)} spare over the floor`],
  ['pay','Payout pool',()=>M.payout,'Pays shops for financed sales, oldest first',()=>`<i style="width:${M.payout/M.owed14*100}%"></i><i class="hx" style="flex:1"></i>`,()=>`Covers ${pct(M.payout,M.owed14,0)} of what’s owed by 4 Nov`],
  ['yield','Yield pool',()=>Y.assets,'Members lending to unsecured credit',()=>`<i style="width:${Y.util*100}%;background:var(--live)"></i><i style="width:${(1-Y.util)*100}%;background:var(--land)"></i>`,()=>`${(Y.apy*100).toFixed(2)}% a year · ${pct(Y.lent,Y.assets,0)} lent out`],
  ['bonds','Bonds',()=>M.bonds,'Owed to bondholders · 6 BurnerBonds',()=>`<i style="width:${Math.min(M.bv,BV_NEED())/M.bonds*100}%"></i><i style="width:${Math.max(0,M.bv-BV_NEED())/M.bonds*100}%;background:var(--land)"></i>`,()=>`${money(Math.min(M.bv,BV_NEED()))} kept · ${money(Math.max(0,M.bv-BV_NEED()))} spare`]];
function renderPools(){
  const tiles = POOLS.map(([k,n,v,s,bar,f])=>`<button class="cell s3 npt ${N.pool===k?'on':''}" data-npool="${k}"><div class="hd"><h2>${n}</h2><div class="r">${ICO.chev}</div></div>
      <div class="npt-b"><div class="m-big">${money(v()).replace(/\.\d+$/,'')}<small class="ct">${money(v()).match(/\.\d+$/)[0]}</small></div><span>${s}</span><div class="npt-bar">${bar()}</div></div><div class="bk-ft"><span>${f()}</span></div></button>`).join('');
  const D = { ap:poolAP, pay:poolPay, yield:poolYield, bonds:poolBonds }[N.pool]();
  const st = (n,k,v,s) => `<div class="nlo-s"><span class="nlo-n">${n}</span><b>${k}</b><span class="m-big">${v}</span><span>${s}</span></div>`;
  const ex = M.unsecured, S3 = [
    [1,'Their own savings',M.savingsBacked,'Savings-backed credit · their pledged savings pay it','Covers all of it',1,'var(--fg)','solo'],
    [2,'Yield pool',Y.assets,'Unsecured credit · first loss, its share price falls',`Could cover all ${money(ex)}`,1,'var(--live)','to'],
    [3,'AssurancePool',M.assurance,'Unsecured credit · pays what the yield pool can’t',`Covers ${pct(M.assurance,ex,0)} of it`,M.assurance/ex,'var(--underway)','end']];
  const arrow = '<span class="nlx-a"><i></i><svg viewBox="0 0 8 12" aria-hidden="true"><path d="M1.5 1.5 6.5 6l-5 4.5"/></svg></span>';
  const stop = '<span class="nlx-a nlx-stop" title="Stops here: savings-backed credit never reaches a pool"><i></i><b></b></span>';
  const order = cell('s12','If a member stops paying','<span class="lbl">The order the contracts enforce</span>',
    `<div class="nlx"><div class="nlx-st">
      ${S3.map(([n,k,v,note,cov,f,col,kind])=>`<div class="nlx-s ${kind}"><div class="nlx-h"><span class="nlx-n" style="--c:${col}">${n}</span><b class="nlx-k">${k}</b>${kind==='to'?arrow:kind==='solo'?stop:''}</div>
        <span class="m-big">${money(v)}</span><span class="nlx-t">${note}</span>
        <div class="nlx-b"><i style="width:${Math.min(1,f)*100}%;background:${col}"></i></div><span class="nlx-c">${cov}</span></div>`).join('')}</div>
      <div class="nlx-nv"><div class="nlx-h"><span class="nlx-n nlx-x"><svg viewBox="0 0 10 10" aria-hidden="true"><path d="M2 2l6 6M8 2 2 8"/></svg></span><b class="nlx-k">Never covers a loss</b></div>
        <div class="nlx-nl">${[['Bondholders',M.bonds,'Owed by the co-op'],['Payout pool',M.payout,'Owed to shops'],['Other members’ savings',M.savings-M.savingsBacked,'Theirs, untouched']].map(([k,v,sub])=>`<div><span><b>${k}</b><em>${sub}</em></span><b>${money(v)}</b></div>`).join('')}</div></div>
    </div>`,
    `<span>Savings-backed credit never reaches a pool</span><button data-ntab="credit">Credit →</button>`);
  document.getElementById('nv').innerHTML = band(tiles, 1) + D + band(order);
}
function poolAP(){
  const req = M.unsecured*M.floor, apW = AP_BAL.slice(1).map((v,i)=>v-AP_BAL[i]), wmx = Math.max(...apW);
  const a = cell('s7','Against the floor','<span class="lbl">AssurancePool · Protocol · 12 s</span>',
    `<div class="npd"><div class="m-big">${money(M.assurance)} <small>covers ${money(M.unsecured)} of unsecured credit</small></div>
      <div class="ncb-bar"><i style="flex:${req}"></i><i style="flex:${M.assurance-req};background:var(--land)"></i></div>
      <div class="f-key"><span><i style="background:var(--fg)"></i>Needed for the 20% floor <b>${money(req)}</b></span><span><i style="background:var(--land)"></i>Spare <b>${money(M.assurance-req)}</b></span></div>
      ${lbl('Added each week · its share of credit fees')}<div class="nlm wk">${apW.map((v,i)=>`<div><span>${money0(v)}</span><i style="height:${v/wmx*100}%" class="${i===apW.length-1?'hi':''}"></i><s>${NW[i+1]}</s></div>`).join('')}</div></div>`,
    `<span>Lent out $0.00 · it only lends its spare, never the floor</span><span></span>`);
  const b = cell('s5','Losses it paid','<span class="lbl">All time · 3</span>',
    `<div class="nl">${CR.losses.map(([d,s,id,v])=>`<div class="nl-r">${leaf(d)}<span><b>${s}</b><span>Member M•••, 90 days late · before the yield pool opened</span></span><b>−${money(v)}</b></div>`).join('')}</div>`,
    `<span>${money(M.lost)} absorbed · loss rate 1.1%</span><button data-ntab="credit">Credit →</button>`);
  return band(a + b);
}
function poolPay(){
  const q = [[1,'Rosa’s Panadería',412.60],[12,'Monthly run · 11 shops',9510.65],[14,'Arrowhead Nails',732.00],[14,'Cajon Phone Repair',2184.00]]; let run = 0;
  const a = cell('s7','Claims, oldest first','<span class="lbl">PayoutPool · Protocol · 12 s</span>',
    `<div class="nq">${q.map(([d,k,v],i)=>{ const s = run; run += v; const cov = Math.max(0, Math.min(v, M.payout - s)), same = i && q[i-1][0]===d;
      const grp = q[i+1] && q[i+1][0]===d;
      return `<div class="nq-r ${same?'same':''} ${grp?'grp':''}"><span class="nq-d">${same?'<i class="tie" aria-hidden="true"></i>':leaf(d)}</span><span class="nq-k"><b>${k}</b><span>${cov>=v?'Covered now':cov>0?`${money(cov)} covered now`:'From repayments, then the yield pool'}</span></span><span class="nq-b"><i style="width:${cov/v*100}%"></i></span><b>${money(v)}</b></div>`; }).join('')}</div>`,
    `<span class="f-key"><i style="background:var(--fg)"></i>Covered now <i class="hx"></i>Repayments, then the yield pool</span><button data-ngo="merchants/payouts">Payouts →</button>`);
  const b = cell('s5','How it’s funded','<span class="lbl">Funded beats queued</span>',
    `<div class="led npl">${[['Today',money(M.payout)],['Repayments due by 4 Nov',money(M.dueMembers)],['Owed by 4 Nov',money(M.owed14)],['Borrowed from the yield pool',money(M.short)],['Paid back','6 Nov, from repayments'],['Order','Oldest claim first, always']].map(([k,v])=>`<div><span>${k}</span><b>${v}</b></div>`).join('')}</div>`,
    `<span>Top-ups need a second person</span><button class="btn sm-b" data-npropose="topup">Propose a top-up</button>`);
  return band(a + b);
}
function poolYield(){
  const mo = bps => (bps/100).toFixed(2)+'%', depAt = u => yApy(yBorrowBps(u)*u)*100;
  const sc = [['20%',.2],['40%',.4],[`${Math.round(Y.util*100)}% now`,Y.util],[`${Math.round(Y.utilAfter*100)}% 4 Nov`,Y.utilAfter],['80%',.8]], smx = Math.max(...sc.map(s=>depAt(s[1])));
  const t = (k,v,n,cls='') => `<div class="${cls}">${lbl(k)}<b>${v}</b><span>${n}</span></div>`;
  const a = cell('s7','Rate',`<span class="lbl">LendingPool · opened ${Y.opened}</span>`,
    `<div class="npd"><div class="ngp-eq">${t('Credit pays',mo(Y.borrowBps),`a month · ${(Y.apr*100).toFixed(1)}% a year`)}<i>×</i>${t('Lent out',pct(Y.lent,Y.assets),`${money(Y.lent)} of ${money(Y.assets)}`)}<i>=</i>${t('Depositors earn',mo(Y.supplyBps),`a month · ${(Y.apy*100).toFixed(2)}% a year`,'hi')}</div>
      ${lbl('Yearly rate to depositors, by share lent out')}<div class="nlm wk">${sc.map(([k,u],i)=>`<div><span>${depAt(u).toFixed(1)}%</span><i style="height:${depAt(u)/smx*100}%" class="${i===2?'hi':'hx'}"></i><s>${k}</s></div>`).join('')}</div></div>`,
    `<span>Set by the contract’s curve, not by us · past 80% lent it climbs fast</span><span></span>`);
  const b = cell('s5','How depositors get paid','<span class="lbl">ERC-4626</span>',
    `<div class="npd"><div class="m-big">$${Y.price.toFixed(4)} <small>a share · up ${((Y.price-1)*100).toFixed(2)}% since ${Y.opened}</small></div>
      <div class="led">${[['Interest','Raises the share price'],[`Withdrawals up to ${money(Y.cash)}`,'Paid at once'],['Above that','Queued, paid as credit repays'],['Pledged to credit',`${money(Y.pledged)} · locked`],['Earned so far',money(Y.earned)]].map(([k,v])=>`<div><span>${k}</span><b>${v}</b></div>`).join('')}</div></div>`,
    `<span>Queue: empty</span><span></span>`);
  const per = 8, rows = Y_DEP.slice(N.dp*per, N.dp*per+per);
  const tbl = cell('s12','Depositors',`<span class="lbl">${Y.depositors} members · masked</span>`,
    `<div class="bt-wrap"><table class="bt ndp"><colgroup><col style="width:16%"><col style="width:12%"><col style="width:15%"><col style="width:12%"><col style="width:15%"><col style="width:15%"><col style="width:15%"></colgroup>
      <thead><tr><th class="c-nm">Member</th><th style="text-align:left">Since</th><th>Put in</th><th>Earned</th><th>Worth now</th><th>Pledged</th><th>Can withdraw</th></tr></thead>
      <tbody>${rows.map(r=>`<tr><td class="tn"><b class="mono">M•••${r.id}</b></td><td style="text-align:left">${r.since}</td><td>${money(r.d)}</td><td>${money(r.e)}</td><td><b>${money(r.w)}</b></td><td>${r.pl?money(r.pl):'<span class="quiet">None</span>'}</td><td class="quiet">${r.pl?money(r.w-r.pl):'All of it'}</td></tr>`).join('')}</tbody></table></div>`,
    `<span>Names stay masked · ${money(Y.assets)} in all</span>${pager(N.dp, Y_DEP.length, per, 'ndp')}`);
  return band(a + b) + band(tbl);
}
function poolBonds(){
  const mons = ['Dec','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep'], by = mons.map(m=>BONDS.filter(b=>b[3].endsWith(m)).reduce((a,b)=>a+b[1],0)), bmx = Math.max(...by);
  const a = cell('s7','Bond ladder','<span class="lbl">Face value by month it matures</span>',
    `<div class="npd"><div class="m-big">${money(M.bonds)} <small>across ${BONDS.length} bonds, each its own token</small></div>
      <div class="nlm wk lad">${mons.map((m,i)=>`<div><span>${by[i]?'$'+(by[i]/1000).toFixed(1)+'k':''}</span><i style="height:${by[i]/bmx*100}%" class="${i===0?'hi':by[i]?'hx':'z'}"></i><s>${m}</s></div>`).join('')}</div></div>`,
    `<span>Zero-coupon · rates are internal, never exported</span><span></span>`);
  const b = cell('s5','Due in 90 days','<span class="lbl">Through 21 Jan</span>',
    `<div class="npd"><div class="m-big">${money(7500)} <small>two bonds · BondVault keeps ${money(Math.min(M.bv,BV_NEED()))} back for them</small></div>
      <div class="nl">${BONDS.filter(x=>x[4]<=92).map(x=>`<div class="nl-r">${leaf(x[4])}<span><b>${x[0]}</b><span>${x[7]} · ${rel(x[4])}</span></span><b>${money(x[1])}</b></div>`).join('')}</div></div>`,
    `<span>BondVault keeps 30% of all owed, or what’s due in 90 days</span><span></span>`);
  const tbl = cell('s12','Every bond','<span class="lbl">6 BurnerBonds</span>',
    `<div class="bt-wrap"><table class="bt nbd"><colgroup><col style="width:14%"><col style="width:14%"><col style="width:12%"><col style="width:12%"><col style="width:22%"><col style="width:10%"><col style="width:16%"></colgroup>
      <thead><tr><th class="c-nm">Bond</th><th>Face value</th><th style="text-align:left">Issued</th><th style="text-align:left">Matures</th><th style="text-align:left">Term</th><th>Rate</th><th style="text-align:left">Holder</th></tr></thead>
      <tbody>${BONDS.map(x=>`<tr><td class="tn"><b class="mono">${x[0]}</b></td><td>${money(x[1])}</td><td style="text-align:left">${x[2]}</td><td style="text-align:left">${x[3]}</td><td style="text-align:left"><span class="nbd-t"><span><i style="width:${x[5]/12*100}%"></i></span>${x[5]} mo</span></td><td>${x[6].toFixed(1)}%</td><td style="text-align:left">${x[7]}</td></tr>`).join('')}</tbody></table></div>`,
    `<span>Next maturity 14 Dec · last 15 Sep</span><span></span>`);
  return band(a + b) + band(tbl);
}

/* ══ Moves: propose, approve, history ═════════════════════════════════════════════ */
function renderMoves(){
  const w = pend();
  const row = m => { const mine = m.by===N.me, me = forMe().includes(m);
    return `<div class="nmv-r ${me?'me':''}">${leaf(m.d)}<span class="nmv-k"><b>${m.t}</b><span>${PLACES[m.from]||acctOf(m.from)?.[1]||m.from} → ${PLACES[m.to]||m.to} · ${mine?'you':PPL[m.by].f} proposed ${rel(m.d)}${m.due!=null?' · due '+dayD(m.due):''}</span></span>
      <b class="nmv-v">${money(m.amt)}</b><span class="nmv-a">${m.st==='merchants' ? `<span class="who">Approved in Merchants</span><button class="lnk" data-ngo="merchants/payouts">Merchants →</button>`
        : me ? `<button class="btn sm-b p" data-nopen="${m.id}">Review</button>` : mine ? `<span class="who">Waiting on ${firstN(m.wait||'dana')}</span><button class="lnk3" data-nwithdraw="${m.id}">Take it back</button>` : `<span class="who">Waiting on ${m.wait?firstN(m.wait):'a signer'}</span>`}</span></div>`; };
  const wc = cell('s8','Waiting for a second person',`${CAN()?'<button class="btn p sm-b" data-npropose="topup">+ Propose a move</button>':`<span class="lbl">${w.length} waiting</span>`}`,
    `<div class="nmv">${w.length ? w.map(row).join('') + '<div class="nmv-end">Nothing else is waiting</div>' : '<p class="nmv-e">Nothing is waiting.</p>'}</div>`,
    `<span>Proposing and approving are both logged in Records</span><button data-ngo="records">Records →</button>`);
  const rules = cell('s4','How money moves','<span class="lbl">Ops Safe · 2 of 3</span>',
    `<div class="nru">${lbl('Signers · any two')}<div class="nru-l">${['kai','dana','priya'].map(k=>`<div class="nru-p ${k===N.me?'me':''}"><span class="av sm">${PPL[k].ini}</span><b>${k===N.me?'You':PPL[k].n}</b><span>${PPL[k].role}</span><em>${k===N.me?'Signed in':''}</em></div>`).join('')}</div>
      ${lbl('Rules')}<div class="led">${[['Who proposes','Any signer'],['Who approves','A different signer'],['Crossing to a bank','Always two people'],['Spending the co-op balance','A member vote']].map(([k,v])=>`<div><span>${k}</span><b>${v}</b></div>`).join('')}</div>
      ${lbl('Runs on its own')}<div class="nru-a">${['Yield pool withdrawals, up to its cash','The payout pool borrowing for a claim that’s due','The AssurancePool paying a loss'].map(t=>`<span>${t}</span>`).join('')}</div></div>`,
    `<span>Set in Permissions</span><button data-ngo="team">Permissions →</button>`);
  const F = { all:['All',N.done], people:['By people',N.done.filter(x=>x.by)], auto:['Automatic',N.done.filter(x=>x.auto)] };
  const list = F[N.mf][1], per = 6, pages = Math.max(1, Math.ceil(list.length/per)); N.mp = Math.min(N.mp, pages-1);
  const hist = cell('s12','Done',`<div class="seg sm" role="group" aria-label="Show">${Object.entries(F).map(([k,[t,a]])=>`<button data-nmf="${k}" aria-pressed="${N.mf===k}">${t} ${a.length}</button>`).join('')}</div>`,
    `<div class="nd">${list.slice(N.mp*per, N.mp*per+per).map(x=>`<div class="nd-r ${x.no?'no':''}">${leaf(x.d)}<span class="nd-k"><b>${x.t}</b><span>${x.from} → ${x.to}</span></span>
        <span class="nd-w">${x.auto ? `<span class="nd-auto">Automatic</span><span>${x.auto}</span>` : x.no ? `<span>${firstN(x.by)} proposed · <b class="bad">${firstN(x.no)} rejected</b></span><span>${x.why}</span>` : `<span>${firstN(x.by)} proposed · ${firstN(x.ok)} approved</span><span>Signed in the Ops Safe</span>`}</span>
        <b class="nd-v ${x.no?'quiet':''}">${money(x.amt)}</b><span class="nd-tx">${x.tx ? `<span class="mono">${x.tx}</span>` : '<span class="quiet">Not sent</span>'}</span></div>`).join('')}</div>`,
    `<span>Last 30 days</span>${pager(N.mp, list.length, per, 'nmp')}`);
  document.getElementById('nv').innerHTML = band(wc + rules, 1) + band(hist);
}

/* ══ Side panels: an account, proposing a move, reviewing one ═════════════════════ */
function ensurePanel(){ let pn = document.getElementById('npanel');
  if (!pn){ const sc = document.createElement('div'); sc.id = 'nscrim'; sc.className = 'scrim'; document.body.appendChild(sc); pn = document.createElement('aside'); pn.id = 'npanel'; pn.className = 'panel npanel'; document.body.appendChild(pn); }
  return pn; }
function renderPanel(){
  const pn = ensurePanel(), P = N.panel;
  if (!P){ document.body.classList.remove('pn'); return; }
  document.body.classList.add('pn');
  pn.innerHTML = P.acct ? acctPanel(P.acct) : P.propose ? proposePanel(P) : P.review ? reviewPanel(P.review) : '';
}
function acctPanel(id){
  const [ , n, why, g, src, bal, wk, col] = acctOf(id), mx = Math.max(...wk)*1.1 || 1;
  const facts = { sav:[['Members',String(M.members)],['Tied to credit',money(M.savingsBacked)],['Free to withdraw',money(M.savings-M.savingsBacked)],['USDC at Bridge',money(M.savings)],['Reserve','1 : 1 · 2 min ago']],
    yld:[['Deposited',`${money(Y.assets)} · ${Y.depositors} members`],['Lent to unsecured credit',`${money(Y.lent)} · ${pct(Y.lent,Y.assets,0)}`],['Cash for withdrawals',money(Y.cash)],['Lends the payout pool',`${money(Y.toPayout)} on 4 Nov`],['Depositors earn',`${(Y.apy*100).toFixed(2)}% a year`]],
    pay:[['Owed to shops by 4 Nov',money(M.owed14)],['Repayments due',money(M.dueMembers)],['Borrows on 4 Nov',money(M.short)],['Moves by','Two people · Ops Safe']],
    ap:[['Covers',money(M.unsecured)+' unsecured'],['RTD',`${(M.rtd*100).toFixed(1)}% · floor 20%`],['Room to issue',money(M.room)],['Losses absorbed',money(M.lost)]],
    ops:[['Bank','Business checking'],['Last sync','3 h ago · Plaid'],['Set aside inside it',money(ASIDE.reduce((a,x)=>a+x[1],0))],['Free to spend',money(freeCash())]],
    bv:[['Owed to bondholders',money(M.bonds)+' · 6 bonds'],['Kept back',money(Math.min(M.bv||0,BV_NEED()))+' of '+money(BV_NEED())],['The Safe can take',money(Math.max(0,(M.bv||0)-BV_NEED()))],['First maturity','14 Dec · BB-0001 · '+money(2500)],['Moves by','Two people · Ops Safe']],
    coop:[['Added in October',money(COOP_W.slice(3).reduce((a,b)=>a+b,0))],['From','Member discounts at partner shops'],['Spending it','Needs a member vote']] }[id];
  const pts = wk.map((v,i)=>`${(i/(wk.length-1)*100).toFixed(1)},${(38-(v/mx)*34).toFixed(1)}`).join(' L');
  const act = { bv:`<button class="btn p" data-npropose="bondvault">Propose using the spare</button>`, ops:`<button class="btn p" data-npropose="bill">Propose a move from here</button>`, pay:`<button class="btn p" data-npropose="topup">Propose a top-up</button>`, sav:`<button class="btn" data-nreserve>Run the reserve check</button>`,
    yld:`<button class="btn" data-npool="yield">Yield pool →</button>`, ap:`<button class="btn" data-npool="ap">AssurancePool →</button>`, coop:`<button class="btn" data-ngo="governance">Propose a use · Governance</button>` }[id];
  return `<div class="pn-hd"><span class="lbl">${GROUPS[g][0]}</span><span class="nsrc ${SRC[src][2]||''}"><i></i>${srcTxt(src)}</span><button class="x" data-nclose aria-label="Close">${ICO.x}</button></div>
    <div class="pn-b"><div><p class="npn-t">${n}</p><p class="npn-s">${why}</p></div>
      <div><div class="m-big">${money(bal)}</div><svg class="npn-ch" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true"><path d="M${pts} L100,40 L0,40 Z" class="ar" style="fill:color-mix(in srgb,${col} 18%,transparent)"/><path d="M${pts}" class="ln" style="stroke:${col}"/></svg><div class="npn-ax"><span>${NW[0]}</span><span>${NW[NW.length-1]}</span></div></div>
      <div>${lbl('Facts')}<div class="led">${facts.map(([k,v])=>`<div><span>${k}</span><b>${v}</b></div>`).join('')}</div></div></div>
    <div class="pn-ft">${CAN() || !/propose/.test(act) ? act : `<span class="small quiet">Read-only for you</span>`}</div>`;
}
function proposePanel(P){
  const K = KINDS[P.kind], amt = P.amt ?? K.amt(), to = P.kind==='bill' ? (P.payee||'') : PLACES[K.to], fromBal = K.from==='bv' ? M.bv : M.cash;
  const approvers = Object.entries(PPL).filter(([k,p])=>p.sign && k!==N.me);
  return `<div class="pn-hd"><span class="lbl">New move</span><button class="x" data-nclose aria-label="Close">${ICO.x}</button></div>
    <div class="pn-b"><p class="npn-t">Propose a move</p>
      <div class="npk">${Object.entries(KINDS).map(([k,x])=>`<button data-nkind="${k}" aria-pressed="${P.kind===k}"><b>${x.t}</b><span>${PLACES[x.from]} → ${k==='bill'?'a payee':PLACES[x.to]}</span></button>`).join('')}</div>
      <div class="npf">${P.kind==='bill' ? `<label>${lbl('Pay who')}<input id="npayee" class="vin" value="${(P.payee||'').replace(/"/g,'&quot;')}" placeholder="CDTFA · sales tax"></label>` : ''}
        <label>${lbl('Amount')}<input id="namt" class="vin" inputmode="decimal" value="${amt?amt.toFixed(2):''}" placeholder="0.00"></label>
        <label>${lbl('Why')}<textarea id="nwhy" class="vin" rows="2" placeholder="What it’s for">${P.why ?? K.why}</textarea></label>
        <label>${lbl('Second person')}<select id="nappr" class="vin">${approvers.map(([k,p])=>`<option value="${k}" ${k===(P.appr||'dana')?'selected':''}>${p.n} · ${p.role}</option>`).join('')}</select></label></div>
      <div>${lbl('After it')}<div class="led"><div><span>${PLACES[K.from]}</span><b>${money(fromBal)} → <span id="nafter">${money(fromBal-(amt||0))}</span></b></div>${P.kind==='topup'?`<div><span>Payout pool on 4 Nov</span><b>No borrowing from the yield pool</b></div>`:P.kind==='bondvault'?`<div><span>Still kept for bondholders</span><b>${money(BV_NEED())}</b></div><div><span>Payout pool on 4 Nov</span><b>No borrowing from the yield pool</b></div>`:''}${K.from==='ops'?`<div><span>Free to spend</span><b>${money(freeCash()-(amt||0))}</b></div>`:''}</div></div>
      <p class="npn-n"><b>Two people.</b> You propose it, the second person signs it in the Ops Safe. Nothing moves until they do.</p></div>
    <div class="pn-ft"><button class="btn" data-nclose>Cancel</button><button class="btn p" data-nsubmit>Propose it</button></div>`;
}
function reviewPanel(id){
  const m = N.moves.find(x=>x.id===id); if (!m) return '';
  const after = m.from==='ops' ? M.cash - m.amt : null;
  return `<div class="pn-hd"><span class="lbl">Needs your signature</span><button class="x" data-nclose aria-label="Close">${ICO.x}</button></div>
    <div class="pn-b"><div><p class="npn-t">${m.t}</p><p class="npn-s">${PPL[m.by].n} proposed it ${rel(m.d)}${m.due!=null?' · due '+dayD(m.due):''}</p></div>
      <div class="m-big">${money(m.amt)}</div>
      <div class="led">${[['From',PLACES[m.from]||m.from],['To',m.to],['Why',m.why],...(after!=null?[['Operating cash after',`${money(after)}`],['Free to spend after',money(freeCash()-m.amt)]]:[]),...(m.from==='bv'?[['BondVault after',money(M.bv-m.amt)],['Still kept for bondholders',money(BV_NEED())]]:[]),['Signs in','Ops Safe · 2 of 3']].map(([k,v])=>`<div><span>${k}</span><b>${v}</b></div>`).join('')}</div>
      ${N.rej ? `<label>${lbl('Why not')}<textarea id="nrej" class="vin" rows="2" placeholder="Tell ${PPL[m.by].f} why"></textarea></label>` : ''}
      <p class="npn-n">Approving signs it as the second person. It goes out at once and is logged in Records.</p></div>
    <div class="pn-ft">${N.rej ? `<button class="btn" data-nrejcancel>Back</button><button class="btn dz" data-nreject="${m.id}">Send it back</button>` : `<button class="btn" data-nrejopen>Reject</button><button class="btn p" data-napprove="${m.id}">Approve and sign</button>`}</div>`;
}

/* ══ render + events ══════════════════════════════════════════════════════════════ */
function render(){
  document.querySelectorAll('.gtabs [data-ntab]').forEach(b=>b.setAttribute('aria-current', b.dataset.ntab===N.tab?'page':'false'));
  document.getElementById('nw').classList.toggle('ro', !CAN());
  renderHdr();
  ({overview:renderOverview, cash:renderCash, credit:renderCredit, pools:renderPools, moves:renderMoves})[N.tab]();
  renderPanel();
}
const closeN = () => { N.panel = null; N.rej = false; };
document.addEventListener('click', e => {
  if (e.target.id==='nscrim'){ closeN(); return render(); }
  const t = e.target.closest('button,a,select,input'); if (!t) return; const d = t.dataset;
  if (d.ntab){ N.tab = d.ntab; if (d.npool) N.pool = d.npool; closeN(); render(); if (d.njump){ const el = document.getElementById(d.njump); el && el.scrollIntoView({behavior:'smooth', block:'center'}); } else window.scrollTo({top:0}); return; }
  if (d.npool){ N.pool = d.npool; N.dp = 0; if (N.tab!=='pools'){ N.tab = 'pools'; closeN(); window.scrollTo({top:0}); } render(); return; }
  if (d.nacct){ N.panel = {acct:d.nacct}; return render(); }
  if (d.nclose!==undefined){ closeN(); return render(); }
  if (d.npropose){ if (!CAN()) return toast('Only Ops Safe signers can propose a move'); N.panel = {propose:true, kind:d.npropose}; return render(); }
  if (d.nkind){ const P = N.panel; P.kind = d.nkind; P.amt = null; P.why = null; return render(); }
  if (d.nsubmit!==undefined){ const P = N.panel, K = KINDS[P.kind], amt = parseFloat((document.getElementById('namt').value||'').replace(/[^0-9.]/g,'')) || 0, appr = document.getElementById('nappr').value;
    const payee = P.kind==='bill' ? (document.getElementById('npayee').value.trim() || 'A payee') : PLACES[K.to];
    if (!amt) return toast('Add an amount');
    if (K.from==='bv' && amt > M.bv-BV_NEED()) return toast(`BondVault can release up to ${money(Math.max(0,M.bv-BV_NEED()))}`);
    N.moves.unshift({ id:'mv-'+Date.now(), kind:P.kind, t:P.kind==='bill' ? `Pay ${payee}` : K.t, from:K.from, to:payee, amt, by:N.me, d:0, why:document.getElementById('nwhy').value.trim() || '—', st:'waiting', wait:appr });
    closeN(); N.tab = 'moves'; render(); return toast(`Proposed · waiting on ${PPL[appr].f} · logged in Records`); }
  if (d.nopen){ N.panel = {review:d.nopen}; N.rej = false; return render(); }
  if (d.nrejopen!==undefined){ N.rej = true; return render(); }
  if (d.nrejcancel!==undefined){ N.rej = false; return render(); }
  if (d.napprove){ const m = N.moves.find(x=>x.id===d.napprove); N.moves = N.moves.filter(x=>x!==m);
    if (m.from==='bv'){ M.bv -= m.amt; const v = acctOf('bv'); v[5] = M.bv; v[6][v[6].length-1] = M.bv; M.payout += m.amt; const p = acctOf('pay'); p[5] = M.payout; p[6][p[6].length-1] = M.payout; }
    if (m.from==='ops'){ M.cash -= m.amt; const a = acctOf('ops'); a[5] = M.cash; a[6][a[6].length-1] = M.cash; if (m.kind==='bondvault'){ M.bv = (M.bv||0) + m.amt; const v = acctOf('bv'); v[5] = M.bv; v[6][v[6].length-1] = M.bv; } if (m.kind==='topup'){ M.payout += m.amt; const p = acctOf('pay'); p[5] = M.payout; p[6][p[6].length-1] = M.payout; } }
    N.done.unshift({ d:0, t:m.t, from:PLACES[m.from]||m.from, to:m.to, amt:m.amt, by:m.by, ok:N.me, tx:'0x'+Math.random().toString(16).slice(2,6)+'…'+Math.random().toString(16).slice(2,6) });
    closeN(); render(); return toast(`Signed · ${money(m.amt)} sent · logged in Records`); }
  if (d.nreject){ const m = N.moves.find(x=>x.id===d.nreject), why = (document.getElementById('nrej')||{}).value || 'No reason given'; N.moves = N.moves.filter(x=>x!==m);
    N.done.unshift({ d:0, t:`Rejected · ${m.t.toLowerCase()}`, from:PLACES[m.from]||m.from, to:m.to, amt:m.amt, by:m.by, no:N.me, why, tx:null }); closeN(); render(); return toast(`Sent back to ${PPL[m.by].f}`); }
  if (d.nwithdraw){ N.moves = N.moves.filter(x=>x.id!==d.nwithdraw); render(); return toast('Taken back · logged'); }
  if (d.nmf){ N.mf = d.nmf; N.mp = 0; return render(); }
  if (d.nmp){ N.mp += +d.nmp; return render(); }
  if (d.ndp){ N.dp += +d.ndp; return render(); }
  if (d.nsync!==undefined){ toast('Syncing from Plaid…'); setTimeout(()=>{ SRC.plaid = ['Plaid','just now']; render(); toast('Operating cash is current'); }, 900); return; }
  if (d.nreserve!==undefined) return toast('Fully reserved · 1 : 1, checked just now');
  if (d.ngo) return toast(`Goes to ${d.ngo.split('/').map(s=>s[0].toUpperCase()+s.slice(1)).join(' → ')} in the Command Center`);
});
document.addEventListener('input', e => { if (e.target.id==='namt'){ const v = parseFloat(e.target.value.replace(/[^0-9.]/g,''))||0, el = document.getElementById('nafter'); if (el) el.textContent = money((N.panel && KINDS[N.panel.kind] && KINDS[N.panel.kind].from==='bv' ? M.bv : M.cash) - v); N.panel.amt = v; } if (e.target.id==='npayee') N.panel.payee = e.target.value; if (e.target.id==='nwhy') N.panel.why = e.target.value; });
document.addEventListener('keydown', e => { if (e.key==='Escape' && N.panel){ closeN(); render(); } });
N.moves = MOVES.slice(); N.done = DONE.slice();
const hs = location.hash.slice(1).split(',');
['overview','cash','credit','pools','moves'].forEach(t=>{ if (hs.includes(t)) N.tab = t; });
['ap','pay','yield','bonds'].forEach(t=>{ if (hs.includes('p-'+t)) N.pool = t; });
if (hs.includes('dana')) N.me = 'dana'; if (hs.includes('marcus')) N.me = 'marcus';
if (hs.includes('dark')) document.documentElement.dataset.theme = 'dark';
if (hs.includes('acct')) N.panel = {acct:'ops'}; if (hs.includes('prop')) N.panel = {propose:true, kind:'topup'}; if (hs.includes('rev')) N.panel = {review:'mv-tax'};
render();

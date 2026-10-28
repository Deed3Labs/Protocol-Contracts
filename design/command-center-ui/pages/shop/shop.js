
/* ══ Shop — what's for sale, what it costs to make, and what's left ═════════════════════════════════════════════════
   Overview · Products (each built from materials, or one cost) · Materials (the saved library, suppliers, reorder points)
   · Inventory (finished stock, batches, what's on the way) · Orders. */
const SP = { tab:'overview', pf:'all', mf:'all', of:'open', panel:null, me:'kai', draft:null, buy:null };
const ICO = { chev:'<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5"/></svg>', back:'<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3.5 5.5 8l4.5 4.5"/></svg>',
  x:'<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>' };
function toast(t){ let el = document.getElementById('toast'); if (!el){ el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el); } el.innerHTML = t; el.classList.add('on'); clearTimeout(el._t); el._t = setTimeout(()=>el.classList.remove('on'), 3200); }
const cell = (cls, title, right, body, foot) => `<div class="cell ${cls}"><div class="hd"><h2>${title}</h2><div class="r">${right}</div></div>${body}<div class="bk-ft">${foot}</div></div>`;
const lbl = t => `<span class="lbl">${t}</span>`;
const rest = () => `<div class="sx-rest" aria-hidden="true"></div>`;   /* leftover space under a short list: the hatch, nothing to show */
const band = (cells, first) => `<section class="band"${first?' style="margin-top:0"':''}><div class="bento">${cells}</div></section>`;
const pager = (p, n, per, key) => { const pages = Math.max(1, Math.ceil(n/per)); return `<span class="pg2"><span>${n ? p*per+1 : 0}–${Math.min(n,(p+1)*per)} of ${n}</span><button data-${key}="-1" ${p===0?'disabled':''} aria-label="Previous">${ICO.back}</button><button data-${key}="1" ${p>=pages-1?'disabled':''} aria-label="Next">${ICO.chev}</button></span>`; };
const seg = (key, opts, v, aria) => `<div class="seg sm" role="group" aria-label="${aria}">${opts.map(([k,t])=>`<button data-${key}="${k}" aria-pressed="${v===k}">${t}</button>`).join('')}</div>`;
const glyph = (p, cls='') => `<span class="sx-g ${cls}" aria-hidden="true"><svg viewBox="0 0 40 40">${GLY[p.g]}</svg></span>`;
const STAFF = () => !!PPL[SP.me].staff;
const shortN = p => p.line==='graphic' ? p.v : p.line==='patch' ? 'Patch · '+p.v : p.line==='logo' ? 'Logo Tee · '+p.v.split(' ')[0] : p.line==='hw' && p.n==='Clear Counter' ? 'Counter · '+p.v : p.n;
const pts = v => Math.abs(v)<.05 ? 'under 0.1 pts' : `${v>0?'+':'−'}${Math.abs(v).toFixed(1)} pts`;
const fx = (n, d=2) => (Math.round(n*100)/100).toFixed(d);

/* ── costing ─────────────────────────────────────────────────────────────────────────────────────────────────────── */
const inCost = (id, size, col) => { const i = INP[id], v = i.var || {}; return i.avg + (v[size]||0) + (v[col]||0); };
const recipeCost = (rec, size, col) => rec.reduce((a,[id,q])=>a + q*inCost(id, size, col), 0);
const costOf = (p, size='M', col) => p.recipe ? recipeCost(p.recipe, size, col || p.cols[0]) : p.flat;
const marginOf = (p, size, col) => p.price ? (p.price - costOf(p, size, col))/p.price : 0;
const mTxt = p => p.dep ? 'Deposit' : `${(marginOf(p)*100).toFixed(0)}%${p.est?' est.':''}`;
const under = p => !p.dep && marginOf(p) < TARGET;
const priceFor = (cost, m) => cost/(1-m);
const u4 = p => p.wk.slice(-4).reduce((a,b)=>a+b,0);
const goods = PR.filter(p=>!p.dep);
const onHand = id => STK[id] ? Object.values(STK[id]).flat().reduce((a,b)=>a+b,0) : null;
const coverW = p => { const h = onHand(p.id), r = u4(p)/4; return r ? h/r : null; };
const usedIn = id => PR.filter(p=>p.recipe && p.recipe.some(r=>r[0]===id));
const ORD_W = [9,13,13,15,18,20,17,19];
const perOrderSupplies = () => INPUTS.filter(i=>i.kind==='order').reduce((a,i)=>a+i.avg,0);
const pickupSupplies = () => INP.tis.avg;   /* pickups skip the mailer and the label */
const useWk = i => i.kind==='order' ? ORD_W.slice(-4).reduce((a,b)=>a+b,0)/4 : usedIn(i.id).reduce((a,p)=>a + u4(p)/4 * p.recipe.find(r=>r[0]===i.id)[1], 0);
const lastsW = i => { const u = useWk(i); return u ? i.hand/u : null; };
const isLow = i => i.kind!=='mto' && lastsW(i)!==null && lastsW(i) < SUP[i.sup].lead/7 + MIN_WEEKS && !i.incoming;
const KC = { stock:'var(--fg)', mto:'color-mix(in srgb,var(--fg) 50%,transparent)', order:'var(--line)' };
const partsOf = p => { const o = {base:0, make:0, trim:0}; (p.recipe||[]).forEach(([id,q])=>{ const i = INP[id], c = q*inCost(id,'M',p.cols[0]); if (i.kind==='mto') o.make += c; else if (/^blk|^pt-/.test(id)) o.base += c; else o.trim += c; }); return o; };

/* the last four weeks */
const SHOPN = (()=>{
  const rev = goods.reduce((a,p)=>a + u4(p)*p.price, 0), prev = goods.reduce((a,p)=>a + p.wk.slice(0,4).reduce((x,y)=>x+y,0)*p.price, 0);
  const mat = goods.reduce((a,p)=>a + u4(p)*costOf(p), 0), ord = ORD_W.slice(-4).reduce((a,b)=>a+b,0), shipped = 60, picked = ord - shipped;
  const pack = shipped * perOrderSupplies() + picked * pickupSupplies(), fees = rev*FEE.pct + ord*FEE.fixed, ship = shipped*(SHIP.label - SHIP.charged);
  const gross = rev - mat - pack - fees - ship, line = LINE_COSTS.reduce((a,b)=>a+b[1],0);
  return { rev, prev, mat, ord, shipped, picked, pack, fees, ship, gross, line, left:gross - line, items:goods.reduce((a,p)=>a+u4(p),0) }; })();
const REV_W = WEEKS.map((_,i)=>goods.reduce((a,p)=>a+p.wk[i]*p.price,0));

/* ── header ── */
function renderHdr(){
  const S = SHOPN, low = INPUTS.filter(isLow), pack = ORDERS.filter(o=>o[7]==='paid'), pm = (S.rev - S.mat)/S.rev, rmx = Math.max(...REV_W);
  const tn = INP['blk-tn'];
  const B = {
    overview: `${money(S.left)} is left for marketing after every cost. <a data-sopen="m:blk-tn">Turtleneck blanks</a> run out before Westcoast can deliver more.`,
    products: `Everything on the shelf clears the ${TARGET*100}% margin at a medium. <a data-sopen="p:gcm">Graphic Tees</a> in XXL don’t, since the blank and the print both cost more.`,
    materials: `${low.length} ${low.length===1?'material is':'materials are'} running low. Hoodie blanks land 30 Oct at the 120-piece price, so the average drops to ${money((INP['blk-hd'].incoming[2])/INP['blk-hd'].incoming[0])}.`,
    inventory: `${int(goods.reduce((a,p)=>a+(onHand(p.id)||0),0))} finished items on hand. The turtleneck batch is <a data-sopen="b:B-017">waiting on blanks</a>.`,
    orders: `${pack.length} orders to pack. A shipped order costs ${money(perOrderSupplies())} in packing and ${money(SHIP.label-SHIP.charged)} more to ship than we charge. Pickups skip both.` }[SP.tab];
  const segs = (arr, col, n) => arr.map((x,i)=>`<i style="left:${i/Math.max(n||0,arr.length)*100}%;width:calc(${100/Math.max(n||0,arr.length)}% - 2px);background:${col(x)}"></i>`).join('');
  const stockIns = INPUTS.filter(i=>i.kind!=='mto');
  document.getElementById('hdr').innerHTML = `<span class="when"><span class="dot"></span>Shop · useclear.org/shop · Demo data</span><p class="brief">${B}</p>
    <div class="strip">
      <div class="sc" data-stab="overview"><span class="lbl">Sales · 4 weeks</span><div class="sc-v">${money0(S.rev)} <small>+${((S.rev/S.prev-1)*100).toFixed(0)}%</small></div><div class="mb">${segs(REV_W, v=>`color-mix(in srgb,var(--fg) ${Math.round(25+v/rmx*65)}%,transparent)`)}</div><div class="sc-s">${S.ord} orders · ${S.items} items</div></div>
      <div class="sc" data-stab="products"><span class="lbl">Product margin</span><div class="sc-v">${(pm*100).toFixed(1)}% <small>target ${TARGET*100}%</small></div><div class="mb"><i style="width:${pm*100}%;background:var(--settled)"></i><s class="nflr" style="left:${TARGET*100}%"></s></div><div class="sc-s">${pct(S.gross,S.rev,1)} after packing, fees and shipping</div></div>
      <div class="sc" data-stab="orders"><span class="lbl">To pack</span><div class="sc-v">${pack.length} <small>orders</small></div><div class="mb">${segs(pack, o=>(NOW-o[1])/DAY>1?'var(--underway)':'var(--live)', 8)}</div><div class="sc-s">Oldest ${ago(Math.min(...pack.map(o=>o[1])))}</div></div>
      <div class="sc" data-stab="materials"><span class="lbl">Materials</span><div class="sc-v">${low.length} <small>running low</small></div><div class="mb">${segs(stockIns, i=>isLow(i)?'var(--underway)':i.incoming?'var(--live)':'var(--fg)')}</div><div class="sc-s">${low.map(i=>i.n.split(' · ')[0]).join(', ') || 'Everything’s covered'}</div></div>
    </div>`;
}

/* ══ Overview ══════════════════════════════════════════════════════════════════════════════════════════════════ */
function shelfCell(){
  const list = PR.filter(p=>p.st!=='arch');
  return cell('s12','What’s for sale',`<span class="lbl">${PR.filter(p=>p.st==='on').length} on the shelf · ${PR.filter(p=>p.st!=='on').length} not</span>`,
    `<div class="sx-shf">${list.map(p=>{ const h = onHand(p.id), w = coverW(p), m = marginOf(p), out = h===0 && p.st!=='draft' && !p.dep, low = !p.dep && p.st==='on' && w!==null && w < 3;
      return `<button class="sx-t ${p.st}" data-sopen="p:${p.id}">${glyph(p)}<span class="sx-tk"><b>${shortN(p)}</b><span>${money(p.price).replace('.00','')}${p.dep?' deposit':''} ${p.dep ? '' : ` · <span class="${m<TARGET?'bad':''} ${p.est?'est':''}">${mTxt(p)}</span>`}</span></span>
        <span class="sx-tu"><b>${u4(p)}</b><span>${p.dep?'pre-ordered':'sold'}</span></span>
        <span class="sx-tm"><i class="${out?'out':low?'low':''} ${p.dep||p.st==='draft'?'na':''}" style="width:${p.dep||p.st==='draft' ? 100 : Math.min(100,(w||0)/12*100)}%"></i></span>
        <span class="sx-ts ${out?'out':low?'low':''}">${p.dep ? 'Pre-order' : p.st==='draft' ? 'Not stocked' : out ? 'Out' : `${h} on hand`}</span>${p.st!=='on'?`<span class="sx-chip">${SHELF[p.st][0]}</span>`:''}</button>`; }).join('')}</div>`,
    `<span class="f-key"><span><i style="background:var(--fg)"></i>Weeks of stock, full at 12</span><span><i style="background:var(--underway)"></i>Under 3 weeks</span><span><i class="hx"></i>Not stocked</span></span><span>Sold is the last 4 weeks</span>`);
}
function dollarCell(){
  const S = SHOPN, steps = [['Sales',S.rev,'tot'],['Materials',-S.mat,'neg'],['Packing',-S.pack,'neg'],['Payment fees',-S.fees,'neg'],['Shipping gap',-S.ship,'neg'],['Gross profit',S.gross,'sub'],['Running the line',-S.line,'neg'],['For marketing',S.left,'keep']];
  let run = 0;
  const rows = steps.map(([k,v,c])=>{ let a, b; if (c==='neg'){ b = run; a = run + v; run = a; } else { a = 0; b = v; run = v; }
    return `<div class="sx-wf-r ${c}"><span>${k}</span><span class="sx-wf-b"><i style="left:${a/S.rev*100}%;width:${(b-a)/S.rev*100}%"></i></span><b>${c==='neg'?'−':''}${money(Math.abs(v))}</b></div>`; }).join('');
  return cell('s7','Where each dollar goes',`<span class="lbl">Last 4 weeks</span>`, `<div class="sx-wf">${rows}</div>`,
    `<span>Materials use the average cost of what was on hand</span><button data-stab="materials">Materials →</button>`);
}
function sellsCell(){
  const top = goods.filter(u4).map(p=>[p, u4(p)*p.price]).sort((a,b)=>b[1]-a[1]), tm = top[0][1];
  return cell('s5','What sells',`<span class="lbl">Sales · 4 weeks</span>`,
    `<div class="sx-hb">${top.map(([p,v])=>`<button class="sx-hb-r" data-sopen="p:${p.id}"><span>${shortN(p)}</span><span class="sx-hb-b"><i style="width:${v/tm*100}%;background:${LINES[p.line][1]}"></i></span><b>${money0(v)}</b><em>${(marginOf(p)*100).toFixed(0)}%</em></button>`).join('')}</div>`,
    `<span class="f-key">${['logo','graphic','layers','patch'].map(l=>`<span><i style="background:${LINES[l][1]}"></i>${LINES[l][0]}</span>`).join('')}</span><span></span>`);
}
function ladderCell(){
  const list = PR.filter(p=>p.st!=='arch' && !p.dep && (p.recipe || p.flat)), mx = Math.max(...list.map(p=>p.price));
  const PART = [['base','Blank or patch','var(--fg)'],['make','Printing and embroidery','color-mix(in srgb,var(--fg) 50%,transparent)'],['trim','Labels and bags','var(--line)']];
  return cell('s12','What each product costs to make',`<span class="lbl">At a medium · average costs</span>`,
    `<div class="sx-ld">${list.map(p=>{ const c = costOf(p), o = partsOf(p);
      return `<button class="sx-ld-r" data-sopen="p:${p.id}"><span class="sx-ld-k"><b>${shortN(p)}</b><span>${p.recipe ? `${p.recipe.length} materials` : p.est ? 'One cost · estimate' : 'One cost'}</span></span>
        <span class="sx-ld-b"><span class="sx-ld-t" style="width:${p.price/mx*100}%">${p.recipe ? PART.map(([k,,col])=>o[k]?`<i style="flex:${o[k]};background:${col}"></i>`:'').join('') : `<i class="hx" style="flex:${c}"></i>`}<i class="m" style="flex:${p.price-c}"></i><s style="left:${(1-TARGET)*100}%"></s></span></span>
        <span class="sx-ld-n"><b>${money(c)}</b><em>of ${money(p.price).replace('.00','')}</em></span><b class="sx-ld-p ${marginOf(p)<TARGET?'bad':''}">${(marginOf(p)*100).toFixed(0)}%</b></button>`; }).join('')}</div>`,
    `<span class="f-key">${PART.map(([,t,c])=>`<span><i style="background:${c}"></i>${t}</span>`).join('')}<span><i class="hx"></i>Estimate</span><span><i class="sx-tick"></i>Cost at the ${TARGET*100}% target</span></span><span></span>`);
}
function renderOverview(){ document.getElementById('sv').innerHTML = band(shelfCell(), 1) + band(dollarCell() + sellsCell()) + band(ladderCell()); }

/* ══ Products ══════════════════════════════════════════════════════════════════════════════════════════════════ */
function renderProducts(){
  const F = [['all','All'],['on','On the shelf'],['off','Off'],['draft','Drafts']], L = PR.filter(p=>SP.pf==='all' || p.st===SP.pf);
  const list = cell('s12','Every product', seg('spf', F, SP.pf, 'Which products'),
    `<div class="sx-pl"><div class="sx-pr hd2"><span>${lbl('Product')}</span>${lbl('Price')}${lbl('Cost to make')}${lbl('Margin')}${lbl('Sold')}${lbl('Status')}<span></span></div>
      ${Object.keys(LINES).map(l=>{ const A = L.filter(p=>p.line===l); return A.length ? `<div class="gv-g">${lbl(`${LINES[l][0]} · ${A.length}`)}</div>${A.map(p=>{ const c = costOf(p), m = marginOf(p), xxl = p.recipe && p.cols[0]!=='One size' ? marginOf(p,'XXL',p.cols[p.cols.length-1]) : null;
        return `<button class="sx-pr st-${p.st}" data-sopen="p:${p.id}"><span class="sx-pk">${glyph(p,'sm')}<span><b>${p.n} · ${p.v}</b><span>${p.recipe ? `Built from ${p.recipe.length} materials` : p.est ? 'One cost per product · estimate' : 'One cost per product'}</span></span></span>
          <b class="num">${money(p.price)}</b><span class="sx-pc ${p.est?'est':''}">${money(c)}${xxl!==null && Math.abs(costOf(p,'XXL',p.cols[p.cols.length-1])-c)>.01 ? `<em>to ${money(costOf(p,'XXL',p.cols[p.cols.length-1]))}</em>` : ''}</span>
          ${p.dep ? `<span class="sx-pm dep"><em>Deposit · estimated cost ${money(c)}</em></span>` : `<span class="sx-pm"><span class="sx-mb"><i class="${p.est?'hx':''} ${m<TARGET?'bad':''}" style="width:${Math.max(0,m)*100}%"></i><s style="left:${TARGET*100}%"></s></span><b class="${m<TARGET?'bad':''}">${(m*100).toFixed(0)}%</b></span>`}
          <span class="num">${u4(p)}</span><span class="gt-st" style="--c:${SHELF[p.st][1]}">${SHELF[p.st][0]}</span><span class="gv-go">${ICO.chev}</span></button>`; }).join('')}` : ''; }).join('') || `<div class="gv-e"><span>Nothing here</span></div>`}</div>`,
    `<span>Margins at a medium · sold in the last 4 weeks</span><button data-sadd>Add a product</button>`);
  const C = CHANGES.map(([t,id,a,b,why])=>{ const ps = usedIn(id), i = INP[id];
    const dm = ps.length ? ps.map(p=>{ const was = (p.price - (costOf(p) - (b-a)*p.recipe.find(r=>r[0]===id)[1]))/p.price; return (marginOf(p)-was)*100; }) : [0];
    return `<button class="gt-cr sx-cr" data-sopen="m:${id}">${leaf(t)}<span class="gt-ck"><b>${i.n}</b><span>${why} · ${money(a)} → ${money(b)}</span></span><span class="sx-cd ${b>a?'up':'dn'}"><b>${b>a?'+':'−'}${money(Math.abs(b-a))}</b><em>${ps.length} product${ps.length===1?'':'s'} · ${pts(Math.min(...dm))}</em></span></button>`; }).join('');
  const changes = cell('s7','Cost changes',`<span class="lbl">Last 8 weeks</span>`, `<div class="gt-cl">${C}${rest()}</div>`, `<span>A new price blends into the average as stock is used</span><span></span>`);
  const under = PR.filter(p=>p.recipe && p.st!=='arch').flatMap(p=>p.cols.filter((c,ix)=>ix===0 || INPUTS.some(i=>(i.var||{})[c] && p.recipe.some(r=>r[0]===i.id))).map(col=>{
      const sz = (p.cols[0]==='One size' ? ['M'] : SIZES).map(s=>[s, marginOf(p,s,col)]), bad = sz.filter(x=>x[1]<TARGET);
      return bad.length ? [p, col, bad, Math.min(...bad.map(x=>x[1]))] : null; })).filter(Boolean).sort((a,b)=>a[3]-b[3]);
  const rng = b => b.length===SIZES.length ? 'every size' : b.length===1 ? b[0][0] : `${b[0][0]}–${b[b.length-1][0]}`;
  const target = cell('s5','Under the target',`<span class="lbl">${TARGET*100}% margin</span>`,
    under.length ? `<div class="sx-ul">${under.map(([p,col,bad,m])=>{ const worst = bad.find(x=>x[1]===m)[0], c = costOf(p,worst,col);
      return `<button class="sx-ur" data-sopen="p:${p.id}"><span class="gt-ck"><b>${shortN(p)} · ${col}</b><span>${bad.length===1 ? `Only ${worst} · it costs ${money(c)}` : `${rng(bad)[0].toUpperCase()+rng(bad).slice(1)} · ${worst} costs ${money(c)}`}</span></span><span class="sx-ud"><b class="bad">${(m*100).toFixed(1)}%</b><em>${money(Math.ceil(priceFor(c,TARGET)))} hits ${TARGET*100}%</em></span></button>`; }).join('')}${rest()}</div>` : `<div class="gv-e"><span>Every size clears ${TARGET*100}%</span></div>`,
    `<span>One price for every size, so XXL earns less</span><span></span>`);
  document.getElementById('sv').innerHTML = band(list, 1) + band(changes + target);
}

/* ══ Materials ═════════════════════════════════════════════════════════════════════════════════════════════════ */
function coverBar(i){
  if (i.kind==='mto') return `<span class="sx-na">Nothing kept · charged per piece</span>`;
  const w = lastsW(i), need = SUP[i.sup].lead/7 + MIN_WEEKS, mx = 16, low = isLow(i);
  return `<span class="sx-cv"><span class="sx-cv-b"><i class="${low?'low':''}" style="width:${w===null?0:Math.min(100,w/mx*100)}%"></i>${i.incoming && useWk(i) ? `<i class="inc" style="left:${Math.min(100,(w||0)/mx*100)}%;width:${Math.min(100-(w||0)/mx*100, i.incoming[0]/useWk(i)/mx*100)}%"></i>` : ''}<s style="left:${need/mx*100}%"></s></span><em class="${low?'bad':''}">${i.incoming && !i.hand ? `None on hand · ${i.incoming[0]} arrive ${fmtD(i.incoming[1])}` : w===null ? 'Not used yet' : `${int(i.hand)} on hand · ${w>=mx ? '16+' : w.toFixed(1)} weeks`}</em></span>`;
}
function renderMaterials(){
  const F = [['all','All'],['stock','Kept on hand'],['mto','Made to order'],['order','Per order']], L = INPUTS.filter(i=>SP.mf==='all' || i.kind===SP.mf);
  const list = cell('s12','Every material', seg('smf', F, SP.mf, 'Which materials'),
    `<div class="sx-ml"><div class="sx-mr hd2"><span>${lbl('Material')}</span>${lbl('Cost each')}${lbl('On hand · lasts')}${lbl('Used in')}<span></span></div>
      ${Object.keys(KIND).map(k=>{ const A = L.filter(i=>i.kind===k); return A.length ? `<div class="gv-g">${lbl(`${KIND[k][0]} · ${A.length}`)}<em>${KIND[k][1]}</em></div>${A.map(i=>{ const ps = usedIn(i.id), d = i.last - i.avg;
        return `<button class="sx-mr ${isLow(i)?'low':''}" data-sopen="m:${i.id}"><span class="gt-ck"><b>${i.n}</b><span>${SUP[i.sup].n}${i.var ? ` · ${Object.keys(i.var).join(', ')} cost more` : ''}</span></span>
          <span class="sx-mc"><b>${money(i.avg)}</b><em class="${Math.abs(d)>.005?(d>0?'up':'dn'):''}">${Math.abs(d)>.005 ? `last paid ${money(i.last)}` : `per ${i.unit}`}</em></span>${coverBar(i)}
          <span class="sx-mu">${i.kind==='order' ? '<em>Every order</em>' : ps.length ? `<span class="sx-dots">${ps.map(p=>`<i style="background:${LINES[p.line][1]}" title="${shortN(p)}"></i>`).join('')}</span><em>${ps.length} product${ps.length>1?'s':''}</em>` : '<em>Nothing yet</em>'}</span><span class="gv-go">${ICO.chev}</span></button>`; }).join('')}` : ''; }).join('')}</div>`,
    `<span class="f-key"><span><i style="background:var(--fg)"></i>Weeks it lasts at the last 4 weeks’ pace</span><span><i style="background:var(--underway)"></i>Runs out before more can arrive</span><span><i class="hx"></i>On the way</span><span><i class="sx-tick"></i>Lead time plus a week</span></span><button data-snewm>Add a material</button>`);
  const low = INPUTS.filter(i=>i.kind!=='mto').filter(i=>isLow(i) || i.incoming || (lastsW(i)!==null && lastsW(i) < 6)).sort((a,b)=>(lastsW(a)??99)-(lastsW(b)??99));
  const reorder = cell('s5','Reorder',`<span class="lbl">Lead time plus a week</span>`,
    `<div class="sx-ro">${low.map(i=>{ const s = SUP[i.sup], w = lastsW(i), q = Math.max(s.breaks[0][0], Math.ceil(useWk(i)*8));
      return `<button class="sx-ro-r ${isLow(i)?'low':''}" data-sopen="m:${i.id}"><span class="gt-ck"><b>${i.n}</b><span>${i.incoming ? `${i.incoming[0]} on the way · ${fmtD(i.incoming[1])}` : `${i.hand} left · ${s.n} takes ${s.lead} days`}</span></span><span class="sx-ro-a">${i.incoming ? `<span class="gt-st" style="--c:var(--live)">Ordered</span>` : isLow(i) ? `<b class="bad">Order ${q}</b><em>${money(q*i.last)}</em>` : `<b>${w.toFixed(1)} wk</b><em>Fine for now</em>`}</span></button>`; }).join('')}${rest()}</div>`,
    `<span>Buys over $250.00 need a second person, in Money</span><span></span>`);
  const sup = cell('s7','Suppliers',`<span class="lbl">${SUPPLIERS.length} suppliers</span>`,
    `<div class="sx-sl">${SUPPLIERS.map(s=>{ const ms = INPUTS.filter(i=>i.sup===s.id); return `<button class="sx-sr" data-sopen="s:${s.id}"><span class="gt-ck"><b>${s.n}</b><span>${s.what} · ${s.city}</span></span><span class="sx-sm"><b>${s.lead} days</b><em>${s.terms}</em></span><span class="sx-sm"><b>${ms.length}</b><em>material${ms.length>1?'s':''}</em></span><span class="sx-sm"><b>${s.breaks.length>1 ? `−${Math.round(s.breaks[s.breaks.length-1][1]*100)}%` : '—'}</b><em>${s.breaks.length>1 ? `at ${s.breaks[s.breaks.length-1][0]}+` : 'no breaks'}</em></span></button>`; }).join('')}${rest()}</div>`,
    `<span>Price breaks apply per order with that supplier</span><span></span>`);
  document.getElementById('sv').innerHTML = band(list, 1) + band(sup + reorder);
}

/* ══ Inventory ═════════════════════════════════════════════════════════════════════════════════════════════════ */
function renderInventory(){
  const rows = goods.filter(p=>p.st!=='arch' && p.line!=='patch' && STK[p.id]).flatMap(p=>Object.entries(STK[p.id]).map(([col,v],k)=>({p, col, v, first:k===0})));
  const cellv = (n, i, on) => `<span class="sx-sg-c ${!on?'q':n===0?'z':n<=2&&i>0&&i<5?'lo':''}" style="--a:${Math.min(1,n/18)}"><b>${on||n?n:'–'}</b></span>`;
  const grid = cell('s12','Finished stock',`<span class="lbl">${int(goods.reduce((a,p)=>a+(onHand(p.id)||0),0))} items · by size</span>`,
    `<div class="sx-sg"><div class="sx-sg-r hd2"><span>${lbl('Product')}</span>${lbl('Colour')}${SIZES.map(s=>lbl(s)).join('')}${lbl('Total')}</div>
      ${rows.map(({p,col,v,first})=>`<button class="sx-sg-r ${first?'first':''}" data-sopen="p:${p.id}"><span class="sx-sg-k">${first?`<b>${shortN(p)}</b>`:''}</span><span class="sx-sg-col"><i class="sx-sw ${col.toLowerCase()}"></i>${col}</span>${v.map((n,i)=>cellv(n,i,p.st==='on')).join('')}<b class="num">${v.reduce((a,b)=>a+b,0)}</b></button>`).join('')}
      <div class="sx-sg-r pt"><span class="sx-sg-k"><b>Patches</b></span><span class="sx-sg-col">Square · circle</span><span class="sx-sg-pt">${onHand('psq')} square · ${onHand('pci')} circle, carded and bagged</span><b class="num">${onHand('psq')+onHand('pci')}</b></div></div>`,
    `<span class="f-key"><span><i style="background:color-mix(in srgb,var(--fg) 60%,transparent)"></i>Fewer to more</span><span><i style="background:var(--underway)"></i>Two or fewer, S to XL</span><span><i class="sx-z"></i>Out</span><span><i class="hx"></i>Not on the shelf</span></span><span></span>`);
  const BS = { done:['Made','var(--fg)'], planned:['Planned','var(--live)'], short:['Short of materials','var(--underway)'] };
  const batches = cell('s7','Batches',`<span class="lbl">Materials in, finished stock out</span>`,
    `<div class="sx-bl">${BATCHES.slice().sort((a,b)=>({short:0,planned:1,done:2})[a[6]]-({short:0,planned:1,done:2})[b[6]] || b[4]-a[4]).map(b=>{ const p = PRO[b[1]];
      return `<button class="sx-br ${b[6]}" data-sopen="b:${b[0]}">${leaf(b[4])}<span class="gt-ck"><b>${b[3]} × ${shortN(p)}${b[2]?' · '+b[2]:''}</b><span>${b[0]} · ${money(b[5])} each · ${money(b[3]*b[5])}</span></span><span class="gt-st" style="--c:${BS[b[6]][1]}">${BS[b[6]][0]}</span></button>`; }).join('')}${rest()}</div>`,
    `<span>Each batch keeps the cost it was made at</span><button data-smake="lts">Make a batch</button>`);
  const inc = [[INP['blk-hd'].incoming[1],'120 hoodie blanks','Heavyweight Supply · '+money(INP['blk-hd'].incoming[2]),'m:blk-hd'],[D(10,28),'Devore sample','Inland Screen Print · 1 of each colour','p:gdv'],[D(11,2),'Clear Point quote','First build, for the pre-orders','p:cpt']];
  const coming = cell('s5','On the way',`<span class="lbl">${inc.length} things</span>`,
    `<div class="gt-cl">${inc.map(([t,a,b,o])=>`<button class="gt-cr" data-sopen="${o}">${leaf(t)}<span class="gt-ck"><b>${a}</b><span>${b}</span></span><span class="gt-st" style="--c:var(--live)">${Math.ceil((t-NOW)/DAY)} days</span></button>`).join('')}${rest()}</div>`,
    `<span>Materials count as on hand once they’re checked in</span><span></span>`);
  document.getElementById('sv').innerHTML = band(grid, 1) + band(batches + coming);
}

/* ══ Orders ════════════════════════════════════════════════════════════════════════════════════════════════════ */
const ordItems = o => o[4].reduce((a,x)=>a+x[3],0);
const ordTotal = o => o[4].reduce((a,[pid,,,q])=>a+PRO[pid].price*q,0);
const ordCost = o => o[4].reduce((a,[pid,col,sz,q])=>a+costOf(PRO[pid], sz||'M', col)*q,0);
function renderOrders(){
  const F = [['open','Open'],['paid','To pack'],['all','All']], open = o => !['done'].includes(o[7]);
  const L = ORDERS.filter(o=>SP.of==='all' || (SP.of==='open' ? open(o) : o[7]===SP.of));
  const list = cell('s12','Orders', seg('sof', F, SP.of, 'Which orders'),
    `<div class="sx-ol">${Object.keys(OST).map(st=>{ const A = L.filter(o=>o[7]===st).sort((a,b)=>a[1]-b[1]); return A.length ? `<div class="gv-g">${lbl(`${OST[st][0]} · ${A.length}`)}</div>${A.map(o=>{ const t = ordTotal(o), c = ordCost(o);
      return `<button class="sx-or" data-sopen="o:${o[0]}"><span class="mono sx-oi">#${o[0]}</span><span class="gt-ck"><b>${o[4].map(([pid,col,sz,q])=>`${q>1?q+' × ':''}${shortN(PRO[pid])}${sz?' · '+sz:''}`).join(', ')}</b><span>${o[2]}${o[3]?' · member':''} · ${PAY[o[5]]} · ${ago(o[1])}</span></span>
        <span class="sx-of"><b>${o[6]==='ship'?'Shipping':'Pickup'}</b><em>${o[6]==='ship' ? (o[7]==='paid' ? `${money(SHIP.label)} label` : o[7]==='refund' ? 'Return label sent' : 'USPS Ground') : POINTS[PICKUP_AT[o[0]]].n}</em></span><span class="sx-om"><b>${money(t)}</b><em>${(((t-c)/t)*100).toFixed(0)}% margin</em></span></button>`; }).join('')}` : ''; }).join('') || `<div class="gv-e"><span>No orders here</span></div>`}</div>`,
    `<span>Oldest first in each step</span><button data-spack>Print labels for the ${ORDERS.filter(o=>o[7]==='paid').length}</button>`);
  /* an average order, shipped vs picked up: one ruler per kind, each cost a span of it */
  const S = SHOPN, avgT = S.rev/S.ord, items = S.mat/S.ord, fee = avgT*FEE.pct + FEE.fixed;
  const kinds = [['ship',`Shipped · ${S.shipped}`, perOrderSupplies(), SHIP.label - SHIP.charged],['pickup',`Picked up · ${S.picked}`, pickupSupplies(), 0]]
    .map(([k,t,sup,gap])=>({ k, t, parts:[items, sup, fee, gap], kept:avgT - items - sup - fee - gap }));
  const PARTS = [['Materials in the items','var(--fg)'],['Mailer, tissue and label','color-mix(in srgb,var(--fg) 55%,transparent)'],['Payment fees','color-mix(in srgb,var(--fg) 30%,transparent)'],['Shipping gap','var(--underway)']];
  const SUBS = [`${(S.items/S.ord).toFixed(1)} items at average cost`, `${INPUTS.filter(i=>i.kind==='order').map(i=>money(i.avg)).join(' + ')} · pickups take tissue only`, `${(FEE.pct*100).toFixed(1)}% + ${money(FEE.fixed)}`, `${money(SHIP.label)} label · ${money(SHIP.charged)} charged`];
  const dash = v => v ? `−${money(v)}` : '<span class="q">—</span>';
  const per = cell('s7','An average order',`<span class="lbl">${money(avgT)} · last 4 weeks</span>`,
    `<div class="sx-ao"><div class="sx-ao-v">${kinds.map(x=>`<div class="sx-ao-r"><span>${x.t}</span><span class="sx-ao-b">${x.parts.map((v,ix)=>v>0.005?`<i style="flex:${v};background:${PARTS[ix][1]}"></i>`:'').join('')}<i class="kp" style="flex:${x.kept}"></i></span><b>${money(x.kept)}<em>${(x.kept/avgT*100).toFixed(0)}% kept</em></b></div>`).join('')}</div>
      <div class="sx-at"><div class="hd2"><span></span>${lbl('Shipped')}${lbl('Picked up')}</div>
        <div class="tot"><span><i></i><b>Sale, before tax</b></span><b>${money(avgT)}</b><b>${money(avgT)}</b></div>
        ${PARTS.map(([t,c],ix)=>`<div><span><i style="background:${c}"></i><b>${t}</b><em>${SUBS[ix]}</em></span><b>${dash(kinds[0].parts[ix])}</b><b>${dash(kinds[1].parts[ix])}</b></div>`).join('')}
        <div class="keep"><span><i></i><b>Kept per order</b></span><b>${money(kinds[0].kept)}</b><b>${money(kinds[1].kept)}</b></div></div></div>`,
    `<span>Per-order costs come once, however many items</span><button data-stab="materials">Materials →</button>`);
  /* waiting for pickup: how long each has been held against the 14 days, then where pickups happen */
  const pick = ORDERS.filter(o=>o[6]==='pickup' && o[7]==='ready').sort((a,b)=>a[1]-b[1]), pmx = Math.max(...Object.values(POINTS).map(x=>x.wk4));
  const saved = S.picked * (perOrderSupplies() - pickupSupplies() + SHIP.label - SHIP.charged);
  const pk = cell('s5','Waiting for pickup',`<span class="lbl">Held ${HOLD_DAYS} days</span>`,
    `<div class="gt-cl sx-wl">${pick.map(o=>{ const dd = Math.round((NOW-o[1])/DAY), pt = POINTS[PICKUP_AT[o[0]]];
      return `<button class="gt-cr sx-wr" data-sopen="o:${o[0]}">${leaf(o[1])}<span class="gt-ck"><b>#${o[0]} · ${o[2]}</b><span>${pt.n} · ${o[4].map(([pid,,sz,q])=>`${q>1?q+' × ':''}${shortN(PRO[pid])}${sz?' · '+sz:''}`).join(', ')}</span></span><span class="sx-hold"><b>${dd} of ${HOLD_DAYS} days</b><span class="sx-hold-b"><i style="width:${dd/HOLD_DAYS*100}%"></i></span></span></button>`; }).join('') || ''}
      <div class="gv-g">${lbl('Pickup points · 4 weeks')}</div>
      ${Object.entries(POINTS).map(([k,x])=>`<button class="sx-pp" data-sgo="merchants/shop:${k}"><span class="gt-ck"><b>${x.n}</b><span>${x.city} · partner shop</span></span><span class="sx-pp-b"><i style="width:${x.wk4/pmx*100}%"></i></span><b>${x.wk4}</b></button>`).join('')}${rest()}</div>`,
    `<span>Pickups saved ${money(saved)} in mailers, labels and shipping</span><span></span>`);
  document.getElementById('sv').innerHTML = band(list, 1) + band(per + pk);
}

/* ══ Panels ════════════════════════════════════════════════════════════════════════════════════════════════════ */
function ensurePanel(){ let pn = document.getElementById('spanel');
  if (!pn){ const sc = document.createElement('div'); sc.id = 'sscrim'; sc.className = 'scrim'; document.body.appendChild(sc); pn = document.createElement('aside'); pn.id = 'spanel'; pn.className = 'panel spanel'; document.body.appendChild(pn); }
  return pn; }
function renderPanel(){ const pn = ensurePanel(), P = SP.panel;
  if (!P){ document.body.classList.remove('pn'); return; }
  document.body.classList.add('pn'); const [k, id] = P.split(':');
  pn.innerHTML = k==='p' ? prodPanel(PRO[id]) : k==='m' ? matPanel(INP[id]) : k==='s' ? supPanel(SUP[id]) : k==='b' ? batchPanel(id) : k==='mk' ? makePanel(id) : k==='o' ? ordPanel(id) : '';
  if (k==='p') refreshProd(); if (k==='m') refreshBuy(); if (k==='mk') refreshMake(); }
const phd = (k) => `<div class="pn-hd"><span class="lbl">${k}</span><button class="x" data-sclose aria-label="Close">${ICO.x}</button></div>`;
const numIn = (id, v, attrs='', step='0.01') => `<input class="vin sx-in" id="${id}" inputmode="decimal" value="${v}" ${attrs}>`;

/* product: build the cost from materials or give one cost; price and margin work both ways */
function prodPanel(p){
  if (!SP.draft || SP.draft.id!==p.id) SP.draft = { id:p.id, mode:p.recipe?'recipe':'flat', recipe:(p.recipe||[]).map(r=>[...r]), flat:p.flat ?? (p.recipe ? recipeCost(p.recipe,'M',p.cols[0]) : 0), est:!!p.est, price:p.price };
  const d = SP.draft, ro = !STAFF() ? 'disabled' : '';
  const opts = Object.keys(KIND).filter(k=>k!=='order').map(k=>`<optgroup label="${KIND[k][0]}">${INPUTS.filter(i=>i.kind===k && !d.recipe.some(r=>r[0]===i.id)).map(i=>`<option value="${i.id}">${i.n} · ${money(i.avg)}</option>`).join('')}</optgroup>`).join('');
  const recipe = `<div class="sx-rc">${d.recipe.map(([id,q],ix)=>{ const i = INP[id];
      return `<div class="sx-rc-r"><span class="gt-ck"><b>${i.n}</b><span><span class="sx-kd ${i.kind}">${KIND[i.kind][0]}</span> ${money(i.avg)} per ${i.unit}${i.var?` · ${Object.entries(i.var).map(([k,v])=>`${k} +${money(v)}`).join(', ')}`:''}</span></span>
        <label class="sx-f">${lbl('Amount')}${numIn('sam'+ix, q, `data-sam="${ix}" ${ro}`)}</label><span class="sx-x">×</span><label class="sx-f">${lbl('Cost')}${numIn('slc'+ix, fx(q*i.avg), `data-slc="${ix}" ${ro}`)}</label>
        <button class="sx-rm" data-srm="${ix}" aria-label="Remove ${i.n}" ${ro}>${ICO.x}</button></div>`; }).join('')}
      <div class="sx-rc-add"><select id="saddsel" class="vin" ${ro}><option value="">Add a material from the library…</option>${opts}</select><button class="btn sm-b" data-saddm ${ro}>Add</button><button class="btn sm-b" data-snewm ${ro}>New material</button></div></div>`;
  const flat = `<div class="sx-fl"><label class="sx-f wide">${lbl('Cost per product')}${numIn('sflat', fx(d.flat), `data-sflat ${ro}`)}</label><label class="sx-chk"><input type="checkbox" id="sest" ${d.est?'checked':''} ${ro}> It’s an estimate</label>
      <p class="bpn-n">${p.note || 'Use one cost when the product is bought finished or quoted as a whole. Switch to materials to see what goes into it.'}</p></div>`;
  return phd(`${LINES[p.line][0]} · ${SHELF[p.st][0]}`) + `<div class="pn-b">
    <div class="sx-ph">${glyph(p,'lg')}<div><p class="bpn-t">${p.n} · ${p.v}</p><p class="bpn-s">${p.cols.join(', ')} · ${u4(p)} ${p.dep?'pre-ordered':'sold'} in 4 weeks${p.why?' · '+p.why:''}</p></div></div>
    <div><div class="sx-sh">${lbl('What it costs to make')}${seg('smode', [['recipe','From materials'],['flat','One cost']], d.mode, 'How it’s costed')}</div>${d.mode==='recipe' ? recipe : flat}</div>
    <div class="sx-pmw"><label class="sx-f">${lbl('Price')}${numIn('sprice', fx(d.price), `data-sprice ${ro}`)}</label><span class="sx-x">↔</span><label class="sx-f">${lbl('Margin %')}${numIn('smarg', '', `data-smarg ${ro}`)}</label>
      <div class="sx-pmo" id="spsum"></div></div>
    <div id="spsize"></div>
    <p class="bpn-n">Average costs of what’s on hand. Batches already made keep the cost they were made at.</p></div>
    <div class="pn-ft">${STAFF() ? `<button class="btn" data-smake="${p.id}" ${p.dep?'disabled':''}>Make a batch</button><button class="btn p" data-ssave="${p.id}">Save</button>` : `<span class="small quiet" style="margin-right:auto">Read-only</span>`}</div>`;
}
function draftCost(size='M', col){ const d = SP.draft, p = PRO[d.id]; return d.mode==='recipe' ? recipeCost(d.recipe, size, col || p.cols[0]) : d.flat; }
function refreshProd(skip){
  const d = SP.draft, p = PRO[d.id], pn = document.getElementById('spanel'); if (!pn) return;
  const c = draftCost(), m = d.price ? (d.price - c)/d.price : 0;
  const mi = pn.querySelector('#smarg'); if (mi && skip!=='smarg') mi.value = (m*100).toFixed(1);
  const pi = pn.querySelector('#sprice'); if (pi && skip!=='sprice') pi.value = fx(d.price);
  pn.querySelector('#spsum').innerHTML = `<span><b class="${d.est&&d.mode==='flat'?'est':''}">${money(c)}</b><em>cost at a medium${d.est&&d.mode==='flat'?' · estimate':''}</em></span><span><b>${money(d.price-c)}</b><em>kept per item</em></span>
    <span><b class="${m<TARGET?'bad':'ok'}">${(m*100).toFixed(1)}%</b><em>${m<TARGET ? `${money(priceFor(c,TARGET))} hits ${TARGET*100}%` : `clears ${TARGET*100}%`}</em></span>${STAFF() && m<TARGET ? `<button class="lnk3" data-starget>Use ${money(Math.ceil(priceFor(c,TARGET)))}</button>` : ''}`;
  const cols = p.cols[0]==='One size' || d.mode==='flat' ? null : [...new Set([p.cols[0], ...p.cols.filter(cl=>d.recipe.some(([id])=>(INP[id].var||{})[cl]))])];
  pn.querySelector('#spsize').innerHTML = cols ? `<div class="sx-sz">${lbl('By size')}${cols.map(cl=>`<div class="sx-sz-r"><span class="sx-sz-c"><i class="sx-sw ${cl.toLowerCase()}"></i>${cl}</span>${SIZES.map(s=>{ const cs = draftCost(s, cl), ms = (d.price-cs)/d.price; return `<span class="sx-sz-v ${ms<TARGET?'bad':''}"><em>${s}</em><b>${(ms*100).toFixed(0)}%</b><i>${money(cs)}</i></span>`; }).join('')}</div>`).join('')}</div>` : '';
}

/* material: what it costs, recording a buy (paid and units, or a cost each), and where it's used */
function matPanel(i){
  const s = SUP[i.sup], ps = usedIn(i.id), ro = !STAFF() ? 'disabled' : '';
  if (!SP.buy || SP.buy.id!==i.id) SP.buy = { id:i.id, units:'', paid:'', per:fx(i.last) };
  const rows = [['Kind',KIND[i.kind][0]],['Supplier',`<button class="lnk3" data-sopen="s:${s.id}">${s.n}</button> · ${s.lead} days`],['Average cost',`${money(i.avg)} per ${i.unit}`],['Last paid',money(i.last)],
    ...(i.var ? [['Costs more',Object.entries(i.var).map(([k,v])=>`${k} +${money(v)}`).join(' · ')]] : []),
    ...(i.kind!=='mto' ? [['On hand',`${int(i.hand)} · uses ${useWk(i).toFixed(1)} a week`],['Lasts',lastsW(i)===null?'—':`${lastsW(i).toFixed(1)} weeks · reorder under ${(s.lead/7+MIN_WEEKS).toFixed(1)}`]] : [])];
  const others = PR.filter(p=>p.recipe && !p.recipe.some(r=>r[0]===i.id) && p.st!=='arch');
  return phd(`Material · ${KIND[i.kind][0]}`) + `<div class="pn-b"><div><p class="bpn-t">${i.n}</p><p class="bpn-s">${i.note || s.what}</p></div>
    <div class="led">${rows.map(([k,v])=>`<div><span>${k}</span><b>${v}</b></div>`).join('')}</div>
    <div>${lbl(i.kind==='mto' ? 'New price' : 'Record a buy')}<div class="sx-buy">${i.kind==='mto' ? '' : `<label class="sx-f">${lbl('Paid')}${numIn('bpaid', SP.buy.paid, `data-bpaid ${ro} placeholder="0.00"`)}</label><span class="sx-x">÷</span><label class="sx-f">${lbl('Units')}${numIn('bunits', SP.buy.units, `data-bunits ${ro} placeholder="0"`)}</label><span class="sx-x">=</span>`}<label class="sx-f">${lbl('Each')}${numIn('bper', SP.buy.per, `data-bper ${ro}`)}</label></div>
      <div id="sbprev"></div></div>
    <div>${lbl(`Used in · ${ps.length}`)}<div class="led sx-ui">${ps.map(p=>{ const q = p.recipe.find(r=>r[0]===i.id)[1]; return `<div><span><button class="lnk3" data-sopen="p:${p.id}">${shortN(p)}</button></span><b>${q} × ${money(i.avg)} = ${money(q*i.avg)} · ${(q*i.avg/costOf(p)*100).toFixed(0)}% of its cost</b></div>`; }).join('') || '<div><span>Not in any product yet</span><b></b></div>'}</div>
      ${STAFF() && i.kind!=='order' && others.length ? `<div class="sx-rc-add"><select id="sapplyp" class="vin">${others.map(p=>`<option value="${p.id}">${p.n} · ${p.v}</option>`).join('')}</select><label class="sx-f sm">${numIn('sapplyq', 1, '')}</label><button class="btn sm-b" data-sapply="${i.id}">Add to it</button></div>` : ''}</div>
    ${i.buys ? `<div>${lbl('Buys')}<div class="led">${i.buys.slice().reverse().map(([t,u,v])=>`<div><span>${fmtD(t)} · ${int(u)} ${i.unit}s</span><b>${money(v)} · ${money(v/u)} each</b></div>`).join('')}${i.incoming?`<div><span>${fmtD(i.incoming[1])} · ${i.incoming[0]} on the way</span><b>${money(i.incoming[2])} · ${money(i.incoming[2]/i.incoming[0])} each</b></div>`:''}</div></div>` : ''}</div>
    <div class="pn-ft">${STAFF() ? `${i.kind!=='mto'?`<button class="btn" data-sorder="${i.id}">Order more</button>`:''}<button class="btn p" data-sbuy="${i.id}">${i.kind==='mto'?'Save the price':'Record the buy'}</button>` : `<span class="small quiet" style="margin-right:auto">Read-only</span>`}</div>`;
}
function refreshBuy(skip){
  const b = SP.buy, i = INP[b.id], pn = document.getElementById('spanel'); if (!pn) return;
  const units = parseFloat(b.units)||0, per = parseFloat(b.per)||0, paid = parseFloat(b.paid)||0;
  if (skip==='bpaid' || skip==='bunits'){ if (units && paid){ b.per = fx(paid/units); const e = pn.querySelector('#bper'); if (e) e.value = b.per; } }
  if (skip==='bper' && units){ b.paid = fx(units*per); const e = pn.querySelector('#bpaid'); if (e) e.value = b.paid; }
  const p2 = parseFloat(b.per)||0, u2 = parseFloat(b.units)||0;
  const na = i.kind==='mto' ? p2 : u2 ? (i.avg*i.hand + u2*p2)/(i.hand + u2) : i.avg;
  const ps = usedIn(i.id);
  pn.querySelector('#sbprev').innerHTML = `<div class="sx-bp"><span><b>${money(na)}</b><em>${i.kind==='mto' ? 'new price' : u2 ? `new average · was ${money(i.avg)}` : 'enter units to see the new average'}</em></span>
    ${ps.length ? `<div class="led">${ps.map(p=>{ const q = p.recipe.find(r=>r[0]===i.id)[1], was = marginOf(p), now = (p.price - (costOf(p) + q*(na-i.avg)))/p.price;
      return `<div><span>${shortN(p)}</span><b class="${now<TARGET?'bad':''}">${(was*100).toFixed(1)}% → ${(now*100).toFixed(1)}%</b></div>`; }).join('')}</div>` : ''}</div>`;
}
function supPanel(s){
  const ms = INPUTS.filter(i=>i.sup===s.id);
  return phd('Supplier') + `<div class="pn-b"><div><p class="bpn-t">${s.n}</p><p class="bpn-s">${s.what} · ${s.city}</p></div>
    <div class="led">${[['Lead time',`${s.lead} days`],['Terms',s.terms],['Minimum',s.min],['Last order',fmtD(s.last)]].map(([k,v])=>`<div><span>${k}</span><b>${v}</b></div>`).join('')}</div>
    <div>${lbl('Price breaks')}<div class="sx-brk">${s.breaks.map(([q,d])=>`<span><b>${q}+</b><em>${d ? `−${Math.round(d*100)}%` : 'List price'}</em></span>`).join('')}</div></div>
    <div>${lbl(`What we buy · ${ms.length}`)}<div class="led">${ms.map(i=>`<div><span><button class="lnk3" data-sopen="m:${i.id}">${i.n}</button></span><b>${money(i.avg)} per ${i.unit}</b></div>`).join('')}</div></div></div>
    <div class="pn-ft"><button class="btn" data-sclose>Close</button></div>`;
}
function batchPanel(id){
  const b = BATCHES.find(x=>x[0]===id), p = PRO[b[1]];
  const need = (p.recipe||[]).map(([iid,q])=>{ const i = INP[iid]; return [i, q*b[3]]; });
  return phd(`Batch ${b[0]}`) + `<div class="pn-b"><div><p class="bpn-t">${b[3]} × ${p.n} · ${p.v}${b[2]?' · '+b[2]:''}</p><p class="bpn-s ${b[6]==='short'?'warn':''}">${{done:`Made ${fmtD(b[4])}`,planned:`Planned for ${fmtD(b[4])}`,short:`Planned for ${fmtD(b[4])} · short of materials`}[b[6]]}</p></div>
    <div class="led">${need.map(([i,n])=>`<div><span>${i.n}</span><b class="${b[6]==='short' && i.kind==='stock' && i.hand<n?'bad':''}">${int(n)} ${i.unit}s${b[6]!=='done' && i.kind==='stock' ? ` · ${int(i.hand)} on hand` : i.kind==='mto' ? ' · charged per piece' : ''}</b></div>`).join('')}</div>
    <div class="sx-bp"><span><b>${money(b[5])}</b><em>each</em></span><span><b>${money(b[5]*b[3])}</b><em>the batch</em></span></div>
    ${b[6]==='short' ? `<p class="bpn-w"><b>${INP['blk-tn'].hand} turtleneck blanks on hand, ${b[3]} needed.</b> Westcoast takes ${SUP.wcb.lead} days. Ordering 24 hits their minimum.</p>` : ''}</div>
    <div class="pn-ft">${b[6]==='short' && STAFF() ? `<button class="btn" data-sclose>Not now</button><button class="btn p" data-sorder="blk-tn">Order 24 blanks</button>` : `<button class="btn" data-sclose>Close</button>`}</div>`;
}
/* make a batch: pick the product, colour and how many of each size; materials are checked against what's on hand */
function makePanel(pid){
  const p = PRO[pid];
  if (!SP.mk || SP.mk.pid!==pid) SP.mk = { pid, col:p.cols[0], q:p.cols[0]==='One size' ? [48] : [2,6,12,12,8,2] };
  const k = SP.mk, sizes = p.cols[0]==='One size' ? ['Each'] : SIZES;
  return phd('Make a batch') + `<div class="pn-b"><div><p class="bpn-t">Make a batch</p><p class="bpn-s">Uses up the materials kept on hand, charges made-to-order costs per piece, and adds finished stock.</p></div>
    <div class="sx-mk"><label class="sx-f wide">${lbl('Product')}<select id="mkp" class="vin">${goods.filter(p=>p.recipe && p.st!=='arch').map(x=>`<option value="${x.id}" ${x.id===pid?'selected':''}>${x.n} · ${x.v}</option>`).join('')}</select></label>
      <label class="sx-f">${lbl('Colour')}<select id="mkc" class="vin">${p.cols.map(c=>`<option ${c===k.col?'selected':''}>${c}</option>`).join('')}</select></label></div>
    <div class="sx-mkq">${sizes.map((s,ix)=>`<label class="sx-f">${lbl(s)}${numIn('mkq'+ix, k.q[ix], `data-mkq="${ix}"`)}</label>`).join('')}</div>
    <div id="mkneed"></div></div>
    <div class="pn-ft"><button class="btn" data-sclose>Cancel</button><button class="btn p" id="mkgo" data-smakego>Make it</button></div>`;
}
function refreshMake(){
  const k = SP.mk, p = PRO[k.pid], pn = document.getElementById('spanel'); if (!pn) return;
  const sizes = p.cols[0]==='One size' ? ['M'] : SIZES, n = k.q.reduce((a,b)=>a+(+b||0),0);
  const lines = p.recipe.map(([id,q])=>{ const i = INP[id], need = q*n, cost = sizes.reduce((a,s,ix)=>a + q*(+k.q[ix]||0)*inCost(id, s, k.col), 0); return [i, need, cost]; });
  const short = lines.filter(([i,need])=>i.kind==='stock' && i.hand < need), tot = lines.reduce((a,l)=>a+l[2],0);
  pn.querySelector('#mkneed').innerHTML = `<div>${lbl(`Materials for ${n}`)}<div class="led">${lines.map(([i,need,cost])=>`<div><span>${i.n}</span><b class="${i.kind==='stock' && i.hand<need?'bad':''}">${int(need)}${i.kind==='stock' ? ` of ${int(i.hand)} on hand` : ' · made to order'} · ${money(cost)}</b></div>`).join('')}</div></div>
    <div class="sx-bp"><span><b>${money(n?tot/n:0)}</b><em>each</em></span><span><b>${money(tot)}</b><em>the batch</em></span><span><b>${money(lines.filter(l=>l[0].kind==='mto').reduce((a,l)=>a+l[2],0))}</b><em>billed by the printer</em></span></div>
    ${short.length ? `<p class="bpn-w"><b>Short of ${short.map(([i,need])=>`${int(need-i.hand)} ${i.n.toLowerCase()}`).join(', ')}.</b> Order more first, or make fewer.</p>` : ''}`;
  const go = pn.querySelector('#mkgo'); if (go) go.disabled = !!short.length || !n;
}
function ordPanel(id){
  const o = ORDERS.find(x=>x[0]===id), t = ordTotal(o), c = ordCost(o), sup = o[6]==='ship' ? perOrderSupplies() : pickupSupplies(), fee = t*FEE.pct + FEE.fixed, ship = o[6]==='ship' ? SHIP.label - SHIP.charged : 0;
  return phd(`Order #${o[0]}`) + `<div class="pn-b"><div><p class="bpn-t">${o[2]}</p><p class="bpn-s">${o[3]?'Member · ':''}${PAY[o[5]]} · ${o[6]==='ship'?'Shipping':`Pickup at ${POINTS[PICKUP_AT[o[0]]||'mesa'].n}`} · ${OST[o[7]][0]}</p></div>
    <div class="led">${o[4].map(([pid,col,sz,q])=>{ const p = PRO[pid]; return `<div><span>${q} × ${p.n} · ${p.v}${col!=='One size'?' · '+col:''}${sz?' · '+sz:''}</span><b>${money(p.price*q)}</b></div>`; }).join('')}</div>
    <div>${lbl('What it cost')}<div class="led">${[['Materials',c],[o[6]==='ship'?'Mailer, tissue and label':'Tissue and sticker',sup],['Payment fee',fee],...(o[6]==='ship'?[['Shipping gap',ship]]:[])].map(([k,v])=>`<div><span>${k}</span><b>${money(v)}</b></div>`).join('')}<div class="tot"><span>Kept</span><b>${money(t-c-sup-fee-ship)} · ${(((t-c-sup-fee-ship)/t)*100).toFixed(0)}%</b></div></div></div>
    ${o[7]==='refund' ? `<p class="bpn-w"><b>The ${money(t)} refund is waiting on Dana Ruiz.</b> Refunds over $50.00 need a second person. It goes back the way they paid, ${PAY[o[5]]}.</p>` : ''}</div>
    <div class="pn-ft">${o[7]==='paid' && STAFF() ? `<button class="btn" data-sclose>Close</button><button class="btn p" data-spacked="${o[0]}">Mark packed</button>` : `<button class="btn" data-sclose>Close</button>`}</div>`;
}

/* ══ render + events ═══════════════════════════════════════════════════════════════════════════════════════════ */
function render(){
  document.querySelectorAll('.gtabs [data-stab]').forEach(b=>b.setAttribute('aria-current', b.dataset.stab===SP.tab?'page':'false'));
  document.getElementById('sw').classList.toggle('ro', !STAFF());
  renderHdr();
  ({overview:renderOverview, products:renderProducts, materials:renderMaterials, inventory:renderInventory, orders:renderOrders})[SP.tab]();
  renderPanel();
}
const closeS = () => { SP.panel = null; SP.draft = null; SP.buy = null; SP.mk = null; };
document.addEventListener('click', e => {
  if (e.target.id==='sscrim'){ closeS(); return render(); }
  const t = e.target.closest('button,a,[data-stab],[data-sopen]'); if (!t) return; const d = t.dataset;
  if (d.stab){ SP.tab = d.stab; closeS(); render(); window.scrollTo({top:0}); return; }
  if (d.sopen){ if (SP.panel!==d.sopen){ SP.draft = null; SP.buy = null; } SP.panel = d.sopen; return render(); }
  if (d.sclose!==undefined){ closeS(); return render(); }
  if (d.spf){ SP.pf = d.spf; return render(); }
  if (d.smf){ SP.mf = d.smf; return render(); }
  if (d.sof){ SP.of = d.sof; return render(); }
  if (d.smode){ const dr = SP.draft; if (d.smode==='flat' && dr.mode==='recipe') dr.flat = draftCost(); dr.mode = d.smode; return renderPanel(); }
  if (d.srm){ SP.draft.recipe.splice(+d.srm,1); return renderPanel(); }
  if (d.saddm!==undefined){ const v = document.getElementById('saddsel').value; if (!v) return toast('Pick a material first'); SP.draft.recipe.push([v,1]); return renderPanel(); }
  if (d.snewm!==undefined) return toast('Opens a new material: name, kind, supplier, unit and cost. It’s saved to the library for every product');
  if (d.starget!==undefined){ SP.draft.price = Math.ceil(priceFor(draftCost(),TARGET)); return refreshProd(); }
  if (d.ssave){ const p = PRO[d.ssave], dr = SP.draft; if (dr.mode==='recipe'){ p.recipe = dr.recipe.map(r=>[...r]); delete p.flat; delete p.est; } else { p.flat = dr.flat; p.est = dr.est; delete p.recipe; }
    const changed = p.price!==dr.price; p.price = dr.price; closeS(); render(); return toast(`Saved · ${shortN(p)} costs ${money(costOf(p))}${changed?` · new price ${money(p.price)} shows in the shop`:''} · logged in Records`); }
  if (d.sapply){ const i = INP[d.sapply], pid = document.getElementById('sapplyp').value, q = parseFloat(document.getElementById('sapplyq').value)||1, p = PRO[pid];
    p.recipe.push([i.id,q]); renderPanel(); render(); return toast(`Added to ${shortN(p)} · it now costs ${money(costOf(p))}`); }
  if (d.sbuy){ const i = INP[d.sbuy], b = SP.buy, per = parseFloat(b.per)||0, u = parseFloat(b.units)||0;
    if (i.kind==='mto'){ CHANGES.unshift([NOW,i.id,i.avg,per,'Updated by hand']); i.avg = per; i.last = per; closeS(); render(); return toast(`${i.n} is now ${money(per)} · every product using it updates`); }
    if (!u || !per) return toast('Enter what you paid and how many, or a cost each');
    const was = i.avg; i.avg = (i.avg*i.hand + u*per)/(i.hand + u); i.hand += u; i.last = per; (i.buys ||= []).push([NOW,u,u*per]); if (Math.abs(per-was)>.005) CHANGES.unshift([NOW,i.id,was,per,'Recorded a buy']);
    closeS(); render(); return toast(`Recorded · ${u} ${i.unit}s at ${money(per)} · average now ${money(i.avg)}${u*per>250?' · the payment needs a second person in Money':''}`); }
  if (d.sorder){ const i = INP[d.sorder], s = SUP[i.sup], q = Math.max(s.breaks[0][0], 24); return toast(`Order ${q} from ${s.n} · ${money(q*i.last)} · ${q*i.last>250 ? 'waits on Dana Ruiz in Money' : 'goes out now'} · lands in about ${s.lead} days`); }
  if (d.smake){ SP.mk = null; SP.panel = 'mk:'+d.smake; return render(); }
  if (d.smakego!==undefined){ const k = SP.mk, p = PRO[k.pid], n = k.q.reduce((a,b)=>a+(+b||0),0);
    p.recipe.forEach(([id,q])=>{ const i = INP[id]; if (i.kind==='stock') i.hand -= q*n; });
    if (STK[p.id]){ STK[p.id][k.col] ||= SIZES.map(()=>0); k.q.forEach((v,ix)=>{ STK[p.id][k.col][ix] += (+v||0); }); }
    BATCHES.unshift(['B-0'+(18+BATCHES.length-6), p.id, k.col==='One size'?'':k.col, n, NOW, costOf(p,'M',k.col), 'done']);
    closeS(); SP.tab = 'inventory'; render(); return toast(`Made ${n} × ${shortN(p)} · materials used, stock added · logged in Records`); }
  if (d.spacked){ ORDERS.find(o=>o[0]===d.spacked)[7] = 'packed'; closeS(); render(); return toast(`#${d.spacked} packed · the label prints next`); }
  if (d.spack!==undefined) return toast('Sends the labels to the thermal printer');
  if (d.sgo) return toast(`Goes to ${d.sgo.split(':')[1]==='mesa'?'Mesa Laundry':'Redlands Tire & Lube'} in Merchants`);
  if (d.sadd!==undefined) return toast('Starts a draft product: name, line, colours and sizes, then its materials and price');
});
document.addEventListener('input', e => {
  const t = e.target, d = t.dataset; if (!SP.panel) return;
  const v = parseFloat(t.value), dr = SP.draft;
  if (d.sam!==undefined){ const r = dr.recipe[+d.sam]; r[1] = isNaN(v) ? 0 : v; const o = document.getElementById('slc'+d.sam); if (o) o.value = fx(r[1]*INP[r[0]].avg); return refreshProd(); }
  if (d.slc!==undefined){ const r = dr.recipe[+d.slc], a = INP[r[0]].avg; r[1] = isNaN(v) ? 0 : Math.round(v/a*1000)/1000; const o = document.getElementById('sam'+d.slc); if (o) o.value = r[1]; return refreshProd(); }
  if (d.sflat!==undefined){ dr.flat = isNaN(v) ? 0 : v; return refreshProd(); }
  if (d.sprice!==undefined){ dr.price = isNaN(v) ? 0 : v; return refreshProd('sprice'); }
  if (d.smarg!==undefined){ if (!isNaN(v) && v<100) dr.price = Math.round(priceFor(draftCost(), v/100)*100)/100; return refreshProd('smarg'); }
  if (d.bpaid!==undefined){ SP.buy.paid = t.value; return refreshBuy('bpaid'); }
  if (d.bunits!==undefined){ SP.buy.units = t.value; return refreshBuy('bunits'); }
  if (d.bper!==undefined){ SP.buy.per = t.value; return refreshBuy('bper'); }
  if (d.mkq!==undefined){ SP.mk.q[+d.mkq] = t.value; return refreshMake(); }
});
document.addEventListener('change', e => {
  const t = e.target; if (!SP.panel) return;
  if (t.id==='sest'){ SP.draft.est = t.checked; return refreshProd(); }
  if (t.id==='mkp'){ SP.mk = null; SP.panel = 'mk:'+t.value; return renderPanel(); }
  if (t.id==='mkc'){ SP.mk.col = t.value; return refreshMake(); }
});
document.addEventListener('keydown', e => { if (e.key==='Escape' && SP.panel){ closeS(); render(); } });
const hs = location.hash.slice(1).split(',');
['overview','products','materials','inventory','orders'].forEach(t=>{ if (hs.includes(t)) SP.tab = t; });
if (hs.includes('viewer')) SP.me = 'viewer';
if (hs.includes('dark')) document.documentElement.dataset.theme = 'dark';
hs.filter(h=>/^(p|m|s|b|o|mk)-/.test(h)).forEach(h=>{ SP.panel = h.replace('-',':'); });
render();

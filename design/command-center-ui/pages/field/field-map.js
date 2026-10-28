
/* ══ Field maps: real streets, the full detail of OpenFreeMap's Positron, recoloured into the Command Center's palette ══
   Positron is the same detailed street style the Merchants corridor map uses. We fetch it, keep every layer, and remap each
   colour by how light or dark it is: Positron's background becomes our ground, anything darker leans toward our ink,
   anything lighter (road fills, halos) toward our raised tone. Parks take our land green, water a trace of our blue.
   So the hierarchy and detail stay, and it sits in the page like it belongs. Light and dark themes both work.
   Each slot keeps one live map for the session; renders re-attach it and update pins and lines without reloading tiles.
   Route lines follow real streets (OSRM); if routing can't be reached they fall back to straight legs. */
const ML_JS = 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js', ML_CSS = 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css';
const ML_STYLE = 'https://tiles.openfreemap.org/styles/positron';
const OSRM = 'https://router.project-osrm.org/route/v1/driving/';
const FM = { slots:{}, specs:{}, lib:null, raw:null, routes:{} };
function fmLib(){
  if (FM.lib) return FM.lib;
  FM.lib = new Promise((ok, no) => { if (window.maplibregl) return ok();
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = ML_CSS; document.head.appendChild(css);
    const sc = document.createElement('script'); sc.src = ML_JS; sc.onload = () => ok(); sc.onerror = no; document.head.appendChild(sc);
    setTimeout(() => window.maplibregl ? ok() : no(), 12000); })
    .then(() => FM.raw || fetch(ML_STYLE).then(r => { if (!r.ok) throw 0; return r.json(); }).then(j => { FM.raw = j; }));
  return FM.lib;
}

/* ── colour remapping ── */
const fmTok = () => { const cs = getComputedStyle(document.documentElement), rgb = v => { const s = cs.getPropertyValue(v).trim();
    if (s.startsWith('#')){ const h = s.length===4 ? s.slice(1).split('').map(c=>c+c).join('') : s.slice(1, 7); return [0,2,4].map(i=>parseInt(h.slice(i,i+2),16)); }
    const m = s.match(/[\d.]+/g); return m ? m.slice(0,3).map(Number) : [0,0,0]; };
  return { fg:rgb('--fg'), ground:rgb('--ground'), raised:rgb('--raised'), land:rgb('--land'), live:rgb('--live'), dark: document.documentElement.dataset.theme==='dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches) }; };
const mixc = (a, b, t) => a.map((v,i)=>v*t + b[i]*(1-t));
const rgbs = (c, a=1) => `rgba(${c.map(v=>Math.round(Math.max(0,Math.min(255,v)))).join(',')},${+a.toFixed(3)})`;
function parseCol(s){ // #rgb, #rrggbb, rgb(a), hsl(a) → [r,g,b,a] or null
  s = s.trim(); let m;
  if ((m = s.match(/^#([0-9a-f]{3,8})$/i))){ let h = m[1]; if (h.length<6) h = h.split('').map(c=>c+c).join(''); return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16), h.length>=8 ? parseInt(h.slice(6,8),16)/255 : 1]; }
  if ((m = s.match(/^rgba?\(([^)]+)\)$/i))){ const p = m[1].split(',').map(x=>parseFloat(x)); return [p[0],p[1],p[2], p[3]==null ? 1 : p[3]]; }
  if ((m = s.match(/^hsla?\(([^)]+)\)$/i))){ const p = m[1].split(',').map(x=>parseFloat(x)); const h = p[0]/360, sa = p[1]/100, l = p[2]/100;
    const q = l < .5 ? l*(1+sa) : l+sa-l*sa, pp = 2*l-q, f = t => { t = (t+1)%1; return t<1/6 ? pp+(q-pp)*6*t : t<1/2 ? q : t<2/3 ? pp+(q-pp)*(2/3-t)*6 : pp; };
    return [f(h+1/3)*255, f(h)*255, f(h-1/3)*255, p[3]==null ? 1 : p[3]]; }
  return null;
}
function fmRemap(raw, T){
  const LBG = .945; // Positron's background lightness
  const lum = c => (0.2126*c[0] + 0.7152*c[1] + 0.0722*c[2]) / 255;
  const conv = (s, hint) => { const c = parseCol(s); if (!c) return s; const L = lum(c);
    if (hint==='water') return rgbs(mixc(T.live, T.ground, T.dark ? .22 : .14), c[3]);
    if (hint==='park') return rgbs(mixc(T.land, T.ground, T.dark ? .22 : .16), c[3]);
    if (L >= LBG) return rgbs(mixc(T.raised, T.ground, Math.min(1, (L-LBG)/(1-LBG)) * (T.dark ? .8 : 1.6)), c[3]);
    const t = Math.min(1, Math.pow((LBG - L)/LBG, .85) * 1.12); return rgbs(mixc(T.fg, T.ground, t), c[3]); };
  const walk = (v, hint) => typeof v === 'string' ? conv(v, hint) : Array.isArray(v) ? v.map(x=>walk(x, hint)) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k,x])=>[k, walk(x, hint)])) : v;
  const st = JSON.parse(JSON.stringify(raw));
  st.layers = st.layers.filter(l => !/^label_country|^label_state|boundary_disputed|ne2_shaded/.test(l.id) && l.source !== 'ne2_shaded').map(l => {
    const hint = /water/.test(l.id) && l.type!=='symbol' ? 'water' : /^park|landcover_wood|landcover_grass/.test(l.id) ? 'park' : null;
    if (l.paint) l.paint = walk(l.paint, hint);
    if (l.type==='symbol' && l.layout && /^label_(city|town|village|other)/.test(l.id)) l.layout = Object.assign({}, l.layout, { 'text-transform':'uppercase', 'text-letter-spacing':.12 });
    return l; });
  delete st.sources.ne2_shaded;
  return st;
}
function fmStyle(){ return fmRemap(FM.raw, fmTok()); }

/* ── our layers: the route, cased so it reads over streets ── */
function fmRouteLayers(){ const T = fmTok(), fg = rgbs(T.fg), gr = rgbs(T.ground);
  return [
    { id:'route-case', type:'line', source:'route', layout:{'line-cap':'round','line-join':'round'}, paint:{'line-color':gr, 'line-width':['interpolate',['linear'],['zoom'],9,6,15,10], 'line-opacity':.9} },
    { id:'route-next', type:'line', source:'route', filter:['==',['get','k'],'next'], layout:{'line-cap':'butt','line-join':'round'}, paint:{'line-color':fg, 'line-width':['interpolate',['linear'],['zoom'],9,2.4,15,4], 'line-dasharray':[1.6,1.4], 'line-opacity':.75} },
    { id:'route-done', type:'line', source:'route', filter:['==',['get','k'],'done'], layout:{'line-cap':'round','line-join':'round'}, paint:{'line-color':fg, 'line-width':['interpolate',['linear'],['zoom'],9,3,15,5]} } ];
}
/* legs: road-following geometry when we have it, straight lines until then */
const fmKey = pts => pts.map(p=>p.map(v=>v.toFixed(4)).join(',')).join(';');
function fmRouteGeo(spec){
  const pts = spec.route || []; if (pts.length < 2) return { type:'FeatureCollection', features:[] };
  const legs = FM.routes[fmKey(pts)] || pts.slice(1).map((p,i)=>[pts[i], p]);
  return { type:'FeatureCollection', features: legs.map((coords,i)=>({ type:'Feature', properties:{ k: i < (spec.done||0) ? 'done' : 'next' }, geometry:{ type:'LineString', coordinates:coords } })) };
}
function fmRoute(slot){
  const spec = FM.specs[slot], pts = spec && spec.route; if (!pts || pts.length < 2) return; const key = fmKey(pts);
  if (FM.routes[key] || FM.routes[key+'?']) return; FM.routes[key+'?'] = 1;
  fetch(`${OSRM}${pts.map(p=>p.join(',')).join(';')}?overview=full&geometries=geojson`).then(r=>r.json()).then(j => {
    if (!j.routes || !j.routes[0]) return; const line = j.routes[0].geometry.coordinates, wp = j.waypoints.map(w=>w.location);
    // split the whole line at each waypoint (walking forward), so each leg can be coloured done or next
    const near = (from, p) => { let bi = from, bd = 1e9; for (let i=from; i<line.length; i++){ const d = (line[i][0]-p[0])**2 + (line[i][1]-p[1])**2; if (d < bd){ bd = d; bi = i; } } return bi; };
    const cut = [0]; for (let i=1; i<wp.length-1; i++) cut.push(near(cut[cut.length-1], wp[i])); cut.push(line.length-1);
    FM.routes[key] = cut.slice(1).map((c,i)=>line.slice(cut[i], c+1));
    Object.keys(FM.slots).forEach(s => { const sp = FM.specs[s]; if (sp && sp.route && fmKey(sp.route)===key) fmApply(s); });
  }).catch(()=>{});
}
function fmApply(slot){
  const s = FM.slots[slot], spec = FM.specs[slot]; if (!s || !s.map || !s.ok || !spec) return;
  const style = s.map.getStyle(); if (!style.sources.route) s.map.addSource('route', { type:'geojson', data:fmRouteGeo(spec) }); else s.map.getSource('route').setData(fmRouteGeo(spec));
  if (!style.layers.find(l=>l.id==='route-case')) fmRouteLayers().forEach(l=>s.map.addLayer(l));
  fmRoute(slot);
  (s.marks||[]).forEach(m=>m.remove()); s.marks = (spec.pins||[]).map(p => { const el = document.createElement('div'); el.innerHTML = p.html; const node = el.firstElementChild;
    return new maplibregl.Marker({ element:node, anchor:'center' }).setLngLat(p.ll).addTo(s.map); });
  s.marks.forEach(m => { const e = m.getElement(); if (e.classList.contains('fsp')) e.style.zIndex = e.classList.contains('now') ? 3 : e.classList.contains('done') ? 1 : 2; });
  fmLayoutLive(slot);
  const key = JSON.stringify(spec.bounds);
  if (key !== s.boundsKey){ s.boundsKey = key; s.map.fitBounds(spec.bounds, { padding:spec.pad || 40, duration: s.fitted ? 500 : 0, maxZoom:14 }); s.fitted = true; }
}
/* ── stop tags: place each tag near its dot without covering another tag or any dot ──
   anchors and sizes in px; returns each tag's centre offset from its dot. Works the same on the drawn and the live map. */
function fmPlaceTags(anchors, sizes, W, H, prefer){
  const n = anchors.length, D = 16;
  // start each tag pointing away from its close neighbours, so a tight cluster fans out instead of stacking
  const pos = anchors.map((a,i)=>{ const nb = anchors.filter((b,j)=>j!==i && Math.hypot(b[0]-a[0], b[1]-a[1]) < 60);
    let dx = 0, dy = -1; if (nb.length){ const cx = nb.reduce((s,b)=>s+b[0],0)/nb.length, cy = nb.reduce((s,b)=>s+b[1],0)/nb.length; dx = a[0]-cx; dy = a[1]-cy; const d = Math.hypot(dx,dy); if (d < .5){ dx = Math.cos(i*2.4); dy = Math.sin(i*2.4); } else { dx /= d; dy /= d; } }
    return [a[0] + dx*(D+sizes[i][0]/2), a[1] + dy*(D+sizes[i][1]/2)]; });
  const hw = i => sizes[i][0]/2 + 3, hh = i => sizes[i][1]/2 + 3;
  for (let it=0; it<140; it++){
    for (let i=0;i<n;i++){ // spring back toward a spot just off the dot, in whatever direction the tag has been pushed
      let dx = pos[i][0]-anchors[i][0], dy = pos[i][1]-anchors[i][1], d = Math.hypot(dx,dy); if (d < .1){ dx = 0; dy = -1; d = 1; }
      const want = D + Math.max(sizes[i][1]/2, Math.abs(dx/d)*sizes[i][0]/2) - 4, k = .12;
      pos[i][0] += (anchors[i][0] + dx/d*want - pos[i][0]) * k; pos[i][1] += (anchors[i][1] + dy/d*want - pos[i][1]) * k; }
    for (let i=0;i<n;i++) for (let j=i+1;j<n;j++){ // tags push each other apart
      const ox = hw(i)+hw(j) - Math.abs(pos[i][0]-pos[j][0]), oy = hh(i)+hh(j) - Math.abs(pos[i][1]-pos[j][1]);
      if (ox > 0 && oy > 0){ if (ox < oy){ const s = (pos[i][0] < pos[j][0] ? -1 : 1) * ox/2; pos[i][0] += s; pos[j][0] -= s; } else { const s = (pos[i][1] < pos[j][1] ? -1 : 1) * oy/2; pos[i][1] += s; pos[j][1] -= s; } } }
    for (let i=0;i<n;i++) for (let k=0;k<n;k++){ // and never sit on a dot
      const ox = hw(i)+5 - Math.abs(pos[i][0]-anchors[k][0]), oy = hh(i)+5 - Math.abs(pos[i][1]-anchors[k][1]);
      if (ox > 0 && oy > 0){ if (ox < oy) pos[i][0] += (pos[i][0] < anchors[k][0] ? -1 : 1) * ox; else pos[i][1] += (pos[i][1] < anchors[k][1] ? -1 : 1) * oy; } }
    for (let i=0;i<n;i++){ pos[i][0] = Math.max(hw(i)+2, Math.min(W-hw(i)-2, pos[i][0])); pos[i][1] = Math.max(hh(i)+2, Math.min(H-hh(i)-2, pos[i][1])); } }
  return pos.map((p,i)=>[p[0]-anchors[i][0], p[1]-anchors[i][1]]);
}
function fmSetTags(els, offs){
  els.forEach((el,i)=>{ const [dx,dy] = offs[i], t = el.querySelector('.fsp-t'), ln = el.querySelector('line');
    t.style.transform = `translate(calc(-50% + ${dx.toFixed(1)}px), calc(-50% + ${dy.toFixed(1)}px))`;
    // the leader runs from the dot to the nearest edge of the tag
    const w = t.offsetWidth/2, h = t.offsetHeight/2, s = Math.min(w/Math.abs(dx||1e-6), h/Math.abs(dy||1e-6), 1), ex = dx - dx*s, ey = dy - dy*s;
    ln.setAttribute('x2', ex.toFixed(1)); ln.setAttribute('y2', ey.toFixed(1)); el.classList.toggle('near', Math.hypot(ex,ey) < 5); });
}
function fmLayoutDrawn(){ document.querySelectorAll('.fm-fb .fmw').forEach(box => { const els = [...box.querySelectorAll('.fsp')]; if (!els.length) return;
  const W = box.clientWidth, H = box.clientHeight; if (!W) return;
  const anchors = els.map(e=>[parseFloat(e.style.left)/100*W, parseFloat(e.style.top)/100*H]), sizes = els.map(e=>{ const t = e.querySelector('.fsp-t'); return [t.offsetWidth, t.offsetHeight]; });
  fmSetTags(els, fmPlaceTags(anchors, sizes, W, H)); }); }
function fmLayoutLive(slot){ const s = FM.slots[slot]; if (!s || !s.map || !s.marks || !s.marks.length) return;
  const els = s.marks.map(m=>m.getElement()).filter(e=>e.classList.contains('fsp')); if (!els.length) return;
  const W = s.el.clientWidth, H = s.el.clientHeight, anchors = s.marks.map(m=>{ const p = s.map.project(m.getLngLat()); return [p.x, p.y]; });
  fmSetTags(els, fmPlaceTags(anchors, els.map(e=>{ const t = e.querySelector('.fsp-t'); return [t.offsetWidth, t.offsetHeight]; }), W, H)); }
/* stops a few streets apart sit on top of each other when zoomed out: nudge their pins apart on screen, never on the map */
function fmSpread(slot){ const s = FM.slots[slot]; if (!s || !s.map || !s.marks || !s.marks.length) return;
  const pts = s.marks.map(m=>s.map.project(m.getLngLat())), off = pts.map(()=>[0,0]);
  for (let it=0; it<24; it++) for (let i=0;i<pts.length;i++) for (let j=i+1;j<pts.length;j++){
    const dx = pts[j].x+off[j][0]-pts[i].x-off[i][0], dy = pts[j].y+off[j][1]-pts[i].y-off[i][1], d = Math.hypot(dx,dy) || .01;
    if (d < 30){ const k = (30-d)/2/d; off[i][0] -= dx*k; off[i][1] -= dy*k; off[j][0] += dx*k; off[j][1] += dy*k; } }
  s.marks.forEach((m,i)=>{ m.setOffset(off[i]); m.getElement().classList.toggle('moved', Math.hypot(...off[i]) > 4); }); }
/* a name label near the right edge would be cut off: put it on the left instead */
function fmFlip(slot){ const s = FM.slots[slot]; if (!s || !s.map || !s.marks) return; const w = s.el.clientWidth;
  s.marks.forEach(m=>{ const x = s.map.project(m.getLngLat()).x + (m.getOffset().x||0); m.getElement().querySelector('.fpin')?.classList.toggle('flip', x > w - 190); }); }
function fmInit(slot){
  const s = FM.slots[slot], spec = FM.specs[slot];
  if (!window.maplibregl || !FM.raw){ return fmFail(slot); }
  let tiles = false, errs = 0;
  try { s.map = new maplibregl.Map({ container:s.el, style:fmStyle(), bounds:spec.bounds, fitBoundsOptions:{ padding:spec.pad || 40, maxZoom:14 },
    attributionControl:{ compact:true }, scrollZoom:false, dragRotate:false, pitchWithRotate:false, cooperativeGestures:matchMedia('(max-width:760px)').matches }); }
  catch(e){ return fmFail(slot); }
  s.boundsKey = JSON.stringify(spec.bounds); s.fitted = true;
  s.map.touchZoomRotate.disableRotation();
  s.map.addControl(new maplibregl.NavigationControl({ showCompass:false }), 'top-right');
  const live = () => { if (s.live || s.fail) return; s.live = true; const h = document.querySelector(`[data-fmslot="${slot}"]`); h && h.classList.add('live'); s.map.resize(); };
  s.map.on('data', e => { if (e.dataType==='source' && e.tile){ tiles = true; if (s.ok) live(); } });
  s.map.on('error', () => { errs++; if (!tiles && errs >= 4) fmFail(slot); });
  s.map.on('load', () => { s.ok = true; fmApply(slot); if (tiles) live(); });
  let raf = 0; s.map.on('move', () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => fmLayoutLive(slot)); });
  setTimeout(() => { if (!tiles) fmFail(slot); }, 10000);
}
function fmFail(slot){ const s = FM.slots[slot]; if (!s) return; s.fail = true; s.live = false; try { s.map && s.map.remove(); } catch(e){} s.map = null;
  const h = document.querySelector(`[data-fmslot="${slot}"]`); h && h.classList.remove('live'); }
/* called after every render: put each slot's live map back in place and update it */
function fmMountAll(){
  document.querySelectorAll('[data-fmslot]').forEach(host => { const slot = host.dataset.fmslot; let s = FM.slots[slot];
    if (!s){ s = FM.slots[slot] = { el:document.createElement('div') }; s.el.className = 'fm-gl'; fmLib().then(() => fmInit(slot), () => fmFail(slot)); }
    if (s.fail) return;
    host.querySelector('.fm-slot').appendChild(s.el);
    if (s.live) host.classList.add('live');
    if (s.map){ s.map.resize(); fmApply(slot); } });
}
/* a map slot: the drawn map shows until the live one is ready, then hides */
const fmSlot = (slot, spec, fallback, cls='') => { FM.specs[slot] = spec; return `<div class="fmh ${cls}" data-fmslot="${slot}"><div class="fm-fb">${fallback}</div><div class="fm-slot"></div></div>`; };
/* theme change: rebuild the colours on every live map */
function fmRestyle(){ Object.entries(FM.slots).forEach(([slot, s]) => { if (!s.map || !s.ok || !FM.raw) return; s.map.setStyle(fmStyle()); s.map.once('styledata', () => fmApply(slot)); }); }

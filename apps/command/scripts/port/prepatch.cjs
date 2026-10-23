// Rewrites the few prototype templates that aren't well-formed fragments on their own.
const fs = require('fs');
const [, , IN, OUT] = process.argv;
let s = fs.readFileSync(IN, 'utf8');
const rep = (a, b) => { if (!s.includes(a)) throw new Error('missing: ' + a.slice(0, 80)); s = s.split(a).join(b); };

rep(`'<span style="color:var(--underway)">'+money(M.short)+'</span>'`, '`<span style="color:var(--underway)">${money(M.short)}</span>`');
rep(`'<span class="mono">#'+(48210+LOG.indexOf(l))+' · sealed</span>'`, '`<span class="mono">#${48210+LOG.indexOf(l)} · sealed</span>`');
rep(`'<span class="mono">9400 1118 …42'+id.slice(2)+'</span>'`, '`<span class="mono">9400 1118 …42${id.slice(2)}</span>`');
rep(
  "`<div class=\"ablock\"><span class=\"lbl\">Signatures a week · Sep – Oct</span>${signerHeat()}</div><div class=\"ablock\"><span class=\"lbl\">Waiting on each</span>`\n    + evRows(",
  "`<div class=\"ablock\"><span class=\"lbl\">Signatures a week · Sep – Oct</span>${signerHeat()}</div><div class=\"ablock\"><span class=\"lbl\">Waiting on each</span>${evRows(",
);
rep("[k,n,w,c,m]))\n    + `</div>`, strip(", "[k,n,w,c,m]))}</div>`, strip(");
rep(`return '<div class="vc">' + chart(`, 'return `<div class="vc">${chart(');
rep(`notes:[{x:px(qi,days), t:'Quorum'}]}) + '</div>'`, "notes:[{x:px(qi,days), t:'Quorum'}]})}</div>`");
rep(
  '`<${e.attr?\'button type="button"\':\'span\'} class="gev ${e.kind}" ${e.attr} title="${e.n} · ${e.s}"><i style="${mark(e)}"></i><span><b>${e.n}</b><em>${e.s}</em></span></${e.attr?\'button\':\'span\'}>`',
  '(e.attr ? `<button type="button" class="gev ${e.kind}" ${e.attr} title="${e.n} · ${e.s}"><i style="${mark(e)}"></i><span><b>${e.n}</b><em>${e.s}</em></span></button>` : `<span class="gev ${e.kind}" ${e.attr} title="${e.n} · ${e.s}"><i style="${mark(e)}"></i><span><b>${e.n}</b><em>${e.s}</em></span></span>`)',
);
rep('  h += nowPanel(waiting);\n  h += numbers(waiting.length === 0, alerts);', '  h = h + nowPanel(waiting) + numbers(waiting.length === 0, alerts);');
rep('    rows += `<button type="button" class="ln-r agg"', '    rows = rows + `<button type="button" class="ln-r agg"');
rep("let h = '';\n  for (let i=0;i<n;i++){ const f = i/n; h += `<i", "let h = [];\n  for (let i=0;i<n;i++){ const f = i/n; h.push(`<i");
rep("f<cut[2]?'c':''}\"></i>`; }", "f<cut[2]?'c':''}\"></i>`); }");
fs.writeFileSync(OUT, s);
// string edits on finished markup become parameters
{
  let t2 = fs.readFileSync(OUT, 'utf8');
  const r2 = (a, b) => { if (!t2.includes(a)) throw new Error('missing: ' + a.slice(0, 80)); t2 = t2.split(a).join(b); };
  r2('const gCell = (cls, label, tag, fig, body, foot, state) =>', 'const gCell = (cls, label, tag, fig, body, foot, state, bodyCls) =>');
  r2('<div class="c-fig">${fig||\'\'}</div><div class="c-body">${body}</div>${foot||\'<div></div>\'}</section>`;', '<div class="c-fig">${fig||\'\'}</div><div class="c-body${bodyCls||\'\'}">${body}</div>${foot||\'<div></div>\'}</section>`;');
  r2(")).replace('class=\"c-body\"','class=\"c-body start\"')", "), undefined, ' start')");
  r2('function miniSpark(seed, total, n=14, w=96, h=24){', "function miniSpark(seed, total, n=14, w=96, h=24, cls='tspark'){");
  t2 = t2.replace(/(function miniSpark\(seed[\s\S]*?)<svg class="tspark"/, '$1<svg class="${cls}"');
  r2(".replace('class=\"tspark\"','class=\"tspark wide\"')", '');
  r2('miniSpark(p.n, p.scans, 30, 480, 64)}', "miniSpark(p.n, p.scans, 30, 480, 64, 'tspark wide')}");
  r2('const areaKey = () => `<div class="mkey wg-key"><span class="wg-kk"><i class="sw wt-sw"></i>Darker is busier · select a day</span><span class="rule"></span>${',
     'const areaKey = (bare) => `<div class="mkey wg-key">${bare ? \'\' : `<span class="wg-kk"><i class="sw wt-sw"></i>Darker is busier · select a day</span><span class="rule"></span>`}${');
  r2("areaKey().replace(/<span class=\"wg-kk\">[\\s\\S]*?<span class=\"rule\"><\\/span>/,'')", 'areaKey(true)');
  r2("fund.replace('cell s-5','cell s-4 wt')", "swapClass(fund, 'cell s-5', 'cell s-4 wt')");
  r2("appr.replace('cell s-4 wt','cell s-5')", "swapClass(appr, 'cell s-4 wt', 'cell s-5')");
  fs.writeFileSync(OUT, t2);
}

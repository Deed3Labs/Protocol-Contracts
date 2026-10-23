// After convert.cjs: header, html() bridge, keys, formatting, then the hand fixes. Re-runnable from scratch.
const fs = require('fs');
const { execSync } = require('child_process');
const DIR = process.argv[2];
const run = (cmd) => execSync(cmd, { stdio: 'inherit', env: process.env });
const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.tsx'));
for (const f of files) {
  const p = `${DIR}/${f}`; let s = fs.readFileSync(p, 'utf8');
  const used = ['attrs', 'css', 'swapClass'].filter((n) => new RegExp(`\\b${n}\\(`).test(s));
  s = `// @ts-nocheck: generated from the prototype's templates (see docs/command-reference/DECISIONS.md). Typed when Phase 3 puts API rows behind it.\n${used.length ? `import { ${used.join(', ')} } from '../runtime/dom';\n` : ''}${s}`;
  fs.writeFileSync(p, s);
}
const here = __dirname;
const prettier = () => run(`${process.execPath} ${require.resolve('prettier/bin/prettier.cjs')} --parser babel-ts --single-quote --print-width 160 --log-level warn --write ${files.map((f) => DIR + '/' + f).join(' ')}`);
run(`${process.execPath} ${here}/innerhtml.cjs ${files.map((f) => `${DIR}/${f}`).join(' ')}`);
run(`${process.execPath} ${here}/keys.cjs ${files.map((f) => `${DIR}/${f}`).join(' ')}`);
prettier();

const ed = (f, a, b) => { const p = `${DIR}/${f}`; let s = fs.readFileSync(p, 'utf8'); if (!s.includes(a)) throw new Error(`${f}: missing ${a.slice(0, 70)}`); s = s.replace(a, b); fs.writeFileSync(p, s); };
const edRe = (f, re, b) => { const p = `${DIR}/${f}`; let s = fs.readFileSync(p, 'utf8'); if (!re.test(s)) throw new Error(`${f}: no match ${re}`); s = s.replace(re, b); fs.writeFileSync(p, s); };

// the prototype declares spark() twice; the second (growth's) is the one every page used
edRe('core.tsx', /\nexport function spark\(vals, emph, prev\) \{[\s\S]*?\n\}\n/, '\n');

// sign-in: the resend label is redrawn every second, the brand mark is a component, and start-up reads the address
ed('signin.tsx', "{document.querySelector('.brand svg').outerHTML}", '<BrandMark />');
edRe('signin.tsx', /^(\/\/ @ts-nocheck[^\n]*\n)/, "$1import { BrandMark } from '../App';\n");
ed('data.tsx', "export const start = (location.hash || '').slice(1);\n", '');
edRe('startup.tsx', /\n  start,(?=\n)/, '');
ed('startup.tsx', "  go(NAMES[start] ? start : 'home');", `  html(
    document.querySelector('.who-n'),
    <>
      <b style={css('font-weight:600')}>Kai</b> <span className="quiet">· Admin</span>
    </>,
  );
  const start = (location.hash || '').slice(1);
  go(NAMES[start] ? start : 'home');`);

// modals: title, body and foot are their own roots, so a flow can redraw one of them
ed('shell.tsx', `          <span className="sub" id="mt">
            {title}
          </span>`, '          <span className="sub" id="mt" />');
ed('shell.tsx', `        <div className="m-mn">{body}</div>
        <footer className="m-ft">{foot}</footer>
      </div>
    </div>,
  );`, `        <div className="m-mn" />
        <footer className="m-ft" />
      </div>
    </div>,
  );
  html($('#mt'), title);
  html($('.m-mn'), body);
  html($('.m-ft'), foot);`);
edRe('shell.tsx', /t\.textContent = (w\.mode === 'approve' \? 'Working' : 'Handing off');/, 'html(t, $1);');
edRe('shell.tsx', /t\.textContent = (w\.mode === 'approve' \? 'Done' : 'Handed off');/, 'html(t, $1);');
ed('kit.tsx', "$('#mt').textContent = title;", "html($('#mt'), title);");

// the board's side panel redraws in place
ed('merchants.tsx', `      <aside className="pane kce" role="dialog" aria-label={isNew ? 'New prospect' : 'Shop on the board'}>
        {kcHtml()}
      </aside>
    </>,
  );`, `      {/* Empty here and drawn as its own root, so kcDraw can redraw it in place. */}
      <aside className="pane kce" role="dialog" aria-label={isNew ? 'New prospect' : 'Shop on the board'} />
    </>,
  );
  html(document.querySelector('.pane.kce'), kcHtml());`);
// MapLibre from npm, loaded the first time the map shows (the prototype added a script tag from unpkg)
ed('data.tsx', "export const ML_JS = 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js';\n", '');
edRe('merchants.tsx', /export function cmLoadLib\(\) \{[\s\S]*?\n\}\n/, `export function cmLoadLib() {
  if (window.maplibregl) return Promise.resolve();
  return import('maplibre-gl').then((m) => {
    window.maplibregl = m.default ?? m;
  });
}
`);
edRe('merchants.tsx', /\n  ML_JS,/, '');

// comments the passes printed twice
for (const f of files) {
  const p = `${DIR}/${f}`; let s = fs.readFileSync(p, 'utf8');
  for (let k = 0; k < 3; k++) s = s.replace(/^(\s*\/\*[^\n]*\*\/)\n\1$/gm, '$1').replace(/^(\s*\/\/[^\n]*)\n\1$/gm, '$1');
  fs.writeFileSync(p, s);
}
// startup.tsx and data.tsx may need html/css after the edits
for (const f of ['startup.tsx']) {
  const p = `${DIR}/${f}`; let s = fs.readFileSync(p, 'utf8');
  const m = /import \{ ([^}]*) \} from '\.\.\/runtime\/dom';/.exec(s);
  const names = new Set(m ? m[1].split(',').map((x) => x.trim()) : []);
  ['html', 'css'].forEach((n) => { if (new RegExp(`\\b${n}\\(`).test(s)) names.add(n); });
  const line = `import { ${[...names].sort().join(', ')} } from '../runtime/dom';`;
  s = m ? s.replace(m[0], line) : s.replace(/^(\/\/ @ts-nocheck[^\n]*\n)/, `$1${line}\n`);
  fs.writeFileSync(p, s);
}
prettier();
console.log('post done');
// a map element left from a failed load goes, as the prototype's next innerHTML took it away
ed('merchants.tsx', `  if (vars.CMAP.el && !vars.CMAP.fail) host.querySelector('.cm-slot').appendChild(vars.CMAP.el);`, `  if (vars.CMAP.el && !vars.CMAP.fail) host.querySelector('.cm-slot').appendChild(vars.CMAP.el);
  else if (vars.CMAP.el && vars.CMAP.el.parentNode) vars.CMAP.el.remove();`);

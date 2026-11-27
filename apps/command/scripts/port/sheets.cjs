// Copies the redesign's page sheets (design/command-center-ui/command-center.html, each page's
// <template id="…-tpl"> <style>) into src/styles/pages/<id>.css, verbatim. Each page's shadow root
// adopts its chain of them (src/sections/pageHost.tsx). Run again when the reference changes:
//   node scripts/port/sheets.cjs
const fs = require('fs');
const path = require('path');

const app = path.resolve(__dirname, '../..');
const html = fs.readFileSync(path.resolve(app, '../../design/command-center-ui/command-center.html'), 'utf8');
const out = path.join(app, 'src/styles/pages');
fs.mkdirSync(out, { recursive: true });
const re = /<template id="([a-z]+)-tpl">/g;
let m;
const written = [];
while ((m = re.exec(html))) {
  const body = html.slice(m.index + m[0].length, html.indexOf('</template>', m.index));
  const css = body.slice(body.indexOf('<style>') + '<style>'.length, body.indexOf('</style>')).trim();
  fs.writeFileSync(path.join(out, `${m[1]}.css`), `/* Copied verbatim from design/command-center-ui (<template id="${m[1]}-tpl">) by scripts/port/sheets.cjs. Change the reference, then run it again. */\n${css}\n`);
  written.push(`${m[1]} ${css.length}`);
}
console.log(written.join('\n'));

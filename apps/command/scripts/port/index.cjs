// Ports docs/command-reference/clear-command-center.html into src/sections and src/styles/command.css.
// See README.md.
//   npm run port                 regenerate src/sections from the prototype
//   npm run port -- --to DIR       write somewhere else (to diff a new prototype against the port)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const app = path.resolve(__dirname, '../..');
const html = path.resolve(app, '../../docs/command-reference/clear-command-center.html');
const to = process.argv.includes('--to') ? path.resolve(process.argv[process.argv.indexOf('--to') + 1]) : path.join(app, 'src/sections');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-port-'));
const node = (script, ...args) => execFileSync(process.execPath, [path.join(__dirname, script), ...args], { stdio: 'inherit' });

// the prototype's script, without the <script> tags
const src = fs.readFileSync(html, 'utf8');
const body = src.slice(src.indexOf('<script>') + '<script>'.length, src.lastIndexOf('</script>'));
fs.writeFileSync(path.join(tmp, 'proto.js'), body.replace(/^\n/, ''));
node('prepatch.cjs', path.join(tmp, 'proto.js'), path.join(tmp, 'proto.p.js'));
node('convert.cjs', path.join(tmp, 'proto.p.js'), path.join(tmp, 'out'));
fs.mkdirSync(to, { recursive: true });
for (const f of fs.readdirSync(to)) if (f.endsWith('.tsx')) fs.rmSync(path.join(to, f));
for (const f of fs.readdirSync(path.join(tmp, 'out.d'))) fs.copyFileSync(path.join(tmp, 'out.d', f), path.join(to, f));
node('post.cjs', to);
// the stylesheet, unchanged (only when writing into the app itself)
if (!process.argv.includes('--to')) {
  const css = src.slice(src.indexOf('<style>') + '<style>'.length, src.indexOf('</style>')).replace(/^\n/, '');
  fs.writeFileSync(path.join(app, 'src/styles/command.css'), '/* Ported verbatim from docs/command-reference/clear-command-center.html by scripts/port. Change the design there first. */\n' + css);
}
fs.rmSync(tmp, { recursive: true, force: true });

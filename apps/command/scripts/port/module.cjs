// Ports one of the redesign's page modules (design/command-center-ui) to a .tsx file to finish by hand
// (docs/ui-redesign-plan.md, "Porting a page"): the module's IIFE and its template's markup are cut from
// the reference, converted to JSX (convert.cjs), and given the html() bridge and list keys. It prints the
// module's free variables (what it reads from the page around it: the CC bridge, shared data) and every
// spot the converter couldn't turn into JSX, which are the hand fixes.
// usage: node module.cjs <MODULE> <template id> <out.tsx>   e.g. node module.cjs MONEY2 n-tpl src/sections/money2.tsx
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;

const [, , NAME, TPL, OUT] = process.argv;
if (!NAME || !TPL || !OUT) throw new Error('usage: node module.cjs <MODULE> <template id> <out.tsx>');
const REF = path.resolve(__dirname, '../../../../design/command-center-ui/command-center.html');
const lines = fs.readFileSync(REF, 'utf8').split('\n');

// the module: `const NAME = (() => {` to the first `})();` at the start of a line after it that closes it
// (a module can hold IIFEs of its own written flush left, as MEMBERS2's PEOPLE is: those don't parse as the end)
const start = lines.findIndex((l) => l.startsWith(`const ${NAME} = (() => {`));
if (start < 0) throw new Error(`no module ${NAME}`);
const closes = (i) => {
  try {
    parser.parse(lines.slice(start, i + 1).join('\n'), { sourceType: 'script' });
    return true;
  } catch {
    return false;
  }
};
const end = lines.findIndex((l, i) => i > start && /^\}\)\(\);/.test(l) && closes(i));
const mod = lines.slice(start, end + 1).join('\n');

// the template's markup: everything in it after its <style>
const t0 = lines.findIndex((l) => l.startsWith(`<template id="${TPL}">`));
if (t0 < 0) throw new Error(`no template ${TPL}`);
const t1 = lines.findIndex((l, i) => i > t0 && l.includes('</template>'));
const tpl = lines.slice(t0, t1 + 1).join('\n');
const markup = tpl.slice(tpl.indexOf('</style>') + 8, tpl.lastIndexOf('</template>')).trim();

const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'port-'));
const src = `${tmp}/in.js`;
fs.writeFileSync(src, `/** The page's skeleton: the reference template's markup. */\nfunction skeleton() {\n  return \`${markup.replace(/`/g, '\\`')}\`;\n}\n${mod}\n`);

// free variables: what the module reads that it never declares
const GLOBAL = new Set(
  'window document Math Date JSON Object Array String Number Boolean Set Map WeakMap Promise setTimeout clearTimeout setInterval clearInterval requestAnimationFrame cancelAnimationFrame localStorage sessionStorage history location navigator console Intl isNaN isFinite parseInt parseFloat encodeURIComponent decodeURIComponent getComputedStyle matchMedia ResizeObserver MutationObserver IntersectionObserver HTMLElement Element Node Event CustomEvent KeyboardEvent Infinity NaN undefined Error RegExp Symbol performance URL Blob fetch alert confirm structuredClone queueMicrotask CSSStyleSheet DOMParser FileReader Image'.split(
    ' ',
  ),
);
const free = new Map();
traverse(parser.parse(fs.readFileSync(src, 'utf8'), { sourceType: 'script', errorRecovery: true }), {
  ReferencedIdentifier(p) {
    const n = p.node.name;
    if (!p.scope.hasBinding(n) && !GLOBAL.has(n)) free.set(n, (free.get(n) || 0) + 1);
  },
});
console.log(`free variables: ${[...free.entries()].sort((a, b) => b[1] - a[1]).map(([n, c]) => `${n}:${c}`).join(' ')}`);

// convert writes the whole file first; its old per-section split then fails, which doesn't matter here
const conv = `${tmp}/out`;
try {
  execFileSync(process.execPath, [`${__dirname}/convert.cjs`, src, conv], { stdio: ['ignore', 'pipe', 'pipe'] });
} catch (e) {
  const msg = String(e.stdout) + String(e.stderr);
  console.log(msg.split('\n').filter((l) => /^line \d+|html functions/.test(l)).join('\n'));
}
if (!fs.existsSync(conv)) throw new Error('the converter wrote nothing');
fs.copyFileSync(conv, OUT);
execFileSync(process.execPath, [`${__dirname}/innerhtml.cjs`, OUT], { stdio: 'inherit' });
execFileSync(process.execPath, [`${__dirname}/keys.cjs`, OUT], { stdio: 'inherit' });
const body = fs.readFileSync(OUT, 'utf8');
fs.writeFileSync(
  OUT,
  `// @ts-nocheck: ported from the redesign's ${NAME} module (design/command-center-ui) with scripts/port/module.cjs; its data is its own.\nimport { Fragment } from 'react';\nimport { attrs, css, hasHtml, html } from '../runtime/dom';\nimport { CC } from './cc';\nimport { registerPage, shadowHost } from './pageHost';\n\n${body}`,
);
// what's left for the hand: string-built markup the converter left as strings
const left = body.split('\n').flatMap((l, i) => (/\+= <|\.join\(''\)|insertAdjacentHTML|"<\/|'<\/|<span>'|\.repeat\(/.test(l) ? [`  ${i + 7}: ${l.trim().slice(0, 140)}`] : []));
console.log(`wrote ${OUT}${left.length ? `; hand fixes:\n${left.join('\n')}` : ''}`);

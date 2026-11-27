// Lists drawn with .map()/Array.from() get positional keys, which is what innerHTML gave them.
const fs = require('fs');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const generate = require('@babel/generator').default;
const t = require('@babel/types');
let total = 0;
for (const f of process.argv.slice(2)) {
  const src = fs.readFileSync(f, 'utf8');
  const ast = parser.parse(src, { sourceType: 'module', plugins: ['jsx', 'typescript'] });
  let n = 0, frag = false;
  const keyed = (el, idx) => {
    if (t.isJSXElement(el)) {
      if (el.openingElement.attributes.some((a) => t.isJSXAttribute(a) && a.name.name === 'key')) return el;
      el.openingElement.attributes.unshift(t.jsxAttribute(t.jsxIdentifier('key'), t.jsxExpressionContainer(t.identifier(idx)))); n++;
      return el;
    }
    if (t.isJSXFragment(el)) {
      frag = true; n++;
      return t.jsxElement(t.jsxOpeningElement(t.jsxIdentifier('Fragment'), [t.jsxAttribute(t.jsxIdentifier('key'), t.jsxExpressionContainer(t.identifier(idx)))]), t.jsxClosingElement(t.jsxIdentifier('Fragment')), el.children);
    }
    if (t.isConditionalExpression(el)) { el.consequent = keyed(el.consequent, idx); el.alternate = keyed(el.alternate, idx); return el; }
    if (t.isLogicalExpression(el)) { el.right = keyed(el.right, idx); return el; }
    if (t.isParenthesizedExpression(el)) { el.expression = keyed(el.expression, idx); return el; }
    return el;
  };
  const fix = (fn) => {
    if (!(t.isArrowFunctionExpression(fn) || t.isFunctionExpression(fn))) return;
    const has = (b) => { let j = false; t.traverseFast(b, (x) => { if (t.isJSXElement(x) || t.isJSXFragment(x)) j = true; }); return j; };
    if (!has(fn.body)) return;
    while (fn.params.length < 2) fn.params.push(t.identifier(fn.params.length === 0 ? '_' : '__k'));
    let idx = fn.params[1];
    if (!t.isIdentifier(idx)) return;
    if (idx.name === '_' ) { idx.name = '__k'; }
    const name = idx.name;
    if (!t.isBlockStatement(fn.body)) fn.body = keyed(fn.body, name);
    else traverse(fn.body, { ReturnStatement(p) { if (p.getFunctionParent().node === fn && p.node.argument) p.node.argument = keyed(p.node.argument, name); }, noScope: true });
  };
  traverse(ast, {
    CallExpression(p) {
      const c = p.node.callee;
      if (t.isMemberExpression(c) && t.isIdentifier(c.property) && ['map', 'flatMap'].includes(c.property.name)) fix(p.node.arguments[0]);
      if (t.isMemberExpression(c) && t.isIdentifier(c.object, { name: 'Array' }) && t.isIdentifier(c.property, { name: 'from' })) fix(p.node.arguments[1]);
    },
  });
  if (!n) continue;
  let code = generate(ast, { jsescOption: { minimal: true } }, src).code;
  if (frag) code = code.replace(/^(\/\/ @ts-nocheck[^\n]*\n)/, `$1import { Fragment } from 'react';\n`);
  fs.writeFileSync(f, code); total += n;
}
console.log('keys added', total);

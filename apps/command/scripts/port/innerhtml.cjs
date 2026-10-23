// el.innerHTML = x  ->  html(el, x);   el.innerHTML (read)  ->  hasHtml(el)
const fs = require('fs');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const generate = require('@babel/generator').default;
const t = require('@babel/types');
for (const f of process.argv.slice(2)) {
  const src = fs.readFileSync(f, 'utf8');
  const ast = parser.parse(src, { sourceType: 'module', plugins: ['jsx', 'typescript'] });
  const need = new Set();
  traverse(ast, {
    MemberExpression(p) {
      if (!t.isIdentifier(p.node.property, { name: 'innerHTML' }) || p.node.computed) return;
      const obj = p.node.object;
      if (p.parentPath.isAssignmentExpression({ left: p.node }) && p.parent.operator === '=') {
        need.add('html');
        p.parentPath.replaceWith(t.callExpression(t.identifier('html'), [obj, p.parent.right]));
      } else { need.add('hasHtml'); p.replaceWith(t.callExpression(t.identifier('hasHtml'), [obj])); }
    },
  });
  if (!need.size) continue;
  let code = generate(ast, { jsescOption: { minimal: true } }, src).code;
  const m = /import \{ ([^}]*) \} from '\.\.\/runtime\/dom';/.exec(code);
  if (m) { const names = new Set(m[1].split(',').map((s) => s.trim())); need.forEach((n) => names.add(n)); code = code.replace(m[0], `import { ${[...names].sort().join(', ')} } from '../runtime/dom';`); }
  else code = code.replace(/^(\/\/ @ts-nocheck[^\n]*\n)/, `$1import { ${[...need].sort().join(', ')} } from '../runtime/dom';\n`);
  fs.writeFileSync(f, code);
  console.log(f.split('/').pop(), [...need].join(','));
}

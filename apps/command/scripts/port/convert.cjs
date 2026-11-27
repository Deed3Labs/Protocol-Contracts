// Turns the prototype's HTML template strings into JSX, keeping the DOM the same, and splits the
// result into data.tsx (in the prototype's order), one file of functions per section, and startup.tsx.
// usage: node convert.cjs in.js out  (writes out.d/*.tsx)
const fs = require('fs');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const generate = require('@babel/generator').default;
const t = require('@babel/types');

const [, , IN, OUT] = process.argv;
const src = fs.readFileSync(IN, 'utf8');
const ast = parser.parse(src, { sourceType: 'module', plugins: ['jsx'] });
const problems = [];

const VOID = new Set(['input', 'br', 'img', 'hr', 'meta', 'link', 'col', 'area', 'source', 'wbr']);
const BOOL = new Set(['hidden', 'disabled', 'checked', 'selected', 'readonly', 'required', 'multiple', 'autofocus', 'novalidate', 'open', 'inert']);
const NAMES = {
  class: 'className', for: 'htmlFor', tabindex: 'tabIndex', maxlength: 'maxLength', minlength: 'minLength', inputmode: 'inputMode',
  autocomplete: 'autoComplete', readonly: 'readOnly', colspan: 'colSpan', rowspan: 'rowSpan', novalidate: 'noValidate',
  autofocus: 'autoFocus', spellcheck: 'spellCheck', enterkeyhint: 'enterKeyHint', crossorigin: 'crossOrigin', datetime: 'dateTime',
  'xlink:href': 'xlinkHref', 'xml:space': 'xmlSpace', srcset: 'srcSet', contenteditable: 'contentEditable', accesskey: 'accessKey',
};
const ENT = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ', '&apos;': "'" };
const decode = (s) => s.replace(/&(amp|lt|gt|quot|#39|nbsp|apos);/g, (m) => ENT[m]);

function reactName(name, tag) {
  const n = name.toLowerCase();
  if (n.startsWith('data-') || n.startsWith('aria-')) return name;
  if (NAMES[n]) return NAMES[n];
  if ((n === 'value') && (tag === 'input' || tag === 'textarea' || tag === 'select')) return 'defaultValue';
  if (n === 'checked' && tag === 'input') return 'defaultChecked';
  if (name.includes('-')) return name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  return name;
}

const isHtmlText = (s) => /<\/?[a-zA-Z][\w-]*(\s|>|\/)/.test(s) || /<[a-zA-Z][\w-]*$/.test(s);
const MARK = (i) => `\u0001${i}\u0002`;

// --- tokenize an HTML string whose holes are marked, into a tree ---
function parseHtml(str, holes, where) {
  const root = { tag: null, attrs: [], children: [] };
  const stack = [root];
  let i = 0;
  const top = () => stack[stack.length - 1];
  const pushText = (s) => { if (s) top().children.push({ text: s }); };
  const holeAt = (p) => { const m = /^\u0001(\d+)\u0002/.exec(str.slice(p)); return m ? { idx: +m[1], len: m[0].length } : null; };
  let text = '';
  while (i < str.length) {
    const h = holeAt(i);
    if (h) { pushText(text); text = ''; top().children.push({ hole: h.idx }); i += h.len; continue; }
    if (str[i] === '<' && /[a-zA-Z/]/.test(str[i + 1] || '')) {
      pushText(text); text = '';
      if (str[i + 1] === '/') {
        const m = /^<\/([a-zA-Z][\w-]*)\s*>/.exec(str.slice(i));
        if (!m) throw new Error('bad close tag');
        const name = m[1];
        let k = stack.length - 1;
        while (k > 0 && stack[k].tag !== name) k--;
        if (k === 0) throw new Error(`stray </${name}>`);
        if (k !== stack.length - 1) throw new Error(`unclosed <${top().tag}> before </${name}>`);
        stack.pop();
        i += m[0].length;
        continue;
      }
      const m = /^<([a-zA-Z][\w-]*)/.exec(str.slice(i));
      const el = { tag: m[1], attrs: [], children: [] };
      i += m[0].length;
      // attributes
      for (;;) {
        while (/\s/.test(str[i] || '')) i++;
        if (i >= str.length) throw new Error(`unterminated <${el.tag}>`);
        if (str[i] === '>') { i++; break; }
        if (str[i] === '/' && str[i + 1] === '>') { i += 2; el.self = true; break; }
        const hh = holeAt(i);
        if (hh) { el.attrs.push({ spread: hh.idx }); i += hh.len; continue; }
        const nm = /^[^\s=>/\u0001]+/.exec(str.slice(i));
        if (!nm) throw new Error(`bad attr in <${el.tag}> at ${JSON.stringify(str.slice(i, i + 20))}`);
        i += nm[0].length;
        let val = null;
        if (str[i] === '=') {
          i++;
          const q = str[i];
          if (q === '"' || q === "'") {
            const end = str.indexOf(q, i + 1);
            if (end < 0) throw new Error('unterminated attr');
            val = str.slice(i + 1, end); i = end + 1;
          } else {
            const hv = holeAt(i);
            if (hv) { val = str.slice(i, i + hv.len); i += hv.len; }
            else { const u = /^[^\s>]+/.exec(str.slice(i)); val = u[0]; i += u[0].length; }
          }
        }
        el.attrs.push({ name: nm[0], val });
      }
      top().children.push(el);
      if (!el.self && !VOID.has(el.tag.toLowerCase())) stack.push(el);
      continue;
    }
    text += str[i++];
  }
  pushText(text);
  if (stack.length !== 1) throw new Error(`unclosed <${top().tag}>`);
  return root.children;
}

// --- tree -> JSX AST ---
function valueExpr(val, holes) {
  // a string with hole marks -> template literal or string
  const parts = val.split(/\u0001(\d+)\u0002/);
  if (parts.length === 1) return t.stringLiteral(decode(val));
  const quasis = [], exprs = [];
  for (let k = 0; k < parts.length; k++) {
    if (k % 2 === 0) quasis.push(t.templateElement({ raw: decode(parts[k]).replace(/\\|`|\$\{/g, (m) => '\\' + m), cooked: decode(parts[k]) }, false));
    else exprs.push(holes[+parts[k]]);
  }
  quasis[quasis.length - 1].tail = true;
  if (quasis.length === 2 && !quasis[0].value.cooked && !quasis[1].value.cooked) return exprs[0];
  return t.templateLiteral(quasis, exprs);
}

function toJsxAttr(a, tag, holes) {
  if (a.spread != null) return t.jsxSpreadAttribute(t.callExpression(t.identifier('attrs'), [holes[a.spread]]));
  const lname = a.name.toLowerCase();
  const name = reactName(a.name, tag.toLowerCase());
  const id = name.includes(':') ? t.jsxNamespacedName(t.jsxIdentifier(name.split(':')[0]), t.jsxIdentifier(name.split(':')[1])) : t.jsxIdentifier(name);
  if (a.val == null) {
    if (BOOL.has(lname)) return t.jsxAttribute(id, null);
    return t.jsxAttribute(id, t.stringLiteral(''));
  }
  if (lname === 'style') return t.jsxAttribute(id, t.jsxExpressionContainer(t.callExpression(t.identifier('css'), [valueExpr(a.val, holes)])));
  const v = valueExpr(a.val, holes);
  if (t.isStringLiteral(v) && !/["\n\\]/.test(v.value)) return t.jsxAttribute(id, v);
  return t.jsxAttribute(id, t.jsxExpressionContainer(v));
}

function textNodes(s) {
  s = decode(s).replace(/\s+/g, ' ');
  if (!s) return [];
  if (s === ' ') return [t.jsxExpressionContainer(t.stringLiteral(' '))];
  if (/[{}<>]/.test(s) || s.startsWith(' ') || s.endsWith(' ')) return [t.jsxExpressionContainer(t.stringLiteral(s))];
  return [t.jsxText(s)];
}

function childExpr(e) {
  if (t.isJSXElement(e) || t.isJSXFragment(e)) return e;
  return t.jsxExpressionContainer(e);
}

function toJsx(nodes, holes) {
  const out = [];
  for (const n of nodes) {
    if (n.text != null) { if (!n.text.trim() && n.text.includes('\n')) continue; out.push(...textNodes(n.text)); }
    else if (n.hole != null) out.push(childExpr(holes[n.hole]));
    else {
      const tag = n.tag;
      const attrs = n.attrs.map((a) => toJsxAttr(a, tag, holes));
      let kids = toJsx(n.children, holes);
      if (tag.toLowerCase() === 'textarea' && kids.length) {
        // React wants defaultValue, not children
        const txt = n.children.map((c) => (c.text != null ? decode(c.text) : '')).join('');
        if (n.children.every((c) => c.text != null)) { attrs.push(t.jsxAttribute(t.jsxIdentifier('defaultValue'), t.jsxExpressionContainer(t.stringLiteral(txt)))); kids = []; }
        else { const h = n.children.find((c) => c.hole != null); attrs.push(t.jsxAttribute(t.jsxIdentifier('defaultValue'), t.jsxExpressionContainer(holes[h.hole]))); kids = []; }
      }
      const self = kids.length === 0;
      out.push(t.jsxElement(t.jsxOpeningElement(t.jsxIdentifier(tag), attrs, self), self ? null : t.jsxClosingElement(t.jsxIdentifier(tag)), kids, self));
    }
  }
  return out;
}

function trimRoot(nodes) {
  // whitespace before the first and after the last node of a template is source indentation
  while (nodes.length && nodes[0].text != null && !nodes[0].text.trim()) nodes.shift();
  while (nodes.length && nodes[nodes.length - 1].text != null && !nodes[nodes.length - 1].text.trim()) nodes.pop();
  // only indentation (whitespace with a line break) goes; a plain space at the edge is part of the text
  if (nodes.length && nodes[0].text != null) nodes[0].text = nodes[0].text.replace(/^\s*\n\s*/, '');
  if (nodes.length && nodes[nodes.length - 1].text != null) nodes[nodes.length - 1].text = nodes[nodes.length - 1].text.replace(/\s*\n\s*$/, '');
  return nodes;
}

function convert(str, holes, loc) {
  try {
    const nodes = trimRoot(parseHtml(str, holes, loc));
    const jsx = toJsx(nodes, holes);
    if (jsx.length === 1 && (t.isJSXElement(jsx[0]))) return jsx[0];
    return t.jsxFragment(t.jsxOpeningFragment(), t.jsxClosingFragment(), jsx);
  } catch (e) {
    problems.push(`line ${loc}: ${e.message}`);
    return null;
  }
}

// pass 1: templates and strings with HTML, innermost first
traverse(ast, {
  TemplateLiteral: {
    exit(p) {
      if (p.parentPath.isTaggedTemplateExpression()) return;
      const raw = p.node.quasis.map((q) => q.value.cooked);
      if (!isHtmlText(raw.join(''))) return;
      let s = '';
      raw.forEach((q, k) => { s += q; if (k < p.node.expressions.length) s += MARK(k); });
      const out = convert(s, p.node.expressions, p.node.loc.start.line);
      if (out) p.replaceWith(out);
    },
  },
  StringLiteral: {
    exit(p) {
      if (p.parentPath.isJSXAttribute() || p.parentPath.isImportDeclaration() || p.parentPath.isObjectProperty({ key: p.node })) return;
      if (!isHtmlText(p.node.value)) return;
      // selectors and regex sources stay strings
      if (p.parentPath.isCallExpression() && /querySelector|closest|matches/.test(generate(p.parentPath.node.callee).code)) return;
      const out = convert(p.node.value, [], p.node.loc.start.line);
      if (out) p.replaceWith(out);
    },
  },
});

// esc() is HTML escaping; React escapes for us
traverse(ast, {
  CallExpression(p) {
    if (t.isIdentifier(p.node.callee, { name: 'esc' }) && p.node.arguments.length === 1) p.replaceWith(p.node.arguments[0]);
  },
});


// ---- pass 2, repeated until nothing changes: which functions and variables hold markup, and
// the string glue between them (join(''), +, and templates made only of other markup) becomes JSX.
// Calls are resolved through scope, so a local helper never borrows another function's name.
const htmlFnNodes = new Set();
const fnOfBinding = (b) => !b ? null : b.path.isFunctionDeclaration() ? b.path.node : (b.path.isVariableDeclarator() && isFnNode(b.path.node.init)) ? b.path.node.init : null;
const isFnNode = (n) => t.isArrowFunctionExpression(n) || t.isFunctionExpression(n) || t.isFunctionDeclaration(n);
const htmlCall = (n, scope) => t.isCallExpression(n) && t.isIdentifier(n.callee) && htmlFnNodes.has(fnOfBinding(scope.getBinding(n.callee.name)));
// does this expression (looked at as written, through nested calls and callbacks) produce markup?
const markupIn = (path) => {
  if (path.isJSXElement() || path.isJSXFragment() || htmlCall(path.node, path.scope)) return true;
  let found = false;
  path.traverse({
    'JSXElement|JSXFragment'(p) { found = true; p.stop(); },
    CallExpression(p) { if (htmlCall(p.node, p.scope)) { found = true; p.stop(); } },
  });
  return found;
};
const ownReturns = (fnPath) => {
  const body = fnPath.get('body');
  if (!body.isBlockStatement()) return [body];
  const rs = [];
  body.traverse({ ReturnStatement(p) { if (p.getFunctionParent() === fnPath && p.node.argument) rs.push(p.get('argument')); } });
  return rs;
};
const cbMarkup = (fnNode, scope) => {
  if (!fnNode) return false;
  if (t.isIdentifier(fnNode)) return htmlFnNodes.has(fnOfBinding(scope.getBinding(fnNode.name)));
  if (!isFnNode(fnNode)) return false;
  let found = false;
  t.traverseFast(fnNode.body, (x) => { if (t.isJSXElement(x) || t.isJSXFragment(x) || (t.isCallExpression(x) && t.isIdentifier(x.callee) && htmlFnNodes.has(fnOfBinding(scope.getBinding(x.callee.name))))) found = true; });
  return found;
};
// markup without looking through variables (used to decide what a variable holds)
const direct = (n, scope) => t.isJSXElement(n) || t.isJSXFragment(n) || htmlCall(n, scope)
  || (t.isConditionalExpression(n) && (direct(n.consequent, scope) || direct(n.alternate, scope))) || (t.isLogicalExpression(n) && direct(n.right, scope))
  || (t.isCallExpression(n) && t.isMemberExpression(n.callee) && t.isIdentifier(n.callee.property) && ['map', 'flatMap'].includes(n.callee.property.name) && cbMarkup(n.arguments[0], scope))
  || (t.isCallExpression(n) && t.isMemberExpression(n.callee) && t.isIdentifier(n.callee.object, { name: 'Array' }) && t.isIdentifier(n.callee.property, { name: 'from' }) && cbMarkup(n.arguments[1], scope))
  || (t.isCallExpression(n) && t.isMemberExpression(n.callee) && t.isIdentifier(n.callee.property) && ['slice', 'filter', 'reverse', 'concat'].includes(n.callee.property.name) && direct(n.callee.object, scope));
const markupVar = (scope, name) => {
  const b = scope.getBinding(name);
  if (!b) return false;
  if (b.path.isVariableDeclarator() && b.path.node.init && direct(b.path.node.init, b.path.scope)) return true;
  return b.constantViolations.some((v) => v.isAssignmentExpression() && direct(v.node.right, v.scope));
};
const htmlish = (n, scope) => direct(n, scope) || (t.isIdentifier(n) && markupVar(scope, n.name))
  || (t.isConditionalExpression(n) && (htmlish(n.consequent, scope) || htmlish(n.alternate, scope))) || (t.isLogicalExpression(n) && htmlish(n.right, scope));
const flatten = (n, acc) => { if (t.isBinaryExpression(n, { operator: '+' })) { flatten(n.left, acc); flatten(n.right, acc); } else acc.push(n); return acc; };
const frag = (kids) => t.jsxFragment(t.jsxOpeningFragment(), t.jsxClosingFragment(), kids);

for (let round = 0; round < 8; round++) {
  let changed = 0;
  traverse(ast, {
    'FunctionDeclaration|ArrowFunctionExpression|FunctionExpression'(p) {
      if (htmlFnNodes.has(p.node)) return;
      if (ownReturns(p).some(markupIn)) { htmlFnNodes.add(p.node); changed++; }
    },
  });
  traverse(ast, {
    TemplateLiteral: {
      exit(p) {
        if (p.parentPath.isTaggedTemplateExpression() || !p.node.expressions.some((e) => htmlish(e, p.scope))) return;
        const kids = [];
        p.node.quasis.forEach((q, k) => {
          if (q.value.cooked) kids.push(...textNodes(q.value.cooked));
          if (k < p.node.expressions.length) kids.push(childExpr(p.node.expressions[k]));
        });
        p.replaceWith(frag(kids)); changed++;
      },
    },
    CallExpression: {
      exit(p) {
        const c = p.node.callee;
        if (!t.isMemberExpression(c) || !t.isIdentifier(c.property, { name: 'join' })) return;
        const a = p.node.arguments[0];
        if (!(p.node.arguments.length === 1 && t.isStringLiteral(a) && a.value === '')) return;
        const obj = c.object;
        let markup = direct(obj, p.scope);
        if (t.isArrayExpression(obj)) markup = obj.elements.some((e) => e && htmlish(e, p.scope));
        if (t.isIdentifier(obj)) {
          const b = p.scope.getBinding(obj.name);
          markup = !!(b && b.path.isVariableDeclarator() && b.path.node.init && direct(b.path.node.init, b.path.scope));
        }
        if (markup) { p.replaceWith(obj); changed++; }
      },
    },
    BinaryExpression: {
      exit(p) {
        if (p.node.operator !== '+' || t.isBinaryExpression(p.parent, { operator: '+' })) return;
        const parts = flatten(p.node, []);
        if (!parts.some((e) => htmlish(e, p.scope))) return;
        p.replaceWith(frag(parts.map((e) => (t.isStringLiteral(e) ? textNodes(e.value)[0] || t.jsxText('') : childExpr(e))))); changed++;
      },
    },
  });
  if (!changed) break;
}
const htmlFns = { size: htmlFnNodes.size };

const out = generate(ast, { retainLines: false, jsescOption: { minimal: true } }).code;
fs.writeFileSync(OUT, out);
console.log('html functions: ' + htmlFns.size);
console.log(problems.length ? problems.join('\n') : 'no problems');


// ---- split: data in the prototype's order, functions by section, start-up statements last ----
// each section starts at its anchor in the prototype's script
const ANCHORS = [
  ['core', null], ['home', /^\/\* ── Home /], ['growth', /^const GS = /], ['members', /^const MS = /], ['merchants', /^const XS = /],
  ['field', /^const FS = /], ['money', /^const NS = /], ['contracts', /^const CS = /], ['governance', /^const VS = /],
  ['records', /^const RS = /], ['team', /^const TS = /], ['shop', /^const SS = /], ['shell', /^\/\* ── Render /], ['signin', /^\/\* ── Sign in/],
];
const srcLines = src.split('\n');
const RANGES = ANCHORS.map(([name, re]) => {
  if (!re) return [1, name];
  const i = srcLines.findIndex((l) => re.test(l));
  if (i < 0) throw new Error('section anchor not found: ' + name);
  return [i + 1, name];
});
for (let k = 1; k < RANGES.length; k++) if (RANGES[k][0] <= RANGES[k - 1][0]) throw new Error('section anchors out of order at ' + RANGES[k][1]);
const OVERRIDE = { stepFlow: 'kit', ddHtml: 'kit', ddClose: 'kit', ddOpen: 'kit', ddPick: 'kit' };
const iifePath = (() => { let fp; traverse(ast, { ArrowFunctionExpression(p) { if (!fp) { fp = p; p.stop(); } } }); return fp; })();
const iife = iifePath.node.body.body;
const isFn = (e) => t.isArrowFunctionExpression(e) || t.isFunctionExpression(e);

// top-level `let`s are assigned from other files: they live on one shared object, `vars`
const topScope = iifePath.scope;
const lets = new Set();
for (const st of iife) if (t.isVariableDeclaration(st, { kind: 'let' })) st.declarations.forEach((d) => Object.keys(t.getBindingIdentifiers(d.id)).forEach((n) => lets.add(n)));
lets.add('lastFocus');
const bindings = new Map([...lets].map((n) => [n, topScope.getBinding(n)]));
iifePath.traverse({
  Identifier(p) {
    const n = p.node.name;
    if (!lets.has(n) || p.scope.getBinding(n) !== bindings.get(n)) return;
    if (p.parentPath.isVariableDeclarator({ id: p.node }) && p.parentPath.parentPath.parent === iifePath.node.body) return;
    if (p.parentPath.isMemberExpression({ property: p.node }) && !p.parent.computed) return;
    if (p.parentPath.isObjectProperty({ key: p.node }) && !p.parent.computed) { if (p.parent.shorthand) { p.parent.shorthand = false; p.parent.value = t.memberExpression(t.identifier('vars'), t.identifier(n)); } return; }
    p.replaceWith(t.memberExpression(t.identifier('vars'), t.identifier(n)));
  },
});

const declNames = (st) => {
  if (t.isFunctionDeclaration(st) || t.isClassDeclaration(st)) return [st.id.name];
  if (t.isVariableDeclaration(st)) return st.declarations.flatMap((d) => Object.keys(t.getBindingIdentifiers(d.id)));
  return [];
};
const secOf = (st, names) => {
  for (const n of names) if (OVERRIDE[n]) return OVERRIDE[n];
  let m = RANGES[0][1];
  for (const [l, name] of RANGES) if (st.loc.start.line >= l) m = name;
  return m;
};
const mods = { data: [], startup: [] };
const owner = {};
const add = (m, st) => { (mods[m] = mods[m] || []).push(st); declNames(st).forEach((n) => (owner[n] = m)); };
for (const st of iife) {
  if (!st.loc) throw new Error('no loc: ' + generate(st).code.slice(0, 60));
  if (t.isFunctionDeclaration(st)) { add(secOf(st, [st.id.name]), st); continue; }
  if (t.isVariableDeclaration(st)) {
    for (const d of st.declarations) {
      const names = Object.keys(t.getBindingIdentifiers(d.id));
      if (t.isIdentifier(d.id) && isFn(d.init)) {
        // arrow helpers become function declarations: hoisted, so no file sees them uninitialised
        const f = d.init;
        const body = t.isBlockStatement(f.body) ? f.body : t.blockStatement([t.returnStatement(f.body)]);
        const fd = t.functionDeclaration(t.identifier(d.id.name), f.params, body, f.generator, f.async);
        fd.loc = st.loc; fd.leadingComments = st.declarations[0] === d ? st.leadingComments : null;
        add(secOf(st, names), fd);
      } else if (lets.has(names[0])) {
        const as = t.expressionStatement(t.assignmentExpression('=', t.memberExpression(t.identifier('vars'), t.identifier(names[0])), d.init || t.identifier('undefined')));
        as.loc = st.loc; as.leadingComments = st.declarations[0] === d ? st.leadingComments : null;
        mods.data.push(as); owner[names[0]] = 'data';
      } else {
        const vd = t.variableDeclaration(st.kind, [d]);
        vd.loc = st.loc; vd.leadingComments = st.declarations[0] === d ? st.leadingComments : null;
        add('data', vd);
      }
    }
    continue;
  }
  // a statement that only fills in data (`Y.cash = Y.assets - Y.lent`) stays with the data, in order
  const assigns = (e) => t.isAssignmentExpression(e) && t.isMemberExpression(e.left) || (t.isSequenceExpression(e) && e.expressions.every(assigns));
  if (t.isExpressionStatement(st) && assigns(st.expression)) { mods.data.push(st); continue; }
  mods.startup.push(st);
}
mods.data.unshift(t.variableDeclaration('const', [t.variableDeclarator(t.identifier('vars'), t.objectExpression([]))]));
owner.vars = 'data';
// the start-up statements run once every file has loaded
mods.startup = [t.functionDeclaration(t.identifier('startup'), [], t.blockStatement(mods.startup))];
owner.startup = 'startup';

fs.rmSync(OUT + '.d', { recursive: true, force: true });
fs.mkdirSync(OUT + '.d', { recursive: true });
for (const [m, stmts] of Object.entries(mods)) {
  const prog = t.file(t.program(stmts.map((s) => t.cloneNode(s, true, false))));
  const used = new Map();
  traverse(prog, { Program(p) { for (const g of Object.keys(p.scope.globals)) if (owner[g] && owner[g] !== m) used.set(g, owner[g]); } });
  prog.program.body = prog.program.body.map((s) => { if (!declNames(s).length) return s; const e = t.exportNamedDeclaration(s, []); e.leadingComments = s.leadingComments; s.leadingComments = null; return e; });
  const byMod = {};
  for (const [n, o] of used) (byMod[o] = byMod[o] || []).push(n);
  const imports = Object.entries(byMod).sort().map(([o, ns]) => `import { ${ns.sort().join(', ')} } from './${o}';`).join('\n');
  fs.writeFileSync(`${OUT}.d/${m}.tsx`, `${imports}\n\n${generate(prog, { jsescOption: { minimal: true } }).code}\n`);
}
console.log(Object.entries(mods).map(([m, s]) => `${m}:${s.length}`).join(' '));
console.log('lets on vars:', [...lets].join(' '));

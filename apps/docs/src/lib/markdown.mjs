// Markdown to the design's markup. marked does the parsing (lexer only); the HTML is written here so
// each block gets the classes clear-docs.css expects (cd-mdl lists, cd-mdt tables, cd-note, cd-code).
import { marked } from 'marked';
import { resolveLink, slugger } from './site.mjs';

export const COUNSEL = '[COUNSEL TO REVIEW]';
const FLAG = '<span class="i-flag">Counsel to review</span>';

const ENT = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&#x27;': "'", '&nbsp;': ' ' };
export const decode = (s) => String(s).replace(/&(amp|lt|gt|quot|nbsp|#39|#x27);/g, (m) => ENT[m]);
export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const text = (s) => esc(decode(s)).split(esc(COUNSEL)).join(FLAG);

// Inline HTML the docs may use as-is: bare tags with no attributes.
const SAFE_INLINE = /^<\/?(br|sub|sup|kbd|b|i|em|strong|code|small)\s*\/?>$/i;

/** Code to coloured spans, as the design's prototype does it (a light, language-agnostic pass). */
export function highlight(code) {
  if (code.length > 6000) return esc(code);
  const re = /((?<!:)\/\/[^\n]*|^[ \t]*#(?= |$)[^\n]*)|("[^"\n]*"|'[^'\n]*'|`[^`]*`)|\b(import|from|export|const|let|var|new|await|async|return|function|external|view|returns|if|else|contract|interface|true|false|null)\b|\b([A-Za-z_$][\w$]*)(?=\()/gm;
  let out = '';
  let at = 0;
  let m;
  while ((m = re.exec(code))) {
    if (m.index > at) out += esc(code.slice(at, m.index));
    const c = m[1] ? 't-c' : m[2] ? 't-s' : m[3] ? 't-k' : 't-f';
    out += `<span class="${c}">${esc(m[0])}</span>`;
    at = m.index + m[0].length;
  }
  return out + esc(code.slice(at));
}

/**
 * Render one markdown file.
 * ctx: { file, byFile, root } — file is repo-relative; byFile maps markdown paths to nav entries.
 * Returns { title, lede, blocks, toc, text, links, anchors, unresolved, html }
 *   blocks: [{ k, id?, html }]  — one per top-level block, so visuals can be placed after a heading
 *   links:  site ids this page links to
 *   anchors: [{ id, anchor }]   — links into another page (or this one, id = null) with a #fragment
 */
export function renderMarkdown(src, ctx) {
  const body = src.replace(/^---\n[\s\S]*?\n---\n/, '');
  const tokens = marked.lexer(body);
  const uid = slugger();
  const links = new Set();
  const anchors = [];
  const unresolved = [];
  const blocks = [];
  const toc = [];
  let title = null;
  let lede = null;

  const link = (href) => {
    const r = resolveLink(decode(href), ctx.file, ctx.byFile, ctx.root);
    if (r.id) links.add(r.id);
    if (r.anchor && (r.id || r.self)) anchors.push({ id: r.id || null, anchor: r.anchor });
    if (r.missing) unresolved.push(`${ctx.file}: ${href}`);
    return r;
  };

  const inline = (toks) => {
    let out = '';
    for (const t of toks || []) {
      switch (t.type) {
        case 'text':
          out += t.tokens ? inline(t.tokens) : text(t.text);
          break;
        case 'escape':
          out += esc(decode(t.text));
          break;
        case 'strong':
          out += `<strong>${inline(t.tokens)}</strong>`;
          break;
        case 'em':
          out += `<em>${inline(t.tokens)}</em>`;
          break;
        case 'del':
          out += `<del>${inline(t.tokens)}</del>`;
          break;
        case 'codespan':
          out += `<code>${esc(decode(t.text))}</code>`;
          break;
        case 'br':
          out += '<br>';
          break;
        case 'link': {
          const r = link(t.href);
          const ext = r.external ? ' rel="noopener"' : '';
          out += `<a class="i-l" href="${esc(r.href)}"${ext}>${inline(t.tokens)}</a>`;
          break;
        }
        case 'image': {
          const r = link(t.href);
          const src = r.external && /github\.com\/.+\/blob\//.test(r.href) ? `${r.href}?raw=true` : r.href;
          out += `<img src="${esc(src)}" alt="${esc(t.text || '')}" loading="lazy">`;
          break;
        }
        case 'html':
          out += SAFE_INLINE.test(t.text.trim()) ? t.text.trim() : /^<!--/.test(t.text) ? '' : esc(t.text);
          break;
        default:
          if (t.tokens) out += inline(t.tokens);
          else if (t.text) out += text(t.text);
      }
    }
    return out;
  };
  const plain = (toks) => {
    let out = '';
    for (const t of toks || []) {
      if (t.tokens) out += plain(t.tokens);
      else if (t.type === 'codespan' || t.type === 'text' || t.type === 'escape') out += decode(t.text);
      else if (t.type === 'br') out += ' ';
    }
    return out;
  };

  // A list is flattened into rows with a depth, as the design draws it.
  const listRows = (list, depth, rows) => {
    let n = Number(list.start) || 1;
    for (const item of list.items) {
      let html = '';
      const subs = [];
      for (const c of item.tokens) {
        if (c.type === 'list') subs.push(c);
        else if (c.type === 'code') html += ` <code>${esc(c.text)}</code>`;
        else if (c.type === 'space') continue;
        else if (c.tokens) html += (html ? ' ' : '') + inline(c.tokens);
        else if (c.text) html += text(c.text);
      }
      const num = list.ordered ? `${n++}.` : '';
      rows.push(`<li data-d="${Math.min(depth, 2)}" data-n="${!!num}"><span class="cd-mdn">${num}</span><div>${html}</div></li>`);
      subs.forEach((s) => listRows(s, depth + 1, rows));
    }
    return rows;
  };
  const list = (t) => `<ul class="cd-mdl">${listRows(t, 0, []).join('')}</ul>`;

  const table = (t) => {
    const cells = (row) => row.map((c) => inline(c.tokens));
    const head = cells(t.header);
    const rows = t.rows.map(cells);
    const lens = t.header.map((_, i) => Math.max(8, ...t.rows.map((r) => (r[i] ? plain(r[i].tokens).length : 0))));
    const cols = lens.map((l) => `minmax(0,${Math.max(1, Math.min(4, Math.sqrt(l) / 4)).toFixed(2)}fr)`).join(' ');
    const style = `grid-template-columns:${cols};min-width:${t.header.length * 150}px`;
    const html = head.map((h) => `<div class="cd-mdc cd-mdh">${h}</div>`).join('') + rows.map((r) => r.map((c) => `<div class="cd-mdc">${c}</div>`).join('')).join('');
    return `<div class="cd-mdw"><div class="cd-mdt" role="table" style="${style}">${html}</div></div>`;
  };

  const code = (t) => {
    const lang = (t.lang || '').trim().split(/\s+/)[0];
    if (lang === 'mermaid') {
      // Drawn in the browser (client/docs.js). Until then, and without JavaScript, it reads as code.
      return `<figure class="cd-mdi cd-mermaid" data-mermaid>${codeBlock('mermaid', t.text)}</figure>`;
    }
    return codeBlock(lang || 'text', t.text);
  };
  const codeBlock = (lang, src) =>
    `<div class="cd-code"><div class="cd-code-h"><div class="cd-code-tabs"><span>${esc(lang)}</span></div><button class="cd-btn" data-variant="ghost" data-size="s" type="button" data-copy>Copy</button></div><pre><code>${highlight(src)}</code></pre></div>`;

  const quote = (t) => {
    let html = '';
    for (const c of t.tokens) {
      if (c.type === 'paragraph') html += `<p>${inline(c.tokens)}</p>`;
      else if (c.type === 'list') html += list(c);
      else if (c.type === 'code') html += code(c);
      else if (c.tokens) html += `<p>${inline(c.tokens)}</p>`;
    }
    return `<div class="cd-note">${html}</div>`;
  };

  for (const t of tokens) {
    if (t.type === 'heading') {
      const label = plain(t.tokens).trim();
      const id = uid(label);
      if (t.depth === 1 && title === null) {
        title = label;
        continue;
      }
      const k = t.depth <= 2 ? 'h2' : 'h3';
      if (k === 'h2') toc.push({ id, label });
      blocks.push({ k, id, html: `<${k} id="${id}">${inline(t.tokens)}</${k}>` });
    } else if (t.type === 'paragraph') {
      const html = inline(t.tokens);
      if (!html.trim()) continue;
      const onlyImg = t.tokens.length === 1 && t.tokens[0].type === 'image';
      if (onlyImg) {
        blocks.push({ k: 'img', html: `<figure class="cd-mdi">${html}</figure>` });
        continue;
      }
      if (lede === null && !blocks.length) {
        lede = html;
        continue;
      }
      blocks.push({ k: 'p', html: `<p>${html}</p>` });
    } else if (t.type === 'list') blocks.push({ k: 'ul', html: list(t) });
    else if (t.type === 'table') blocks.push({ k: 'table', html: table(t) });
    else if (t.type === 'code') blocks.push({ k: t.lang === 'mermaid' ? 'mermaid' : 'code', html: code(t) });
    else if (t.type === 'blockquote') blocks.push({ k: 'q', html: quote(t) });
    else if (t.type === 'html') {
      const h = t.text.trim();
      if (!h || /^<!--[\s\S]*-->$/.test(h)) continue;
      blocks.push({ k: 'p', html: `<p>${esc(h)}</p>` });
    }
    // hr and space: the design draws no rules between blocks.
  }

  const plainText = body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#*`|>_]+/g, ' ')
    .replace(/ -{2,} /g, ' ')
    .split(COUNSEL)
    .join('Counsel to review')
    .replace(/\s+/g, ' ')
    .trim();
  const words = plainText ? plainText.split(' ').length : 0;

  return { title, lede, blocks, toc, text: plainText, words, links: [...links], anchors, unresolved };
}

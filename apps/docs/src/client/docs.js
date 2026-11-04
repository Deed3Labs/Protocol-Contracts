/* Clear docs: the small amount of JavaScript the static pages need. Theme, rail, menu sheet, search,
   contents highlight, code copy, the drawn maps, and Mermaid diagrams. Every page works without it. */
(function () {
  'use strict';

  var root = document.querySelector('.cd');
  if (!root) return;
  var shell = root.querySelector('.cd-shell');
  var SIGN_IN = root.getAttribute('data-signin');

  // ── Storage can throw (private windows, blocked site data): every call is guarded ──
  function load(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }
  function save(key, value) {
    try { window.localStorage.setItem(key, value); } catch (e) { /* keep going without it */ }
  }
  function $$(sel, el) { return Array.prototype.slice.call((el || document).querySelectorAll(sel)); }
  function h(tag, attrs, html) {
    var el = document.createElement(tag);
    for (var k in attrs || {}) el.setAttribute(k, attrs[k]);
    if (html != null) el.innerHTML = html;
    return el;
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  }

  // ── Theme: light or dark, remembered; with nothing saved it follows the system ──
  var media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  function theme() { return root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'; }
  function applyTheme(t) {
    root.setAttribute('data-theme', t);
    document.documentElement.setAttribute('data-theme', t);
    $$('[data-theme-toggle]').forEach(function (b) {
      var label = t === 'dark' ? 'Light mode' : 'Dark mode';
      b.setAttribute('aria-label', label);
      b.setAttribute('title', label);
    });
    drawDiagrams();
  }
  applyTheme(theme());
  $$('[data-theme-toggle]').forEach(function (b) {
    b.addEventListener('click', function () {
      var next = theme() === 'dark' ? 'light' : 'dark';
      save('clear-docs-theme', next);
      applyTheme(next);
    });
  });
  if (media && media.addEventListener) {
    media.addEventListener('change', function (e) {
      var saved = load('clear-docs-theme');
      if (saved !== 'dark' && saved !== 'light') applyTheme(e.matches ? 'dark' : 'light');
    });
  }

  // ── The rail: collapse to icons; in that state a section opens a drawer beside it ──
  var railToggle = root.querySelector('[data-rail-toggle]');
  function railMin() { return shell && shell.getAttribute('data-rail') === 'min'; }
  function syncRailButton() {
    if (!railToggle) return;
    railToggle.setAttribute('aria-pressed', String(railMin()));
    var label = railMin() ? 'Expand menu' : 'Collapse menu';
    railToggle.setAttribute('aria-label', label);
    railToggle.setAttribute('title', label);
  }
  syncRailButton();
  if (railToggle) {
    railToggle.addEventListener('click', function () {
      var next = railMin() ? 'full' : 'min';
      shell.setAttribute('data-rail', next);
      save('clear-docs-rail', next);
      closeFly();
      syncRailButton();
    });
  }

  function toggleGroup(btn) {
    var open = btn.getAttribute('aria-expanded') !== 'true';
    btn.setAttribute('aria-expanded', String(open));
    btn.setAttribute('data-open', String(open));
    var list = btn.nextElementSibling;
    if (list) list.hidden = !open;
  }
  function toggleSection(sec) {
    var head = sec.querySelector('.cd-sec');
    var pages = sec.querySelector('.cd-pages');
    if (!pages) return;
    var open = pages.hidden;
    pages.hidden = !open;
    head.setAttribute('aria-expanded', String(open));
  }

  var fly = null;
  function closeFly() {
    if (fly) { fly.remove(); fly = null; }
  }
  function openFly(sec) {
    var id = sec.getAttribute('data-sec');
    if (fly && fly.getAttribute('data-for') === id) return closeFly();
    closeFly();
    var name = sec.getAttribute('data-name') || '';
    var body = '';
    $$('.cd-pages > div', sec).forEach(function (g) {
      body += '<div><span class="cd-th">' + escapeHtml(g.querySelector('.cd-grp').textContent) + '</span>';
      $$('.cd-nav', g).forEach(function (a) { body += a.outerHTML; });
      body += '</div>';
    });
    fly = h('div', { class: 'cd-fly', role: 'dialog', 'aria-label': name, 'data-for': id },
      '<div class="cd-fly-h"><b>' + escapeHtml(name) + '</b><button class="cd-icon-btn" type="button" aria-label="Close"><svg class="cd-car" viewBox="0 0 10 10" aria-hidden="true"><path d="M1.5 1.5l7 7M8.5 1.5l-7 7"></path></svg></button></div><div class="cd-fly-b">' + body + '</div>');
    fly.querySelector('button').addEventListener('click', closeFly);
    root.querySelector('.cd-rail-in').appendChild(fly);
    var first = fly.querySelector('.cd-nav');
    if (first) first.focus();
  }

  function wireNav(container, inSheet) {
    container.addEventListener('click', function (e) {
      var grp = e.target.closest('.cd-grp');
      if (grp && container.contains(grp)) { e.preventDefault(); toggleGroup(grp); return; }
      var head = e.target.closest('.cd-sec');
      if (!head || !container.contains(head)) return;
      var sec = head.parentElement;
      if (!sec || !sec.hasAttribute('data-sec') || head.hasAttribute('data-locked')) return;
      if (inSheet) { e.preventDefault(); toggleSection(sec); return; }
      if (railMin()) { e.preventDefault(); openFly(sec); return; }
      if (head.tagName === 'BUTTON') toggleSection(sec);
    });
  }
  var railNav = root.querySelector('.cd-rail-nav');
  if (railNav) wireNav(railNav, false);
  document.addEventListener('click', function (e) {
    if (fly && !fly.contains(e.target) && !e.target.closest('.cd-rail-nav')) closeFly();
  });

  // ── Small screens: the Browse sheet is the rail's sections, opened one at a time ──
  var sheet = null;
  var lastFocus = null;
  function closeSheet() {
    if (!sheet) return;
    sheet.remove();
    sheet = null;
    document.documentElement.style.overflow = '';
    $$('[data-menu-open]').forEach(function (b) { b.setAttribute('data-on', 'false'); });
    if (lastFocus) lastFocus.focus();
  }
  function openSheet() {
    closeSearch();
    lastFocus = document.activeElement;
    sheet = h('div', { class: 'cd-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Browse docs' },
      '<div class="cd-sheet-top"><span class="cd-label">Browse</span><button class="cd-btn" data-variant="ghost" data-size="s" type="button">Close</button></div>');
    var nav = h('nav', { 'aria-label': 'Docs' }, railNav ? railNav.innerHTML : '');
    $$('.cd-sec', nav).forEach(function (s) { s.removeAttribute('title'); });
    sheet.appendChild(nav);
    sheet.querySelector('.cd-sheet-top button').addEventListener('click', closeSheet);
    wireNav(nav, true);
    root.appendChild(sheet);
    document.documentElement.style.overflow = 'hidden';
    $$('[data-menu-open]').forEach(function (b) { b.setAttribute('data-on', 'true'); });
    sheet.querySelector('.cd-sheet-top button').focus();
  }
  $$('[data-menu-open]').forEach(function (b) {
    b.addEventListener('click', function () { if (sheet) closeSheet(); else openSheet(); });
  });

  // ── Search: an index of titles, headings and text, fetched the first time it opens ──
  var index = null;
  var indexing = null;
  function getIndex() {
    if (index) return Promise.resolve(index);
    if (!indexing) {
      indexing = fetch(root.getAttribute('data-search'))
        .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
        .then(function (d) {
          d.docs.forEach(function (doc) {
            doc.lt = doc.t.toLowerCase();
            doc.lx = (doc.x || '').toLowerCase();
            doc.lh = doc.h.map(function (x) { return x[1].toLowerCase(); });
          });
          index = d;
          return d;
        })
        .catch(function (e) { indexing = null; throw e; });
    }
    return indexing;
  }

  function searchDocs(q) {
    var terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length || !index) return [];
    var whole = terms.join(' ');
    var hits = [];
    index.docs.forEach(function (d) {
      var all = function (s) { return terms.every(function (t) { return s.indexOf(t) >= 0; }); };
      var heads = d.lh.join(' ');
      if (!all(d.lt + ' ' + heads + ' ' + d.lx)) return;
      var rank;
      var url = d.u;
      var title = d.t;
      var hi = -1;
      if (d.lt.indexOf(whole) >= 0) rank = d.lt === whole ? 0 : 1;
      else if (all(d.lt)) rank = 2;
      else {
        d.lh.some(function (x, i) { if (all(x)) { hi = i; return true; } return false; });
        rank = hi >= 0 ? 3 : 4;
      }
      if (hi >= 0) { url = d.u + '#' + d.h[hi][0]; title = d.t + ' › ' + d.h[hi][1]; }
      var at = d.lx.indexOf(whole);
      if (at < 0) at = d.lx.indexOf(terms[0]);
      var snip = '';
      if (at >= 0 && rank > 1) {
        var from = Math.max(0, at - 40);
        snip = (from ? '…' : '') + d.x.slice(from, at + 90) + '…';
      }
      // Within a rank: terms in the title, then in headings, then how often the words appear.
      var score = 0;
      terms.forEach(function (t) {
        if (d.lt.indexOf(t) >= 0) score += 8;
        if (heads.indexOf(t) >= 0) score += 3;
        score += Math.min(10, d.lx.split(t).length - 1) / 2;
      });
      score += Math.min(10, d.lx.split(whole).length - 1) * 2;
      hits.push({ t: title, s: d.s, u: url, snip: snip, rank: rank, score: score });
    });
    hits.sort(function (a, b) { return a.rank - b.rank || b.score - a.score; });
    return hits.slice(0, 10);
  }

  var panel = null;
  var cursor = 0;
  var results = [];
  function closeSearch() {
    if (!panel) return;
    panel.scrim.remove();
    panel.box.remove();
    panel = null;
    document.documentElement.style.overflow = '';
    $$('.cd-tabbar [data-search-open]').forEach(function (b) { b.setAttribute('data-on', 'false'); });
    if (lastFocus) lastFocus.focus();
  }
  function renderResults(q) {
    if (!panel) return;
    var list = panel.box.querySelector('[data-results]');
    var band = panel.box.querySelector('[data-band]');
    if (!q.trim()) {
      results = (index ? index.suggested : []).map(function (s) { return { t: s.t, s: s.s, u: s.u, snip: '' }; });
      band.textContent = index ? 'Start here' : 'Loading';
    } else {
      results = searchDocs(q);
      band.textContent = results.length + (results.length === 1 ? ' result' : ' results');
    }
    cursor = Math.min(cursor, Math.max(results.length - 1, 0));
    var html = results.map(function (r, i) {
      return '<a class="cd-res" role="option" id="cd-res-' + i + '" aria-selected="' + (i === cursor) + '" data-on="' + (i === cursor) + '" href="' + escapeHtml(r.u) + '"><div><b>' + escapeHtml(r.t) + '</b><small>' + escapeHtml(r.snip) + '</small></div><span>' + escapeHtml(r.s) + '</span></a>';
    }).join('');
    if (q.trim() && !results.length) html = '<div class="cd-search-none cd-hatch"><p>Nothing by that name.</p></div>';
    list.innerHTML = html;
    var input = panel.box.querySelector('input');
    if (results.length) input.setAttribute('aria-activedescendant', 'cd-res-' + cursor);
    else input.removeAttribute('aria-activedescendant');
  }
  function moveCursor(by) {
    if (!results.length) return;
    cursor = Math.max(0, Math.min(results.length - 1, cursor + by));
    $$('.cd-res', panel.box).forEach(function (el, i) {
      el.setAttribute('data-on', String(i === cursor));
      el.setAttribute('aria-selected', String(i === cursor));
      if (i === cursor) el.scrollIntoView({ block: 'nearest' });
    });
    panel.box.querySelector('input').setAttribute('aria-activedescendant', 'cd-res-' + cursor);
  }
  function openSearch() {
    if (panel) return;
    closeSheet();
    closeFly();
    lastFocus = document.activeElement;
    var scrim = h('div', { class: 'cd-scrim' });
    var box = h('div', { class: 'cd-search', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Search docs' },
      '<div class="cd-search-h"><svg class="cd-ico" viewBox="0 0 18 18" aria-hidden="true"><circle cx="8" cy="8" r="5.5"></circle><path d="M12 12l4.5 4.5"></path></svg>' +
      '<input type="search" aria-label="Search docs" placeholder="Search docs" autocomplete="off" spellcheck="false" role="combobox" aria-expanded="true" aria-controls="cd-results">' +
      '<button class="cd-btn" data-variant="ghost" data-size="s" type="button">Close</button></div>' +
      '<div class="cd-search-band"><span class="cd-th" data-band>Start here</span><span class="cd-th">Arrows · Enter</span></div>' +
      '<div id="cd-results" role="listbox" aria-label="Results" data-results></div>' +
      '<p class="cd-search-f">Sign-in pages stay out of public search.</p>');
    root.appendChild(scrim);
    root.appendChild(box);
    panel = { scrim: scrim, box: box };
    cursor = 0;
    document.documentElement.style.overflow = 'hidden';
    $$('.cd-tabbar [data-search-open]').forEach(function (b) { b.setAttribute('data-on', 'true'); });
    var input = box.querySelector('input');
    scrim.addEventListener('click', closeSearch);
    box.querySelector('.cd-search-h button').addEventListener('click', closeSearch);
    input.addEventListener('input', function () { cursor = 0; renderResults(input.value); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); moveCursor(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); moveCursor(-1); }
      else if (e.key === 'Enter') {
        var r = results[cursor];
        if (r) { e.preventDefault(); window.location.href = r.u; closeSearch(); }
      }
    });
    box.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.preventDefault(); closeSearch(); }
      if (e.key === 'Tab') { // keep focus inside the dialog
        var f = $$('input, button, a[href]', box);
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      }
    });
    box.addEventListener('click', function (e) { if (e.target.closest('.cd-res')) closeSearch(); });
    input.focus();
    renderResults('');
    getIndex().then(function () { renderResults(input.value); }, function () {
      if (!panel) return;
      panel.box.querySelector('[data-band]').textContent = 'Search is unavailable';
    });
  }
  $$('[data-search-open]').forEach(function (b) { b.addEventListener('click', openSearch); });
  document.addEventListener('keydown', function (e) {
    var typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || '') || (e.target && e.target.isContentEditable);
    if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) { e.preventDefault(); if (panel) closeSearch(); else openSearch(); return; }
    if (e.key === '/' && !typing && !panel) { e.preventDefault(); openSearch(); return; }
    if (e.key === 'Escape') { closeSheet(); closeFly(); }
  });

  // ── On this page: highlight the section being read ──
  var tocLinks = $$('.cd-toc a');
  if (tocLinks.length) {
    var heads = tocLinks.map(function (a) { return document.getElementById(decodeURIComponent(a.getAttribute('href').slice(1))); });
    var ticking = false;
    var spy = function () {
      ticking = false;
      var cur = 0;
      heads.forEach(function (el, i) { if (el && el.getBoundingClientRect().top < 140) cur = i; });
      tocLinks.forEach(function (a, i) { a.setAttribute('data-on', String(i === cur)); });
    };
    window.addEventListener('scroll', function () { if (!ticking) { ticking = true; window.requestAnimationFrame(spy); } }, { passive: true });
    spy();
  }

  // ── Copy buttons on code ──
  root.addEventListener('click', function (e) {
    var b = e.target.closest('[data-copy]');
    if (!b) return;
    var code = b.closest('.cd-code').querySelector('pre');
    var done = function () { b.textContent = 'Copied'; setTimeout(function () { b.textContent = 'Copy'; }, 1600); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(code.textContent).then(done, function () { b.textContent = 'Copy failed'; });
    else b.textContent = 'Copy failed';
  });

  // ── The contract maps: select a contract to trace it; hover to look ──
  $$('[data-graph]').forEach(function (fig) {
    var nodes = $$('.cd-gn', fig);
    var edges = $$('.cd-edge', fig);
    var sel = (nodes.filter(function (n) { return n.getAttribute('data-s') === 'on'; })[0] || nodes[0]).getAttribute('data-n');
    var hot = null;
    function paint() {
      var focus = hot || sel;
      var linked = {};
      linked[focus] = 1;
      edges.forEach(function (e) {
        var a = e.getAttribute('data-a'), b = e.getAttribute('data-b');
        var on = a === focus || b === focus;
        if (on) { linked[a] = 1; linked[b] = 1; }
        e.setAttribute('data-s', on ? 'on' : hot ? 'off' : '');
      });
      nodes.forEach(function (n) {
        var name = n.getAttribute('data-n');
        n.setAttribute('data-s', name === focus ? 'on' : hot && !linked[name] ? 'off' : '');
        n.setAttribute('aria-pressed', String(name === sel));
      });
    }
    function pick(n) {
      sel = n.getAttribute('data-n');
      fig.querySelector('[data-role="name"]').textContent = sel;
      fig.querySelector('[data-role="job"]').textContent = n.getAttribute('data-job');
      var scan = fig.querySelector('[data-role="scan"]');
      scan.hidden = !n.getAttribute('data-scan');
      scan.setAttribute('href', n.getAttribute('data-scan') || '#');
      scan.textContent = n.getAttribute('data-short');
      fig.querySelector('[data-role="open"]').setAttribute('href', n.getAttribute('data-href'));
      paint();
    }
    nodes.forEach(function (n) {
      n.addEventListener('click', function () { pick(n); });
      n.addEventListener('mouseenter', function () { hot = n.getAttribute('data-n'); paint(); });
      n.addEventListener('mouseleave', function () { hot = null; paint(); });
      n.addEventListener('focus', function () { hot = null; paint(); });
    });
  });

  // ── The org chart: select an entity to see who owns it ──
  $$('[data-org]').forEach(function (fig) {
    var items = $$('[data-o]', fig);
    var edges = $$('.cd-oe', fig);
    function pick(id) {
      var row = null;
      items.forEach(function (el) {
        var on = el.getAttribute('data-o') === id;
        el.setAttribute('data-on', String(on));
        el.setAttribute('aria-pressed', String(on));
        if (on) row = el;
      });
      var chain = id === 'lend' || id === 'prop' ? [id, 'hold'] : [id];
      edges.forEach(function (e) {
        var k = e.getAttribute('data-e');
        e.setAttribute('data-on', String(k === 'found' ? id === 'found' || id === 'labs' : chain.indexOf(k) >= 0));
      });
      fig.querySelector('[data-role="name"]').textContent = row.querySelector('b').textContent;
      fig.querySelector('[data-role="by"]').textContent = row.getAttribute('data-by');
      fig.querySelector('[data-role="what"]').textContent = row.getAttribute('data-what');
    }
    items.forEach(function (el) {
      el.addEventListener('click', function () { pick(el.getAttribute('data-o')); });
      if (el.classList.contains('cd-on')) el.addEventListener('mouseenter', function () { pick(el.getAttribute('data-o')); });
    });
  });

  // ── Contract map: switch the address table between networks ──
  $$('[data-seg]').forEach(function (seg) {
    seg.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-net]');
      if (!b) return;
      var net = b.getAttribute('data-net');
      $$('button[data-net]', seg).forEach(function (x) {
        var on = x === b;
        x.setAttribute('data-on', String(on));
        x.setAttribute('aria-pressed', String(on));
      });
      $$('.cd-table[data-net]').forEach(function (t) { t.hidden = t.getAttribute('data-net') !== net; });
    });
  });

  // ── Mermaid diagrams, drawn in the browser with the Clear theme (light and dark) ──
  var MERMAID = 'https://cdn.jsdelivr.net/npm/mermaid@11.17.2/dist/mermaid.esm.min.mjs';
  var LIGHT = { background: 'transparent', primaryColor: '#E9ECE7', primaryBorderColor: '#16211D', primaryTextColor: '#16211D', secondaryColor: '#DFE3DE', tertiaryColor: '#DFE3DE', lineColor: '#16211D', textColor: '#16211D', fontFamily: 'Instrument Sans, Arial, sans-serif', fontSize: '15px', noteBkgColor: '#E9ECE7', noteBorderColor: '#16211D', actorBkg: '#E9ECE7', actorBorder: '#16211D', signalColor: '#16211D', signalTextColor: '#16211D', clusterBkg: 'transparent', clusterBorder: '#16211D', edgeLabelBackground: '#DFE3DE' };
  var DARK = { background: 'transparent', primaryColor: '#1E2C27', primaryBorderColor: '#DFE3DE', primaryTextColor: '#DFE3DE', secondaryColor: '#16211D', tertiaryColor: '#16211D', lineColor: '#ABB1AC', textColor: '#DFE3DE', fontFamily: 'Instrument Sans, Arial, sans-serif', fontSize: '15px', noteBkgColor: '#1E2C27', noteBorderColor: '#DFE3DE', actorBkg: '#1E2C27', actorBorder: '#DFE3DE', signalColor: '#DFE3DE', signalTextColor: '#DFE3DE', clusterBkg: 'transparent', clusterBorder: '#ABB1AC', edgeLabelBackground: '#16211D' };
  function themeCss(bg) {
    return '.node rect,.cluster rect,.actor,rect{rx:0!important;ry:0!important}text,tspan{font-style:normal!important}' +
      '.edgeLabel,.edgeLabel p,.labelBkg{background:' + bg + '!important;background-color:' + bg + '!important;opacity:1!important}' +
      '.edgeLabel rect{fill:' + bg + '!important;opacity:1!important}.edgeLabel p{padding:0 3px}';
  }
  var figures = $$('[data-mermaid]');
  figures.forEach(function (fig) {
    var code = fig.querySelector('pre');
    fig._src = code ? code.textContent : '';
  });
  var mermaidLib = null;
  var drawn = 0;
  function drawDiagrams() {
    if (!figures || !figures.length) return;
    if (!mermaidLib) mermaidLib = import(MERMAID).then(function (m) { return m.default; });
    var t = theme();
    mermaidLib.then(function (mermaid) {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: 'base',
        themeVariables: t === 'dark' ? DARK : LIGHT,
        themeCSS: themeCss(t === 'dark' ? '#16211D' : '#DFE3DE'),
        flowchart: { curve: 'linear', htmlLabels: false },
      });
      var run = Promise.resolve();
      figures.forEach(function (fig) {
        run = run.then(function () {
          return mermaid.render('cd-mermaid-' + drawn++, fig._src).then(function (r) {
            var out = fig.querySelector('.cd-mermaid-svg') || h('div', { class: 'cd-mermaid-svg', role: 'img', 'aria-label': 'Diagram' });
            out.innerHTML = r.svg;
            if (!out.parentNode) {
              var code = fig.querySelector('.cd-code');
              if (code) code.hidden = true;
              fig.appendChild(out);
            }
            fig.setAttribute('data-done', '');
          }, function () { /* leave the source showing */ });
        });
      });
    }, function () { /* offline or blocked: the source stays as code */ });
  }
  drawDiagrams();
})();

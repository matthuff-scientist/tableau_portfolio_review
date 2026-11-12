'use strict';
// One short page: synopsis, trends, opportunities, individual dashboard tiles.
(function () {
  var root = document.getElementById('app');
  var C = window.GrowthCore, U = C.util;
  var mean = U.mean, clamp = U.clamp, r0 = U.r0, signed = U.signed, trunc = U.trunc, monthYear = U.monthYear, shortDate = U.shortDate;
  var PILLARS = C.PILLARS;

  // ---------------------------------------------------------------------------------------------
  // DOM helpers (textContent only: live data never goes through innerHTML)
  // ---------------------------------------------------------------------------------------------
  var SVGNS = 'http://www.w3.org/2000/svg';
  function applyProps(e, p) {
    for (var k in p) {
      if (!Object.prototype.hasOwnProperty.call(p, k)) { continue; }
      var v = p[k];
      if (v === null || v === undefined) { continue; }
      if (k === 'text') { e.textContent = v; }
      else if (k.slice(0, 2) === 'on') { e.addEventListener(k.slice(2), v); }
      else { e.setAttribute(k, v); }
    }
  }
  function addKids(e, kids) { (kids || []).forEach(function (c) { if (c === null || c === undefined || c === false) { return; } e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); }); }
  function h(tag, p, kids) { var e = document.createElement(tag); applyProps(e, p); addKids(e, kids); return e; }
  function s(tag, p, kids) { var e = document.createElementNS(SVGNS, tag); applyProps(e, p); addKids(e, kids); return e; }

  var state = { profile: null, data: null, A: null, self: {}, source: 'workbook', sort: 'score', show: 12 };
  function storeKey() { return 'tpGrowthReview:' + (state.profile || ''); }
  function loadSelf() { try { state.self = JSON.parse(window.localStorage.getItem(storeKey()) || '{}') || {}; } catch (e) { state.self = {}; } }
  function saveSelf() { try { window.localStorage.setItem(storeKey(), JSON.stringify(state.self)); } catch (e) { /* storage may be blocked */ } }
  function vizUrl(w) { return 'https://public.tableau.com/app/profile/' + encodeURIComponent(w.profile) + '/viz/' + encodeURIComponent(w.repo); }
  function thumbUrl(w) {
    var vr = w.view.replace(/\./g, '_').replace(/[^A-Za-z0-9_-]/g, '');
    return 'https://public.tableau.com/static/images/' + encodeURIComponent(w.repo.slice(0, 2)) + '/' + encodeURIComponent(w.repo) + '/' + encodeURIComponent(vr) + '/1.png';
  }
  function pctText(v) { return r0(v * 100) + '%'; }

  // ---------------------------------------------------------------------------------------------
  // Trend sparkline: the rolling score over your timeline, first and latest points marked
  // ---------------------------------------------------------------------------------------------
  function sparkline(values, color) {
    var Wd = 260, Ht = 70, pad = 6, lo = Math.min.apply(null, values), hi = Math.max.apply(null, values), span = (hi - lo) || 1;
    var svg = s('svg', { viewBox: '0 0 ' + Wd + ' ' + Ht, class: 'spark', role: 'img', 'aria-label': 'Trend from ' + r0(values[0]) + ' to ' + r0(values[values.length - 1]) });
    function X(i) { return pad + i / (values.length - 1) * (Wd - 2 * pad); }
    function Y(v) { return Ht - pad - (v - lo) / span * (Ht - 2 * pad); }
    var d = values.map(function (v, i) { return (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1); }).join('');
    svg.appendChild(s('path', { d: d + 'L' + X(values.length - 1) + ' ' + (Ht - pad) + 'L' + X(0) + ' ' + (Ht - pad) + 'Z', fill: color, 'fill-opacity': 0.12 }));
    svg.appendChild(s('path', { d: d, fill: 'none', stroke: color, 'stroke-width': 2.6, 'stroke-linejoin': 'round' }));
    svg.appendChild(s('circle', { cx: X(0), cy: Y(values[0]), r: 3.5, fill: '#0b1020', stroke: color, 'stroke-width': 2 }));
    svg.appendChild(s('circle', { cx: X(values.length - 1), cy: Y(values[values.length - 1]), r: 4.5, fill: color }));
    return svg;
  }

  // ---------------------------------------------------------------------------------------------
  // Page blocks
  // ---------------------------------------------------------------------------------------------
  function block(kicker, title, sub, id) {
    return h('section', { class: 'band', id: id || null }, [h('div', { class: 'bandhead' }, [h('div', { class: 'kicker', text: kicker }), h('h2', { text: title }), sub ? h('p', { class: 'sub', text: sub }) : null])]);
  }

  // Search by profile name or URL, plus a way back to the connected workbook data.
  function parseProfile(v) {
    v = String(v || '').trim();
    var m = v.match(/profile\/([A-Za-z0-9._-]+)/);
    if (m) { return m[1]; }
    v = v.replace(/^@/, '');
    return /^[A-Za-z0-9._-]{1,80}$/.test(v) ? v : null;
  }
  function topBar() {
    var status = h('span', { class: 'pstatus', text: '', role: 'status' });
    var input = h('input', { type: 'text', class: 'psearch', placeholder: 'Review a profile: name or public.tableau.com URL', 'aria-label': 'Tableau Public profile name or URL', value: state.source === 'profile' ? state.profile : '' });
    var go = h('button', { class: 'drillbtn gobtn', type: 'submit', text: 'Review profile' });
    function useRows(rows, name) {
      var norm = normalize(rows);
      if (!norm.length) { status.className = 'pstatus bad'; status.textContent = 'No dated workbooks were found for ' + name + '.'; return false; }
      if (norm.length < 12) { status.className = 'pstatus bad'; status.textContent = name + ' has ' + norm.length + ' public workbooks. The review needs at least 12 to compare early and recent work.'; return false; }
      state.data = { rows: norm }; state.profile = name; state.source = 'profile'; loadSelf(); state.A = C.analyze(norm, name); render(true); return true;
    }
    var form = h('form', { class: 'pform', onsubmit: function (e) {
      e.preventDefault();
      var name = parseProfile(input.value);
      if (!name) { status.className = 'pstatus bad'; status.textContent = 'Enter a profile name like matt.huff, or paste your profile URL.'; return; }
      go.disabled = true; status.className = 'pstatus'; status.textContent = 'Fetching ' + name + '’s workbooks. This can take 20-30 seconds for large profiles.';
      GrowthHost.loadProfile(name).then(function (rows) { if (useRows(rows, name) === false) { go.disabled = false; } }).catch(function (err) {
        go.disabled = false; status.className = 'pstatus bad'; status.textContent = (err && err.message) || String(err);
      });
    } }, [input, go]);
    var kids = [h('div', { class: 'brand', text: 'Profile growth review' }), form, state.source === 'profile' ? null : h('span', { class: 'pstatus', text: GrowthHost.snapshotLabel() + (state.profile ? ' of ' + state.profile : '') + '.' })];
    if (state.source === 'profile') { kids.push(h('button', { class: 'upbtn', type: 'button', text: 'Back to saved data', onclick: function () { state.source = 'workbook'; load(true).catch(function (e) { showMessage('Data error: ' + (e && e.message || e)); }); } })); }
    kids.push(status);
    return h('header', { class: 'topbar' }, kids);
  }

  // 1. Synopsis
  function synopsis(A, ops) {
    var E = A.eras, W = A.W, d = E[3].composite - E[0].composite, now = E[3].composite;
    var proj = Math.min(100, now + ops.slice(0, 3).reduce(function (a, o) { return a + o.uplift; }, 0));
    var pillars = PILLARS.map(function (p) { return { p: p, v: E[3][p.key] }; }).sort(function (a, b) { return b.v - a.v; });
    function pace(st) { return st.n / Math.max(1, (st.end - st.start) / (30.4 * 864e5)); }
    function fav(st) { return mean(st.items.map(function (w) { return w.favRate; })); }
    var tiles = [
      { l: 'Craft score', v: r0(now) + '/100', was: r0(E[0].composite), d: d, u: '' },
      { l: 'Publishing pace', v: (Math.round(pace(E[3]) * 10) / 10).toFixed(1) + '/mo', was: (Math.round(pace(E[0]) * 10) / 10).toFixed(1), d: pace(E[3]) - pace(E[0]), u: '', dec: 1 },
      { l: 'Audience response', v: (Math.round(fav(E[3]) * 10) / 10).toFixed(1), was: (Math.round(fav(E[0]) * 10) / 10).toFixed(1), d: fav(E[3]) - fav(E[0]), u: '', dec: 1, hint: 'favorites per 100 views' }
    ];
    var sec = h('section', { class: 'synopsis', id: 'synopsis' }, [
      h('div', { class: 'eyebrow', text: W[0].profile + ' | ' + A.n + ' workbooks | ' + monthYear(W[0].date) + ' to ' + monthYear(W[A.n - 1].date) }),
      h('h1', {}, [C.trajectory(d), h('span', { class: 'traj', text: ' ' + r0(E[0].composite) + ' → ' + r0(now) })]),
      h('p', { class: 'lede', text: (d >= 3 ? 'Your work has measurably improved. ' : (d <= -3 ? 'Your latest work scores lower than your early work. ' : 'Your scores are steady. ')) + pillars[0].p.label + ' is your strongest area and ' + pillars[2].p.label.toLowerCase() + ' has the most room. ' + (ops.length ? 'Three fixes to your latest ' + E[3].n + ' workbooks could lift your craft score from ' + r0(now) + ' to about ' + r0(proj) + '.' : 'Your latest workbooks pass every tracked check.') }),
      A.dateTrust < 0.85 ? h('p', { class: 'warn', text: 'Heads up: dates on this profile look edited after publishing (agreement ' + r0(A.dateTrust * 100) + '%), so the timeline is approximate.' }) : null,
      h('div', { class: 'tiles' }, tiles.map(function (t) {
        var dv = Math.round(t.d * (t.dec ? 10 : 1)) / (t.dec ? 10 : 1);
        return h('div', { class: 'tile' }, [h('div', { class: 'kl', text: t.l }), h('div', { class: 'mval', text: t.v }), h('div', { class: 'kd ' + (t.d >= 0 ? 'up' : 'dn'), text: (t.d >= 0 ? '▲ ' : '▼ ') + Math.abs(dv) + ' vs the start (was ' + t.was + ')' }), t.hint ? h('div', { class: 'mhint', text: t.hint }) : null]);
      })),
      h('p', { class: 'mhint', text: 'Craft score (0-100) rates how clearly each workbook is named, framed, documented and structured, from public titles, names and descriptions. It cannot see colour or layout; see "Add your own eye" below.' })
    ]);
    return sec;
  }

  // 2. Trends: one sparkline per measure, with a plain-language note
  function trends(A) {
    var W = A.W, T = A.turn, E = A.eras;
    var series = [
      { l: 'Craft score', vals: W.map(function (w) { return (w.rd + w.rs + w.rr) / 3; }), color: '#e6edf7', note: 'Average of the three below' },
      { l: PILLARS[0].label, vals: W.map(function (w) { return w.rd; }), color: PILLARS[0].color, note: 'Names, titles, structure' },
      { l: PILLARS[1].label, vals: W.map(function (w) { return w.rs; }), color: PILLARS[1].color, note: 'Headlines and written context' },
      { l: PILLARS[2].label, vals: W.map(function (w) { return w.rr; }), color: PILLARS[2].color, note: 'Comparisons, sources, depth' }
    ];
    var sec = block('Trends', 'Where you are heading', T && T.gain >= 3 ? 'Your biggest step up came around ' + monthYear(T.date) + ': scores rose ' + r0(T.gain) + ' points over the next ' + T.step + ' workbooks.' : 'Each line is a rolling average across your timeline. Open circle is the start, filled circle is now.', 'trends');
    // Each tile flips on click to a short definition. Fixed-length text keeps every tile the same size.
    var DEFS = [
      { d: 'The average of Design, Storytelling and Analytical rigor, from 0 to 100.', c: 'It rises when all three rise together.' },
      { d: 'How intentionally a workbook is named and structured.', c: 'Counts: a named view, a real title, a tidy title, more than one view.' },
      { d: 'How clearly a workbook frames its message.', c: 'Counts: a question or contrast headline, written context.' },
      { d: 'How testable a workbook’s claim is.', c: 'Counts: a measurable comparison, a credited source, extra views.' }
    ];
    sec.appendChild(h('div', { class: 'sparkgrid' }, series.map(function (se, i) {
      var first = se.vals[0], last = se.vals[se.vals.length - 1], dv = last - first;
      var front = h('div', { class: 'face front panel spk' }, [h('div', { class: 'kl', text: se.l }), h('div', { class: 'sparkrow' }, [h('div', { class: 'mval', text: r0(last) }), h('div', { class: 'kd ' + (dv >= 0 ? 'up' : 'dn'), text: (dv >= 0 ? '▲ ' : '▼ ') + Math.abs(r0(dv)) })]), sparkline(se.vals, se.color), h('div', { class: 'mhint', text: se.note }), h('div', { class: 'flipcue', text: 'Click for definition ↻' })]);
      var back = h('div', { class: 'face back panel spk', style: 'border-top-color:' + se.color }, [h('div', { class: 'kl', text: se.l }), h('p', { class: 'flipdef', text: DEFS[i].d }), h('p', { class: 'flipp', text: DEFS[i].c }),
        h('div', { class: 'flipcue', text: 'Click to flip back ↻' })]);
      var tile = h('div', { class: 'flip', role: 'button', tabindex: '0', 'aria-pressed': 'false', 'aria-label': se.l + ' trend. Press to flip for a description.' }, [h('div', { class: 'flip-inner' }, [front, back])]);
      function toggle() { var on = tile.classList.toggle('flipped'); tile.setAttribute('aria-pressed', on ? 'true' : 'false'); }
      tile.addEventListener('click', toggle);
      tile.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
      return tile;
    })));
    return sec;
  }

  // 3. Opportunities: the three biggest fixes, with the workbooks to start with
  function opportunities(A, ops) {
    var E = A.eras, sec = block('Opportunities', ops.length ? 'Where you can improve most' : 'Nothing left to fix in your latest work', 'Ranked by points added to your craft score across your latest ' + E[3].n + ' workbooks. Gains add up because each fix touches different checks.', 'opps');
    sec.appendChild(h('div', { class: 'cards3' }, ops.slice(0, 3).map(function (o, i) {
      var pc = C.pillarInfo(o.pillar), first = o.items.slice().sort(function (a, b) { return b.views - a.views; }).slice(0, 2);
      return h('article', { class: 'card opp', style: 'border-top-color:' + pc.color }, [h('div', { class: 'oppn', text: '#' + (i + 1) + ' | ' + pc.label }), h('div', { class: 'oppgain', text: '+' + r0(o.uplift) }), h('div', { class: 'oppunit', text: 'craft score' }),
        h('h3', { text: o.t }), h('p', { class: 'ev', text: o.n + ' of your latest ' + o.of + ' workbooks' }), h('p', { text: o.d }),
        h('div', { class: 'startwith' }, [h('b', { text: 'Start with: ' })].concat(first.map(function (w, j) { return h('span', {}, [j ? ' and ' : '', h('a', { href: vizUrl(w), target: '_blank', rel: 'noopener', text: trunc(w.title, 30) })]); })))]);
    })));
    return sec;
  }

  // 4. Your dashboards: one tile per workbook with its performance bars. Click flips to a preview image.
  var PAGE = 12;
  function miniBar(label, v, color) {
    return h('div', { class: 'barrow' }, [h('span', { class: 'bl', text: label }), h('div', { class: 'track' }, [h('div', { class: 'fill', style: 'width:' + clamp(v, 0, 100) + '%;background:' + color })]), h('span', { class: 'bv', text: r0(v) })]);
  }
  function wbTile(w, rank) {
    var fix = C.fixes(w)[0], link = h('a', { href: vizUrl(w), target: '_blank', rel: 'noopener', text: w.title });
    link.addEventListener('click', function (e) { e.stopPropagation(); });
    var front = h('div', { class: 'face front panel wbf' }, [
      h('div', { class: 'wbtop' }, [h('span', { class: 'rank', text: '#' + rank }), h('span', { class: 'chip', style: 'background:' + C.TYPE_COLORS[w.type], text: w.type })]),
      h('div', { class: 'wbtitle' }, [link]),
      h('div', { class: 'dm', text: shortDate(w.date) + ' | ' + w.views.toLocaleString() + ' views | ' + w.favs + ' favorites' }),
      h('div', { class: 'wbscore' }, [h('span', { class: 'mval', text: r0(w.composite) }), h('span', { class: 'mhint', text: 'craft score' })]),
      miniBar('Design', w.design, PILLARS[0].color), miniBar('Story', w.story, PILLARS[1].color), miniBar('Rigor', w.rigor, PILLARS[2].color),
      h('div', { class: 'wbfix', text: fix ? 'Top fix: ' + fix.t.toLowerCase() + ' (+' + r0(fix.gain) + ')' : 'Passes every check' }),
      h('div', { class: 'flipcue', text: 'Click to see the dashboard ↻' })]);
    var box = h('div', { class: 'thumbbox big' }), img = h('img', { src: thumbUrl(w), alt: 'Preview of ' + w.title, loading: 'lazy' });
    img.addEventListener('error', function () { box.textContent = ''; box.appendChild(h('div', { class: 'nothumb', text: 'No preview available' })); });
    box.appendChild(img);
    var open = h('a', { href: vizUrl(w), target: '_blank', rel: 'noopener', class: 'lnk', text: 'Open on Tableau Public ↗' });
    open.addEventListener('click', function (e) { e.stopPropagation(); });
    var back = h('div', { class: 'face back panel wbf' }, [box, h('div', { class: 'wbtitle small', text: trunc(w.title, 60) }), open, h('div', { class: 'flipcue', text: 'Click to flip back ↻' })]);
    var tile = h('div', { class: 'flip wbflip', role: 'button', tabindex: '0', 'aria-pressed': 'false', 'aria-label': w.title + ', craft score ' + r0(w.composite) + '. Press to see the dashboard.' }, [h('div', { class: 'flip-inner' }, [front, back])]);
    function toggle() { var on = tile.classList.toggle('flipped'); tile.setAttribute('aria-pressed', on ? 'true' : 'false'); }
    tile.addEventListener('click', toggle);
    tile.addEventListener('keydown', function (e) { if (e.target === tile && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggle(); } });
    return tile;
  }
  function dashboards(A) {
    var sec = block('Your dashboards', 'How each dashboard performs', 'Each tile shows the craft score and its three pillars. Click a tile to see the dashboard itself.', 'dashboards');
    var sortbar = h('div', { class: 'sortbar', role: 'group', 'aria-label': 'Sort dashboards' }), grid = h('div', { class: 'wbgrid' }), foot = h('div', { class: 'btnrow wbfoot' }), btns = {};
    [['score', 'Top scoring'], ['views', 'Most viewed']].forEach(function (o) {
      btns[o[0]] = h('button', { class: 'segbtn', type: 'button', text: o[1], onclick: function () { state.sort = o[0]; state.show = PAGE; draw(); } });
    });
    addKids(sortbar, [h('span', { class: 'cl', text: 'Sort by' }), btns.score, btns.views]);
    function draw() {
      var list = A.W.slice().sort(state.sort === 'views' ? function (a, b) { return b.views - a.views || b.composite - a.composite; } : function (a, b) { return b.composite - a.composite || b.views - a.views; });
      var shown = list.slice(0, state.show);
      Object.keys(btns).forEach(function (k) { btns[k].className = 'segbtn' + (state.sort === k ? ' on' : ''); btns[k].setAttribute('aria-pressed', state.sort === k ? 'true' : 'false'); });
      grid.textContent = ''; shown.forEach(function (w, i) { grid.appendChild(wbTile(w, i + 1)); });
      foot.textContent = '';
      foot.appendChild(h('span', { class: 'pstatus', text: 'Showing ' + shown.length + ' of ' + list.length }));
      if (shown.length < list.length) { foot.appendChild(h('button', { class: 'drillbtn', type: 'button', text: 'Show ' + Math.min(PAGE, list.length - shown.length) + ' more', onclick: function () { state.show += PAGE; draw(); } })); }
      if (state.show > PAGE) { foot.appendChild(h('button', { class: 'upbtn', type: 'button', text: 'Show fewer', onclick: function () { state.show = PAGE; draw(); } })); }
    }
    draw();
    addKids(sec, [sortbar, grid, foot]);
    return sec;
  }

  // Optional, collapsed: compare early and recent design with your own eye, plus the exportable report
  function eyeCheck(A) {
    var E0 = A.eras[0], E3 = A.eras[3], early = A.W.slice(0, 3), recent = A.W.slice(-3);
    function avg(list) { var v = list.map(function (w) { return (state.self[w.repo] || {}).design; }).filter(Boolean); return v.length ? mean(v) : null; }
    var ea = avg(early), ra = avg(recent), sig = E3.design - E0.design, result = null;
    if (ea !== null && ra !== null) {
      var eye = (ra - ea) * 20;
      result = h('p', { class: 'eyeres' }, [h('b', { text: 'Your eye: design ' + ea.toFixed(1) + ' → ' + ra.toFixed(1) + ' out of 5 (' + signed(eye) + ' points). ' }), 'The signals say ' + signed(sig) + '. ' + (eye - sig > 10 ? 'You see more design growth than the metadata can. Trust your eye.' : (eye - sig < -10 ? 'You rate recent work lower than the signals do.' : 'Your eye and the signals agree.'))]);
    }
    function thumbCard(w) {
      var mine = (state.self[w.repo] || {}).design, box = h('div', { class: 'thumbbox' }), img = h('img', { src: thumbUrl(w), alt: 'Preview of ' + w.title, loading: 'lazy' });
      img.addEventListener('error', function () { box.textContent = ''; box.appendChild(h('div', { class: 'nothumb', text: 'No preview available' })); });
      box.appendChild(img);
      var rate = h('div', { class: 'grp' });
      for (var v = 1; v <= 5; v++) {
        (function (val) { rate.appendChild(h('button', { class: 'rb' + (mine === val ? ' on' : ''), type: 'button', text: val, 'aria-label': 'Design ' + val + ' of 5 for ' + w.title, onclick: function () { var cur = state.self[w.repo] || {}; cur.design = cur.design === val ? 0 : val; state.self[w.repo] = cur; saveSelf(); render(false, true); } })); })(v);
      }
      return h('div', { class: 'thumb' }, [h('a', { href: vizUrl(w), target: '_blank', rel: 'noopener' }, [box]), h('div', { class: 'tt', text: trunc(w.title, 40) }), h('div', { class: 'dm', text: shortDate(w.date) }), rate]);
    }
    var det = h('details', { class: 'more', id: 'eye' }, [h('summary', { text: 'Add your own eye: compare early and recent design (optional)' }),
      h('p', { class: 'sub', text: 'The score cannot see how clean or polished a dashboard looks. Rate your three earliest and three latest workbooks from 1 (rough) to 5 (polished).' }),
      h('div', { class: 'eyecols' }, [h('div', {}, [h('h4', { text: 'Earliest' }), h('div', { class: 'thumbs' }, early.map(thumbCard))]), h('div', {}, [h('h4', { text: 'Latest' }), h('div', { class: 'thumbs' }, recent.map(thumbCard))])]), result]);
    if (state.eyeOpen || result) { det.setAttribute('open', 'open'); }
    det.addEventListener('toggle', function () { state.eyeOpen = det.open; });
    return det;
  }

  function reportDetails(A) {
    var text = C.reportText(A), ta = h('textarea', { class: 'report', readonly: 'readonly', rows: '9' }), note = h('span', { class: 'okmsg', text: '' });
    ta.value = text;
    var copy = h('button', { class: 'drillbtn', type: 'button', text: 'Copy report', onclick: function () {
      ta.select();
      var done = function () { note.textContent = 'Copied.'; };
      if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).then(done, function () { try { document.execCommand('copy'); done(); } catch (e) { note.textContent = 'Select the text and copy it manually.'; } }); }
      else { try { document.execCommand('copy'); done(); } catch (e) { note.textContent = 'Select the text and copy it manually.'; } }
    } });
    var dl = h('button', { class: 'drillbtn', type: 'button', text: 'Download .md', onclick: function () {
      try { var a = h('a', { href: URL.createObjectURL(new Blob([text], { type: 'text/markdown' })), download: 'growth-review.md' }); document.body.appendChild(a); a.click(); document.body.removeChild(a); }
      catch (e) { note.textContent = 'Download is blocked here; use Copy report.'; }
    } });
    return h('details', { class: 'more' }, [h('summary', { text: 'Take it with you: copy or download this review' }), ta, h('div', { class: 'btnrow' }, [copy, dl, note])]);
  }

  function render(toTop, keepScroll) {
    var A = state.A, y = window.scrollY, ops = C.opportunities(A);
    root.textContent = '';
    root.appendChild(topBar());
    root.appendChild(synopsis(A, ops));
    root.appendChild(trends(A));
    root.appendChild(opportunities(A, ops));
    root.appendChild(dashboards(A));
    root.appendChild(eyeCheck(A));
    root.appendChild(reportDetails(A));
    root.appendChild(h('p', { class: 'foot', text: 'Scores use only public titles, view names, descriptions, views, favorites and last-updated dates. They are conversation starters, not verdicts. Gains estimate the craft score, not audience growth.' }));
    window.scrollTo(0, toTop && !keepScroll ? 0 : y);
  }

  // ---------------------------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------------------------
  function showMessage(msg) { root.textContent = ''; root.appendChild(topBar()); root.appendChild(h('p', { class: 'error', text: msg })); }
  function normalize(data) {
    return data.map(function (r) {
      return { title: String(r.Workbook || ''), repo: String(r.RepoUrl || ''), view: String(r.DefaultView || ''), date: new Date(r.LastUpdated).getTime(), desc: String(r.Description || ''), profile: String(r.Profile || ''),
        views: Number(r.Views) || 0, favs: Number(r.Favorites) || 0, sheets: Number(r.SheetCount) || 0, descLen: Number(r.DescriptionLength) || 0, order: Number(r.ListOrder) || 0 };
    }).filter(function (w) { return w.title && !isNaN(w.date); });
  }
  function load(first) {
    return GrowthHost.load().then(function (data) {
      var rows = normalize(data), profiles = [];
      if (!rows.length) { showMessage('No workbook rows with a valid date were found.'); return; }
      rows.forEach(function (r) { if (profiles.indexOf(r.profile) < 0) { profiles.push(r.profile); } });
      if (first || !state.profile || profiles.indexOf(state.profile) < 0) { state.profile = profiles[0]; loadSelf(); }
      state.data = { rows: rows };
      var count = rows.filter(function (r) { return r.profile === state.profile; }).length;
      if (count < 12) { showMessage('This review compares early and recent work, so it needs at least 12 workbooks (found ' + count + ').'); return; }
      state.A = C.analyze(rows, state.profile); render(true);
    });
  }
  GrowthHost.init().then(function () {
    GrowthHost.onChange(function () { if (state.source !== 'workbook') { return; } load(false).catch(function (e) { showMessage('Data error: ' + (e && e.message || e)); }); });
    return load(true);
  }).catch(function (err) { showMessage('Live query unavailable: ' + ((err && (err.message || err.errorCode)) || String(err))); });
})();

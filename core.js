'use strict';
// GrowthCore: host-agnostic analysis. Scores, eras, clusters, habits, coaching and narrative text.
// All scores are transparent proxies built from public metadata only.
(function () {
  function mean(a) { return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : 0; }
  function sd(a) { var m = mean(a); return Math.sqrt(mean(a.map(function (x) { return (x - m) * (x - m); }))); }
  function median(a) {
    if (!a.length) { return 0; }
    var b = a.slice().sort(function (x, y) { return x - y; }), m = Math.floor(b.length / 2);
    return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2;
  }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function r0(v) { return Math.round(v); }
  function signed(v) { var r = Math.round(v); return (r > 0 ? '+' : '') + r; }
  function trunc(t, n) { return t.length > n ? t.slice(0, n - 1) + '...' : t; }
  function pearson(xs, ys) {
    var mx = mean(xs), my = mean(ys), num = 0, dx = 0, dy = 0;
    for (var i = 0; i < xs.length; i++) { num += (xs[i] - mx) * (ys[i] - my); dx += Math.pow(xs[i] - mx, 2); dy += Math.pow(ys[i] - my, 2); }
    return dx && dy ? num / Math.sqrt(dx * dy) : 0;
  }
  function monthYear(ms) { return new Date(ms).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }); }
  function shortDate(ms) { return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }); }

  var PILLARS = [
    { key: 'design', label: 'Design', color: '#818cf8' },
    { key: 'story', label: 'Storytelling', color: '#2dd4bf' },
    { key: 'rigor', label: 'Analytical rigor', color: '#fbbf24' }
  ];
  var TYPE_COLORS = { 'Community challenge': '#94a3b8', 'Technique piece': '#22d3ee', 'Standalone': '#fb7185' };
  var ERA_NAMES = ['Foundations', 'Exploration', 'Acceleration', 'Current'];
  var CL_COLORS = { 'Signature pieces': '#2dd4bf', 'Hidden gems': '#818cf8', 'Crowd-pleasers': '#fbbf24', 'Quick sketches': '#94a3b8' };
  var CL_EXTRA = ['#f472b6', '#38bdf8', '#a3e635'];
  var CL_DESC = {
    'Signature pieces': 'Strong craft signals and strong audience pull. This is your repeatable formula.',
    'Hidden gems': 'Well-crafted work that has not found its audience yet. A promotion opportunity.',
    'Crowd-pleasers': 'The audience liked these despite lighter craft signals. Polish them first for the biggest return.',
    'Quick sketches': 'Lighter polish and modest reach. Good for experiments; refresh the best few.'
  };
  var CL_PLAY = {
    'Signature pieces': 'Codify the formula: reuse the defining traits as a checklist and test whether they hold on the next five publications.',
    'Hidden gems': 'Give these a second launch: re-share with a takeaway-led post, link them from newer vizzes, and feature them on your profile.',
    'Crowd-pleasers': 'Work the polish queue: rename, add context, add a second view. These already have reach to reward the effort.',
    'Quick sketches': 'Pick the three with the most reach and rebuild them; leave the rest as a record of what you tried.'
  };
  var HABITS = [
    { k: 'custom', t: 'Named dashboard views' }, { k: 'human', t: 'Human titles' }, { k: 'tidy', t: 'Tidy titles' },
    { k: 'q', t: 'Question headlines' }, { k: 'colon', t: '"A vs B" framing' }, { k: 'rich', t: 'Written context' },
    { k: 'analytic', t: 'Measurable comparisons' }, { k: 'source', t: 'Source credits' }, { k: 'multi', t: 'Multi-view depth' }
  ];
  var LIFT_SIGNALS = HABITS.concat([{ k: 'original', t: 'Standalone topic' }, { k: 'technique', t: 'Technique stretch' }]);

  var RE_GENERIC_VIEW = /^\s*(dashboard|sheet|story|dash)\s*\d*\s*$/i;
  // A title that is only a series code, counter or placeholder ("Week 12", "MM2026 wk34", "Untitled 3"): no letters beyond filler words.
  var CODE_WORDS = /^(mm|mom|wow|wk|w|week|day|viz|vizzes|challenge|dashboard|sheet|untitled|copy|test|final|draft|project|practice|makeover|monday|workout|wednesday|tc|ironviz|iron|of|the|for|book|story|chart|graph|v)$/i;
  function isCode(str) {
    var t = String(str || '').trim();
    if (!t) { return true; }
    if (!/\d/.test(t) && !/^(untitled|dashboard|sheet|story|book|test|copy)\b/i.test(t)) { return false; }
    return t.split(/[^a-z]+/i).filter(Boolean).every(function (x) { return CODE_WORDS.test(x) || x.length <= 2; });
  }
  var RE_ANALYTIC = /(index|rate|trend|change|growth|\bvs\b|\bper\b|share|risk|balance|impact|performance|comparison|benchmark|productivity|analysis|evolution|disparity|ratio|score|divide|cost|spend)/i;
  var RE_SOURCE = /(source|via |credit|data from|dataset|kaggle|data:)/i;

  function classify(w) {
    var t = w.title + ' ' + w.view + ' ' + w.desc;
    // Recurring community challenges, named or implied by a series-style title or view name.
    if (/makeover\s*monday|workout\s*wednesday|iron\s*viz|tidy\s*tuesday|sports\s*viz|viz\s*of\s*the|challenge|(^|[^a-z])(mm|mom|wow)(?=[^a-z]|$)/i.test(t) || isCode(w.title) || (!RE_GENERIC_VIEW.test(w.view) && /\d/.test(w.view) && isCode(w.view))) { return 'Community challenge'; }
    if (/tutorial|how to|waterfall|custom labeled|unexpected builds|formatting|connected scatter|technique/i.test(w.title + ' ' + w.view)) { return 'Technique piece'; }
    return 'Standalone';
  }

  function scoreWorkbook(w) {
    var words = w.title.trim().split(/\s+/).length, extra = Math.max(0, w.descLen - w.title.length);
    var g = {
      custom: !RE_GENERIC_VIEW.test(w.view) && !isCode(w.view),
      human: !isCode(w.title),
      tidy: !/[#|]/.test(w.title) && w.title.length >= 12 && w.title.length <= 65,
      multi: w.sheets > 1, deep: w.sheets >= 3,
      q: /\?/.test(w.title), colon: /:|\bvs\.?\b/i.test(w.title), words5: words >= 5,
      rich: extra > 30, desc80: w.descLen >= 80,
      analytic: RE_ANALYTIC.test(w.title), source: RE_SOURCE.test(w.desc)
    };
    w.type = classify(w);
    g.technique = w.type === 'Technique piece' || /workout|(^|[^a-z])wow(?=[^a-z]|$)/i.test(w.title + ' ' + w.view);
    g.original = w.type === 'Standalone';
    w.g = g;
    w.head = g.q ? 35 : (g.colon ? 25 : (g.words5 ? 20 : 0));
    w.design = (g.custom ? 35 : 0) + (g.human ? 30 : 0) + (g.tidy ? 20 : 0) + (g.multi ? 15 : 0);
    w.story = w.head + (g.rich ? 30 : 0) + (g.human ? 20 : 0) + (g.custom ? 15 : 0);
    w.rigor = Math.min(100, (g.rich ? 25 : 0) + (g.desc80 ? 15 : 0) + (g.analytic ? 25 : 0) + (g.deep ? 30 : (g.multi ? 20 : 0)) + (g.technique ? 15 : 0) + (g.source ? 15 : 0));
    w.composite = (w.design + w.story + w.rigor) / 3;
    w.favRate = w.views > 0 ? (w.favs / w.views) * 100 : 0;
    w.checks = [
      { p: 'design', ok: g.custom, t: 'Intentional view name' },
      { p: 'design', ok: g.human, t: 'Human title (not a challenge code)' },
      { p: 'design', ok: g.tidy, t: 'Tidy title (no hashtag/pipe clutter, 12-65 chars)' },
      { p: 'design', ok: g.multi, t: 'More than one published view' },
      { p: 'story', ok: g.q || g.colon || g.words5, t: 'Headline framing (question, contrast or full sentence)' },
      { p: 'story', ok: g.rich, t: 'Description adds context beyond the title' },
      { p: 'story', ok: g.human && g.custom, t: 'Title and view both carry a message' },
      { p: 'rigor', ok: g.analytic, t: 'Title frames a measurable comparison' },
      { p: 'rigor', ok: g.desc80, t: 'Description of 80+ characters' },
      { p: 'rigor', ok: g.source, t: 'Source or credit stated' },
      { p: 'rigor', ok: g.technique, t: 'Technique stretch (WOW or tutorial)' }
    ];
    return w;
  }

  // Individual recommendations: each failed signal with the composite points it would add.
  function fixes(w) {
    var g = w.g, f = [], hashy = /[#|]/.test(w.title);
    if (!g.human) { f.push({ gain: 50 / 3, pillar: 'story', t: 'Retitle with the finding', d: '"' + w.title + '" reads like a filename. Lead with the insight, for example a question or a claim.' }); }
    if (!g.custom) { f.push({ gain: 50 / 3, pillar: 'design', t: 'Name the dashboard view', d: 'The view "' + w.view + '" is generic or a challenge code. Name it for what it shows.' }); }
    if (w.head < 35) { f.push({ gain: (35 - w.head) / 3, pillar: 'story', t: 'Frame the headline as a question', d: 'A question or an "A vs B" contrast gives viewers a reason to stay.' }); }
    if (!g.rich) { f.push({ gain: 55 / 3, pillar: 'rigor', t: 'Write the context', d: 'Add 2-3 sentences covering the question, the finding and one caveat.' }); }
    if (!g.tidy) { f.push({ gain: 20 / 3, pillar: 'design', t: 'Tidy the title', d: hashy ? 'Move hashtags and series labels out of the title and into tags or a subtitle.' : 'Aim for a title of 12-65 characters.' }); }
    if (!g.analytic) { f.push({ gain: 25 / 3, pillar: 'rigor', t: 'Make the comparison explicit', d: 'Add a benchmark, prior period, rate or per-capita view so the headline can be tested.' }); }
    if (!g.source) { f.push({ gain: 15 / 3, pillar: 'rigor', t: 'Credit the data source', d: 'Name the source and any caveat in the description.' }); }
    if (!g.multi) { f.push({ gain: 35 / 3, pillar: 'design', t: 'Add a second view', d: 'A drill-down or detail view adds depth and lets viewers verify the headline.' }); }
    return f.sort(function (a, b) { return b.gain - a.gain; });
  }

  // Refinement opportunities: each fix type applied across a pool of workbooks (default: the latest quarter),
  // with the craft-score uplift if every affected workbook were fixed. Fix gains are additive across types.
  var FIX_DEFS = [
    { k: 'rich', pillar: 'rigor', t: 'Write the context', d: 'Add 2-3 sentences to the description: the question, the finding and one caveat.', test: function (w) { return !w.g.rich; }, gain: function () { return 55 / 3; } },
    { k: 'human', pillar: 'story', t: 'Retitle with the finding', d: 'Replace filename-style titles with the insight, for example a question or a claim.', test: function (w) { return !w.g.human; }, gain: function () { return 50 / 3; } },
    { k: 'custom', pillar: 'design', t: 'Name the dashboard view', d: 'Give each default view a descriptive name; it becomes the link text and the first label viewers see.', test: function (w) { return !w.g.custom; }, gain: function () { return 50 / 3; } },
    { k: 'multi', pillar: 'design', t: 'Add a second view', d: 'Publish a drill-down or detail view that lets viewers test the headline.', test: function (w) { return !w.g.multi; }, gain: function () { return 35 / 3; } },
    { k: 'q', pillar: 'story', t: 'Frame the headline as a question or contrast', d: 'A question or an "A vs B" gives viewers a reason to stay.', test: function (w) { return w.head < 35; }, gain: function (w) { return (35 - w.head) / 3; } },
    { k: 'analytic', pillar: 'rigor', t: 'Make the comparison explicit', d: 'Add a benchmark, prior period, rate or per-capita view so the claim can be tested.', test: function (w) { return !w.g.analytic; }, gain: function () { return 25 / 3; } },
    { k: 'tidy', pillar: 'design', t: 'Tidy the title', d: 'Move hashtags and series labels into tags; keep the title between 12 and 65 characters.', test: function (w) { return !w.g.tidy; }, gain: function () { return 20 / 3; } },
    { k: 'source', pillar: 'rigor', t: 'Credit the data source', d: 'Name the source and any caveat in the description.', test: function (w) { return !w.g.source; }, gain: function () { return 15 / 3; } }
  ];
  function opportunities(A, pool) {
    pool = pool || A.eras[3].items;
    return FIX_DEFS.map(function (def) {
      var aff = pool.filter(def.test);
      return { k: def.k, pillar: def.pillar, t: def.t, d: def.d, n: aff.length, of: pool.length, items: aff, uplift: aff.reduce(function (a, w) { return a + def.gain(w); }, 0) / pool.length };
    }).filter(function (o) { return o.n > 0; }).sort(function (a, b) { return b.uplift - a.uplift; });
  }

  function groupStats(items) {
    var types = {}, hhi = 0, k;
    items.forEach(function (w) { types[w.type] = (types[w.type] || 0) + 1; });
    for (k in types) { hhi += Math.pow(types[k] / items.length, 2); }
    var gaps = items.map(function (w) { return w.gap; }).filter(function (v) { return v !== null; });
    var cv = gaps.length > 1 && mean(gaps) > 0 ? sd(gaps) / mean(gaps) : 0;
    var st = {
      items: items, types: types, n: items.length,
      design: mean(items.map(function (w) { return w.design; })), story: mean(items.map(function (w) { return w.story; })), rigor: mean(items.map(function (w) { return w.rigor; })),
      pct: mean(items.map(function (w) { return w.pct; })),
      variety: clamp((1 - hhi) / (1 - 1 / 3) * 100, 0, 100),
      consistency: clamp(100 * (1 - cv / 2), 0, 100),
      resonance: clamp(mean(items.map(function (w) { return w.favRate; })) * 50, 0, 100),
      start: items.length ? Math.min.apply(null, items.map(function (w) { return w.date; })) : 0,
      end: items.length ? Math.max.apply(null, items.map(function (w) { return w.date; })) : 0
    };
    st.composite = (st.design + st.story + st.rigor) / 3;
    return st;
  }

  function features(w) { return [w.design / 100, w.story / 100, w.rigor / 100, w.pct / 100 * 1.2, (w.type === 'Standalone' ? 0 : 1) * 0.6, Math.min(1, w.favRate / 2) * 0.6]; }
  function dist2(a, b) { var d = 0; for (var i = 0; i < a.length; i++) { d += (a[i] - b[i]) * (a[i] - b[i]); } return d; }

  function kmeans(W, k) {
    var X = W.map(features), cents = [], i, j, it, assign = [], first = 0;
    X.forEach(function (x, idx) { if (W[idx].composite > W[first].composite) { first = idx; } });
    cents.push(X[first].slice());
    while (cents.length < k) {
      var best = -1, bd = -1;
      X.forEach(function (x, idx) { var dm = Math.min.apply(null, cents.map(function (c) { return dist2(x, c); })); if (dm > bd) { bd = dm; best = idx; } });
      cents.push(X[best].slice());
    }
    for (it = 0; it < 40; it++) {
      var changed = false;
      for (i = 0; i < X.length; i++) {
        var bc = 0, bdist = Infinity;
        for (j = 0; j < k; j++) { var d = dist2(X[i], cents[j]); if (d < bdist) { bdist = d; bc = j; } }
        if (assign[i] !== bc) { assign[i] = bc; changed = true; }
      }
      for (j = 0; j < k; j++) {
        var mem = X.filter(function (x, idx) { return assign[idx] === j; });
        if (mem.length) { cents[j] = cents[j].map(function (_, f) { return mean(mem.map(function (m) { return m[f]; })); }); }
      }
      if (!changed) { break; }
    }
    return assign;
  }

  function buildClusters(W) {
    var k = W.length >= 60 ? 4 : (W.length >= 30 ? 3 : 2), assign = kmeans(W, k), medComp = median(W.map(function (w) { return w.composite; })), cl = [];
    for (var j = 0; j < k; j++) {
      var items = W.filter(function (w, i) { return assign[i] === j; });
      if (!items.length) { continue; }
      var st = groupStats(items);
      cl.push({ st: st, items: items, name: st.composite >= medComp ? (st.pct >= 50 ? 'Signature pieces' : 'Hidden gems') : (st.pct >= 50 ? 'Crowd-pleasers' : 'Quick sketches') });
    }
    var seen = {}, extra = 0;
    cl.sort(function (a, b) { return b.st.composite - a.st.composite; }).forEach(function (c, idx) {
      seen[c.name] = (seen[c.name] || 0) + 1; c.base = c.name;
      if (seen[c.name] > 1) { c.name = c.name + ' ' + ['', 'II', 'III', 'IV'][seen[c.name] - 1]; c.color = CL_EXTRA[extra++ % 3]; } else { c.color = CL_COLORS[c.name]; }
      c.id = idx; c.items.forEach(function (w) { w.cl = idx; });
    });
    return cl;
  }

  // Habit adoption: pass rate of each habit across chronological bins, plus early vs late thirds.
  function habitMatrix(W) {
    var bins = clamp(Math.floor(W.length / 7), 4, 12), size = W.length / bins, cols = [], third = Math.max(1, Math.floor(W.length / 3));
    for (var b = 0; b < bins; b++) { var items = W.slice(Math.round(b * size), Math.round((b + 1) * size)); cols.push({ items: items, start: items[0].date }); }
    var rows = HABITS.map(function (hb) {
      var rates = cols.map(function (c) { return c.items.filter(function (w) { return w.g[hb.k]; }).length / c.items.length; });
      var early = W.slice(0, third).filter(function (w) { return w.g[hb.k]; }).length / third;
      var late = W.slice(-third).filter(function (w) { return w.g[hb.k]; }).length / third;
      return { k: hb.k, t: hb.t, rates: rates, early: early, late: late, delta: late - early };
    });
    return { cols: cols, rows: rows };
  }

  function analyze(rows, profile) {
    var W = rows.filter(function (r) { return !profile || r.profile === profile; }).map(scoreWorkbook);
    W.sort(function (a, b) { return a.date - b.date || b.order - a.order; });
    var n = W.length;
    W.forEach(function (w, i) { w.i = i; w.era = Math.min(3, Math.floor(i * 4 / n)); w.gap = i ? (w.date - W[i - 1].date) / 864e5 : null; });
    for (var e = 0; e < 4; e++) {
      var m = W.filter(function (w) { return w.era === e; }), lv = m.map(function (w) { return Math.log(1 + w.views); }), mu = mean(lv), sg = sd(lv) || 1;
      var sorted = m.slice().sort(function (a, b) { return a.views - b.views; });
      m.forEach(function (w) { w.z = (Math.log(1 + w.views) - mu) / sg; w.pct = m.length > 1 ? sorted.indexOf(w) / (m.length - 1) * 100 : 50; });
    }
    var win = Math.max(6, Math.round(n / 10));
    W.forEach(function (w, i) {
      var sl = W.slice(Math.max(0, i - win + 1), i + 1);
      w.rd = mean(sl.map(function (x) { return x.design; })); w.rs = mean(sl.map(function (x) { return x.story; })); w.rr = mean(sl.map(function (x) { return x.rigor; }));
    });
    var eras = [0, 1, 2, 3].map(function (e2) { var st = groupStats(W.filter(function (w) { return w.era === e2; })); st.e = e2; return st; });
    var A = { W: W, eras: eras, n: n, win: win, all: groupStats(W) };
    A.clusters = buildClusters(W);
    A.medComp = median(W.map(function (w) { return w.composite; }));
    A.polish = W.filter(function (w) { return w.composite < A.medComp && w.pct >= 55; }).sort(function (a, b) { return b.views - a.views; });
    A.habits = habitMatrix(W);
    A.lift = liftTable(W);
    A.breakouts = W.slice().sort(function (a, b) { return b.z - a.z; }).slice(0, 5);
    var gaps = W.map(function (w) { return w.gap; }).filter(function (v) { return v !== null; }), mg = median(gaps);
    A.gapMedian = mg;
    A.pauses = W.filter(function (w) { return w.gap !== null && w.gap > Math.max(21, mg * 3); });
    // Date trust: the API lists workbooks newest-first, so list order should track the dates.
    function ranks(a) { var idx = a.map(function (v, i) { return [v, i]; }).sort(function (x, y) { return x[0] - y[0]; }), r = []; idx.forEach(function (p, k) { r[p[1]] = k; }); return r; }
    A.dateTrust = clamp(-pearson(ranks(W.map(function (w) { return w.order; })), ranks(W.map(function (w) { return w.date; }))), 0, 1);
    // Turning point: the stretch where the craft score rose the most from one window to the next.
    var step = clamp(Math.round(n / 8), 4, 10); A.turn = null;
    for (var ti = step; ti <= n - step; ti++) {
      var before = W.slice(ti - step, ti), after = W.slice(ti, ti + step);
      var gain = mean(after.map(function (w) { return w.composite; })) - mean(before.map(function (w) { return w.composite; }));
      if (!A.turn || gain > A.turn.gain) { A.turn = { i: ti, gain: gain, step: step, date: W[ti].date, era: W[ti].era, before: before, after: after }; }
    }
    if (A.turn) {
      var bestH = null;
      HABITS.forEach(function (hb) {
        var rb = A.turn.before.filter(function (w) { return w.g[hb.k]; }).length / A.turn.before.length, ra = A.turn.after.filter(function (w) { return w.g[hb.k]; }).length / A.turn.after.length;
        if (!bestH || ra - rb > bestH.d) { bestH = { t: hb.t, k: hb.k, rb: rb, ra: ra, d: ra - rb }; }
      });
      A.turn.habit = bestH;
    }
    return A;
  }

  function liftTable(W) {
    return LIFT_SIGNALS.map(function (sg) {
      var a = W.filter(function (w) { return w.g[sg.k]; }), b = W.filter(function (w) { return !w.g[sg.k]; });
      return { k: sg.k, t: sg.t, n: a.length, lift: (a.length && b.length) ? mean(a.map(function (w) { return w.pct; })) - mean(b.map(function (w) { return w.pct; })) : 0, ok: a.length >= 6 && b.length >= 6 };
    }).sort(function (x, y) { return y.lift - x.lift; });
  }
  function definingTraits(items, W) {
    return LIFT_SIGNALS.map(function (sg) {
      var gp = items.filter(function (w) { return w.g[sg.k]; }).length / items.length, pp = W.filter(function (w) { return w.g[sg.k]; }).length / W.length;
      return { t: sg.t, d: (gp - pp) * 100, share: gp * 100 };
    }).sort(function (a, b) { return b.d - a.d; });
  }

  var PILLAR_ACTIONS = {
    design: 'Audit your next viz against a five-point checklist (hierarchy, colour, annotation, alignment, accessibility), then name every view and write an insight headline.',
    story: 'Lead with the takeaway in the title, add a "how to read this" annotation, and write a 2-3 sentence description covering question, finding and so-what.',
    rigor: 'State the source and caveats in the description, add a benchmark or prior-period comparison, and publish a second view that stress-tests the headline claim.'
  };
  function pillarInfo(key) { return PILLARS.filter(function (p) { return p.key === key; })[0]; }

  function portfolioCoach(A) {
    var cur = A.eras[3], prev = A.eras[2], recs = [];
    var ranked = PILLARS.map(function (p) { return { p: p, v: cur[p.key], d: cur[p.key] - prev[p.key] }; }).sort(function (a, b) { return a.v - b.v; });
    var weak = ranked[0];
    recs.push({ tag: 'Biggest opportunity', pillar: weak.p.key, title: 'Level up ' + weak.p.label, ev: 'Current era averages ' + r0(weak.v) + '/100 (' + signed(weak.d) + ' vs the prior era).', act: PILLAR_ACTIONS[weak.p.key] });
    var drop = ranked.slice().sort(function (a, b) { return a.d - b.d; })[0];
    if (drop.d < -3) { recs.push({ tag: 'Course-correct', pillar: drop.p.key, title: drop.p.label + ' has slipped', ev: 'Down ' + r0(Math.abs(drop.d)) + ' points from the prior era to the current one.', act: PILLAR_ACTIONS[drop.p.key] }); }
    if (A.polish.length) { recs.push({ tag: 'Polish queue', pillar: 'design', title: 'Upgrade ' + A.polish.length + ' high-reach, light-craft vizzes', ev: 'They out-perform most of their era but sit below your median craft score. Start with "' + trunc(A.polish[0].title, 40) + '" (' + A.polish[0].views.toLocaleString() + ' views).', act: 'Open each one at the individual level and apply the top fix. Reach is already there, so craft improvements pay off fastest.' }); }
    var items = cur.items, cnt = items.length || 1, code = items.filter(function (w) { return !w.g.human; });
    if (code.length / cnt > 0.2) { recs.push({ tag: 'Quick win', pillar: 'story', title: 'Retire challenge-code titles', ev: r0(code.length / cnt * 100) + '% of current-era vizzes are titled like a filename (for example "' + code[0].title + '").', act: 'Rename them with the finding, for example "Why X is rising faster than Y".' }); }
    var richShare = items.filter(function (w) { return w.g.rich; }).length / cnt;
    if (richShare < 0.5) { recs.push({ tag: 'Quick win', pillar: 'rigor', title: 'Document the thinking', ev: 'Only ' + r0(richShare * 100) + '% of current-era vizzes have a description beyond the title.', act: 'Add a three-line description: the question, the data source, and one caveat.' }); }
    var chal = 1 - items.filter(function (w) { return w.g.original; }).length / cnt;
    if (chal >= 0.7) { recs.push({ tag: 'Stretch', pillar: 'rigor', title: 'Balance challenges with your own questions', ev: r0(chal * 100) + '% of current-era vizzes come from weekly challenges (variety ' + r0(cur.variety) + '/100).', act: 'Ship one viz a month on data you sourced yourself, using a chart form you have never published.' }); }
    var best = A.lift.filter(function (l) { return l.ok && l.lift > 5; })[0];
    if (best) { recs.push({ tag: 'Lean in', pillar: 'story', title: 'Your audience rewards: ' + best.t.toLowerCase(), ev: 'Vizzes with this trait rank ' + signed(best.lift) + ' percentile points higher than era peers (n=' + best.n + ').', act: 'Make it a default in your template, then test whether it holds on your next five publications.' }); }
    return recs.slice(0, 6);
  }

  function groupCoach(sc, A) {
    var items = sc.items, st = groupStats(items), all = A.all, recs = [];
    var rel = PILLARS.map(function (p) { return { p: p, v: st[p.key], d: st[p.key] - all[p.key] }; }).sort(function (a, b) { return a.d - b.d; });
    var weak = rel[0];
    recs.push({ tag: 'Biggest gap', pillar: weak.p.key, title: 'Close the ' + weak.p.label.toLowerCase() + ' gap', ev: 'This group averages ' + r0(weak.v) + ' against ' + r0(all[weak.p.key]) + ' for the whole portfolio (' + signed(weak.d) + ').', act: PILLAR_ACTIONS[weak.p.key] });
    if (sc.play) { recs.push({ tag: 'Group playbook', pillar: 'story', title: sc.label, ev: sc.desc, act: sc.play }); }
    var code = items.filter(function (w) { return !w.g.human; });
    if (code.length / items.length > 0.2) { recs.push({ tag: 'Quick win', pillar: 'story', title: 'Retitle ' + code.length + ' challenge-code titles', ev: code.length + ' of ' + items.length + ' vizzes in this group are titled like a filename.', act: 'Start with "' + trunc(code[0].title, 40) + '". Use the finding as the headline.' }); }
    var norich = items.filter(function (w) { return !w.g.rich; });
    if (norich.length / items.length > 0.5) { recs.push({ tag: 'Quick win', pillar: 'rigor', title: 'Add context to ' + norich.length + ' vizzes', ev: r0(norich.length / items.length * 100) + '% have no description beyond the title.', act: 'Write the question, source and one caveat for each. Drill into a workbook to see its full fix list.' }); }
    var tr = definingTraits(items, A.W);
    if (tr[0].d > 12) { recs.push({ tag: 'Defining trait', pillar: 'design', title: 'What sets this group apart: ' + tr[0].t.toLowerCase(), ev: r0(tr[0].share) + '% of the group has it, ' + signed(tr[0].d) + ' points above the portfolio.', act: 'Decide whether to make this trait a standard or to deliberately vary it in the next piece.' }); }
    var top = items.slice().sort(function (a, b) { return b.composite - a.composite; })[0];
    recs.push({ tag: 'Study', pillar: 'design', title: 'Best example here: ' + trunc(top.title, 44), ev: 'Composite ' + r0(top.composite) + ' with ' + top.views.toLocaleString() + ' views.', act: 'Drill into it and compare the checks against the weakest piece in the group.' });
    return recs.slice(0, 5);
  }

  function insights(A) {
    var W = A.W, E = A.eras, out = [], d = E[3].composite - E[0].composite;
    var gains = PILLARS.map(function (p) { return { p: p, d: E[3][p.key] - E[0][p.key] }; }).sort(function (a, b) { return b.d - a.d; });
    out.push('Composite moved ' + signed(d) + ' points from the first to the latest quarter of your portfolio. ' + gains[0].p.label + ' gained most (' + signed(gains[0].d) + '); ' + gains[2].p.label.toLowerCase() + ' moved least (' + signed(gains[2].d) + ').');
    var tv = W.reduce(function (a, w) { return a + w.views; }, 0), top3 = A.breakouts.slice(0, 3);
    out.push('Your top three breakouts hold ' + r0(top3.reduce(function (a, w) { return a + w.views; }, 0) / tv * 100) + '% of all views, led by "' + trunc(top3[0].title, 40) + '".');
    var r = pearson(W.map(function (w) { return w.composite; }), W.map(function (w) { return w.pct; }));
    out.push('Craft signals and audience pull are ' + (Math.abs(r) < 0.2 ? 'only weakly' : (Math.abs(r) < 0.45 ? 'moderately' : 'strongly')) + ' related (r = ' + r.toFixed(2) + ').');
    return out;
  }

  function trajectory(delta) { return delta >= 8 ? 'Accelerating' : (delta >= 3 ? 'Climbing' : (delta > -3 ? 'Holding steady' : 'Drifting')); }

  // Narrative: the copy for each scrollytelling step, generated from the data.
  function narrative(A) {
    var E = A.eras, W = A.W, c0 = E[0].composite, c3 = E[3].composite, d = c3 - c0, T = A.turn;
    var chal = function (st) { return r0((1 - (st.types['Standalone'] || 0) / st.n) * 100); };
    var pillarNow = PILLARS.map(function (p) { return { p: p, v: E[3][p.key], gain: E[3][p.key] - E[0][p.key] }; });
    var strong = pillarNow.slice().sort(function (a, b) { return b.v - a.v; })[0], weakest = pillarNow.slice().sort(function (a, b) { return a.v - b.v; })[0];
    var tv = W.reduce(function (a, w) { return a + w.views; }, 0), top3 = A.breakouts.slice(0, 3), shareTop = r0(top3.reduce(function (a, w) { return a + w.views; }, 0) / tv * 100);
    var N = {}, pct = function (v) { return r0(v * 100) + '%'; };
    // Journey: only beats the data supports. Each step carries a highlight rule for the spiral.
    N.journey = [{ h: 'It started at ' + r0(c0) + ' out of 100', p: 'Your first ' + E[0].n + ' workbooks, from ' + monthYear(E[0].start) + '. ' + (chal(E[0]) >= 40 ? chal(E[0]) + '% were community challenges.' : 'Most were standalone ideas.'), hl: { era: 0 } }];
    if (T && T.gain >= 3) {
      var hb = T.habit, habitLine = hb && hb.d >= 0.15 ? ' It lines up with ' + hb.t.toLowerCase() + ' becoming routine (' + pct(hb.rb) + ' to ' + pct(hb.ra) + ' of workbooks).' : '';
      N.journey.push({ h: 'The step up came around ' + monthYear(T.date), p: 'Over the next ' + T.step + ' workbooks your craft score rose ' + r0(T.gain) + ' points.' + habitLine, hl: { from: T.i, to: T.i + T.step - 1 }, do: hb && hb.d >= 0.15 ? 'Make ' + hb.t.toLowerCase() + ' a default in every new viz.' : 'Note what you changed around then and repeat it.' });
    }
    N.journey.push({ h: d >= 3 ? 'Now it sits at ' + r0(c3) + ', up ' + r0(d) : (d <= -3 ? 'Now it sits at ' + r0(c3) + ', down ' + r0(-d) : 'Now it sits at ' + r0(c3) + ', about where it began'), p: strong.p.label + ' is your strongest pillar at ' + r0(strong.v) + '; ' + weakest.p.label.toLowerCase() + ' is the one with most room at ' + r0(weakest.v) + '.', hl: { era: 3 } });
    if (shareTop >= 25) { N.journey.push({ h: 'A few pieces carry the audience', p: 'Three workbooks hold ' + shareTop + '% of all views, led by "' + trunc(top3[0].title, 44) + '". Gold rings mark them.', hl: { breakout: true } }); }
    else { N.journey.push({ h: 'Your audience is spread evenly', p: 'No single workbook dominates: the top three hold ' + shareTop + '% of views. Gold rings still mark them.', hl: { breakout: true } }); }
    // Craft: the most improved pillar and the one with most room, each tied to the habit behind it.
    var PILLAR_HABITS = { design: ['custom', 'human', 'tidy', 'multi'], story: ['q', 'colon', 'rich', 'human'], rigor: ['analytic', 'source', 'rich', 'multi'] };
    function habitIn(key, byLate) {
      var rows = A.habits.rows.filter(function (r) { return PILLAR_HABITS[key].indexOf(r.k) > -1; });
      return rows.sort(function (a, b) { return byLate ? a.late - b.late : b.delta - a.delta; })[0];
    }
    var most = pillarNow.slice().sort(function (a, b) { return b.gain - a.gain; })[0], hi = habitIn(most.p.key, false), lo = habitIn(weakest.p.key, true);
    N.craft = [
      { h: most.gain >= 3 ? most.p.label + ' improved most: ' + signed(most.gain) : most.p.label + ' moved least of all, ' + signed(most.gain), p: hi && hi.delta > 0.1 ? 'The biggest driver was ' + hi.t.toLowerCase() + ': ' + pct(hi.early) + ' of early workbooks, ' + pct(hi.late) + ' of recent ones.' : 'No single habit explains it; the change is spread across several small ones.', focus: most.p.key, do: hi && hi.delta > 0.1 ? 'Keep going: add ' + hi.t.toLowerCase() + ' to your publishing checklist.' : 'Pick one habit and apply it to every viz this month.' },
      { h: weakest.p.label + ' has the most room', p: lo ? 'Only ' + pct(lo.late) + ' of your recent workbooks show ' + lo.t.toLowerCase() + '. It is the quickest lever on this pillar.' : 'It is currently your lowest-scoring pillar.', focus: weakest.p.key, do: lo ? 'Add ' + lo.t.toLowerCase() + ' to your next three workbooks.' : 'Review your weakest recent workbook against its fix list.' }
    ];
    if (most.p.key === weakest.p.key) { N.craft.pop(); }
    var hs = A.habits.rows.slice().sort(function (a, b) { return b.delta - a.delta; }), up = hs[0], down = hs[hs.length - 1], miss = A.habits.rows.slice().sort(function (a, b) { return a.late - b.late; })[0];
    N.habits = [];
    if (up.delta > 0.1) { N.habits.push({ h: 'You made ' + up.t.toLowerCase() + ' a habit', p: 'It went from ' + pct(up.early) + ' of your earliest workbooks to ' + pct(up.late) + ' of your latest. Bright cells mark when it became the norm.', row: up.k }); }
    if (down.delta < -0.1) { N.habits.push({ h: 'You drifted from ' + down.t.toLowerCase(), p: 'It fell from ' + pct(down.early) + ' to ' + pct(down.late) + '. Worth deciding whether that was deliberate.', row: down.k }); }
    if (miss.late < 0.5 && miss.k !== up.k) { N.habits.push({ h: 'Still missing: ' + miss.t.toLowerCase(), p: 'Only ' + pct(miss.late) + ' of your recent workbooks have it, and it costs minutes, not new skills.', row: miss.k }); }
    if (!N.habits.length) { N.habits.push({ h: 'Your habits are steady', p: 'None of the nine tracked habits moved by more than ten points between your earliest and latest workbooks.', row: null }); }
    var best = A.lift.filter(function (l) { return l.ok; })[0];
    var big = A.breakouts[0];
    N.audience = [
      { h: '"' + trunc(big.title, 38) + '" is your biggest draw', p: big.views.toLocaleString() + ' views and ' + big.favs + ' favorites. Older work has had longer to collect views, so judge bubbles against their neighbours.' },
      best ? { h: 'Audiences respond to ' + best.t.toLowerCase(), p: 'Workbooks with it rank ' + r0(best.lift) + ' points higher than peers from the same period (' + best.n + ' workbooks). A hint, not proof.' }
        : { h: 'No trait clearly separates your hits yet', p: 'There are not enough workbooks on each side of any trait to tell signal from noise. Revisit after more publishing.' },
      { h: A.gapMedian > 0 ? 'You publish about every ' + r0(A.gapMedian) + ' days' : 'You often publish in bursts', p: A.pauses.length ? A.pauses.length + (A.pauses.length === 1 ? ' pause stands' : ' pauses stand') + ' out, the longest ' + r0(Math.max.apply(null, A.pauses.map(function (w) { return w.gap; }))) + ' days (rose brackets).' : 'No unusually long pauses stand out.' }
    ];
    var kc = A.clusters.length, share = function (c, e) { return c.items.filter(function (w) { return w.era === e; }).length / E[e].n; };
    var grower = A.clusters.slice().sort(function (a, b) { return (share(b, 3) - share(b, 0)) - (share(a, 3) - share(a, 0)); })[0];
    N.portfolio = [
      { h: 'Your work falls into ' + kc + ' groups', p: A.clusters.map(function (c) { return c.name + ' (' + c.st.n + ')'; }).join(', ') + '. Groups are found by clustering craft, audience and origin. Dashed lines mark the median craft score and the midpoint of audience.' },
      share(grower, 3) - share(grower, 0) > 0.1
        ? { h: 'The mix is shifting toward ' + grower.name.toLowerCase(), p: grower.name + ' made up ' + pct(share(grower, 0)) + ' of your first era and ' + pct(share(grower, 3)) + ' of your latest.' }
        : { h: 'The mix has stayed fairly stable', p: 'No group has gained or lost more than ten points of share between your first and latest era.' },
      { h: 'Pick a group to explore', p: 'Choosing one scopes the lens and the plan to it. The bar at the top takes you back up.' }
    ];
    return N;
  }

  function reportText(A) {
    var E = A.eras, lines = [], delta = E[3].composite - E[0].composite, W = A.W, recs = portfolioCoach(A);
    lines.push('# Tableau Public growth review: ' + W[0].profile, '', A.n + ' workbooks, ' + monthYear(W[0].date) + ' to ' + monthYear(W[A.n - 1].date) + '. Trajectory: **' + trajectory(delta) + '** (composite ' + r0(E[0].composite) + ' to ' + r0(E[3].composite) + ', ' + signed(delta) + ').', '', '| Pillar | First era | Current era | Change |', '|---|---|---|---|');
    PILLARS.forEach(function (p) { lines.push('| ' + p.label + ' | ' + r0(E[0][p.key]) + ' | ' + r0(E[3][p.key]) + ' | ' + signed(E[3][p.key] - E[0][p.key]) + ' |'); });
    lines.push('', '## Insights'); insights(A).forEach(function (t) { lines.push('- ' + t); });
    var ops = opportunities(A).slice(0, 5);
    lines.push('', '## Refinement opportunities (latest ' + E[3].n + ' workbooks)');
    ops.forEach(function (o, i) { lines.push((i + 1) + '. **' + o.t + '**: ' + o.n + ' of ' + o.of + ' workbooks, about +' + r0(o.uplift) + ' craft score. ' + o.d); });
    lines.push('', '## Other recommendations'); recs.forEach(function (r, i) { lines.push((i + 1) + '. **' + r.title + '** (' + r.tag + '). ' + r.ev + ' ' + r.act); });
    lines.push('', '## Clusters'); A.clusters.forEach(function (c) { lines.push('- **' + c.name + '** (' + c.st.n + '): composite ' + r0(c.st.composite) + ', audience percentile ' + r0(c.st.pct) + '. ' + CL_DESC[c.base]); });
    if (A.polish.length) { lines.push('', '## Polish queue (high reach, light craft)'); A.polish.slice(0, 8).forEach(function (w) { var f = fixes(w)[0]; lines.push('- ' + w.title + ' (' + w.views.toLocaleString() + ' views): ' + (f ? f.t : 'passes all signals')); }); }
    lines.push('', '_Scores are proxies from public metadata, not verdicts. Pair them with your own review._');
    return lines.join('\n');
  }

  window.GrowthCore = {
    util: { mean: mean, sd: sd, median: median, clamp: clamp, r0: r0, signed: signed, trunc: trunc, monthYear: monthYear, shortDate: shortDate },
    PILLARS: PILLARS, TYPE_COLORS: TYPE_COLORS, ERA_NAMES: ERA_NAMES, CL_DESC: CL_DESC, CL_PLAY: CL_PLAY, HABITS: HABITS,
    analyze: analyze, groupStats: groupStats, opportunities: opportunities, fixes: fixes, definingTraits: definingTraits, portfolioCoach: portfolioCoach, groupCoach: groupCoach,
    insights: insights, trajectory: trajectory, narrative: narrative, reportText: reportText, pillarInfo: pillarInfo
  };
})();

'use strict';
// Host adapter. Inside Tableau it reads the worksheet's row-level summary data; in a plain browser
// (the future web app) it falls back to data.csv next to index.html. app.js only sees GrowthHost.
(function () {
  var CAPS = ['Workbook', 'RepoUrl', 'DefaultView', 'LastUpdated', 'Description', 'Profile',
    'Views', 'Favorites', 'SheetCount', 'DescriptionLength', 'ListOrder'];
  var mode = 'web';
  var listeners = [];

  function capFor(fieldName) {
    for (var i = 0; i < CAPS.length; i++) {
      if (new RegExp('(^|[(\\s])' + CAPS[i] + '($|[)\\s])').test(fieldName)) { return CAPS[i]; }
    }
    return null;
  }

  function cellValue(c) {
    if (c === null || c === undefined) { return ''; }
    var v = c.value;
    if (v === undefined || v === null || v === '') { v = c.formattedValue; }
    return v;
  }

  function fromTableau() {
    var ws = tableau.extensions.worksheetContent.worksheet;
    return ws.getSummaryDataAsync({ ignoreSelection: true }).then(function (t) {
      var idx = {};
      t.columns.forEach(function (col, i) { var c = capFor(col.fieldName); if (c) { idx[c] = i; } });
      if (idx.Workbook === undefined) {
        throw new Error('Put Workbook, RepoUrl, DefaultView, LastUpdated, Description, Profile, Views, Favorites, SheetCount, DescriptionLength and ListOrder on Detail. Found: ' +
          t.columns.map(function (c) { return c.fieldName; }).join(', '));
      }
      return t.data.map(function (row) {
        var o = {};
        Object.keys(idx).forEach(function (k) { o[k] = cellValue(row[idx[k]]); });
        return o;
      });
    });
  }

  function parseCsv(text) {
    var rows = [], row = [], cur = '', q = false, i, ch;
    for (i = 0; i < text.length; i++) {
      ch = text.charAt(i);
      if (q) {
        if (ch === '"') { if (text.charAt(i + 1) === '"') { cur += '"'; i++; } else { q = false; } }
        else { cur += ch; }
      } else if (ch === '"') { q = true; }
      else if (ch === ',') { row.push(cur); cur = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text.charAt(i + 1) === '\n') { i++; }
        row.push(cur); cur = '';
        if (row.length > 1 || row[0] !== '') { rows.push(row); }
        row = [];
      } else { cur += ch; }
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    var head = rows.shift();
    return rows.map(function (r) {
      var o = {};
      head.forEach(function (hd, j) { o[hd] = r[j]; });
      return o;
    });
  }

  function fromCsv() {
    return fetch('data.csv').then(function (r) {
      if (!r.ok) { throw new Error('data.csv not found (' + r.status + ')'); }
      return r.text();
    }).then(parseCsv);
  }

  var cfg = window.GROWTH_CONFIG || {};
  var IS_LOCAL = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);

  window.GrowthHost = {
    // The page is self-contained: it reads data.csv unless it is running inside Tableau as an extension
    // (the Extensions API script is only present then). A guard stops a plain page from waiting on it.
    init: function () {
      if (window.tableau && tableau.extensions && typeof tableau.extensions.initializeAsync === 'function') {
        var attempt = tableau.extensions.initializeAsync().then(function () { return 'ok'; }, function () { return 'fail'; });
        var guard = new Promise(function (resolve) { setTimeout(function () { resolve('timeout'); }, 3000); });
        return Promise.race([attempt, guard]).then(function (outcome) {
          if (outcome !== 'ok' || !tableau.extensions.worksheetContent) { mode = 'web'; return mode; }
          mode = 'tableau';
          tableau.extensions.worksheetContent.worksheet.addEventListener(
            tableau.TableauEventType.SummaryDataChanged, function () { listeners.forEach(function (f) { f(); }); });
          return mode;
        });
      }
      return Promise.resolve(mode);
    },
    load: function () { return mode === 'tableau' ? fromTableau() : fromCsv(); },
    // Profile lookup needs a backend (the browser cannot call Tableau Public directly): the local review
    // server, or a hosted function whose address is set in config.js. A static host has neither.
    canLookup: function () { return !!cfg.profileApi || IS_LOCAL; },
    snapshotLabel: function () { return cfg.snapshot ? 'Saved snapshot from ' + cfg.snapshot : 'Saved snapshot'; },
    loadProfile: function (name) {
      var base = cfg.profileApi ? cfg.profileApi.replace(/\/$/, '') + '/' : '';
      return fetch(base + 'api/profile?name=' + encodeURIComponent(name)).then(function (r) {
        return r.json().catch(function () { throw new Error('Profile lookup is not available on this host.'); }).then(function (j) {
          if (!r.ok || !j.rows) { throw new Error(j.error || 'Lookup failed (' + r.status + ')'); }
          return j.rows;
        });
      });
    },
    onChange: function (f) { listeners.push(f); },
    mode: function () { return mode; }
  };
})();

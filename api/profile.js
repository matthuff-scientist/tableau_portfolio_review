'use strict';
// Profile lookup for the Profile Growth Review, as a Vercel serverless function (Node 18+).
//   GET /api/profile?name=<tableau-public-profile>  ->  {"rows": [...]}  or  {"error": "..."}
// Same contract as tools/server.py. It only ever calls two fixed Tableau Public endpoints, validates the
// profile name, and lets the CDN cache each answer for 15 minutes.

const NAME_RE = /^[A-Za-z0-9._-]{1,80}$/;
const MAX_WORKBOOKS = 300;
const PAGE = 50;
const CONCURRENCY = 12;

class NotFound extends Error {}

async function getJson(url) {
  let last;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(url);
      if (r.status === 400 || r.status === 404) { throw new NotFound('not found'); }
      if (!r.ok) { last = new Error('HTTP ' + r.status); continue; }
      return await r.json();
    } catch (e) {
      if (e instanceof NotFound) { throw e; }
      last = e;
    }
  }
  throw new Error('Tableau Public did not respond (' + (last && last.message) + ')');
}

async function pool(items, worker, size) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await worker(items[i]);
    }
  }));
  return out;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  const name = String((req.query && req.query.name) || '').trim();
  if (!NAME_RE.test(name)) { res.status(400).json({ error: 'That does not look like a Tableau Public profile name.' }); return; }

  try {
    const quoted = encodeURIComponent(name);
    const items = [];
    for (let start = 0; start < MAX_WORKBOOKS; start += PAGE) {
      const page = await getJson('https://public.tableau.com/public/apis/workbooks?profileName=' + quoted + '&start=' + start + '&count=' + PAGE + '&visibility=NON_HIDDEN');
      const got = page.contents || [];
      items.push(...got);
      if (got.length < PAGE) { break; }
    }
    if (!items.length) { res.status(404).json({ error: 'No public workbooks found for "' + name + '". Check the spelling of the profile name.' }); return; }

    const rows = await pool(items, async (it) => {
      let d = {};
      try { d = await getJson('https://public.tableau.com/profile/api/workbook/' + encodeURIComponent(it.workbookRepoUrl)); } catch (e) { d = {}; }
      const desc = (d.description || '').trim();
      return {
        Workbook: it.title || '', RepoUrl: it.workbookRepoUrl, DefaultView: it.defaultViewName || '',
        Views: it.viewCount || 0, Favorites: it.numberOfFavorites || 0,
        LastUpdated: d.lastUpdateDate ? new Date(d.lastUpdateDate).toISOString().slice(0, 10) : '',
        SheetCount: (d.viewInfos || []).length, DescriptionLength: desc.length,
        Description: desc.replace(/\s+/g, ' '), Profile: name, ListOrder: 0
      };
    }, CONCURRENCY);

    const dated = rows.filter((r) => r.LastUpdated);
    dated.forEach((r, i) => { r.ListOrder = i + 1; });
    res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=3600');
    res.status(200).json({ rows: dated });
  } catch (e) {
    if (e instanceof NotFound) {
      res.status(404).json({ error: 'No Tableau Public profile named "' + name + '" was found. Check the spelling, or paste the profile URL.' });
    } else {
      res.status(502).json({ error: 'The lookup failed unexpectedly. Try again in a moment.' });
    }
  }
};

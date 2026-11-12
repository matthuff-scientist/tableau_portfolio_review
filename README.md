# Profile Growth Review: publishing as a Web Page object

Tableau Public does not run custom extensions, so the review ships as an ordinary web page framed by a
Web Page object on a dashboard.

## What is in `site/` (publish all of it, nothing else is needed)

| File | Role |
|---|---|
| `index.html` | The page. Self-contained: no Tableau scripts. |
| `config.js` | Deployment settings: `snapshot` date and optional `profileApi` address. |
| `host.js`, `core.js`, `story.js`, `styles.css` | Data loading, scoring, and the UI. |
| `data.csv` | Saved snapshot of one profile's public workbooks. The page reads this on a static host. |

Not published: `tools/` (local helpers) and this README.

## Publish with GitHub Pages
1. Create a public GitHub repo and put the contents of `site/` at its root (or in a `docs/` folder).
2. Settings > Pages > deploy from the branch and folder you used. Note the URL, for example
   `https://<user>.github.io/<repo>/index.html`.
3. Open that URL in a private browser window and confirm the review loads. If the page is blank, press
   F12 and read the Console.

GitHub Pages sends no frame-blocking headers and serves HTTPS, which a Web Page object requires.

## Put it in a dashboard
1. In Tableau Desktop (a released build, not a development build), open a dashboard.
2. Drag a **Web Page** object onto the canvas, paste the Pages URL, click OK.
3. Size the dashboard to fit, for example fixed at 1000 x 900. The page scrolls inside the frame.
4. Delete any leftover viz extension from the workbook before publishing.
5. **File > Save to Tableau Public As.** Test the published viz in a private window.

## Refresh the saved data
`python3 tools/fetch_profile.py <profile-name> site/data.csv`, then update `snapshot` in `config.js`
and push. Reviews need at least 12 public workbooks with dates.

## Turn on profile search for everyone (Vercel, free tier)
1. Add two files from `site/` to the repo root: `api/profile.js` and `vercel.json`.
2. At vercel.com, sign in with GitHub, **Add New > Project**, import the repo. Framework preset: Other.
   No build command. Deploy.
3. Test `https://<your-project>.vercel.app/api/profile?name=matt.huff` in a browser. You should see JSON.
4. Open the Vercel address itself: the page and the function share a host, so search works with no
   settings. Only if you keep the page on GitHub Pages, set `profileApi: 'https://<your-project>.vercel.app'`
   in `config.js` (the function allows any origin). The search box always shows; a host without the
   function says so when someone searches.

## Profile search (how it works)
The search box needs a backend, because the browser cannot call Tableau Public directly. It shows
automatically on `localhost` (run `python3 tools/server.py site 8765`) or when `profileApi` in
`config.js` points at a hosted function with the same contract as `tools/server.py`:

    GET <profileApi>/api/profile?name=<profile>  ->  {"rows": [...]}   or   {"error": "..."}

On a static host with `profileApi` empty, the page shows the saved snapshot and hides the box.

## Limits
- The framed page is static: it does not read the workbook or react to dashboard filters.
- GitHub Pages sites are public. The data is already public Tableau Public metadata.
- Scores read public titles, view names and descriptions. They cannot see colour or layout.

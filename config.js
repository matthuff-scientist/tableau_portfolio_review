'use strict';
// Deployment settings.
//   profileApi: address of a hosted profile-lookup function (see tools/server.py for the contract:
//               GET <profileApi>/api/profile?name=<profile>  ->  {"rows": [...]}). Leave empty on a
//               static host such as GitHub Pages; the page then shows the saved snapshot in data.csv.
//   snapshot:   the date data.csv was fetched, shown to readers.
window.GROWTH_CONFIG = {
  profileApi: '<https://<your-address>',
  snapshot: '2026-11-12'
};

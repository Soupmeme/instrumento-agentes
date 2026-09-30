# LOGBOOK (Bitacora)

Experiments, decisions, tests and rehearsals, with dates. Kiwi writes scores and reflections himself.

## 2026-09-29, M0 scaffold (andamiaje)

- Built the Vite + TypeScript scaffold: WebGPU device init, clear-to-color render loop, fps HUD, song picker, fullscreen, device-lost recovery.
- Verified on a real WebGPU adapter (Chrome in the Claude desktop app, NVIDIA Lovelace, `timestamp-query` available): device created, canvas cleared, 0 validation errors, no console errors after removing `powerPreference`.
- Verified: a generated WAV loaded through the file input, showed its name and duration, and the audio clock advanced during playback (0.75 s in 0.8 s).
- Not verified: device-lost recovery (needs a forced loss, planned for M8), the fullscreen toggle (needs a user gesture the test harness cannot give), and any other GPU or browser.
- Note: the built-in browser could not click the native audio controls, so playback was tested through the element's API after a real page click.

## 2026-09-29, song sources and offline support

- Added local file, direct audio link, Spotify link and YouTube link, and an offline service worker.
- Tested with the real services in Chrome: a public Spotify episode (anonymous embed) and a YouTube video both loaded, played after a click, and the display clock tracked them (Spotify 2.50 s to 4.51 s over 2 s; YouTube 3.18 s to 5.18 s over 2 s). Loading a new source removed the previous iframe. Keyboard focus returned to the page after clicking inside either embed. Hiding the panel with P did not stop playback.
- Tested error paths: `javascript:` links, non-playable Spotify links, an empty field, a link that is not audio, and pasting Spotify or YouTube links while `navigator.onLine` was overridden to false. All gave a readable message and left no player behind.
- Unit tests: `npm test` runs 8 tests of the link parser (Spotify web and uri forms, YouTube forms, direct links, rejected schemes, lookalike hosts). They cover parsing only, not playback.
- Offline test: built the site, served it, let the service worker cache it, stopped the server (confirmed with curl that nothing answered), and reloaded. The page loaded from the cache and the GPU loop ran. This found a real bug: with the first version of the worker the JS and CSS failed offline because of `Vary: Origin` (fixed with `ignoreVary`). The four `ERR_FAILED` lines left in the console belong to those failed pre-fix attempts; later offline reloads added none.
- Not verified: a real Spotify Premium sign-in and full-track playback (I do not enter credentials), the first-visit-online then offline flow on a real GitHub Pages deployment, and behavior with third-party cookies blocked.

## 2026-09-30, first deployment

- Published the repo and deployed it with GitHub Actions. The workflow (npm ci, tests, build, publish) ran green on Linux in about a minute.
- Checked the live site https://soupmeme.github.io/instrumento-agentes/ in the built-in browser: page, JS, CSS and \`sw.js\` all served (200), WebGPU initialised on the NVIDIA adapter, 0 validation errors, no console errors, and the service worker registered under \`/instrumento-agentes/\` and cached the page and both assets.
- Not verified: an offline reload of the live site (tested offline only against the local build), any browser other than Chrome, and the Spotify sign-in in a regular browser (still open in ESCALATIONS.md).

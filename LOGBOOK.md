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

## 2026-09-30, Spotify dropped, README added

- Kiwi tested the Spotify embed in regular Chrome: no sign-in prompt, a separate tab and the desktop app opened, only the 30 second preview played. Spotify support was removed (see DECISIONS.md). Local files, YouTube and direct links remain.
- Re-checked in the browser after the change: a pasted Spotify link now shows the "not supported" message and creates no player; a YouTube link still loads, plays after a click, its display clock advanced (3.39 s to 5.40 s over 2 s) and keyboard focus returned to the page. Unit tests: 6 pass (the parser tests for Spotify now assert rejection).
- Added README.md with the live site link at the top.

## 2026-09-30, M1 classic Physarum

**Built:** agent, deposit and diffuse compute passes with an atomic counter, a display pass, a fixed-step loop, GPU timestamp timing, a tuning panel (T), Reset (R), a CPU reference (`reference.ts`) and an in-browser GPU self-test.

**Tested on a real WebGPU adapter** (Chrome in the Claude desktop app, NVIDIA Lovelace, timestamp-query available). Nothing here was run on any other GPU.

- First run failed: the move shader did not compile ("mixing '*' and '^' requires parenthesis"). Found by compiling each shader in isolation and reading `getCompilationInfo`. Fixed; all five shaders compile with no messages.
- Picture: a recognizable Physarum network (bright veins around dark cells) within seconds. 0 validation errors, no console errors on a fresh tab.
- Self-test, 11 of 11 pass: six controlled agent cases match the CPU reference (heading error at most 4e-8 rad, position error at most 6e-5 px), the counter sums to exactly the awake agents (100000 of 100000), no NaN, positions and headings in range, the trail is finite and non-negative, and the same seed gives identical agents (0 of 400000 values differ).
- Mutation check: with the CPU reference deliberately broken (left turn negated), the self-test failed exactly the two left-turn cases (heading error 1 rad). Reference restored afterwards.
- CPU unit tests: 8 tests of the turn rule, sensing geometry, moving and wrapping (14 tests in total with the link parser).
- Performance, GPU time per step from timestamps (coarse, about 0.066 ms steps): at 1043x914 with 400k agents the agent pass took about 0.2 ms. At 1920x1080 with 400k agents, agents plus deposit plus diffuse plus display took about 0.9 ms. With 1M agents the agent pass took about 2.0 ms, with 2M about 2.9 ms (about 3.4 ms for everything). The 60 fps budget is 16.7 ms. Acceptance asked for 200k agents at 60 fps, and this machine has a large margin. This says nothing about weaker GPUs.
- Live parameters: every slider changed its parameter (agents, SD, SA, RA, MD, decay, deposit, respawn, display gain) and Defaults restored all of them. Visually confirmed only for SA.
- SA observation, one seed (7), about 8 s after reset, 400k agents: 15 deg gave long, straighter filaments meeting at hubs with fewer closed cells; 45 deg a honeycomb of closed cells; 90 deg thick meandering labyrinth bands. This differs from my first draft prediction ("larger SA branches more"), so the draft was rewritten to the observation. Not verified by Kiwi, other seeds not checked.

**Not verified:** the visual effect of SD, RA, MD, decay, deposit and respawn (only that the parameters reach the shader), behavior on other GPUs, long-run behavior (M8, for example whether the network collapses after minutes), and the look at resolutions other than 1043x914 and 1920x1080.

## 2026-09-30, service worker bug found after the M1 deploy

- After deploying M1, the live site still showed the M0 build (old script name, old placeholder text) after two reloads. Cause: the old worker refreshed its cache in the background without `event.waitUntil`, so the browser could stop it before the new page was saved. Anyone who had visited the site before (including Kiwi's browser) could be stuck on an old version.
- Fix: pages are network-first, other files cache-first with a background refresh under `waitUntil`, cache renamed `instrumento-v2` (DECISIONS.md).
- Tested locally on the same origin that still had the old worker registered (a faithful reproduction of the stuck state): the server served the new build but the page showed the old script; after one reload the new script loaded and the cache was `instrumento-v2`. Then the server was stopped (confirmed down with curl) and the page reloaded: the new build loaded from the cache, the network grew, GPU timings showed, 0 validation errors.
- Note: in a background tab the browser pauses the animation loop, so the simulation does not advance until the tab is visible again (seen as a briefly noisy start after switching to the tab).
- Not verified: the recovery on the real live site for a browser that already holds the old worker (checked after the push, see next entry if added).

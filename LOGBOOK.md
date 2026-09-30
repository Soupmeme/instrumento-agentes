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

## 2026-09-30, M1 verification pass: sliders, soak tests, timing

Everything below ran on one machine, one NVIDIA GPU (Lovelace), in Chrome inside the Claude desktop app, with seed 7 for the slider comparisons. It says nothing about other GPUs or browsers.

**Slider predictions against measurements** (900 steps after reset, 400k agents unless stated; details and numbers in EXPLAINER.md):
- Supported: agents, turn angle (RA), trail decay (strongest effect), respawn (over 100 simulated seconds).
- Confirmed exactly: deposit and display gain. Display gain 2 versus 20 leaves the simulation bit-identical (0 of about 950k trail values and 0 of 400k agent values differ). Deposit 0.05 versus 0.1 versus 0.4 gives identical agent paths and, at x2, an exactly doubled trail.
- Contradicted: small sensor distance (predicted a fine tangled texture, measured sparse thin curving lines with few closed cells) and large sensor angle (predicted more branching, measured thick meandering labyrinth bands).
- Partly supported: move distance (finer at small MD, but 4 was not faster-changing than 1.5 by the 1-second correlation, even at 3000 steps).
- Respawn 0 is the dramatic case: after 6000 steps (100 s) the view had one line left at the edge, cells fell from 31 to 9, and the share of agents in crowded pixels rose from 20% to 47%.

**Soak tests, accelerated (steps as fast as the GPU allows, health check every few thousand steps):**
- Default settings, 400k agents, 30,010 steps (8.3 simulated minutes): 0 NaN, 0 out-of-range agents, 0 bad headings, counter sum equal to the agent count at all 10 checks, minimum displacement exactly equal to the move distance (nothing stuck), measured respawn rate about 0.001, JS heap sawtooth 20 to 49 MB with no growth trend, GPU time per step 0.178 ms with -1.4% drift from the first to the last tenth.
- 2M agents, 20,004 steps: 0 anomalies, 0.368 ms per step, -1.1% drift.
- Extreme parameters (MD 6, SD 60, SA and RA 120 deg, decay 0.99, deposit 0.5, respawn 0) 15,003 steps: no numerical errors, but 68% of agents ended in pixels with 50 or more agents and only about 19k pixels were occupied (a degenerate clumped picture). Tiny settings (10k agents) 15,003 steps: no problems.
- Found and fixed: 2 agents at exactly x = 1.0 in about 4 million samples (see DECISIONS.md). After the fix, none in about 12 million samples.

**Live loop (real 60 Hz pacing, HUD open so GPU timestamps are read back):**
- 400k agents, 300 seconds: exactly 60 steps in every second, frame interval median 3.3 ms, GPU total median 0.328 ms in both the first and the last quarter, worst single sample 1.18 ms, worst frame interval 10 ms once, JS heap 3.2 to 3.0 MB.
- 2M agents at 1920x1080, 120 seconds: exactly 60 steps in every second, GPU total 1.64 to 2.11 ms per 10-second window (first quarter 2.03, last 1.97), worst sample 3.54 ms, against a 16.7 ms frame.
- The same 2M at 1080p stepped at full speed cost 0.90 ms per step, about half of the live figure. Likely the GPU clocking down while idle between steps; not confirmed.

**Seed check on the two contradicted predictions:** repeated with seeds 1, 2 and 3. Sensor distance 4 gave 19 to 24 closed cells at 5.3% coverage on every seed (against 51 to 66 cells at SD 16), and SD 48 gave 16% to 18% coverage. Sensor angle 15 deg had 61% of agents turning per step and 90 deg had 9% on every seed, with the fewest cells at both extremes. So these two findings are not artifacts of seed 7. The other sliders were compared on seed 7 only.

**Not verified:** any GPU other than this one; runs longer than 8 simulated minutes at full speed or 5 real minutes live (the 20-minute run is M8); other seeds for the sliders other than SD and SA; the effect of window resizing or fullscreen during a long run; behavior with a background tab (the browser pauses the loop).

## 2026-09-30, M2 extended Physarum, presets, pen

All GPU results below come from one machine (one NVIDIA GPU, Chrome in the Claude desktop app) at 1043x914. Nothing was run at 1920x1080 in extended mode or on any other GPU.

**Built:** the extended `A + B*S^C` mode (a port of Bleuje's move shader), the 24-row preset matrix (22 selectable slots), background and pen blend, eased transitions, pen with ring, wave, stir, inertia, ring and center bursts, deposit density compensation, per-mode defaults, tuning panel additions (mode, two preset selectors, pen radius, inertia, transition time, effect buttons), on-screen credits, and dev tools for galleries, transitions, filmstrips, pen and effect tests.

**Read first:** Bleuje's `shaders.js`, `parameters.js` and the relevant parts of `main.js`, as the SPEC says. This caught two things before they cost anything: the stir scale (a gamepad axis in -1..1, so my first plan of mouse pixels would have been about 6 times too strong) and the density compensation (`countScale`), without which the tuned presets cannot work at our agent counts.

**Tests:**
- Unit tests: 30 pass (was 14). New: the matrix equals the copy in SPEC.md value for value, slots and landing-pair decoding, pen weight, vector blend, easing, the `A + B*S^C` values worked by hand for row 21, the extended step (background versus pen preset, S clamp, turn direction, S read with the preset offsets), pixel scale, count scale, mode defaults.
- GPU self-test, 22 of 22 pass, three runs in a row (11 classic, 11 extended): the extended shader matches the CPU reference on 8 controlled cases (background preset, pen preset with the pen exactly on the agent, S-dependent parameters, wrap, random turn; heading error at most 6e-8 rad, position error at most 5e-5 px), the counter sums to the agent count, no NaN, positions in [0,1), and same seed gives identical agents in extended mode. Not covered on the GPU: waves, stir, inertia, spawn, the noise wobble.
- Two problems in the test itself were found and fixed (see DECISIONS.md): the self-test raced the frame loop (determinism failed after extended mode made runs slower; the M1 pass was luck), and a mutation check first "survived" because one turn case used a 0.64 px sensor distance and because the dev server had not picked up my edit. After fixing both, a flipped turn direction fails exactly the strengthened case, with a heading error of twice the turn angle.

**Presets:**
- Gallery of all 22 slots as background (pen off) at 15 s and 45 s, 1M agents: chose 8 by eye (0, 2, 4, 13, 14, 15, 19, 21). The automatic coverage metric could not judge fine-grain presets (it saturates near 1), so the choice is visual.
- All 8 still alive and structured after 100 simulated seconds. Slot 4's blobs merge (22 cells to 9), the stripes of slot 14 regularize.
- At 400k agents four of the eight degrade (0 grainy, 14 blurred, 13 fragmented, 15 thinner) while 2, 4, 19, 21 hold. Extended default set to 1M.

**Transitions:** all 56 ordered pairs among the 8 (settle 15 s, switch with a 0.5 s ease, sample at 0.25, 0.5, 1.5, 4, 15 s). None went blank, all ended at 0.82 to 1.11 times the coverage of a pure run of the destination, and the final-state contact sheet (all 56 tiles) shows each destination's character. 15 pairs (all involving slots 13, 14 or 15) show a coverage spike mid-transition. Two were inspected frame by frame (15 to 21, 14 to 19): the picture washes into a fine-grain haze about half a second after the switch and the new structure grows out of it; with a 2 s ease the same passage is a slow dissolve. The other 13 were not inspected frame by frame.

**Pen:** background 21 with pen preset 4 and radius 0.22: a fine cellular honeycomb in the middle of the ribbed rivers, rivers intact outside, a soft halo between, still stable after 16 s in the live page (ring visible). Ring made more visible after this look.

**Interactions:** measured numbers in EXPLAINER.md (spawn 1.5% to 11.4% on the ring and 0.4% to 10.4% at the center, wave correlation 0.97, 0.67, 0.15, network healthy after it expired, stir 91 px against 1 px). Real pointer events in the browser: hover set the pen to the pointer position with the ring at the right size, scroll up grew the pen 0.20 to 0.27 and the slider followed, a click started a wave. Right-drag was tested with synthetic events (the pane cannot hold the right button): stir capped at length 1, faded to 0.0076 in half a second, no stir without the right button, context menu suppressed, pen off when the pointer left.

**Soak and timing (extended, 1M agents):**
- Accelerated, 30,003 steps (8.3 simulated minutes) with the pen on and inertia 0.3: 0 NaN, 0 out-of-range agents, 0 bad headings, counter sum exact at every check, 0.279 ms per step, -2.6% drift.
- Live loop, 90 seconds, with a simulated performer (pen circling, a wave every 3 s, a pen preset change every 10 s): exactly 60 steps in every second, GPU total 0.33 to 0.39 ms median, worst 1.31 ms, no frame over 10 ms, JS heap flat (10.7 to 9.1 MB).

**Not verified:** extended mode at 1920x1080 (pixel scale untested there), any other GPU, presets at agent counts other than 400k and 1M, seeds other than 7 for the gallery and effects, all 56 transitions frame by frame (2 inspected), the inertia slider (draft prediction only), right-drag with a real right button, the pen with real long-term use (the longest live run was 90 s), device-loss recovery with the new buffers (M8).

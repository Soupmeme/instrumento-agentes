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

## 2026-09-30, M3 flow field, flow followers, steering library

Everything GPU-related below ran on one machine (one NVIDIA GPU, Chrome in the Claude desktop app) at 1043x914. Nothing was run at 1920x1080 or on another GPU.

**Built:** the steering library (WGSL and CPU), the flow field (3D Perlin noise on the GPU, noise-angle and curl constructions, quantization, strength, pen edits: swirl, attract, repel, stir), the flow followers (steering agents that consult the field), a follower counter and weight in the deposit pass so followers and Physarum share one trail, the field debug arrows (V), the `Physarum agents` switch, pen support for followers, and tuning panel groups with dropdowns.

**Tests:**
- Unit tests: 54 pass (was 30). New (24): limit and length helpers, the steering formula (including that the force depends on the current velocity, that a low maxForce limits how fast the heading changes, and the speed cap), seek, flee, arrive, wrapped offsets, the noise (zero at lattice points, bounded, centred, continuous), field vector length and smoothness, quantization, curl is perpendicular to the noise gradient, pen edits (swirl perpendicular, attract and repel in opposite directions, none far away, stir aligns), field interpolation and wrap, the consult rule, look-ahead, and that a weaker maxForce overshoots a field flip further.
- GPU self-test, 35 of 35 pass (11 classic, 11 extended, 13 new). The GPU field matches the CPU reference cell for cell: noise angle worst error 6e-6, curl 3e-4 (finite differences amplify float error), quantized 4.5e-7 with 0 of 3828 cells differing, pen swirl with stir 4.6e-5. The GPU follower step matches the CPU steering rule (velocity error at most 7e-7, position error at most 9e-5 px) in six controlled cases: from rest, against the field, strong and weak force, look-ahead, and wrapping. The follower counter sums to the follower count, no NaN, no follower above maxSpeed, and the same seed gives identical followers.
- Mutation check with predicted failures: flipped the x term of the steering formula and the swirl rotation in the CPU references together. Predicted and observed failures matched exactly (the swirl case and five follower cases; the at-rest case, three other field cases, and counter, health and determinism passed). Served code checked, references restored.

**Do followers trace the field?** Alignment (mean cosine between a follower's direction and the field at its position): 0.96 with the noise-angle field and 0.974 with curl, against 0.34 and 0.01 when each follower is paired with the field at another follower's position. Measured effects of every follower and field parameter, and of the pen edits, are in EXPLAINER.md; two predictions were partly wrong (look-ahead hurts at 30 steps, faster followers cannot follow curvy fields) and their hints were rewritten.

**Seen (screenshots):** noise-angle followers gather into a few bright rivers along the field's sinks; curl followers with a slow trail decay draw luminous vortex strokes; 4 angle steps give right-angle, circuit-board streams; the pen's swirl carves a dark eye of circulation into the field; the arrow overlay shows the field as data. A dense curl swarm with a short trail decay looks like static (curl flow keeps density uniform), so strokes need fewer followers and a slower decay.

**Soak and timing (1M extended Physarum agents + 500k curl followers, pen on):**
- Accelerated, 30,003 steps (8.3 simulated minutes): 0 NaN, 0 out-of-range, 0 followers faster than max speed, Physarum and follower counters exact at every check, 0.41 ms per step (0.45 in the first tenth, 0.38 in the last).
- Live loop, 60 seconds, simulated performer (pen circling, waves, pen edit mode changing every 5 s): exactly 60 steps in every second, GPU total median 1.57 ms in the first quarter and 0.46 ms in the last (heavier while followers are scattered), worst sample 2.75 ms, one 20 ms frame interval in the whole minute, JS heap 18 to 6 MB (garbage-collection sawtooth).

**Not verified:** any GPU other than this one; 1920x1080; the flock or the coupling between families (M4, M5); runs longer than 60 s live or 8.3 minutes accelerated with followers; other seeds (all follower measurements used seed 7); the follower respawn and follower trail sliders (drafts); quantization beyond one screenshot at 4 steps; right-drag stir with a real right button (synthetic events only); the "wall" pen edit named in SPEC 5.2 (not built).

## 2026-09-30, M4 flocking on the GPU

Everything GPU-related below ran on one machine (one NVIDIA GPU, Chrome in the Claude desktop app) at a simulation grid of 1043 x 910. Nothing was run at 1920 x 1080 or on another GPU.

**Built:** the flock layer (`src/flock/`): boids with separation, alignment and cohesion as steering behaviors through the shared library; a spatial grid built on the GPU every step by counting sort (count, scan, scatter) so each boid reads only the 3 x 3 cells around it; fixed-point neighbour sums (bit-reproducible); the pointer as predator (flee) or attractor (seek) with the Physarum pen's soft circle; boids depositing into the shared trail with their own weight; a work guard that bounds the cost of a step; the G debug overlay (grid, one boid's perception circles and view cone, every boid coloured by how that boid counts it); a "Flock" group in the tuning panel with measured hints; a dev experiment harness (`__exp.flockStats`, `flockSweep`, `flockBench`, `flockSoak`).

**Tests:**
- Unit tests: 78 pass (was 54). New (24): fixed-point sums are order independent, grid dimensions, cell assignment, counting sort (counts, prefix sums, every boid once in its own cell), wrapping neighbour cells, the grid misses no neighbour, grid step equals the all-pairs step exactly (three radius settings), separation pushes away, radii, alignment and cohesion directions, forces capped and summed with weights, a weight of 0 silences a behavior, a lone boid coasts, the view cone and its effect only on alignment and cohesion (separation mutual), wrap, coincident boids, cancelling pushes do not brake, speed cap, the pointer (attract, flee, fade with distance, off), polarisation rises with alignment and cohesion, disorder without alignment, crowding without separation, the work guard's cap and sampling.
- GPU self-test, 49 of 49 pass (was 35; 14 new): grid cell counts, cell starts and cell membership against the CPU counting sort (572 cells, 0 differ); seven flock-step cases against the all-pairs CPU reference (three behaviors, view cone, separation only, cohesion only, pointer as predator, pointer as attractor, large radius), at most 0.1% of boids differing (measured: 0 of 4,000 in six cases, velocity error at most 7e-4; 1 of 2,500 in the large-radius case, a neighbour within float error of the radius); the work guard (sampled step mean velocity difference 3.0e-3 against 3.5e-4 without it); boid counter sum; no NaN, positions in [0,1), speed cap; bit-identical determinism (30,000 boids).
- Mutation checks with predicted failures: (A) the boid shader skipping the left column of grid cells: predicted and observed that all 7 flock-step cases fail and the 3 grid checks, counter, health and determinism pass. (B) the CPU reference's separation sign flipped: predicted and observed that 6 flock-step cases fail and "cohesion only" passes. Served code checked each time, originals restored.

**Problems found while building, and what was done (details in DECISIONS.md):**
1. The first flock collapsed: 20,000 boids ended in 2 flocks, 2.2 px apart, about 1,470 neighbours each, at 15% of max speed, and the boid pass cost 4.7 ms. The CPU reference reproduced it. Cause: the view cone applied to separation, so pushes between a boid and the one behind it were not mutual. Fixed by letting separation see all around; same flock then 5.6 px, 92% of max speed.
2. I first tried scaling the separation force by how lopsided the crowd is. A/B on the CPU reference: no measurable difference (6.41 px against 6.54 px). Reverted.
3. The live run found that holding the pointer still as an attractor gathers all boids in the pen circle and the boid pass took 55 ms (18 steps per second). Fixed with the work guard: 150,000 boids packed into the pen circle now cost 4.5 ms.
4. The first guard budget (100 million tests) was below the fullest cells of a healthy 50,000-boid flock and tipped a long run into a denser regime (3.0 px instead of 4.2). Budget doubled; the long run returned to the healthy regime.
5. Two of my own self-test checks were wrong before they were right: the work-guard check compared a noise-dominated quantity boid by boid, and the determinism check ran at a count where the guard was engaged.

**Do the sliders do what was predicted?** Measured for every flock parameter over 3 seeds (10,000 boids, 15 simulated seconds) and for the pointer (one seed); table in EXPLAINER.md section 4. Three predictions were wrong or partly wrong and their hints were rewritten: without alignment there are no clumps (an even slow gas); a high max force makes the flock noisier, not tighter; a smaller neighbour radius does not split the flock into pieces at this density. Cohesion equal to separation collapses the flock in all 3 seeds.

**Seen (screenshots):** the G overlay (grid lines, the selected boid's green neighbour circle and red separation circle, neighbours coloured); 6,000 boids alone with a decay of 0.94 form distinct circular mills with comet-like tails, and the pointer as predator clears a hole in them; 20,000 boids form one large rotating mill; all three families together in the extended mode look like one picture, but the boids and followers are faint next to 1M Physarum agents (balancing is M5).

**Soak and timing:**
- GPU time per step with 400k Physarum agents and 200k followers also running: 2.6 ms at 20,000 boids, 3.7 ms at 50,000, 4.7 ms at 100,000, 4.9 ms at 150,000 (60 steps per second in all).
- Accelerated, 18,000 steps (5 simulated minutes) with 50,000 boids, 400k Physarum agents and 200k followers: 0 NaN, 0 out-of-range, 0 boids faster than max speed, boid counter exact at all 10 checks, statistics flat, wall time per 100 steps 144 ms then 132 ms. Statistics cover the first 20,000 boids.
- Live loop, 60 seconds, extended mode with 1M Physarum agents, 500k followers and 50,000 boids, simulated pointer circling with clicks and the pointer alternating predator and attractor: exactly 59 to 61 steps in every second, GPU total 4.3 ms median in the first quarter and 4.5 in the last, worst second 5.6 ms, JS heap 20 to 17 MB.
- Acceptance (SPEC 12, M4): at least 20,000 boids at 60 fps together with M1 and M3 running: met (up to 150,000 boids measured).

**Not verified:** any GPU other than this one (the work guard's budget is tuned on this GPU at about 27 billion neighbour tests per second; a slower GPU needs fewer boids); 1920 x 1080 (the radii and speeds are in simulation pixels and are not scaled with the grid size); the flock sweeps used 10,000 boids only (other counts were looked at, not measured); the pointer numbers are one seed; the pointer was moved by synthetic events, not a real hand; flocks above about 50,000 boids are sampled in crowded cells (an approximation, checked only statistically on the GPU); the boid trail weights are starting values; runs longer than 5 simulated minutes; coupling between the flock and the other families (M5); the G overlay always follows boid 0 (picking a boid with the pointer was not built).

## 2026-09-30, M5 coupling and coherence

Everything GPU-related below ran on one machine (one NVIDIA GPU, Chrome in the Claude desktop app) at a simulation grid of 1043 x 910. Nothing was run at 1920 x 1080 or on another GPU.

**Built:** the coupling channels (flow -> Physarum as steering in both Physarum shaders; trail -> boids as a fourth steering force in the flock pass; both CPU references extended; a shared field sampling file), a delayed copy of the trail kept in the diffuse pass, the colour system (six palettes as data, one tone curve, the change tint, a faint vignette in the display shader), "Coupling" and "Look" groups in the tuning panel with measured hints, raised default boid trail weights, and a coupling experiment harness (`__exp.couplingStats`, `couplingSweep`).

**Process:** this was the first milestone run with the workflow habits saved after M4: metrics and predictions written first (DECISIONS.md), CPU definitions and unit tests first, GPU checks and mutation checks before measuring, the rule frozen before one scripted evidence job (self-test, all sweeps, shares, worst-case benchmarks, soak, live run).

**Tests:**
- Unit tests: 90 pass (was 78). New (12): flow bias silent at weight 0 and for no or zero field, turns toward the field the short way round, is limited (about 14 degrees at weight 1, strongest sideways to the field, small head-on), grows with the weight, an agent on empty ground ends up along the field, the trail still decides against a weak bias, the trail gradient (uphill, wraps, flat is zero), boids climb the trail (scales with weight, silent on a flat trail, limited to maxForce), six palettes (start at the background, brighten at every stop), palette lookup, the generated WGSL.
- GPU self-test, 60 of 60 pass (was 49; 11 new): flow -> Physarum classic at two weights and extended (heading error at most 9e-7 rad against the CPU steering rule, using the GPU's own field), weight 0 and a zero field change nothing, trail -> boids against the all-pairs reference with the three flocking rules and alone (0 of 4,000 boids differ), the delayed trail for two steps (error 1.2e-7), and everything on at once (counters exact, no NaN, bit-identical determinism with 100,000 Physarum agents, 50,000 followers and 20,000 boids).
- Mutation checks with predicted failures: (A) the shader's flow force halved: predicted and observed the three flow -> Physarum heading checks failing and nothing else. (B) the CPU gradient's y sign flipped: predicted and observed only the two trail -> boids checks failing. Served code checked, originals restored.

**Problems found while building (details in DECISIONS.md):**
1. The first flow force (0.5 step lengths) was twice too strong: alignment 0.92 at weight 1 and a collapsed network. Halved. This is tuning to a target after a wrong prediction.
2. The trail -> boids response has a cliff (1.5 to 1.75): boids climb a trail they also write. Slider capped at 2, safe range in the hint.
3. The change tint was invisible at first (scale 5 against a typical signal of 0.01 to 0.03), then gritty on bright veins; fixed by looking at screenshots (scale 25, mid-tone weighting).
4. Family shares were off: boids only 6.5 to 13% of the trail energy. Default boid weights raised threefold.
5. The existing work-guard self-test check had a tight margin (5x) and failed when the flock shader gained code; loosened to 3x.

**Seen (screenshots):** calm, dense and mid-transition states with all families on, in Abyss, Ember, Orchid, Verdigris, Bone and Tide; the Ember wave-and-vortex frame shows the pen across all three families. The coherence test is judged by eye by the author, and Kiwi decides whether it passes.

**Soak and timing:** table in EXPLAINER.md section 5. Summary: extended mode with 1M Physarum agents, 500k followers and 50,000 boids costs 3.9 to 4.9 ms per step with or without the couplings, 60 steps per second exactly; the collapse worst case is bounded at 4.8 ms; 18,000 accelerated steps with both couplings on show 0 anomalies and exact counters; the 60 s live loop (pointer, clicks, palette changing every 5 s) held 59 to 61 steps in every second.

**Acceptance (SPEC 12, M5):** "passes the coherence acceptance test in section 7": met by the author's eye on three states, pending Kiwi. "All coupling strengths are live controls": met (two new scalars, plus the three deposit weights).

**Not verified:** any GPU other than this one; 1920 x 1080; the coherence judgement by anyone but the author and on anything but this screen (not on a projector); the display pass is not machine-checked (palette lookup and data are unit tested, the shader is judged by eye); flow -> Physarum measured with a curl and a noise-angle field at field strength 1 only and in the extended mode with one preset; trail -> boids measured with classic Physarum, 20,000 boids, one boid trail weight (0.15), decay 0.94; the boid cliff moves with the boid trail weight and the decay; soak of only 5 simulated minutes with both couplings at moderate values (the flock was still getting slightly denser at the end, which longer runs in M8 should watch); flow -> boids (optional in SPEC 6) was not built; palette keys belong to M6.

## 2026-09-30, M6 scenes and the live instrument

Everything GPU-related below ran on one machine (one NVIDIA GPU, Chrome in the Claude desktop app) at a simulation grid of 1043 x 910. Nothing was run at 1920 x 1080 or on another GPU. The milestone was built across two sessions (a usage limit interrupted the first); nothing was lost.

**Built:** the scene data format with a validator (`src/scenes/`), the director (eased transitions, the wheel, the accent, capture), the keyboard map, the live control surface of SPEC 8.2 (pen, wheel as intensity, click as accent, right-drag stir, next, previous, jump, freeze, reset, safe), the cue panel, the help overlay, the rehearsal panel with scene tools (capture, export and import JSON, autosave and restore, rehearse with a readout, hot reload of `scenes.json`), three PLACEHOLDER scenes, and, in the world, the accent's surge, spawn and wave sizes, the palette crossfade and the count scale for safe mode.

**Process:** predictions and metrics first (DECISIONS.md), the pure logic and its unit tests before any GPU wiring, GPU hook checks, mutation checks with predicted failures, the ranges frozen, then the evidence job.

**Tests:**
- Unit tests: 115 pass (was 90). New (25): curves, the shipped scenes (valid, three, all marked PLACEHOLDER, inside the safe ranges of M4 and M5), validation (clamps, ignores, drops, never throws), array or object file forms, parameter ranges in radians, scene resolution (complete regime, rule defaults, wheel curves, pen scale), transitions (start where the world is, land exactly, no overshoot, monotonic, discrete switch at the set moment, presets pointed at the target, palette crossfade, interrupted crossfade), hard cut on a change of agent rule, zero-second scenes and entry bursts, next and previous at the ends, nothing changes without input for 2 simulated minutes, the wheel (bounded, smoothed, effective on the next step, only moves the scene's parameters, optional return), the accent by type, panel edits, capture and its round trip, setScenes, the rehearsal readout, and the key map (single keys, no modifiers, no repeat, nothing shared, digits jump, S and Escape).
- GPU self-test, 67 of 67 pass (was 60; 7 new): safe mode runs exactly the scaled count of every family and is reversible; the accent's surge multiplies the boids' pointer weight (0 and 0.8, against the CPU reference, error 7e-7), a full surge pushes harder, it fades by itself; a spawn burst moves the requested share of agents (0.049 for 0.05, 0.296 for 0.3). The self-test now starts from the default parameters (it had been inheriting the live scene).
- Mutation checks with predicted failures: (D1) the wheel's interpolation with min and max swapped and (D2) the transition easing reversed: in each case exactly the one predicted unit test failed. Originals restored.

**Problems found while building (details in DECISIONS.md):** the first wheel ranges left the scenes' character (calm 1,327 to 9 closed cells, dense collapsed) and were narrowed twice; the first pen test was not local because runs drift apart, so the method was changed to a warm start; safe mode saves about 30%, not 2.5 times; the self-test inherited the live scene's couplings; a palette crossfade interrupted by another scene key would jump (now committed to the nearer palette); Vite's hot reload needed the accept at module level and a window event; shell quoting failed twice (the known trap) and the Write tool was used.

**Seen (screenshots):** the help overlay at load; the cue panel with the current and next scene and PLACEHOLDER badges; the rehearsal panel with the rehearse readout; the FROZEN and SAFE MODE badge (canvas 625 x 546); the calm scene at wheel 0 and wheel 1, which after narrowing read as the same scene.

**Acceptance (SPEC 12, M6):**
- "Every live input has an observable effect in every scene": met by measurement (table in EXPLAINER.md section 6), with the pen only 2.3 times local in the calm scene.
- "No live input requires a modifier key or chord": met, tested.
- "A person who has never seen the app can walk through the three placeholder scenes and shape each one using only the help overlay": **not verified.** I walked through it myself using only the overlay's keys and mouse inputs (H, C, Space, wheel, click, F, S) and everything the overlay lists works, but I cannot play the part of a person who has never seen the app. Kiwi, or someone else, should try it cold.

**Not verified:** any GPU other than this one; 1920 x 1080; a cold walkthrough by another person; the soak ran with the first, wider wheel ranges (only the macro ranges changed afterwards; the live loop and the scene test used the final ones); safe mode's real benefit on a slower GPU; the SPEC 8.8 test measures a difference, "visible" is my threshold (0.03) and my eye; hot reload only in the dev server; the autosave and import paths through the real file picker were not exercised in the browser (the logic is unit tested); the `dominant` label is documentation and does not match the measured energy in the dense scene; a hard cut between agent rules was unit tested but not run on the GPU with a classic scene; scene content, names and notes belong to Kiwi (no SONG_BRIEF.md yet).

## 2026-09-30, M7 verification and documentation

Everything GPU-related below ran on one machine (one NVIDIA GeForce RTX 4070, Chrome in the Claude desktop app) at a simulation grid of 1043 x 910, seed 7. Nothing was run at 1920 x 1080 or on another GPU. From about the middle of the session another program (a game) was using the GPU, which made every timing unreliable (0.35 ms per step became 0.9 to 1.5 ms); the checks that count things were not affected.

**Built:**
- **The prediction registry** (`src/verify/predictions.ts`): 62 predictions in 7 groups (classic Physarum 13, extended Physarum 9, flow followers 11, flock 10, coupling 6, scenes 7, tools 6), each with an id, a testable statement, what changes, and the check that tests it: a unit test titled `[ID]` (20 predictions), a GPU check (38) or a self-test section (11); some have more than one. A unit test fails if a prediction loses its check, or a check its prediction.
- **CPU prediction tests:** 24 new, 139 in all. Flock predictions run on the CPU reference with 800 boids at the GPU's density (`test/predictions_flock.test.ts`, about 40 s), rules (`test/predictions_rules.test.ts`: the pen weight, the 22 presets, the turning radius v squared over F, the flow's turn limit), the registry integrity test, and the readout texts.
- **`__exp.verify()`:** 38 GPU checks, each registered under its prediction's id; a background job that saves a report to `evidence/verify/`.
- **Debug overlays:** key **A**, the sensors of the Physarum agent nearest the pointer (three sensors, readings, the turn it chose and why, in a text box); key **G** now follows the boid nearest the pointer instead of always boid 0; key **O** cycles the display through the trail, the delayed trail, the change and the agents per pixel; key **D** now adds one line per family with the live value of its parameters. The agent pass writes down what the chosen agent perceived and decided, and the overlay draws that, so it shows what the shader used.
- **The sweep tool:** `__exp.sweepShots(key, values, {times})` saves the real display for each value and time to `evidence/sweeps/` with a manifest and a hash per file (12 screenshots of 4 sweeps are kept).
- **Docs:** EXPLAINER section 7 (the tables of all 62 predictions, how to run each check, the debug tools, what the first run found, the limits), SCORE_TEMPLATE.md and a printable SCORE_TEMPLATE.html, the self-evaluation skeleton below, README, DECISIONS, `evidence/README.md`.

**Process:** predictions and metrics first (DECISIONS.md), the CPU tests tuned on the CPU before the GPU work, three mutation checks with predicted failures on the new GPU code, one first GPU run kept unchanged as a report, then the corrections, then a final run after every code change.

**Tests:**
- Unit tests: 139 pass (was 115). The 24 new are listed above.
- GPU self-test: 77 of 77 (was 67; 10 new: the probe against the CPU reference for the classic and the extended rule, and the pick against a brute-force search for agents and boids).
- GPU checks (`__exp.verify()`): first run 32 of 37, with five misses (three thresholds of mine too tight, one check using the wrong field, one check that could not tell clock drift from cost); second run 37 of 37 after the corrections; final run 37 of 38 (TL-05, whether following an agent costs anything, is inconclusive while the GPU is shared). The three revised thresholds and the two corrected checks are written in the history of each prediction.
- Mutation checks with predicted failures: (A) a probe reading written from the wrong sensor, (B) a pick that ignores wrapping, (C) S doubled in the extended probe: in each case exactly the predicted checks failed. Originals restored. TL-06 was run before its fix (fails) and after (passes).

**Problems found while building (details in DECISIONS.md and EXPLAINER section 7):** two flock thresholds missed on the first CPU run (the claims held); the first GPU run's five misses; a reset did not clear the accent's surge, found because the dense scene's wheel number changed between runs (fixed, TL-06); a probe-cost check that took clock drift for cost; the first pick check could not have caught a missing wrap (edge points added); Windows shell quoting failed once more (patches written as files); the GPU shared with a game made timing meaningless for the second half of the session.

**Seen (screenshots):** the sensor overlay on a classic agent (readout "middle is strictly highest: kept its heading") and on an extended one ("turned 80 deg toward the minus side, the higher reading"); the flock overlay with the boid nearest the pointer; the trail, change and agents-per-pixel views; the sweep screenshots (sensor distance 4 gives thin curling lines, 48 coarse fat veins; separation 0 piles the flock into a few streaks, 4 spreads it evenly). Looked at on an 800 x 700 pane; the overlay's marker sizes grow with the canvas but were not seen on a larger one.

**Acceptance (SPEC 12, M7): "for each agent family, a documented set of predictions each accompanied by a reproducible check":** met in form: every family has a set (Physarum classic 13, extended 9, followers 11, flock 10, coupling 6, scenes 7), each with a check anyone can run, listed in EXPLAINER section 7. Two things limit what that says: (1) a pass on a regression row means "still true on this machine", not "newly confirmed", and the document marks which are new (11 of 62); (2) all of it is draft until Kiwi writes his verdict in the last column, and none of it has been run on another GPU.

**Not verified:** any GPU other than this one; 1920 x 1080; the cost of the probe (inconclusive: -1.2%, -1.2% and 0.0% under a shared GPU with the rounds disagreeing by up to 14.7%, and no comparison with the M6 build); the GPU flock against the flock predictions at 10,000 boids (they are on the CPU reference; the GPU against the CPU is the self-test); the overlay on a projector; why the dense placeholder scene's wheel number still moves a little between runs (0.085 to 0.121, 0.107 to 0.108 when repeated; the accent's surge was one cause, the rest unknown); a cold walkthrough of the instrument by another person (from M6); the verdict of every prediction, which is Kiwi's.

---

## Self-evaluation (Autoevaluación)

Kiwi writes the scores and the reflections himself. The score fields below are empty on purpose, and nothing in this file proposes a number. The evidence lists were filled in by Claude from what exists in the repository today; an item marked *(pending)* does not exist yet, and the evidence is only as good as the limits stated in each milestone entry above (one machine, one GPU, one seed).

Date of this self-evaluation (Fecha): ____________

### 1. Task fulfillment (Cumplimiento de la tarea): web technology, real time, interprets the chosen music

**Score (Puntaje): ____ / 25**

**Reflection (Reflexión):**

**Evidence (Evidencia):**
- Web technology: WebGPU compute and render, TypeScript, Vite, deployed on GitHub Pages: [README.md](README.md), [`src/gpu.ts`](src/gpu.ts), [`src/physarum/physarum.ts`](src/physarum/physarum.ts), live at https://soupmeme.github.io/instrumento-agentes/
- Everything per agent runs on the GPU (the four allowed families only): [`src/physarum/move.wgsl`](src/physarum/move.wgsl), [`src/physarum/move_extended.wgsl`](src/physarum/move_extended.wgsl), [`src/flow/followers.wgsl`](src/flow/followers.wgsl), [`src/flock/flock.wgsl`](src/flock/flock.wgsl), and the rules in [CLAUDE.md](CLAUDE.md)
- Real time at 60 steps per second, measured on one machine: the "Performance and stability" tables in [EXPLAINER.md](EXPLAINER.md) sections 1, 3, 4, 5 and 6, and the milestone entries above (M1 to M6)
- Interprets the chosen music: the song is not chosen yet, so there is no evidence for this part *(pending)*. What exists: the cue panel with the song's clock (display only) and the scene engine: [`src/cue.ts`](src/cue.ts), [`src/scenes/`](src/scenes/), [SCORE_TEMPLATE.md](SCORE_TEMPLATE.md)
- No audio analysis anywhere (the music is a plain audio element): [DECISIONS.md](DECISIONS.md) (2026-09-29 entry on the song sources) and [`src/audio.ts`](src/audio.ts)
- Rehearsal hardening (20 minute run, device loss, full screen at presentation resolution) *(pending, milestone M8)*

### 2. Understanding and verification (Comprensión y verificación): can explain and defend the system, and predict and verify what a parameter does

**Score (Puntaje): ____ / 25**

**Reflection (Reflexión):**

**Evidence (Evidencia):**
- What each family perceives and how it computes its action, with the formulas and a predicted-versus-measured table per family: [EXPLAINER.md](EXPLAINER.md) sections 1 to 6
- Every prediction with an id, a testable statement and the check that tests it: [`src/verify/predictions.ts`](src/verify/predictions.ts), tables in [EXPLAINER.md](EXPLAINER.md) section 7
- CPU references and their unit tests (run with `npm test`): [`src/physarum/reference.ts`](src/physarum/reference.ts), [`src/physarum/extended.ts`](src/physarum/extended.ts), [`src/steering/steering.ts`](src/steering/steering.ts), [`src/flock/flocking.ts`](src/flock/flocking.ts), [`src/coupling/coupling.ts`](src/coupling/coupling.ts), the tests in [`test/`](test/) (including [`test/predictions_flock.test.ts`](test/predictions_flock.test.ts), [`test/predictions_rules.test.ts`](test/predictions_rules.test.ts) and [`test/registry.test.ts`](test/registry.test.ts))
- GPU against CPU on a real adapter, in the browser: `await __physarumSelfTest()` ([`src/physarum/selftest.ts`](src/physarum/selftest.ts) and its sections)
- Reproducible GPU checks of the predictions: `await __exp.verify()` ([`src/verify/gpu_checks.ts`](src/verify/gpu_checks.ts)), the saved reports in [`evidence/verify/`](evidence/verify/)
- Parameter sweeps with screenshots at fixed times from a fixed seed: `await __exp.sweepShots(...)` ([`src/verify/sweep_shots.ts`](src/verify/sweep_shots.ts)), the files in [`evidence/sweeps/`](evidence/sweeps/)
- Debug overlays that show what one agent perceives: key A (a Physarum agent's three sensors, readings and decision), key G (a boid's perception), key V (the flow field), key O (the raw buffers), key D (the live value of each family's parameters); [EXPLAINER.md](EXPLAINER.md) section 7
- Honest record of predictions that were wrong and how they were handled: the "Predicted versus measured" tables, the `history` fields of the registry, and the milestone entries above
- Test limits stated per milestone (what ran on the GPU, what did not): each milestone entry above, "Not verified"

### 3. Design and intention (Diseño e intención): can justify the selection and combination of behaviors and relate them to the musical interpretation

**Score (Puntaje): ____ / 25**

**Reflection (Reflexión):**

**Evidence (Evidencia):**
- Why these four families and how they are combined into one picture (shared trail, coupling channels, one palette): [EXPLAINER.md](EXPLAINER.md) section 5, [DECISIONS.md](DECISIONS.md) (M5)
- Every design choice with its alternatives and reasons: [DECISIONS.md](DECISIONS.md)
- The idea of scenes as regimes, brushes and keys, written as a draft in the author's own words to be edited into Kiwi's: [EXPLAINER.md](EXPLAINER.md) section 6
- How a scene relates to the music: the real scenes and their notes *(pending: they come from SONG_BRIEF.md, protocol in SPEC 8.9)*; the three scenes that exist are placeholders for testing the engine: [`src/scenes/scenes.json`](src/scenes/scenes.json)
- Open questions waiting for Kiwi: [ESCALATIONS.md](ESCALATIONS.md)

### 4. Human interpretation (Interpretación humana): the score and the controls let the performer drive the system live and respond to what emerges

**Score (Puntaje): ____ / 25**

**Reflection (Reflexión):**

**Evidence (Evidencia):**
- The whole live vocabulary (pen, wheel, click, stir, scene keys, freeze, reset, safe mode) and that none of it needs a modifier key: [`src/scenes/keys.ts`](src/scenes/keys.ts), [`src/help.ts`](src/help.ts), the key map tests in [`test/scenes.test.ts`](test/scenes.test.ts)
- Every live input makes a measurable difference in every scene: [EXPLAINER.md](EXPLAINER.md) section 6 (the table of the wheel, pen and click measurements) and registry ids SC-01 to SC-03
- Nothing happens by itself (no timeline, no automation): the unit test of registry id SC-04
- A blank visual score, one row per passage, with columns for the scene and the gestures and none for parameters: [SCORE_TEMPLATE.md](SCORE_TEMPLATE.md), printable as [SCORE_TEMPLATE.html](SCORE_TEMPLATE.html)
- The filled score and rehearsal records *(pending: they belong to Kiwi and depend on the song)*
- A cold walkthrough of the instrument by someone who has never seen it *(pending, not verified; see the M6 entry)*

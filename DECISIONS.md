# DECISIONS

Autonomous decisions, newest last. Format: date, decision, alternatives considered, why.

## 2026-09-29, M0

**Vite + plain TypeScript, no framework.**
Alternatives: plain JS with no bundler, Vite + JS. SPEC section 3 already fixes "plain TS/JS with a minimal bundler". TypeScript catches buffer-layout and uniform-struct mistakes early, and `@webgpu/types` gives typed access to the API. `npm run build` runs `tsc --noEmit` first so a type error blocks the build.

**File layout: `src/` with one small module per concern (`gpu.ts`, `hud.ts`, `audio.ts`, `ui.ts`, `main.ts`).**
Alternatives: one big `main.ts`. Small modules keep each one explainable in a sentence during the defense. Simulation code will get its own folders per agent family in M1 onward.

**Vite `base: './'`.**
So the built site works from any GitHub Pages sub-path (SPEC section 3).

**Non-live keys for setup: Enter = fullscreen, D = debug HUD, P = setup panel.**
Alternatives: F11, F for fullscreen. F is reserved for Freeze in the live vocabulary (SPEC 8.2), and F11 is browser fullscreen which cannot be intercepted reliably. These three keys are setup-time or debug, not part of the live vocabulary, and none needs a modifier.

**Device request: ask for the adapter's own `maxStorageBufferBindingSize` and `maxBufferSize`, and `timestamp-query` when offered.**
The default limits (128 MiB binding) would cap agent counts, and later milestones want millions of agents. Asking for the adapter's maximum costs nothing. Timestamp queries are optional: without them the HUD says frame timing is CPU-only.

**No `powerPreference` in `requestAdapter`.**
Chrome on Windows ignores it and logs a console warning (crbug.com/369219127). Removing it keeps the console clean, which the M0 acceptance requires.

**Device-lost recovery: up to 3 attempts with growing delay, message overlay while trying, final "reload" message.**
SPEC section 9 asks for a clear message and a recreate attempt. Full re-creation of simulation resources is added as they appear (M8 verifies it end to end).

**HUD fps is CPU frame-to-frame time from `requestAnimationFrame`.**
This is what the browser presented, so it is a fair fps figure, but it does not separate GPU from CPU time. Documented in `hud.ts` and shown in the HUD.

**Blob URL is revoked when a new song is chosen.**
Otherwise every song change leaks the whole audio file in memory (matters for the 20-minute run in M8).

## 2026-09-29, song sources (approved by Kiwi in chat)

**Song sources: local file, direct audio link, Spotify link, YouTube link. Plus an offline service worker.**
Kiwi asked for local files (offline) and pasted links (online), and confirmed Spotify Premium sign-in is acceptable. This loosens CLAUDE.md rule 2's wording ("music is played from a plain audio element") for the two embed cases, so it is recorded here as a user-approved exception. The intent of the rule is untouched: no audio analysis, ever. A local file or direct link stays a plain HTMLAudioElement whose samples are never read. Spotify and YouTube play inside vendor iframes, which the page cannot analyse at all. The only playback value the app reads is `Song.elapsed`, a display-only clock for the cue panel, which triggers nothing. CLAUDE.md itself was not edited; Kiwi may want to update its wording.

**Spotify through the embed iframe API, not the Web Playback SDK.**
Alternatives: Web Playback SDK (full tracks, needs OAuth, a registered Client ID and redirect URIs, which are account and deployment decisions, and Premium). The embed needs none of that: Kiwi signs in to Spotify inside Spotify's own player, no credentials touch our code, and it works on a static GitHub Pages site. Logged-out listeners get 30 second previews, so for a full song Kiwi must be signed in to Spotify in the same browser. The SDK stays a fallback if the embed proves unreliable (see ESCALATIONS.md).

**Vendor scripts are loaded only when a Spotify or YouTube link is pasted.**
The app never depends on them, so a local file works with no network. Offline, a pasted Spotify or YouTube link gets a plain message instead of a hang. Script loads time out after 10 s.

**Only http(s) links are accepted, parsed by a pure function (`src/source.ts`) with unit tests.**
The pasted string can end up in an element `src`, so `javascript:`, `data:` and `file:` are rejected. Lookalike hosts (`open.spotify.com.evil.test`) are treated as plain direct links, not as Spotify.

**Keyboard focus is handed back to the page after any click inside a player.**
A click inside an iframe keeps keyboard focus there, and Space (next scene) would silently stop working mid-performance. On window blur, if the active element is an iframe, it is blurred; the audio element blurs itself on focus. The link text field is blurred after loading for the same reason. Verified with the real Spotify and YouTube embeds: focus returns to the page body after clicking play.

**P hides the setup panel by fading it (`opacity: 0`, no pointer events), never `display: none`.**
So an embedded player keeps playing while the audience sees only the artwork. Verified with the Spotify embed: the clock kept advancing with the panel hidden.

**Service worker: stale-while-revalidate for same-origin GETs, plus a precache handshake, production builds only.**
The first page load happens before the worker controls the page, so its requests are never seen by the fetch handler. After registering, the page therefore sends the worker the list of same-origin files it loaded (`performance.getEntriesByType('resource')`) and the worker caches them, so the very next load can be offline. Cache matching uses `ignoreVary: true`: servers send `Vary: Origin`, module scripts carry an Origin header that the `cache.add` copies do not, and without this the JS and CSS never matched (found by testing, see LOGBOOK.md). Consequence: after a redeploy, the first reload still shows the old version and the next one shows the new one. Cross-origin requests (Spotify, YouTube, direct links) are never touched. Not registered in dev, where it would fight hot reload.

## 2026-09-29, follow-up from Kiwi

- Player visibility: Kiwi judged it inconsequential, so the panel (and any embedded player) keeps fading with P. No change made.
- CLAUDE.md is left untouched, at Kiwi's request. The embed exception is recorded only here.
- Spotify sign-in did not prompt inside the Claude app's built-in browser. Treated as a limit of that pane until tested in regular Chrome (ESCALATIONS.md item 4). No code change.

## 2026-09-30, deployment (approved by Kiwi)

**Public repo Soupmeme/instrumento-agentes, deployed to GitHub Pages by a GitHub Actions workflow.**
Live at https://soupmeme.github.io/instrumento-agentes/. Alternatives: a `gh-pages` branch with prebuilt files (would commit build output), or a private repo (Pages needs a paid plan for that). The workflow runs `npm ci`, `npm test` and `npm run build` before publishing, so a type error or failing test blocks the deploy. The repo is public, so SPEC.md, CLAUDE.md and all docs are public too.

**Commit author rewritten to the GitHub noreply address before the first push.**
The local commits carried Kiwi's Gmail address, which would have been public in the history. Kiwi approved rewriting the three unpushed commits (content unchanged, only author and committer lines). Verified afterwards that the Gmail address appears in no commit and no file. Future commits use the noreply address, set in this repo's local git config.

**Clean-install check before deploying.**
A dry run of the CI steps (`npm ci`, test, build) exposed a half-deleted `node_modules` caused by the dev server holding files open on Windows. Not a code problem, but stop the dev server before running `npm ci` locally.

## 2026-09-30, Spotify removed (Kiwi's decision)

**Spotify support removed. Song sources are now: local file, YouTube link, direct audio link.**
The embedded Spotify player was tested by Kiwi in regular Chrome (not the built-in pane): clicking it opened a separate tab and the Spotify desktop app, the player never showed a sign-in and never played more than the 30 second preview. The alternative, the Web Playback SDK, needs a developer app, Client ID, OAuth redirect and Premium, and Kiwi chose not to take on that fiddling. This supersedes the Spotify parts of the 2026-09-29 song-sources entry above (the embed choice and its focus and P-fade notes still apply to YouTube). A pasted Spotify link is recognised only to show "Spotify links are not supported. Use a local file, a YouTube link or a direct audio link." Direct audio links were kept because they need no account or player and are one code path shared with local files; they can be dropped if Kiwi wants only files and YouTube. The YouTube embed remains the one approved exception to "plain audio element" (CLAUDE.md is unchanged, at Kiwi's request).

**README.md added with the live GitHub Pages link as its first line after the title.**
Covers what it is, status, requirements, song sources, current keys, how to run, deployment, documents and credits. Credits list the algorithms the project is built on and are marked as growing as each one is implemented.

## 2026-09-30, M1 classic Physarum

**Trail and counter are plain storage buffers, not textures.**
Alternatives: `r32float` storage textures (SPEC 5.1 notes), `rgba16float`. `r32float` is not filterable without an extra feature and needs `textureLoad` anyway; half floats lose precision. A buffer has no format rules, any pass can read it, and the flow field and flock grid can use the same pattern later. The display pass does its own bilinear upsampling (4 reads). Cost: no hardware filtering, which the nearest-pixel sensing does not need.

**Agent positions are stored normalised (0..1), converted to pixels inside the shader.**
Alternative: pixel units. Normalised positions let the simulation grid be resized (fullscreen toggle, window resize) without touching or rescaling 2M agents. On resize the trail is cleared and agents keep their place.

**Simulation grid follows the canvas, capped at 1920 px on the long side, aspect kept.**
A 4K canvas would otherwise quadruple the per-pixel passes for little visible gain. The display pass upsamples bilinearly.

**Fixed 60 Hz simulation step with an accumulator (max 2 steps per frame, backlog dropped).**
Alternative: one step per screen refresh. That would make a 144 Hz monitor run the piece 2.4 times faster than a 60 Hz one, so the same tuning would look different on the presentation machine. Trade-off: if the machine cannot keep 60 steps per second, the simulation slows down instead of catching up.

**Agent buffer holds 2,000,000 agents; `agentCount` wakes the first N.**
Changing the count is a uniform change, not a reallocation, so it can be a live slider. 32 MB is small next to the adapter limits we request.

**Seeding on the GPU (`init.wgsl`).**
CLAUDE.md forbids CPU per-agent loops. Reset reuses the same pass.

**Trail update split into a deposit pass and a diffuse pass, ping-pong buffers.**
Alternative: fuse them (blur is linear, so one pass could read the counts of the 3x3 neighbourhood). Fusing saves a dispatch but doubles the counter reads and hides the two ideas (deposit, then diffuse and decay) that must be explained in the defense. The two passes cost about 0.3 ms together at 1080p, so clarity wins.

**Respawn kept, default 0.001 per step (about every 1000 steps).**
SPEC 5.1 lists respawn in the reference pipeline, not in the classic rule. It is one extra line and a live control. Setting it to 0 gives the pure classic behavior.

**Defaults that differ from the SPEC reference: decay 0.9 (reference 0.75), depositFactor 0.05 (reference 0.003), 400k agents.**
The reference numbers belong to Bleuje's setup: about 6 agents per pixel at 1280x736, where the sqrt saturation and a 0.75 decay give crisp filaments. We start with roughly 0.4 agents per pixel, so trails must live longer to connect (0.9) and each deposit must count for more (0.05). Sensing only compares values, so deposit mostly changes brightness. These are starting points tuned by eye, not final scene values.

**Turn rule tie handling.**
SPEC 5.1 leaves ties open. Implemented: F strictly highest keeps heading; F lower than both picks a random side; otherwise turn toward the higher side; when L equals R and the middle is not an extreme, keep heading. Unit tested in `test/physarum.test.ts`.

**GPU timing through timestamp queries, read back only while the HUD is open.**
The pane runs uncapped (about 300 fps), so fps says nothing about headroom. Timestamps give per-pass GPU time. The read-back (`mapAsync` on a 64 byte buffer, at most once per step) is a debugging cost paid only with the HUD visible, so the normal frame path has no read-back. Chrome quantises timestamps (values come in steps of about 0.066 ms), so small numbers are rough.

**A temporary tuning panel on T, sliders generated from a parameter list (`params.ts`).**
M1 needs live-adjustable parameters. The panel is built so M6 can extend it (scene capture, JSON) rather than replace it. It is not part of the live vocabulary: sliders release keyboard focus after each drag so the live keys keep working.

**In-browser self-test (`__physarumSelfTest`, dev builds) instead of a headless GPU test.**
Node has no WebGPU, and SPEC 10.4 says not to claim GPU tests ran without a real adapter. The self-test steps controlled agents on a hand-built trail and compares the GPU result with the CPU reference. It was mutation-checked: flipping one turn direction in the CPU reference made exactly the two left-turn cases fail.

## 2026-09-30, service worker fix: network-first pages

**Pages are now network-first (4 s timeout, cached copy as fallback); other same-origin files are cache-first with a background refresh under `event.waitUntil`. Cache renamed `instrumento-v2`.**
This supersedes the stale-while-revalidate design in the 2026-09-29 service worker entry. Found after the M1 deploy: the live site kept serving the M0 build even after two reloads, because the background refresh was not wrapped in `event.waitUntil`, so the browser could stop the worker before the new page was stored. Alternatives: keep stale-while-revalidate and only add `waitUntil` (a deploy would still take one extra reload to show), or skip caching pages (loses offline). Network-first for the page means an online visit always gets the newest version, and the cache only matters offline or on a very slow connection. Hashed JS and CSS files never change content, so cache-first is safe for them. Users stuck on the old worker recover with one reload (tested, see LOGBOOK.md).

## 2026-09-30, M1 verification pass (slider predictions, soak, timing)

**A dev-only experiment harness (`src/physarum/experiments.ts`) instead of eyeballing sliders.**
Alternatives: manual screenshots only. The harness runs each parameter value from the same seed, computes numbers (closed-cell count and size, vein coverage, turning per step, change over 1 s, agent pile-ups) and draws a contact sheet, so predictions are tested against measurements and can be rerun. It is loaded with a dynamic import inside `import.meta.env.DEV`, so it is not in the production bundle (checked: bundle size unchanged apart from three small lines). It reads buffers back and loops over pixels and agents, which CLAUDE.md allows only in test code; that is why it is isolated and never called by the app.

**A `paused` flag on the simulation (frame loop takes no steps while it is set).**
The harness needs the loop to stand still while it steps the simulation itself. The flag is the natural home for the Freeze key of milestone M6, so it was added to the class, not to the harness.

**Positions are clamped to the largest float below 1 (`0.99999994`) in `move.wgsl`.**
The soak test found 2 agents in about 4 million samples at exactly x = 1.0, because `p / size` rounds up when an agent is within about 6e-5 px of the far edge. The movement code already copes with it, but the documented range is [0, 1) and the self-test asserts it, so a rare flake was possible. After the clamp the same kind of soak found none in about 12 million samples at 2M agents. Self-test still 11 of 11.

**Parameter ranges are not narrowed, known bad corners are documented instead.**
Alternatives: clamp the sliders away from respawn 0 and the extreme corner. Scenes (M6) may legitimately want the "world decays" look of respawn 0, and the performer never touches raw sliders live anyway. EXPLAINER.md lists the corners (respawn 0 collapses the picture in about 100 s; extreme settings clump all agents).

**Hints in the tuning panel now state measurements, and say where the first predictions were wrong.**
SD (small SD does not give a fine tangle) and SA (larger SA does not branch more) were contradicted, so the draft text was replaced by what was measured. Kiwi still owns the final wording.

**Performance is judged on the live loop, not on full-speed stepping.**
Full-speed batches (0.90 ms per step for 2M agents at 1080p) were about half the cost of the live 60 Hz loop (1.6 to 2.1 ms) for the same work. Probable cause: the GPU idles between steps and clocks down (not confirmed). Headroom estimates therefore use the live numbers, with the timestamp quantisation (about 0.066 ms per pass) in mind. Full-speed wall-clock per batch is still the better drift detector, because it is not quantised.

## 2026-09-30, M2 extended Physarum, presets, pen

**Two separate agent shaders (classic and extended), chosen per step by the mode.**
Alternatives: one shader with a mode branch, or replacing the classic rule. The classic shader is the verified M1 baseline and the version that maps to the course's Patt Vira reference; keeping it untouched keeps its tests and measurements valid and keeps each shader short enough to explain. The extended shader is a port of Bleuje's move shader (CC BY-NC-SA 3.0), restructured for WebGPU with per-agent random streams instead of position hashing. Both share the trail, deposit, diffuse and display code.

**Velocity lives in its own buffer, used only by the extended shader.**
Alternative: widen the agent struct to 32 bytes. A separate 8-byte-per-agent buffer (16 MB at 2M agents) leaves the classic agent layout and its tests unchanged. Cleared on Reset.

**Deposit density compensation (`countScale`), as in the reference.**
The reference multiplies each pixel's agent count by `referenceDensity / actualDensity` (reference density 6.28 agents per pixel) before the square root, so the trail has the statistics the presets were tuned on. We run 0.4 to 2 agents per pixel, so without it S would be far too small and every preset would misbehave. Classic mode uses 1. Written into the shared params uniform (replaced a spare field) so the deposit pass needs no new binding.

**Distance scale `pixelScale = 250 * sqrt(area / (1280 * 736))`.**
Alternative: the reference's 250 for 1280x736 and 300 for 1920x1088, which grows more slowly than the picture. Proportional scaling keeps the composition of a preset the same whether the grid is windowed or full screen. Cost: on a bigger grid the same number of agents is spread thinner. Extended mode was only run and looked at at 1043x914. It has not been run at 1920x1080, so the scaling itself is untested.

**Presets are "slots" (22 of the 24 matrix rows, in the reference's order).**
The matrix is copied from Bleuje's `parameters.js`; a unit test parses the copy printed in SPEC.md and checks every value. The shader's parameter order (SD0, SDE, SDA, SA0, SAE, SAA, RA0, RAE, RAA, MD0, MDE, MDA, SB1, SB2, SF) matches the SPEC; the names in Bleuje's source are shifted by one, which is a labelling slip in that file, not a difference in behavior (checked against the shader indexing).

**Preset transitions: smoothstep ease over `presetSeconds` of simulation time, all 15 numbers blended linearly, started automatically when a slot changes.**
Alternative: the reference's per-frame chase with progress^1.5. A fixed-duration ease is deterministic, does not depend on frame rate, and pauses with the simulation. Default 0.5 s (the reference value). The value is a scene property (SPEC 8.3).

**Transitions through a fine-texture preset pass through a haze; the ease time decides whether it reads as a wipe or a dissolve.**
Observed in all pairs involving slots 13, 14, 15 (15 of the 56 pairs spiked; two inspected frame by frame). A 2 s ease turns the 0.5 s wipe into a slow dissolve. No pair was blanked or failed to reach its destination, so no pair needs special handling, but scene designers should know that a hard 0.5 s change into or out of these presets is visibly a wipe. No two-step paths were needed.

**Pen: Gaussian weight `exp(-d^2 / sigma^2)` in screen-height units, with the reference's slow noise wobble on the distance.**
Default radius 0.25 of the screen height (reference default 0.5, range 0.15 to 0.85); the ring drawn at the pointer has radius sigma, where the pen still has 37% weight. Ring made brighter with a dark halo after the first look showed it was hard to see over bright veins.

**Pointer mapping in M2: move = pen, wheel = pen radius, left click = wave, right-drag = stir. Bursts only from panel buttons.**
Move, click and right-drag are already in the SPEC 8.2 vocabulary. The wheel is the future intensity macro that also scales the pen; until M6 defines that macro it changes the pen radius directly, so it is not a new live input. Bursts (ring, center) are rehearsal buttons, not a new live input: the SPEC makes the click the one accent whose look (wave, burst or ring) belongs to the scene, which is M6 work. The panel buttons let the effects be tested now.

**Stir is normalised to the reference scale (length at most 1, times 5 px in the shader), not raw mouse pixels.**
The reference takes stir from a gamepad stick in -1..1. My first version allowed up to 6 before the same factor of 5, which would have pushed agents about 30 px per step. Found by reading the source, fixed before the first run.

**Simulation time (`frame / 60`) drives the noise, the waves and the transitions, not the wall clock.**
Runs are repeatable from a seed, and pausing (Freeze, tests) pauses waves and easing as well.

**Extended-mode defaults: decay 0.75, deposit 0.003, display gain 30, respawn 0.001, 1M agents. Switching mode resets the agents.**
Decay and deposit are the reference values. The display gain is higher because the extended trail is dimmer (about 4 times, from the density compensation). 1M agents because several curated presets degrade at 400k (measured). Cost of 1M: about 0.28 ms per step at 1043x914.

**The display is still the trail through a tanh tone curve, not the per-step agent count the reference draws.**
The reference draws agent density, which needs about 6 agents per pixel to look solid; at our densities it would look dotted. The unified palette and the delayed-trail colour trick are milestone M5.

**Eight presets curated, chosen by eye from a gallery of all 22.**
Criteria: clearly structured (not fine grain), distinct from each other, still alive after 100 simulated seconds, and useful as different regimes (calm, dense, scattered, ordered). Chosen: 0, 2, 4, 13, 14, 15, 19, 21. Bleuje's own list of good pen and background pairs was used only as a starting point; nothing was kept without looking at it here. The choice is aesthetic and can change once the song and the scenes exist. Starred in the panel, others remain selectable.

**On-screen credits (a "Credits" block in the setup panel) added, as SPEC 5.1 requires for the CC BY-NC-SA code.**

**Test infrastructure lessons (fixed):**
- The self-test did not pause the frame loop, so the loop's own 60 Hz steps landed between the test's steps. The determinism check then failed once extended mode made the runs slower. It had passed in M1 by luck of timing. The test now pauses the loop for its duration.
- A first mutation check "survived" for two independent reasons: the test case that exercises the "left sensor is higher" branch used S = 0.3, which makes the sensor distance 0.64 px so all three sensors read the same cell (fixed: S = 0.55, about 30 px), and the dev server had missed my edit of the mutated file (fixed by restarting it and by checking the served code, not a comment, which Vite strips). After both fixes the mutation is caught, with a heading error of exactly twice the turn angle.
- Node's native TypeScript mode needs `.ts` in import paths, so tsconfig allows importing `.ts` extensions (noEmit, so harmless) and the modules that tests import use them.

## 2026-09-30, M3 flow field, flow followers, steering library

**The field is a buffer of vectors on a coarse grid (16 px cells), rebuilt every step by a compute pass.**
Alternatives: store an angle per cell, or evaluate the noise inside each follower's shader (no field buffer). SPEC 5.2 asks for the field to be data so it can be drawn, painted and read by other families, and vector interpolation avoids angle wrap-around. A field of about 66x58 cells costs nothing to rebuild per step. Followers interpolate between the four nearest cells, so motion is smooth.

**Pen edits are procedural, applied on top of the noise each step, not painted into a persistent field.**
Alternative: let the pen accumulate edits that persist and fade. That needs a second field buffer and decay rules and is harder to explain. A pen region that exists only while the pointer is there matches how the Physarum pen works (same gesture, same meaning, SPEC 8.4). Swirl, attract and repel are the three edits; the stir drag also bends the field near the pen. A wall edit (SPEC lists it) was not built: repel gives the same visible effect for followers.

**Noise: Perlin gradient noise with an integer hash, identical on the CPU and GPU.**
Alternatives: simplex (patented in some forms, harder to explain), value noise (blocky). Perlin is what Hobbs, Shiffman and Sofia's sketch use, and an integer hash written the same way in TypeScript and WGSL lets the self-test compare the GPU field with the CPU reference cell for cell (matched to about 6e-6). Noise coordinates are in screen-height units so the field looks the same at any resolution; the third axis is simulation time.

**Two field constructions: noise angle (0..4 pi) and curl.**
Noise angle is the Nature of Code construction (0..4 pi counters Perlin's habit of hugging the middle, which would otherwise favour one direction). Curl (the noise gradient turned 90 degrees) has no sinks. Both are one selector; the difference is visible and explainable (measured, see EXPLAINER.md).

**Followers deposit into their own per-pixel counter; the deposit pass adds it to the shared trail with its own weight.**
Alternative: a separate trail for followers, or writing the trail directly. A separate counter and weight keeps followers and Physarum agents in one material (SPEC section 2, "one image") and makes each family's share one live number. It also means Physarum agents sense follower marks; the explicit coupling controls of SPEC section 6 belong to M5. Cost: one more grid-sized buffer and one more read in the deposit pass.

**Followers are stateless apart from position and velocity; respawn is a per-step chance, at rest.**
Alternative: a progress counter per follower as in Physarum. A chance per step needs no extra state and gives the same average lifetime. Followers start at rest so the steering (acceleration limited by maxForce) is visible from the first frame.

**A shared steering library, WGSL and CPU, with seek, flee and arrive as well as follow-field.**
SPEC 5.3 wants the steering structure visible in the code. Only follow-field runs on the GPU in M3, but seek, flee and arrive are in the library and unit tested on the CPU so the flock (M4) and the pen (attract or repel boids) reuse them unchanged. `steer = limit(desired - velocity, maxForce)` is the one shared line. WGSL `round()` rounds halves to even and JavaScript's `Math.round` rounds them up; this only matters at exactly half the world width, where either way round is the same distance.

**Followers are off by default (count 0), and the Physarum agents can be switched off.**
So every M1 and M2 result stays valid and the scene system (M6) decides what runs. `followerCount` is a linear slider from 0 (a log slider cannot reach 0). Per-mode default follower trail weights (0.05 classic, 0.02 extended) match the brightness of each mode's Physarum deposit and are starting points, not tuned values.

**The pen now serves any family that reads it: it exists in the extended mode, or when followers are on and the pen edits the field.**
The wheel, right-drag stir and the ring follow it. The left-click wave stays extended-only because waves are a Physarum effect.

**Field debug overlay on V, drawn as arrows over the picture, one per cell.**
Arrows have constant length (direction is what is read) and opacity showing strength. Not part of the live vocabulary (SPEC 8.2); V is free.

**GPU timestamp slots grew from 4 passes to 6 (field, followers added); passes that did not run in the latest step report "?".**
Otherwise a pass that stopped running would keep showing an old time.

**Test method: mutation checks with predicted failures.**
Two mutations of the CPU references (the x component of the steering formula, the rotation direction of the pen swirl) were applied at the same time, and the set of failing checks was predicted before running: the swirl field case and the five follower cases with a nonzero x velocity should fail, and the at-rest follower case, the other field cases and the counter, health and determinism checks should pass. Exactly that happened. The served code was checked (not a comment, which the dev server strips) so the test could not silently run the unmutated file.

**Measured hints replaced the drafts in the tuning panel.**
Two were partly wrong: look-ahead helps at 10 steps but hurts at 30, and a faster follower with the same force follows a curvy field worse (turning radius grows with speed squared).

## 2026-09-30, M4 flocking on the GPU

**Neighbour search: a uniform grid built with a counting sort, exact within the radius (the SPEC's preferred option), not the approximate aggregate fallback.**
Alternatives: all-pairs (N squared, dead above a few thousand boids) and per-cell aggregates of position and velocity (cheaper, but a boid then perceives "the average of nine cells" instead of its real neighbours, which the professor could question). The grid cell is at least as wide as the largest of the two radii, so every neighbour lies in the 3 x 3 cells around a boid. Three passes: count (atomicAdd per cell, the returned value is the boid's rank in the cell), scan (one workgroup, prefix sum of up to 65536 cells), scatter (each boid copies its state into its slot). The cell count follows the radius slider every step (at least 3 per side, at most 65536 in all). A CPU twin (`buildGrid`) and an all-pairs reference let the self-test prove the grid misses no neighbour.

**The scatter pass copies the boid states into cell order; the boid pass reads consecutive memory instead of an index list.**
Alternative: scatter only indices. It was built first and measured: the copy made the boid pass about 14% faster at 20k boids (4.0 ms against 4.7 ms while the flock was still collapsed), a smaller gain than expected, but it also removed one buffer and one indirection. Kept. Flock cost turned out to depend mostly on how many neighbours are in reach (see the view cone entry below).

**Neighbour sums are fixed-point integers (1/1024 pixel), so the flock is bit-reproducible.**
The grid is built with atomics, so the order in which a boid meets its neighbours changes from run to run, and float addition is not associative. Integer addition is. Alternatives: sort each cell by index (costly) or accept run-to-run differences. Cost: terms are rounded to 1/1024, which changes a force by about 1e-4 relative; the GPU matches the CPU reference to 7e-4 in velocity. The determinism check (30,000 boids, 20 steps, two runs, every value identical) passes.

**Boids are double buffered.**
The boid pass reads the state at the start of the step and writes the next one, so no boid sees a neighbour that has already moved. Alternative: update in place (less memory, but then results depend on thread order and a flock is not reproducible).

**Three weights, two radii, one view angle, plus the pointer; all steering, all through `steerToward`.**
A separation radius and a shared alignment and cohesion radius (as in the Nature of Code: 25 and 50 px), one view cone. Reynolds lists a separate distance and angle per behaviour (nine numbers); that is more controls than a performer can use and more than can be defended one by one. Each behaviour chooses a desired velocity (away from crowding, the neighbours' mean heading, the neighbours' centre) and the library's one line turns it into a force. The forces are weighted, added, and the speed is capped.

**The view cone applies to alignment and cohesion only; separation sees all around.**
Found by measurement. The first version applied the cone to all three behaviours with a default cone of 270 degrees. Flocks collapsed: 20,000 boids ended in 2 flocks with 2.2 px between nearest neighbours, about 1,470 neighbours each, and moved at 15% of max speed (the CPU reference reproduced it at the same density, so it was the rule, not the GPU code). Cause: with a blind spot behind, a boid never feels the boid it is crowding from behind, so the pushes between two boids stop being mutual and only ever point backwards. With the cone off separation, the same flock is healthy (nearest neighbour 5.6 px, 92% of max speed). Reynolds gives each behaviour its own angle, so this stays within his model; personal space is the behaviour where a blind spot makes least sense.

**Tried and reverted: scaling the separation force by how lopsided the crowd is.**
Before finding the real cause I made the separation force proportional to the size of the summed pushes (a balanced crowd pushes nowhere), reasoning that a normalised sum gives no resistance to compression. A/B on the CPU reference, 1,200 boids, 500 steps: nearest neighbour 6.41 px scaled against 6.54 px normalised, and both collapse at cohesion 2. No measurable effect, so the plain rule (normalised, as in the Nature of Code and Reynolds' advice to normalise each component) was restored. Less to explain.

**Cohesion equal to or above separation collapses the flock; this is left in the range and documented, not clamped.**
At cohesion 2 (separation 2) all 3 seeds collapsed into a few dense points (0.6 px spacing, up to 4,000 boids in one grid cell). That is what the model does (competition against cooperation, SPEC 5.4), it is a legitimate dramatic state, and it shows why both forces matter. The cost is performance: the boid pass cost grows with boids times neighbours in reach. The work guard below bounds it, so the collapsed state is safe to reach, but scenes should stay out of that corner unless a collapse is the intent.

**The pointer is a steering target: attract is seek, predator is flee, weight exp(-d^2 / sigma^2) times a strength.**
The same soft circle as the Physarum pen (same radius control and wheel), so one gesture means one region for all families (SPEC 6.3). Alternatives: a speed boost for fleeing boids (as in the three.js example), a hard radius. The force is limited to maxForce before weighting, like every other behaviour. Attract is seek, not arrive: boids overshoot and orbit the pointer, which looks alive; arrive would park them.

**Boids deposit into their own per-pixel counter with their own weight, like followers; the deposit pass has a third term.**
Same reasons as M3 (one material, each family's share is one live number). Default weights 0.05 (classic) and 0.02 (extended) are starting points, not tuned values. In the extended mode with 1M Physarum agents, boids and followers are faint next to the Physarum network; balance and coupling (boids sensing the trail, the flow bending Physarum) belong to M5.

**Defaults: 0 boids, separation 2, alignment 1.5, cohesion 0.6, radii 12 and 40, cone 270 degrees, max speed 2.5, force 0.08, pointer as predator at strength 4.**
Starting values chosen by looking at 6k and 20k boids and by the sweeps, not tuned for any scene. The flock is off by default so every earlier result stays valid and scenes (M6) decide.

**Slider limit 150,000 boids.**
Before the work guard, 262k boids took 49 ms per step at radius 40 (cost grows with count times density). The guard now bounds the cost, but above about 50k boids the flock is an approximation, so the slider stops at 150k. The buffers are still allocated for 262,144.

**Debug overlay on G: the grid, the perception circles and view cone of boid 0, every boid coloured by how boid 0 counts it.**
For the defense ("what does one boid see?", SPEC 10). Boid 0 is the selected boid; choosing one with the pointer was not built. Not part of the live vocabulary (SPEC 8.2); G is free.

**Timestamp slots grew from 6 to 8 passes** (the flock grid passes count, scan and scatter are timed together; the boid pass separately).

**Test method: two mutation checks with predicted failures.**
(A) The boid shader skipped the left column of grid cells: predicted that all 7 flock-step cases fail and the 3 grid checks, counter, health and determinism pass. Observed exactly that. (B) The CPU reference's separation sign flipped: predicted that 6 of the 7 flock-step cases fail and "cohesion only" (separation weight 0) passes. Observed exactly that. The served code was checked each time.

**Test tolerance: up to 0.1% of boids may differ in one flock-step case.**
A neighbour within float error of the radius is in for the GPU (float32) and out for the CPU (float64). One boid in the 2,500-boid large-radius case differed by 5e-3 in velocity (expected: about one such pair per run at that density). A real bug changes hundreds of boids, as mutation A showed.

**A work guard bounds the cost of a step: about 200 million neighbour tests, then crowded cells are sampled.**
Found by the live run: after the simulated performer stopped with the pointer in attract mode, all 50,000 boids gathered in the pointer circle and the boid pass went to 55 ms (18 steps per second), which would break 60 fps in performance. Alternatives: clamp the pointer strength below the separation weight (hacky, and cohesion above separation collapses the flock as well), lower the boid limit (does not help when the collapse is the state), or leave it for M8. The guard is a per-step budget: each boid examines at most `cap = budget / (9 x boids)` boids of each cell (never below 24), as an evenly spaced sample with a per-boid offset when the cell holds more. The sums are then estimates of the exact ones; nothing changes for cells under the cap. With the guard, 150,000 boids packed into the pointer circle cost 4.5 ms. Cost: in an overloaded cell the subset depends on the arbitrary order inside the cell, so bit-reproducibility holds only while no cell exceeds the cap (the determinism check uses 30,000 boids for that reason), and above about 50,000 boids at the default radii the flock is an approximation.

**The budget is 200 million tests, not 100 million.**
The first budget (100 million) gave 222 boids per cell at 50,000 boids, just below the fullest cells of a healthy flock (about 250). The guard then sampled them slightly and the 18,000-step soak settled into a denser regime (nearest neighbour 3.0 px instead of 4.2, fullest cell 500 and more instead of about 90). Sampled separation is noisier, the flock compresses, more cells exceed the cap, which compresses it further. The guard must only bite in states that are already pathological, so the budget was doubled (cap 444 at 50,000 boids) and the soak returned to the healthy regime. The cost bound is about 7 ms on the development GPU (about 27 billion tests per second measured), which is the largest flock pass the guard allows; a slower presentation GPU needs fewer boids (M8 quality presets).

**Test method: the guard check proves the guard engaged.**
"The sampled step is close to the exact one" alone would also pass if the cap were ignored, so the check also runs the same case without the guard and requires the forced-cap run to differ more (3.0e-3 against 3.5e-4 mean velocity difference). The setup is alignment only with a narrow range of headings: separation in a balanced crowd is a tiny leftover of large pushes, so a sample of it cannot be compared boid by boid (a first version of the check failed for that reason: mean difference 0.16, which is what independent random directions give).

## 2026-09-30, M5 coupling and coherence

Predictions and metrics were written before measuring (see "Predictions and metrics" below), following the workflow habits agreed after M4.

### Predictions and metrics

Metrics (measured with `__exp.couplingStats`, seeds 7, 8, 9, 900 steps after a reset, 1043 x 910 grid):
- Flow alignment of Physarum: mean cosine between an agent's heading and the field direction at its position.
- Network health: closed cells, coverage, agents in crowded pixels (existing trail analysis).
- Boid enrichment: mean trail under the boids divided by the mean trail over the world.
- Flock health: nearest-neighbour distance, fullest grid cell (existing flock analysis).
- Family share: each family's contribution to the trail energy per step (sum over pixels of sqrt(min(count * scale, 100)) * weight), as a fraction of the total.
- GPU time per step and in the worst state.

Predictions:
1. flow -> Physarum, alignment: about 0 at weight 0 (between -0.03 and 0.03); 0.1 to 0.3 at 0.25; 0.4 to 0.8 at 1 (the agent's own trail-following turn pushes back). Stronger with curl than with noise angle only if the field is smoother there; I expect no large difference.
2. flow -> Physarum, structure: closed cells fall as the weight rises (veins straighten into streams along the field), coverage roughly unchanged. With the noise-angle field (which has sinks) at weight 1, agents concentrate onto a few lines: the share of agents in crowded pixels rises clearly. Agent pass time rises by less than 30%.
3. trail -> boids, enrichment: about 1 to 1.5 at weight 0 (no perception of the trail); at least 2 at weight 1; rising with the weight. Hazard: at weight 2 or more boids pile onto veins and their own wake, nearest-neighbour distance falls below 2 px; the work guard bounds the cost.
4. Family share: with equal per-agent deposit weights the Physarum family dominates the extended mode (above 85% of the trail energy with 1M agents against 60k followers and 20k boids). Balanced defaults need a larger boid and follower weight there.
5. Delayed-trail colour: growing trail glows in the palette's accent and fading trail darkens; with the coupling on, flocks crossing veins should be visible as bright moving accents. Judged by eye.

### Decisions

**Two coupling channels change how agents move; the third ("who writes the trail") needed no new code.**
SPEC 6 lists three channels. (1) Flow -> Physarum: new. (2) Boids write to the trail and sense its gradient: the writing already existed (boid trail weight), the sensing is new (trail -> boids). (3) The pen as the shared intervention: already built across the three families (same soft circle and wheel). Physarum agents already sense follower and boid marks because all families write one trail; the deposit weights ("deposit", "follower trail", "boid trail") are that channel's live scalars. Each new channel has one live scalar: "flow steers Physarum" (0 to 1) and "trail attracts boids" (0 to 2). Both are off (0) by default, so every earlier result stays valid.

**Flow -> Physarum is steering, using the library's one line, applied after the agent's own trail-based turn.**
The agent's velocity is its heading times its step length; the field gives a desired velocity of the same length; `steer = limit(desired - velocity, weight * FLOW_FORCE * stepLength)`, and the new heading is the direction of velocity plus steer (speed stays constant, as for every Physarum agent). Alternatives: add a fixed angle toward the field (not steering, and it needs an arbitrary sign rule), or bias the sensor readings (changes what the agent perceives, but then the flow's strength depends on the trail). Both Physarum shaders (classic and extended) and both CPU references use it, and a zero field is silent (it does not brake). A property worth knowing: steering works on the difference between desired and current velocity, so an agent heading straight against the field is mostly slowed, not turned, and a constant-speed agent ignores that; the flow bends agents that are sideways to it.

**FLOW_FORCE is 0.25 step lengths (about 14 degrees per step at weight 1), after a first value of 0.5 overshot.**
With 0.5 the measured alignment was 0.92 at weight 1 and the network collapsed (3 closed cells with a noise-angle field, 84% of agents in crowded pixels) while 0.25 already gave 0.35 to 0.5. The prediction had been 0.4 to 0.8 at weight 1. The reason: the flow pulls the same way every step, while the trail's turns alternate left and right, so a pull that looks small next to a 45 degree turn wins. The constant was halved so that the slider's 0 to 1 spans "no effect" to "strongly aligned" instead of reaching collapse before the top. This is tuning a range to a target after a wrong prediction, not a confirmed prediction; the table in EXPLAINER.md says so.

**Trail -> boids is steering up the trail gradient, sensed at 8 pixels, silent on a flat trail.**
The boid reads the trail at four points (8 px right, left, below, above; nearest pixel, wrapping) and takes the two differences as a gradient; desired velocity is toward it at max speed; the force is limited to maxForce and weighted like every flock behavior. Alternatives: sense a wider neighbourhood (more reads), use the trail value only (no direction). One vector is all a boid perceives of the trail. The flock pass now binds the trail buffer, which brings it to 8 storage buffers, the default limit per shader stage; a further coupling in that pass (flow -> boids, SPEC 6 lists it only as optional) would need a buffer merge, so it was not built.

**The trail -> boids response has a cliff, so the slider stops at 2 and the hint gives the safe range.**
Measured (20k boids, 400k Physarum agents, 3 seeds): the trail under boids against the world average is 1.3 at 0, 1.5 at 1, 1.9 at 1.25, 2.9 at 1.5, then 9 at 1.75 and 19 at 2 (boids locked onto veins, 0.6 px spacing, up to 2000 in one grid cell). Boids climb a trail they also write, which is positive feedback. A smoother response would need a saturating function of the gradient or excluding the boids' own marks; neither was done (the second needs a separate trail channel). The cost of the collapsed state is bounded by the work guard (4.8 ms for 50,000 boids, 3.9 ms for 150,000).

**The delayed trail is updated in place in the diffuse pass, and is not blurred.**
The reference (SPEC 5.1) blurs the delayed copy like the trail. Each pixel only needs its own delayed value (`delayed = 0.8 * now + 0.2 * delayed`), so one extra buffer and one extra read and write per pixel, in place. A blurred copy needs a ping-pong pair. The visual difference is small because the trail itself is already blurred each step.

**Display: one tone curve, one of six palettes, a change tint, a fixed faint vignette.**
Every family is drawn through the same steps because all families write one trail: tone `tanh(gain * trail)`, palette lookup, then the change tint. The palettes are data in `src/render/palettes.ts` (Abyss, Ember, Orchid, Verdigris, Bone, Tide), which also generates the WGSL constants, so the shader and the tests read the same numbers. Rules, checked by unit tests: each starts at the page background, luminance rises at every stop, colours stay within one or two hue families. Palette keys are not assigned: the live vocabulary belongs to M6 (scenes carry a palette); for now it is a dropdown in the tuning panel.

**Change tint: growing trail glows in the palette's accent, fading trail darkens, scaled by 25 and weighted toward the mid-tones.**
Two changes came from looking. The first version scaled the change signal by 5, which was almost invisible (measured: after the tone gain the change is typically 0.01 to 0.03, so the scale became 25). Then it added grit on bright veins (a darkening or tint on a saturated pixel reads as noise), so both effects are weighted by `4 v (1 - v)`, strongest in the mid-tones where the palette has its colour.

**Families are drawn by splatting into the shared trail, not as separate soft quads (SPEC 7 asked to decide by testing).**
By construction splatting gives every family the same blur, palette, tone curve and decay: there is no second layer to match. Quads would need a separate draw, blending and matching of the trail's blur, for an orientation cue that the picture does not need. Checked by eye on calm, dense and mid-transition states (see LOGBOOK): boids and followers read as bead-like stipple inside the same medium. The cost is that families are not separately identifiable; that is the point of "one image". Kiwi owns the final judgement.

**No bloom or other post pass; a fixed vignette of 0.15 only.**
SPEC 7 allows one lightweight post pass "only if it improves coherence". The images already read as one medium, bloom would cost a pass and blur the stipple, and a vignette costs nothing inside the display shader. It is fixed, not a control, because it is not something a performer should touch.

**Default boid trail weight raised about threefold (0.05 to 0.15 classic, 0.02 to 0.06 extended).**
Prediction 4 said Physarum would hold more than 85% of the trail energy; it held 63 to 79% and the boids only 6.5 to 13%. After raising the boid weight the shares with all three families on are Physarum 50 to 69%, followers 13 to 22%, boids 17 to 31%. Energy share is a proxy (the tone curve saturates); the real test was the coherence screenshots, and those were taken with the new weights. These are starting values; scenes (M6) set the mix.

**The Params uniform grew from 80 to 96 bytes (field cells, flow weight, palette, change gain, vignette).**
The field cell count is needed by the Physarum shaders now. The field sampling functions moved to a shared `field_sample.wgsl` used by the followers and the two Physarum shaders, so there is one definition.

**Test method: two mutation checks with predicted failures.**
(A) The shader's flow force halved: predicted that the three flow -> Physarum heading checks fail (classic weight 1 and 0.35, extended) and the weight-0, strength-0, trail -> boids, delayed-trail and all-on checks pass. Observed exactly that. (B) The CPU reference's gradient y sign flipped: predicted that only the two trail -> boids checks fail. Observed exactly that. The served code was checked each time. A side finding: the existing work-guard check's "guard must be engaged" margin (5x) was tight enough to fail when the flock shader gained code; it was loosened to 3x.

## 2026-09-30, M6 scenes and the live instrument

Predictions were written before measuring (below), following the workflow habits agreed after M4. The scene logic is pure TypeScript, so it was built and unit tested in Node first (25 tests), then wired to the GPU world.

### Predictions and metrics
Metrics (`__exp.sceneTest`, `transitionTest`, `sceneSoak`; seed 7; a "difference" is the mean absolute difference of two tone-mapped, 8 times downsampled trail images of two runs that differ in ONE input only, 0 = identical, 1 = black against white):
- Wheel at 0 against 1 (600 steps), with trail mean, vein coverage, closed cells and the trail-energy share of each family.
- Pen on against off, inside against outside the pen circle. Accent: click against no click, 30 steps later.
- Transition: largest single-step relative change of the mean trail across a scene switch, against steady state. Steps per second through it.
- Safe mode: GPU time per step, full against safe against after.
- A live loop of 60 s that drives the real keyboard and pointer event paths.

Predictions:
1. Wheel: image difference at least 0.03 in every scene, one of mean, coverage or cells differs by at least 15%, and the largest-energy family is the same at wheel 0, 0.5 and 1.
2. Pen: inside difference at least 0.03 and at least 3 times the outside difference, in every scene.
3. Accent: at least 0.02 in every scene, largest for the burst scene, smallest for the wave scene.
4. Transitions: no single step changes the mean trail by more than 5%, and 60 steps per second hold through every switch.
5. Safe mode: GPU time falls by at least a factor of 2.5 and returns after leaving it.
6. Live loop: 59 to 61 steps in every second, no validation errors, GPU total under 8 ms.

### Decisions

**A scene is data with the parameter names the code already uses; it is a complete regime because anything it does not name falls back to the defaults of its agent rule.**
SPEC 8.3 suggests nested groups (physarum, flow, flock, coupling, look). That would need a translation layer for every parameter and would break the moment a parameter is added. `params` uses `PhysarumParams` names and units (angles in radians), validated against the tuning panel's ranges. The suggested group names live on as documentation (`dominant`) and in the rehearsal panel's groups. Scenes also carry: `pen` (radius and what it means), `macro` (wheel entries, entry value, a one-sentence description, optional return), `accent` (wave, burst or ring, strength, size) and `entry` (seconds, easing, entry burst, the moment discrete parameters switch). Not built: `world.boundary: contain` (the world always wraps) and `seeding` patterns beyond the entry burst; neither is needed by the placeholders.

**The director is pure logic with a small host interface, so every rule is unit tested without a GPU.**
It owns: the scene index, an eased transition, the wheel (target and smoothed value), the accent and the capture and import tools. Nothing in it runs on its own: with no input and no transition `update()` changes nothing (a test runs it for 2 simulated minutes), and a scene key is the only thing that starts a transition (CLAUDE.md rules 2 and 6). The one thing that moves without input is the optional slow return of the wheel (`macro.returnSeconds`, 0 by default, off in every placeholder), which SPEC 8.5 allows a scene to ask for.

**Transitions blend numbers and switch discrete settings at one moment; the palette crossfades and the presets ease themselves.**
Every continuous parameter interpolates between the state at the key press and the scene, so nothing jumps at the press and nothing overshoots (tested). Discrete ones (field kind, pen modes, physarum on) switch at `entry.switchAt` (default the middle). The Physarum presets are pointed at the target at the start with the scene's transition time as their own ease time (the world already blends them). The palette crossfades in the display through two extra uniforms, so there is no switch to hide. Agent, follower and boid counts interpolate, so a family fades in and out by count. Documented limits: (a) a different agent rule (classic against extended) is a hard cut with an agent reset, because the agents are different things; (b) pressing a scene key in the middle of a transition starts from the half-made state, and a palette crossfade in progress is committed to the nearer palette (a small visible step, only when the performer interrupts a transition); (c) boids and followers that slept inside a clump wake clumped (bounded by the work guard).

**The wheel is one smoothed value, 0 to 1; the scene turns it into two to four parameters along curves and scales the pen.**
Twelve notches cover the range; it glides over about 0.15 s so it never jumps; the pen radius scales from 0.75 to 1.35 of the scene's value. The value at entry is the scene's `macro.entry`. Parameters outside the scene's macro list stay where the rehearsal panel put them. The wheel replaced the temporary pen-size wheel of M2.

**The accent is the scene's wave, burst or ring plus a surge of the pointer forces on every family.**
Alternatives: only a Physarum wave (invisible in scenes whose dominant family is not Physarum), or a new shock-wave force on boids (new GPU code). The surge multiplies the pointer's weight on boids by up to 4 and raises the field edit toward full strength, then fades by itself in about a second (0.96 per step). A wave or burst only exists in the extended rule; in a classic scene the click still surges. `strength` also scales the burst size.

**Keys: Space next, B previous, 1 to 9 jump, F freeze, R reset, S safe (and Escape), H help, C cue; rehearsal keys T, P, D, V, G, Enter.**
B is the key under Space. A single press each, no modifier (Ctrl, Alt and Meta are ignored; Shift is only how a capital is typed), no key repeat. Next stops at the last scene and previous at the first (no wrap: a stray press at the end must not restart the piece). Pressing the number of the current scene re-enters it, which returns to its default. In full screen the browser keeps Escape to leave full screen, so S is the dependable safe key. The map is one pure function, tested: every action has one key (safe has two) and no live key is shared with a debug key. The earlier 'R' reset and debug keys are unchanged.

**Safe mode drops the counts to 35% and the canvas to 60% and resumes a frozen picture; it is reversible.**
Counts are scaled in the world (not by editing the scene), so leaving safe mode restores them exactly (a self-test checks both ways). Resuming a frozen picture is deliberate: the smaller canvas restarts the trail, which a frozen world could not redraw. The saving turned out to be modest (measured below). Quality presets (SPEC 9) are M8.

**The cue panel shows the current and next scene, the song's elapsed time and the scene list; the clock only displays.**
The time comes from the audio element (`Song.elapsed`) and shows `--:--` when there is no readable clock (nothing loaded, or a YouTube embed that has not played). Placeholder scenes carry a badge.

**The help overlay is shown at load and generated from the key map, so it cannot disagree with the bindings.**
It is the only instruction a new person gets. Whether it is enough for a person who has never seen the app is not something I can test alone (see LOGBOOK).

**Rehearsal panel: edits belong to the current scene in memory; capture, export, import, autosave, hot reload, rehearse.**
A slider edit goes to the current scene (so the next capture and the wheel agree with it). Capture overwrites the current scene or appends a new one that copies its pen, wheel, accent and entry settings. Export downloads all scenes as an editable JSON file; import validates it, clamps or drops bad values and lists them. Scenes are autosaved to localStorage (all access in try/catch) but never loaded by themselves: scenes.json starts the instrument, and "Restore autosave" is a button, so an old autosave can never silently override an edited scene file. "Rehearse: next scene" switches and lists what changes, biggest first. Hot reload (development server only) re-applies scenes.json when it is saved, without a transition or a reset. Vite only recognises the dependency accept at module level, and can hold two instances of the module, so the update travels as a window event.

**Placeholder scenes: three, all extended rule, a different dominant family each, wheel ranges kept narrow.**
The first wheel ranges were too wide (see Findings) and were narrowed twice. All are marked `placeholder: true`, named "PLACEHOLDER: ...", and say so in their notes. They stay inside the safe ranges found in M4 and M5 (a test checks cohesion below separation, trail to boids at most 1.5, flow steering at most 0.6, counts within the limits). They are not final tuning and they are not Kiwi's content.

**The self-test now starts from the default parameters, not from the live scene.**
With a scene live, its flow steering (0.25) legitimately bent the agents and 13 older checks failed. The checks compare the GPU with the plain rules, so they must not inherit a scene.

### Findings that changed the design
1. The first wheel ranges left the scene's character: in the calm scene the wheel went from 1,327 closed cells to 9, and in the dense scene it collapsed the network (coverage 0.85 to 0.05). Ranges narrowed (calm: decay 0.78 to 0.82, flow 0.1 to 0.22, agents 520k to 660k; dense: cohesion 0.4 to 0.9, speed 2 to 3, followers 40k to 90k; scattered: evolution 0.08 to 0.45). Judged by eye at wheel 0 and 1 after settling.
2. The first pen test was not local: over 600 steps the two worlds drift apart anyway (chaotic dynamics), so "outside" was about half of "inside". The pen and accent are now compared from a warm world: 500 steps without the input, then 90 or 30 with it, against the identical run without.
3. The scene's `dominant` label and the measured trail energy disagree in the dense scene: it is labelled flock, but Physarum holds 57 to 62% of the energy and the boids 13 to 28%. The label says which family carries the scene's pen and movement, not which one is brightest. The cue panel does not show it, so nothing misleads at performance time, but the word needs a better definition when real scenes arrive.
4. Safe mode saves about 30% of GPU time, not the 2.5 times predicted.
5. A palette crossfade interrupted by another scene key would have jumped through three palettes; it now commits to the nearer one (tested).

### Test method
Two mutation checks with predicted failures on the director: (D1) the wheel's interpolation with min and max swapped: predicted and observed that only "the wheel drives the macro parameters along their curves" fails. (D2) the transition easing reversed: predicted and observed that only "no parameter overshoots ... blended ones move one way only" fails. The GPU-side hooks (count scale, surge, spawn fraction) have 7 self-test checks.

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

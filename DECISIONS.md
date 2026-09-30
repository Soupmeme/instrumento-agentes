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

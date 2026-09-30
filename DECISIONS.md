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

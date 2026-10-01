# Instrumento de Agentes

**Live site: https://soupmeme.github.io/instrumento-agentes/**

A WebGPU visual instrument, played live by one person to interpret a song. Course deliverable for Simulacion, Unit 6 ("Agentes autonomos"), Universidad Pontificia Bolivariana. The picture is made only of autonomous agents following four kinds of rules: steering behaviors (Reynolds), flocking, flow fields and Physarum. Everything runs on the GPU, in real time, full screen.

The performer drives every change by hand. There is no audio analysis, no beat detection and no automatic timeline: the music plays from a plain player and never touches the picture.

## Status

Early. Milestones M0 (scaffold, song player), M1 (classic Physarum), M2 (extended Physarum with presets and a pen), M3 (flow field and flow followers), M4 (flocking) and M5 (coupling and one shared look) and M6 (scenes and the live instrument) are done. A million agents grow a live slime-mold network; in the extended mode 22 presets give veins, cells, stripes, mazes or worms, and the pointer is a pen that runs a second preset in a soft circle around it. A second agent family, flow followers, steers along a noise flow field that the pen can swirl, attract or repel, and draws into the same picture. A third family, the flock, is boids that steer by separation, alignment and cohesion, each perceiving only the neighbours near it (a spatial grid on the GPU finds them), and the pointer can be their predator or their attractor. The families perceive one another only through shared fields, and two coupling channels change how agents move: the flow field can steer the Physarum agents, and the boids can climb the trail's gradient, each with one live strength. Everything is drawn through one of six palettes, with a delayed copy of the trail tinting where the picture is changing, so the three families read as a single medium. The piece is a list of scenes (data, in `src/scenes/scenes.json`; three PLACEHOLDER scenes ship for testing, the real ones are the performer's); you move between them with keys and shape each with the pen, the wheel, the click and the stir. Verification, rehearsal hardening and the fluid stretch come next (M7 to M9). See [SPEC.md](SPEC.md) for the full plan and milestones, and [LOGBOOK.md](LOGBOOK.md) for what has been built and tested so far.

## Requirements

A recent Chrome or Edge with WebGPU and hardware acceleration enabled. Without WebGPU the page shows a plain message instead of the instrument.

## Choosing the song

| Source | Needs internet | Notes |
|---|---|---|
| Local file (mp3, wav, ...) | No | "Choose song". The safest choice for a live performance. |
| YouTube link | Yes | Paste the link and press Load, then press play in the player. |
| Direct audio link (`.mp3`, `.wav` URL) | Yes | Plays in the plain audio element. The server must allow it. |

Spotify links are not supported: its embedded player would not play full tracks reliably (see [DECISIONS.md](DECISIONS.md)).

Once the site has been opened online one time, it reloads with no connection (a service worker caches it). Local files then work fully offline.

## Playing it

The page opens with a help overlay (H closes it) and the first scene. The whole live vocabulary:

| Input | Meaning |
|---|---|
| Move the mouse | The pen: a soft circle around the pointer where the world runs another state. What it does depends on the scene |
| Wheel | Intensity: one knob that moves several things together (up for more). It also scales the pen |
| Left click | Accent: the scene's wave, burst or ring at the pointer |
| Hold the right button and move | Stir: your drag pushes the world inside the pen |
| Space / B | Next scene / previous scene |
| 1 to 9 | Jump to that scene |
| F | Freeze (hold the picture), again to resume |
| R | Reset: agents scatter, trail clears, same scene |
| S (or Esc) | Safe mode: fewer agents and a lower resolution, again to leave (in full screen the browser keeps Esc, so use S) |
| H / C | Help overlay / cue panel (current and next scene, the song's clock, the scene list) |

No key needs Shift, Ctrl or Alt. For rehearsal only: **T** the rehearsal panel (every parameter of the current scene, with what each does and what was measured; capture the live state as a scene, export and import scenes as JSON, rehearse a transition), **P** the song panel, **D** the debug readout, **V** the flow field arrows, **G** the flock overlay, **Enter** full screen.

The three scenes that ship are PLACEHOLDERS (calm, dense, scattered) for testing the engine. Scenes are data in `src/scenes/scenes.json`; edit it with the dev server running and the change appears at once, or edit in the rehearsal panel and export. Nothing in the picture is driven by the music: the song plays from a plain player and every change comes from the performer.

Where things are in the rehearsal panel: "Coupling" (flow steers Physarum: 0.5 aligns the veins clearly and halves the closed cells, 1 lines the network up with the flow; trail attracts boids: graded up to about 1.5, then the flock locks onto the trail and collapses), "Look" (palette, change colour), "Flock" (boids; keep cohesion below the separation weight, at equal weights the flock collapses into a few dense points), "Flow followers" (for thin strokes use the curl field, a slow decay and tens of thousands of followers).

## Run locally

```bash
npm install
npm run dev        # http://localhost:5173
```

```bash
npm test           # unit tests
npm run build      # type check and production build into dist/
npm run preview    # serve the production build
```

## Deployment

Pushing to `main` runs `.github/workflows/deploy.yml`, which installs, tests, builds and publishes to GitHub Pages. A failing test or type error blocks the deploy.

## Documents

- [SPEC.md](SPEC.md): what is being built and why.
- [EXPLAINER.md](EXPLAINER.md): how each agent family works, what it perceives and how it decides, with draft predictions.
- [DECISIONS.md](DECISIONS.md): every autonomous design decision, with alternatives and reasons.
- [ESCALATIONS.md](ESCALATIONS.md): open questions for the performer.
- [LOGBOOK.md](LOGBOOK.md): dated record of experiments and tests.

## Credits

The algorithms below are the basis of the instrument. Implementation is in progress, so this list will gain specifics as each one lands.

- **Physarum:** Jeff Jones (2010), the original agent model. Tweaks and presets follow Etienne Jacob (Bleuje), [Algorithms for making interesting organic simulations](https://bleuje.com/physarum-explanation/), [physarum-36p](https://github.com/Bleuje/physarum-36p), [interactive-physarum](https://github.com/Bleuje/interactive-physarum) and its [web port](https://bleuje.com/web-interactive-physarum/), which build on Sage Jenson's work ([36 Points](https://sagejenson.com/36points/)). The 24-row preset matrix is copied from Bleuje's web port (`parameters.js`), and the extended agent shader, the pen blend, the waves, the stir and the spawn bursts are ported from its move shader, restructured for WebGPU. Bleuje's code is under CC BY-NC-SA 3.0, which asks that adaptations stay non-commercial and are shared under the same terms; this is non-commercial coursework.
- **Steering behaviors and flocking:** Craig Reynolds, [Steering Behaviors For Autonomous Characters](https://www.red3d.com/cwr/steer/gdc99/) (1999). Daniel Shiffman, [The Nature of Code](https://natureofcode.com/), chapter 5. The flock uses Reynolds' three group behaviors (separation weighted by 1/d, alignment, cohesion) with the Nature of Code's weights and radii as the starting point, Reynolds' bin-lattice idea for neighbor search (a uniform grid, built on the GPU with a counting sort), and the pointer-as-predator idea from the three.js [GPGPU birds example](https://github.com/mrdoob/three.js/blob/dev/examples/webgl_gpgpu_birds.html).
- **Flow fields:** Tyler Hobbs, [Flow Fields](https://www.tylerxhobbs.com/words/flow-fields).
- **Course:** [Simulacion, Unit 6](https://juanferfranco.github.io/simulacion-2026-20/units/unit6/).

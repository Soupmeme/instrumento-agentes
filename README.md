# Instrumento de Agentes

**Live site: https://soupmeme.github.io/instrumento-agentes/**

A WebGPU visual instrument, played live by one person to interpret a song. Course deliverable for Simulacion, Unit 6 ("Agentes autonomos"), Universidad Pontificia Bolivariana. The picture is made only of autonomous agents following four kinds of rules: steering behaviors (Reynolds), flocking, flow fields and Physarum. Everything runs on the GPU, in real time, full screen.

The performer drives every change by hand. There is no audio analysis, no beat detection and no automatic timeline: the music plays from a plain player and never touches the picture.

## Status

Early. Milestones M0 (scaffold, song player), M1 (classic Physarum), M2 (extended Physarum with presets and a pen), M3 (flow field and flow followers) and M4 (flocking) are done. A million agents grow a live slime-mold network; in the extended mode 22 presets give veins, cells, stripes, mazes or worms, and the pointer is a pen that runs a second preset in a soft circle around it. A second agent family, flow followers, steers along a noise flow field that the pen can swirl, attract or repel, and draws into the same picture. A third family, the flock, is boids that steer by separation, alignment and cohesion, each perceiving only the neighbours near it (a spatial grid on the GPU finds them), and the pointer can be their predator or their attractor. Coupling between the families, shared rendering and the scene system come next (M5 and M6). See [SPEC.md](SPEC.md) for the full plan and milestones, and [LOGBOOK.md](LOGBOOK.md) for what has been built and tested so far.

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

## Keys (current)

| Key | Action |
|---|---|
| Enter | Toggle fullscreen |
| D | Toggle the debug HUD (fps, frame time, GPU adapter) |
| P | Show or hide the setup panel (it fades, so an embedded player keeps playing) |
| T | Show or hide the tuning panel (agent rule, presets, sliders; hover a control for what it does and what was measured) |
| R | Reset: agents scatter and the trail clears |
| V | Draw the flow field as arrows (debug overlay) |
| G | Draw the flock overlay: the spatial grid, and what one boid perceives (its separation and neighbour circles, its view cone, every boid coloured by how it counts them) |

Flock: in the tuning panel raise "boids" (20,000 to 50,000 is a good start; to see them alone set "Physarum agents" to off, and use a slower trail decay, about 0.94). The pointer then scatters them (predator) or gathers them (attractor). Keep cohesion below the separation weight: at equal weights the flock collapses into a few dense points.

Flow followers: in the tuning panel raise "followers" (and, to see them alone, set "Physarum agents" to off). For thin strokes use the curl field, a slow trail decay (about 0.96) and tens of thousands of followers.

On the picture, in the extended mode (choose "extended" under "agent rule" in the tuning panel), or with followers on and a pen edit chosen:

| Input | Action |
|---|---|
| Move the mouse | The pen: a soft circle around the pointer that runs the pen preset |
| Wheel | Pen size (temporary; becomes the intensity macro in M6) |
| Left click | A wave: an expanding front from the pointer (extended mode) |
| Hold the right button and move | Stir: agents near the pen are pushed in the drag direction |

The scene system and the full live vocabulary (next and previous scene, jump, freeze, safe mode, cue panel) arrive with milestone M6.

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

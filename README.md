# Instrumento de Agentes

**Live site: https://soupmeme.github.io/instrumento-agentes/**

A WebGPU visual instrument, played live by one person to interpret a song. Course deliverable for Simulacion, Unit 6 ("Agentes autonomos"), Universidad Pontificia Bolivariana. The picture is made only of autonomous agents following four kinds of rules: steering behaviors (Reynolds), flocking, flow fields and Physarum. Everything runs on the GPU, in real time, full screen.

The performer drives every change by hand. There is no audio analysis, no beat detection and no automatic timeline: the music plays from a plain player and never touches the picture.

## Status

Early. Milestone M0 (scaffold) is done and the song player works. The simulation itself starts with milestone M1 (classic Physarum). See [SPEC.md](SPEC.md) for the full plan and milestones, and [LOGBOOK.md](LOGBOOK.md) for what has been built and tested so far.

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

The live performance controls (pen, wheel, click, stir, scene keys) arrive with milestone M6.

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
- [DECISIONS.md](DECISIONS.md): every autonomous design decision, with alternatives and reasons.
- [ESCALATIONS.md](ESCALATIONS.md): open questions for the performer.
- [LOGBOOK.md](LOGBOOK.md): dated record of experiments and tests.

## Credits

The algorithms below are the basis of the instrument. Implementation is in progress, so this list will gain specifics as each one lands.

- **Physarum:** Jeff Jones (2010), the original agent model. Tweaks and presets follow Etienne Jacob (Bleuje), [Algorithms for making interesting organic simulations](https://bleuje.com/physarum-explanation/), [physarum-36p](https://github.com/Bleuje/physarum-36p), [interactive-physarum](https://github.com/Bleuje/interactive-physarum) and its [web port](https://bleuje.com/web-interactive-physarum/), which build on Sage Jenson's work ([36 Points](https://sagejenson.com/36points/)). Bleuje's code is under CC BY-NC-SA 3.0; this is non-commercial coursework.
- **Steering behaviors and flocking:** Craig Reynolds, [Steering Behaviors For Autonomous Characters](https://www.red3d.com/cwr/steer/gdc99/) (1999). Daniel Shiffman, [The Nature of Code](https://natureofcode.com/), chapter 5.
- **Flow fields:** Tyler Hobbs, [Flow Fields](https://www.tylerxhobbs.com/words/flow-fields).
- **Course:** [Simulacion, Unit 6](https://juanferfranco.github.io/simulacion-2026-20/units/unit6/).

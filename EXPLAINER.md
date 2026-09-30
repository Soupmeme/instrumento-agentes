# EXPLAINER

How each part of the instrument works, in terms you can defend out loud. One section per agent family. Only Physarum exists so far; flow followers, flocking and coupling are added as their milestones land.

**Status of the evidence:** "Measured" below means one run with seed 7 on the developer machine (one NVIDIA GPU), 900 steps (15 simulated seconds) after a reset unless stated. It is evidence, not proof, and Kiwi still verifies and owns the final wording of every prediction.

---

## 1. Physarum (classic mode)

Milestone M1. Code: `src/physarum/`. The readable CPU definition of the rule is `reference.ts`; the GPU version is `move.wgsl`.

### The idea in one paragraph

Thousands of tiny agents wander a wrapped (toroidal) world. Each one leaves a trail behind it and steers toward the strongest trail it can smell ahead. Trails fade and blur. Agents never see each other, only what others left behind. Out of that loop (leave trail, follow trail, trail fades) a network of veins appears by itself, like the slime mold Physarum polycephalum. Nothing tells the network where to form.

### What an agent perceives

| Item | Value |
|---|---|
| What it senses | The trail intensity at exactly 3 pixels: straight ahead, and rotated by +SA and -SA from its heading |
| Range | Sensor distance SD (default 16 px on the simulation grid) |
| Field of view | Three single points, not a cone. Nothing between them is seen |
| Resolution | Nearest pixel, no interpolation |
| What it ignores | Other agents, the trail anywhere except those 3 pixels, the pointer (until M2) |
| Memory | None. Only its position and heading |

### How it computes its action (one step)

1. **Sense:** read the trail at three points: F (ahead), L (heading + SA), R (heading - SA).
2. **Turn:**
   - if F is strictly the highest: keep the heading;
   - else if F is lower than both L and R: turn by RA to a random side (coin flip);
   - else turn by RA toward the higher of L and R (if L equals R, do not turn).
3. **Move:** step forward by MD pixels along the new heading, wrapping at the edges.
4. **Deposit:** add itself to a per-pixel counter at its new position.

Then, for the whole world, once per step:

5. **Deposit pass:** `trail += sqrt(min(count, 100)) * depositFactor` for every pixel. The square root (Bleuje's idea) stops crowds from making runaway brightness.
6. **Diffuse and decay pass:** every pixel becomes the average of its 3x3 neighbourhood, times the decay factor (default 0.9).

Extra, not in the textbook rule: **respawn**. Every step an agent gains `respawnRate` of progress; at 1 it teleports to a random place. With the default 0.001, each agent teleports about every 1000 steps. Without it the picture collapses (see the measurements below and DECISIONS.md).

### What emerges

A honeycomb-like network of bright veins with dark cells between them. Veins form because an agent that lands on a faint trail follows it, reinforces it, and drags others onto it (positive feedback), while decay removes trails nobody uses (negative feedback). Many agents on one vein saturate it (square-root deposit), so it stays bounded.

### Simulation details worth knowing

- The world is a torus (wraps on both axes).
- Grid: same aspect as the canvas, longest side at most 1920 px. The picture is bilinearly upsampled if the canvas is larger.
- Time: fixed 60 steps per second, independent of the monitor refresh rate.
- Agents live on the GPU (`vec2f` position in 0..1, heading, respawn progress); seeding, stepping and drawing never touch the CPU per agent.
- Randomness: a PCG hash of agent index, step number and seed. The same seed gives bit-identical runs (checked).

### Parameters: predicted versus measured

The first column of predictions was written before measuring. The verdict says whether the measurement supported it. Hover a slider in the tuning panel (T) for the measured text.

| Parameter | Predicted | Measured (seed 7) | Verdict |
|---|---|---|---|
| agents | More: denser, brighter, more connected. Fewer: thin isolated filaments | 50k: sparse, 26 closed cells, 8% coverage. 400k: 63 cells. 2M: 102 finer cells, brighter veins | Supported. "More connected" is really "more, finer cells" |
| sensor distance (SD) | Larger: coarser network, long straight links. Smaller: fine, tangled texture | SD 4: sparse, thin, long curving lines, few closed cells, 6% coverage. SD 16: honeycomb. SD 48: fat blurry veins, 16% coverage | Larger SD supported (coarse, thick). Smaller SD **contradicted**: it gives sparse thin lines, not a fine tangle |
| sensor angle (SA) | Larger: branches and crosses more. Smaller: few long parallel lines | 15 deg: long straighter filaments meeting at hubs, fewer cells, churning. 45 deg: honeycomb. 90 deg: thick meandering labyrinth bands, very stable (10% of agents turn per step) | Larger SA **contradicted** (it does not branch more, it makes labyrinth bands). Smaller SA partly supported |
| turn angle (RA) | Larger: sharper, curlier, jittery. Smaller: smooth | Mean turn per step: 3 deg (RA 15), 11 (45), 38 (90). RA 15: smooth fine honeycomb, 125 cells, very stable. RA 90: ragged kinked veins, 41 cells | Supported, plus: small RA also means finer cells and a calmer picture |
| move distance (MD) | Larger: faster evolution, stretched. Smaller: slow, detailed | Mature (3000 steps): 94, 47, 50 cells at MD 0.5, 1.5, 4. Change over 1 s (correlation, lower is faster): 0.73, 0.55, 0.62 | Partly. Small MD is finer and slower. Above 1.5 there was no further speed-up in this metric |
| trail decay | Closer to 1: thick and stable. Lower: only fresh paths show | 0.6: dim (trail max 0.28), 96 cells, correlation 0.25. 0.97: bright (max 4.3), 31 large cells, correlation 0.87 | Strongly supported. The most effective single control |
| deposit | Mostly brightness | Cell count and coverage unchanged (64, 63, 59 cells). Trail mean scales with deposit. Doubling gives bit-identical agent paths and exactly doubled trail | Confirmed exactly |
| respawn rate | Higher: alive and uniform. Zero: gradual collapse | 0 over 100 s: cells 31 to 9, agents in crowded pixels 20% to 47%, one line left in view. 0.001: stable. 0.01: about 130 cells, no clumping | Strongly supported |
| display gain | Brightness only | Simulation bit-identical for gain 2 and 20 (0 of 950k trail values differ) | Confirmed exactly |

The two contradicted rows (small SD, large SA) were repeated with seeds 1, 2 and 3 and the numbers agreed: SD 4 always gave 19 to 24 closed cells at 5.3% coverage (against 51 to 66 at SD 16), and SA 15 deg had about 61% of agents turning per step against 9% at SA 90 deg. The other rows were measured on seed 7 only.

### Known bad corners

- **Respawn 0:** after about 100 seconds the picture collapses onto one or two lines. Fine as a deliberate "decay of the world" effect in a scene, dangerous otherwise.
- **Extreme settings with respawn 0** (MD 6, SD 60, SA and RA 120 deg, decay 0.99, deposit 0.5): after 4 minutes 68% of agents sit in pixels holding 50 or more agents, only about 2% of pixels are occupied and the trail peaks at 355. No numerical errors, but the picture is a few clumps.
- **Very many agents:** at 2M, individual pixels hold hundreds of agents; the deposit cap of 100 saturates the vein cores.

### Performance and stability (this machine only)

| Test | Result |
|---|---|
| Soak, 400k agents, 30,010 steps (8.3 simulated minutes), full speed | 0.178 ms per step, no drift (-1.4%), no NaN, no out-of-range agents, counter sum exact at every check, no stuck agents |
| Soak, 2M agents, 20,004 steps | 0.368 ms per step, drift -1.1%, no anomalies |
| Soak, extreme parameters, 15,003 steps, and tiny settings (10k agents) | No numerical errors. Extreme case clumps (above) |
| Live loop, 400k agents, 5 minutes | Exactly 60 steps per second in all 300 seconds, GPU total 0.33 ms median (first and last quarter equal), worst 1.18 ms, JS heap flat |
| Live loop, 2M agents at 1920x1080, 2 minutes | Exactly 60 steps per second, GPU total 1.6 to 2.1 ms (first quarter 2.03, last 1.97), worst 3.5 ms of the 16.7 ms frame |
| Same 2M at 1920x1080, full speed | 0.90 ms per step |

Two cautions. The GPU timestamps in the HUD are rounded up in steps of about 0.066 ms per pass, so they overstate small costs. And the live loop cost about twice the full-speed cost for the same work, probably because the GPU idles between 60 Hz steps and runs at a lower clock (not confirmed). Use the live numbers for headroom estimates. None of this says anything about other GPUs.

### How to verify a prediction

1. Run the dev server (`npm run dev`), open the page, press D for the HUD and T for the tuning panel.
2. Console: `await __exp.sweep('decay', [0.6, 0.9, 0.97], {steps: 900})` runs each value from seed 7, returns the measurements and draws a contact sheet (click it to dismiss). Angles are in radians (`45 * Math.PI / 180`).
3. `await __exp.series('respawnRate', [0, 0.001, 0.01], {steps: 6000, every: 1000})` measures over time.
4. `await __exp.exact()` runs the bit-exact checks (display gain, deposit scaling).
5. `__exp.soak({label, params, steps, checkEvery})` runs a long accelerated test in the background and reports in `__job`. `__exp.monitor(seconds)` watches the live loop and reports in `__mon`.
6. `await __physarumSelfTest()` compares the GPU rule with the CPU reference.

The harness is `src/physarum/experiments.ts` (dev builds only). The parameter sweep tool that saves screenshots automatically is part of milestone M7.

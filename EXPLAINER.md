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

---

## 2. Physarum (extended mode, "36 Points")

Milestone M2. Code: `src/physarum/extended.ts` (readable CPU definition), `move_extended.wgsl` (GPU), `presets.ts` (the 22 selectable presets). Switch to it with the "agent rule" selector in the tuning panel (T).

**Evidence:** "Measured" means seed 7, 1M agents, one NVIDIA GPU, 900 steps (15 simulated seconds) after a reset unless stated. Kiwi still verifies and owns the final wording. Anything marked "draft" has not been measured.

### The idea in one paragraph

The same loop as the classic mode (agents leave trail, agents follow trail, trail fades and blurs), with one change. In the classic mode every agent obeys the same four numbers. Here an agent first asks "how much trail is under me?" (call the answer S, between 0 and 1) and then works out how far to look, how wide to look, how sharply to turn and how fast to move as a function of S. A preset is 15 numbers that say how those four functions look. Change the preset and the same swarm produces veins, cells, stripes, mazes or worms.

### What an agent perceives

| Item | Value |
|---|---|
| Under itself | The trail at one pixel, shifted forward by SB2 and sideways by SB1 pixels (part of the preset), times SF. That is S, clamped to (0, 1] |
| Ahead | The trail at three points, at a distance that itself depends on S |
| Also felt | The pen (how far it is from the pen, through the blend weight), a passing wave (raises S a little), the stir push (near the pen) |
| Ignores | Other agents (only their trail), everything not under those points |
| Memory | Position and heading, plus a velocity when inertia is used |

### How it computes its action (one step)

1. **How crowded is it here:** `S = clamp(trail(here + offsets) * SF, 1e-9, 1)`.
2. **Its four behaviour numbers**, each `A + B * S^C` (a preset supplies A, B and C for each):
   - sensor distance `SD = SD0 + SDA * S^SDE * pixelScale`
   - sensor angle `SA = SA0 + SAA * S^SAE`
   - turn angle `RA = RA0 + RAA * S^RAE`
   - move distance `MD = MD0 + MDA * S^MDE * pixelScale`
3. **Sense** three points at distance SD, at angles -SA, 0 and +SA from its heading.
4. **Turn** by RA toward the higher side sensor. If the middle one is strictly highest, keep going. If the middle one is lowest, pick a side at random.
5. **Move** by MD, plus the stir push and inertia if they apply. Then add itself to the per-pixel counter.

The whole trail loop after that (deposit, blur, decay) is the same as in the classic mode.

### The pen: two presets, blended by distance

There are two presets at any time, the background and the pen preset. Each agent uses a mix of the two, weighted by `t = exp(-d^2 / sigma^2)`, where d is its distance to the pointer (in units of the screen height, wobbled by slow noise so the edge is alive) and sigma is the pen radius. At the pointer t is 1 (pen rules), at one radius away it is 0.37, far away it is 0 (background rules). All 15 numbers are mixed, so the swarm changes character gradually across the edge, not with a hard line. The ring drawn at the pointer has the radius sigma.

### Interactions

| Gesture | What it does | Measured |
|---|---|---|
| Move | The pen follows the pointer | Pen lands at the pointer position, the ring has the expected size |
| Wheel | Pen radius (temporary, becomes the intensity macro in M6) | Scroll up grew it 0.20 to 0.27 and the slider followed |
| Left click | A wave: an expanding front from the pointer that lasts 5 seconds. It makes agents feel denser (S up 30% at the peak) and pulls them toward smooth inertial motion | Correlation with an identical run without the wave fell 0.97, 0.67, 0.15 at 0.5, 1.5 and 3 s. The wave had expired at the end and the network was as healthy as without it (coverage 0.64 vs 0.67, cells 350 vs 376) |
| Right button held and moving | Stir: near the pen agents are pushed in the drag direction, unevenly (noise), fading a few frames after you stop | Agents inside half a radius drifted 91 px in 60 steps against 1 px without stir. The push is capped at length 1 (about 5 px per step at most), fades to 0.008 in half a second |
| Ring burst, center burst (panel buttons only for now) | For one step, 10% of the agents jump onto a ring around the pen, or onto the pen | Ring: the share of agents on the ring went 1.5% to 11.4%. Center: 0.4% to 10.4% |
| Inertia (slider) | Agents keep some velocity | Draft, not measured. Prediction: smoother, wider swings around bends |

### The presets

Presets are the 15-number rows of Bleuje's matrix (24 rows; the app offers 22 of them, called slots 0 to 21). Curated slots are starred in the panel.

| Slot | Row | What it looks like (measured, still there after 100 simulated seconds) |
|---|---|---|
| 0 | 0 (pure multiscale) | Leaf-vein network at several scales. Grainy at 400k agents |
| 2 | 2 (vertebrata) | Large cells with thick veins. Holds at 400k |
| 4 | 3 (star network) | Bright blobs joined by thin tendrils. Blobs merge over time (22 cells to 9). Holds at 400k |
| 13 | 12 | A labyrinth of curling bands. Breaks into fragments at 400k |
| 14 | 14 | Long parallel stripes. Blurred and noisy at 400k |
| 15 | 16 | Curly worms. Thinner at 400k |
| 19 | 19 | One branching tree of thick veins. Holds at 400k |
| 21 | 21 (reference default) | Ribbed rivers with fine texture between them. Holds at 400k |

Rejected after looking at all 22 (each as background, 15 s and 45 s): slots 1, 5, 7, 10, 12, 16, 17 look like fine grain, slot 11 like large soft patches, slot 9 like short streaks, slot 20 like rough terrain, slots 3, 6, 8, 18 are interesting but overlap the kept ones (delicate net, spots, lattice, sparse thick veins). Nothing is deleted: they stay selectable, only unstarred.

**Agent count matters.** The presets were tuned for a dense swarm (about 6 agents per pixel). The deposit is compensated for the swarm size (so the trail has the right strength), but the picture still degrades with fewer agents. That is why extended mode starts at 1M agents.

### Changing preset while running

A preset change eases over `preset transition` seconds (default 0.5): every one of the 15 numbers moves along a smooth curve, and the agents keep their positions. All 56 ordered transitions between the 8 curated presets end within 0.82 to 1.11 times the coverage of a pure run of the destination, and none went blank. But 15 of them show a spike of coverage in the middle of the transition, and the two inspected frame by frame (15 to 21 and 14 to 19) pass through a brief haze: about half a second after the switch the picture washes into fine grain before the new structure grows out of it. All 15 involve at least one fine texture (slots 13, 14 or 15) and the halfway set of numbers itself produces grain, so the other 13 very likely look the same, but only these two were looked at. A short ease (0.5 s) reads as a quick wipe, a 2 s ease as a slow dissolve. Which one is right is a scene decision.

### How to verify

In a dev build (`npm run dev`), console:

- `__setMode(1)` switches to extended mode.
- `await __exp.gallery([0, 2, 4], {agents: 1000000})` looks at presets. `await __exp.transitions([[15, 21]])` checks transitions, `await __exp.filmstrip(15, 21)` shows one frame by frame.
- `await __exp.penTest(21, 4)` compares pen on and off. `await __exp.effects()` measures spawn, wave and stir.
- `await __physarumSelfTest()` compares the GPU with the CPU reference for both modes (22 checks).

---

## 3. Flow field and flow followers (steering)

Milestone M3. Code: `src/steering/` (the steering library, WGSL and CPU), `src/flow/` (the field, the followers, the debug arrows; `flowfield.ts` is the readable CPU definition). Turn the family on with the "followers" slider in the tuning panel (T); turn the Physarum agents off with "Physarum agents: off" to see followers alone; press V to draw the field as arrows.

**Evidence:** "Measured" means seed 7, 100k followers (200k for the pen), 600 steps (10 simulated seconds) after a reset, one NVIDIA GPU, curl field unless stated. Kiwi still verifies and owns the final wording. "Seen" means looked at in a screenshot, not measured.

### The idea, and the rule that keeps it explainable

The unit asks that the field of directions and the rule an agent uses to consult it be told apart. Here they are two separate things in the code and on screen:

- **The field** is data: one vector per cell (16 px cells), rebuilt every step from noise that drifts slowly with time, plus whatever the pen does to it. It can be drawn (V) without any agent existing.
- **The rule** is a steering behavior. A follower reads the field at one place and steers toward it. It never has its velocity set by the field directly.

### The field

| Item | How |
|---|---|
| Noise | 3D Perlin noise: x and y are space (in screen-height units, so the field looks the same at any resolution), z is time. Value 0 at lattice points, roughly -1..1, smooth |
| Noise angle field | direction = noise mapped to an angle between 0 and 720 degrees (0 to 4 pi). Mapping to 0..360 would prefer flowing left, because Perlin values cluster near the middle (Nature of Code) |
| Curl field | direction = the noise gradient turned 90 degrees. Followers then travel along the contour lines of the noise, and the field has no sinks |
| Quantization | 0 keeps angles smooth; n snaps every direction to a multiple of 360/n degrees |
| Strength | Every vector has this length (0..1) |
| Pen edits | Within the pen radius the direction is blended toward: swirl (perpendicular to the direction to the pen), attract (toward it) or repel (away), weighted by exp(-d^2 / radius^2) times the edit strength. The drag direction (stir) also bends the field toward itself near the pen |

### What a follower perceives

| Item | Value |
|---|---|
| What it senses | The field vector at one place: its own position, or the place it will reach in `look-ahead` steps if it keeps its velocity (Reynolds' prediction) |
| Interpolation | The field is blended between the four nearest cells (vector interpolation, so no angle wrap-around problem) |
| What it ignores | Other followers, the Physarum agents, the trail, everything else |
| Memory | Its velocity |

### How it computes its action (one step)

```
desired  = field(here, or ahead) * maxSpeed
steer    = limit(desired - velocity, maxForce)
velocity = limit(velocity + steer, maxSpeed)
position = position + velocity            (the world wraps)
```

The field says which way to go. The steering rule decides how the agent gets there: `maxForce` is the most it can change its velocity in one step, so it cannot turn instantly. Adding the field vector straight to the acceleration would ignore the current velocity, which is not steering. Occasionally (respawn) a follower jumps to a random place, at rest; without it followers gather along the field's sinks and the rest of the picture empties.

### The steering library

`steering.wgsl` (GPU) and `steering.ts` (CPU twin, unit tested) hold the behaviors every steering family shares. They differ only in how they choose the desired velocity:

| Behavior | Desired velocity |
|---|---|
| follow field | field at (predicted) position * maxSpeed |
| seek | toward the target at max speed |
| flee | away from the target at max speed |
| arrive | like seek, but inside a slowing radius the speed falls linearly to 0 |

`steer = limit(desired - velocity, maxForce)` is shared. Only follow-field runs on the GPU so far; the flock (M4) will use the same functions. A behavior with nothing to say must not return a zero desired velocity (that would brake the agent to a stop): the caller simply does not apply it.

### One material

Followers do not draw separately. They count themselves into their own per-pixel counter and the deposit pass turns that into trail with its own weight ("follower trail"), next to the Physarum agents' contribution. So the two families share one trail, one blur, one decay and one tone curve, and Physarum agents sense the marks followers leave. Followers alone with a long trail give thin luminous strokes, seen in the live page.

### Parameters: predicted versus measured

The predictions were written before measuring. The hover text in the tuning panel repeats the measured version.

| Parameter | Predicted | Measured | Verdict |
|---|---|---|---|
| max force | Low: turns wide and lazily. High: snaps onto the field | Alignment with the field (1 = exactly along it; unrelated pairing scores 0.34): force 0.02 gives 0.48 and speed 55% of max, 0.12 gives 0.96, 1 gives 0.999 | Supported |
| max speed | Faster followers draw longer strokes | Mean speed is about 92% of it. With the same force, alignment falls as speed rises: 1.00 at 1, 0.97 at 2.5, 0.62 at 6 (turning radius is about speed squared over force) | Supported, plus an effect not predicted: fast followers cannot follow a curvy field |
| look-ahead | Larger: starts turning before reaching a change | 10 steps: alignment 0.96 to 0.974. 30 steps: 0.82 and speed down to 66% of max | Partly. Helps a little, then hurts: reading the field too far away makes it irrelevant |
| field kind | Noise angle has sinks, curl does not | Noise angle: followers gather into a few bright rivers (seen). Curl: alignment 0.974 and an unrelated-pairing score of 0.01, followers spread over vortices | Supported. Curl is incompressible, so a dense swarm averages into grain; use fewer followers and a slower decay to see strokes |
| noise frequency | Higher: tighter turns | Turning per step 0.8, 1.5, 2.5 degrees at 1.5, 3, 8 features per screen height; alignment 0.99, 0.97, 0.88 | Supported |
| field drift | 0 freezes the field: fixed streamlines | 0: 14% of followers stall at stagnation points, alignment 0.961. 0.08: 0.974. 0.8: 0.913 | Supported, plus stalled followers when frozen |
| angle steps | Rockier, more geometric | 4 steps: right-angle streams, like a circuit board (seen) | Supported |
| field strength | Scales desired speed; 0 stops them | Mean speed 0.24, 0.47, 0.92 of max at 0.25, 0.5, 1 | Supported (proportional) |
| pen: swirl, attract, repel | Circle, gather, empty | Against a nearly uniform field: swirl circulation 0.23 to 0.87; attract inward motion -0.83; repel followers inside the pen 15.5k to 9k, outward drift +0.26 | Supported. Repel is the weakest effect |
| pen edit strength | Stronger replaces the noise more | Swirl circulation 0.36 at 0.3, 0.87 at 0.9 | Supported |
| follower respawn, follower trail | Draft | Not measured | Draft |

### Performance and stability (this machine only)

| Test | Result |
|---|---|
| Soak, 1M extended Physarum agents + 500k followers (curl), pen on, 30,003 steps (8.3 simulated minutes) | 0 NaN, 0 out-of-range, 0 followers faster than max speed, both counters exact at every check, 0.41 ms per step at full speed |
| Live loop, same load, 60 s, simulated performer (pen circling, waves, pen edit mode changing) | Exactly 60 steps in every second. GPU total 1.6 ms median in the first quarter (followers still scattered), 0.46 ms in the last, worst 2.75 ms, one 20 ms frame in the minute |

Per-pass timestamps overlap on the GPU, so a single pass can look slower than it is (the deposit pass showed 0.85 ms once); trust the total.

### How to verify

In a dev build (`npm run dev`), console:

- `await __physarumSelfTest()` compares the GPU with the CPU references for all three families (35 checks).
- `await __exp.followerStats({fieldKind: 1, followerForce: 0.02})` measures alignment, speed and turning for any setting. `await __exp.penFieldStats(1)` measures a pen edit (0 none, 1 swirl, 2 attract, 3 repel).
- `__physarum.fieldArrows = true` (or key V) draws the field.

# EXPLAINER

How each part of the instrument works, in terms you can defend out loud. One section per agent family. Only Physarum exists so far; flow followers, flocking and coupling are added as their milestones land.

**Status of the predictions:** everything under "Parameters and predicted effect" is a DRAFT, to be verified by Kiwi. A line marked "seen" says what was observed once, on one machine, with one seed. It is not a verification.

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

Extra, not in the textbook rule: **respawn**. Every step an agent gains `respawnRate` of progress; at 1 it teleports to a random place. With the default 0.001, each agent teleports about every 1000 steps. This keeps the pattern from collapsing onto a few dominant lines (see DECISIONS.md).

### What emerges

A honeycomb-like network of bright veins with dark cells between them. Veins form because an agent that lands on a faint trail follows it, reinforces it, and drags others onto it (positive feedback), while decay removes trails nobody uses (negative feedback). Many agents on one vein saturate it (square-root deposit), so it stays bounded.

### Simulation details worth knowing

- The world is a torus (wraps on both axes).
- Grid: same aspect as the canvas, longest side at most 1920 px. The picture is bilinearly upsampled if the canvas is larger.
- Time: fixed 60 steps per second, independent of the monitor refresh rate.
- Agents live on the GPU (`vec2f` position in 0..1, heading, respawn progress); seeding, stepping and drawing never touch the CPU per agent.
- Randomness: a PCG hash of agent index, step number and seed. The same seed gives bit-identical runs (checked by the self-test).

### Parameters and predicted effect

*Draft, to be verified by Kiwi.* Hover any slider in the tuning panel (press T) for the same text.

| Parameter | What it changes | Predicted visible effect |
|---|---|---|
| agents | How many agents are awake | More: denser, brighter, better connected. Fewer: thin, isolated filaments |
| sensor distance (SD) | How far ahead agents smell | Larger: coarser network, longer straight links. Smaller: fine, tangled texture |
| sensor angle (SA) | Angle between the three sensors | *Seen once (one seed):* 15 deg gives long, straighter filaments meeting at hubs with fewer closed cells; 45 deg a honeycomb of closed cells; 90 deg thick meandering labyrinth bands |
| turn angle (RA) | How sharply an agent turns per step | Larger: sharper turns, curlier and jittery paths. Smaller: smooth, gently curving paths |
| move distance (MD) | Pixels per step | Larger: faster evolution, stretched look. Smaller: slow, detailed growth |
| trail decay | Fraction of trail kept each step | Closer to 1: trails linger, network thick and stable. Lower: only fresh paths show |
| deposit | Trail added per agent | More: brighter and stronger contrast. Fewer: dim network (sensing compares relative values, so this mostly acts as brightness) |
| respawn rate | Teleport frequency | Higher: pattern stays alive and uniform. Zero: gradual collapse onto a few strong lines |
| display gain | Brightness before the tone curve | Brightness only, the simulation is unchanged |

### How to verify a prediction

1. Open the app, press T for the tuning panel, D for the HUD.
2. In the browser console: `__physarum.reset(7)` restarts with a fixed seed, so two runs are comparable.
3. Change one slider, press R (or `__physarum.reset(7)`), wait about 8 seconds, compare.
4. `await __physarumSelfTest()` (dev build) checks the GPU rule against the CPU reference and returns pass or fail per check.

The parameter sweep tool that automates steps 2 and 3 with saved screenshots is part of milestone M7.

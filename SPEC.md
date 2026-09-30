# SPEC: Unidad 6 Visual Instrument (Autonomous Agents)

Audience: Claude Code, working autonomously in a fresh repo. Owner: Kiwi. Read CLAUDE.md first; it holds the non-negotiable rules. This document explains what we are building, why, and what "done" looks like.

---

## 1. Context

Course: Simulacion (Universidad Pontificia Bolivariana), Unit 6, "Agentes autonomos", aligned with chapter 5 of The Nature of Code. Unit page: https://juanferfranco.github.io/simulacion-2026-20/units/unit6/ (Spanish). The unit is worth 12.5% of the course grade.

The commission (translated): design and develop a visual instrument for the Web that interprets a piece of music the performer likes, in real time. It may use only steering behaviors, flocking, flow fields and Physarum. The proposal must:

- define what the agents perceive, what their limits are, and how they compute their actions;
- produce emergent behavior through the chosen rules, and let the performer explain what each rule contributes;
- offer a few expressive controls that intervene on perception, the rules, or the environment during execution, with perceptible consequences;
- keep human interpretation as the main driver. Listening and the performer's decisions guide changes, never an automatic sequence or audio analysis;
- run in real time and full screen for the live presentation.

The performer also prepares a visual score relating musical passages, intentions and possible interventions. The score guides the performance but never automates it.

Grading is a self-evaluation defended live, 4 criteria of 25 points each:
1. Task fulfillment: web technology, real time, interprets the chosen music.
2. Understanding and verification: can explain and defend how the system is built, what agents perceive, how they compute actions, and can predict and verify what happens when a parameter changes.
3. Design and intention: can justify the selection and combination of behaviors and relate them to the musical interpretation.
4. Human interpretation: the score and the controls let the performer drive the system live and respond to what emerges.

Implication for engineering: the code and docs must be explainable by a student in a live oral defense. Prefer the simple, legible version of an algorithm over the maximal one. Every parameter should have a documented, predictable effect.

Kiwi's stated priorities: (a) visual coherence, (b) the simulation must run on the GPU with enough headroom for many agents and their interactions. WebGPU is confirmed usable on the target machine.

---

## 2. Product vision

One image, one material. The three agent families (Physarum agents, flocking agents, flow-field followers) live in a shared world made of fields, and perceive each other only through those fields. The result should look like a single organic medium, not three demos overlaid. The performer plays it like an instrument: gestural, continuous controls ("brushes") plus a few discrete regime switches ("keys").

Performance model (decided with Kiwi): the piece is played like a film made of scenes. A scene is a complete "regime" of the world (agent mix, rules, field character, palette, look). The performer walks through the scenes with the keyboard and shapes each one live with the mouse. Complexity lives in rehearsal (designing and tuning scenes), never in performance (no raw parameters, no key combinations). Input is mouse and keyboard only.

Design vocabulary from Kiwi's earlier units, reuse it:
- Canvas vs score: the live output is never automated. The score is a rehearsal aid.
- Brushes vs keys: continuous gestural controls (magnitude, region, direction) versus discrete regime changes (preset, palette, mode).

---

## 3. Technology decisions (already made)

- WebGPU with compute shaders (WGSL). Rendering also through WebGPU on one canvas.
- Plain TypeScript or JavaScript with a minimal bundler (Vite is fine). No UI framework, no game engine, no Three.js for the simulation. If a helper library is used for small things (for example a GUI panel for development), it must be optional and hidden in performance mode.
- Static site, deployable to GitHub Pages (the course logbook lives on GitHub).
- Audio: a plain HTMLAudioElement or a file picker for the song. No Web Audio analysis nodes. Playing the file through an audio element is the whole audio story.
- Input: pointer (mouse/trackpad), keyboard, and optionally the Web Gamepad API and Web MIDI. Pointer plus keyboard must be enough on their own.

Autonomous choices left to you: bundler details, TS vs JS, file layout, buffer layouts, workgroup sizes, texture formats (see section 5.1 notes), naming.

---

## 4. World model

The world is a 2D toroidal or bounded domain (your choice, document it) mapped to the canvas. All agents live in the same coordinate system. Suggested fields, all GPU-resident:

| Field | Type | Written by | Read by |
|---|---|---|---|
| Trail | scalar (optionally 2 channels: current and delayed) | Physarum agents (and optionally boids) | Physarum agents (sensing), renderer (color), optionally boids |
| Flow field | 2D direction per cell (angle or vector) | procedural noise pass, pen edits, optional fluid module | Flow followers, optionally Physarum (movement bias), optionally boids |
| Flock grid | per-cell agent lists or aggregates | boids | boids (neighbor perception) |

Perception is always local and limited: an agent reads a small neighborhood of a field or a bounded neighbor radius. Document each agent type's perception as a short table: what it perceives, range, field of view, what it ignores.

---

## 5. Algorithms

### 5.1 Physarum (primary visual driver)

References, in order of importance:
1. Bleuje, "Algorithms for making interesting organic simulations": https://bleuje.com/physarum-explanation/ (sections 1 to 7 are the algorithm; section 9 is only closing remarks; collapsed code blocks on that page do not render in some fetchers, use the GitHub files below).
2. Bleuje physarum-36p (simplified, non-interactive): https://github.com/Bleuje/physarum-36p, shaders in bin/data/shaders/ (computeshader_move.glsl, computeshader_deposit.glsl, computeshader_diffusion.glsl).
3. Bleuje interactive-physarum (pen blending, waves, spawning, inertia): https://github.com/Bleuje/interactive-physarum, especially bin/data/shaders/computeshader_move.glsl and src/points_management.h, src/points_basematrix.h, src/ofApp.h.
4. Jones (2010), the original model, linked from the Bleuje article.
5. Optional cross-checks: Sebastian Lague video https://www.youtube.com/watch?v=X-iSQQgOd1A, Amanda Ghassaei's web version https://apps.amandaghassaei.com/gpu-io/examples/physarum/, Deniz Bicer https://denizbicer.com/202408-UnderstandingPhysarum.html, Sage Jenson https://cargocollective.com/sagejenson/physarum and https://sagejenson.com/36points/.
6. **Bleuje's browser port (read in full, treat as ground truth for a web implementation):** live demo https://bleuje.com/web-interactive-physarum/ and its readable sources https://bleuje.com/web-interactive-physarum/src/main.js, .../src/shaders.js, .../src/parameters.js. It is WebGL2 with fragment shaders only (no compute), and it runs 2.1M particles at 1280x736 (Low), 5.8M at 1920x1088 (Medium) and 13.1M at 1920x1088 (High). Read these three files before writing any Physarum code. See "Browser reference pipeline" below.
7. Patt Vira's p5.js Physarum tutorial (https://youtu.be/VyXxSNcgDtg, 34:49, the professor's assigned video; code at https://editor.p5js.org/pattvira/sketches/rS3KsmJHB, sketch "CT69_Slime Molds_Physarum"). It is the CPU teaching version and the likely baseline the professor has in mind: 4000 molds on a 400x400 canvas, degrees, sensorDist 10, sensorAngle 45, rotAngle 45, speed 1 px/frame, and the trail is the canvas itself (molds draw 1 px white dots, decay is `background(0, 5)` each frame, no blur, sensors read the red channel from `pixels[]`). Order per frame: move, sense, turn. It is useful for the defense: the classic algorithm you present should be explainable in these same terms.

License note: Bleuje's code is CC BY-NC-SA 3.0 (derived from Sage Jenson's work). This is non-commercial coursework, fine, but credit both authors in the README and on an on-screen credits toggle.

**Classic algorithm (implement first, as a mode):**
Agent state: position (x, y), heading angle. Per step:
1. Sense the trail at three points: ahead, left, right, at distance SD, side sensors at +/- SA from heading.
2. Turn: if middle is strictly the highest, keep heading. If middle is lower than both sides, turn randomly left or right by RA. Otherwise turn by RA toward the higher side (right lower than left means turn left, and vice versa).
3. Move forward by MD, wrapping at borders.
4. Deposit into the trail at the new position.
5. Then, for the whole map: blur (3x3 box) and multiply by a decay factor (reference: 0.75 per frame in Bleuje's setup).

**Extended algorithm (36 Points style, implement as the second mode):**
Let S be the trail value sensed at the agent (optionally with an offset), scaled by a per-preset scaling factor and clamped to (1e-9, 1]. Each parameter becomes `A + B * S^C`:

- sensorDistance = SD0 + SDA * S^SDE * pixelScaleFactor
- moveDistance = MD0 + MDA * S^MDE * pixelScaleFactor
- sensorAngle = SA0 + SAA * S^SAE
- rotationAngle = RA0 + RAA * S^RAE

Reference pixelScaleFactor is 250 at a 1280x736 simulation. Scale distances proportionally if you use a different resolution. Sensing point for S in the reference: `pos + SB2 * direction + (0, SB1)`, with wrap. Angles are radians.

Preset matrix (verbatim from Bleuje's web port, https://bleuje.com/web-interactive-physarum/src/parameters.js; the same 24 rows as points_basematrix.h). Column order: SD0, SDE, SDA, SA0, SAE, SAA, RA0, RAE, RAA, MD0, MDE, MDA, SB1, SB2, SF (sensing factor). Shorthand in the source: DE_SD=2, DE_SA=1, DE_RA=1, DE_MD=3 (already substituted below). The app exposes 22 of the 24 rows through `SELECTED_POINTS = [0, 5, 2, 15, 3, 4, 6, 1, 7, 8, 9, 10, 11, 12, 14, 16, 13, 17, 18, 19, 20, 21]`. Row 0 is the default pen (pure_multiscale) in the desktop app. Named rows known from the source comments: 0 pure_multiscale, 1 hex_hole_open, 2 vertebrata, 3 star_network, 4 enmeshed_singularities, 5 waves_upturn.

```
 #  SD0    SDE    SDA     SA0    SAE    SAA    RA0    RAE    RAA    MD0    MDE    MDA    SB1   SB2    SF
 0  0.0    4.0    0.3     0.1    51.32  20.0   0.41   4.0    0.0    0.1    6.0    0.1    0.0   0.0    22.0
 1  0.0    28.04  14.53   0.09   1.0    0.0    0.01   1.4    1.12   0.83   3.0    0.0    0.57  0.03   36.0
 2  17.92  2.0    0.0     0.52   1.0    0.0    0.18   1.0    0.0    0.1    6.05   0.17   0.0   0.0    18.0
 3  3.0    10.17  0.4     1.03   2.3    2.0    1.42   20.0   0.75   0.83   1.56   0.11   1.07  0.0    13.0
 4  0.0    8.51   0.19    0.61   1.0    0.0    3.35   1.0    0.0    0.75   12.62  0.06   0.0   0.0    34.0
 5  0.0    0.82   0.03    0.18   1.0    0.0    0.26   1.0    0.0    0.0    20.0   0.65   0.2   0.9    31.5
 6  1.5    1.94   0.28    1.73   1.12   0.71   0.18   2.22   0.85   0.5    4.13   0.11   1.12  0.0    15.0
 7  2.87   3.04   0.28    0.09   1.0    0.0    0.44   0.85   0.0    0.0    2.22   0.14   0.3   0.85   11.0
 8  0.14   1.12   0.19    0.27   1.4    0.0    1.13   2.0    0.39   0.75   2.22   0.19   0.0   7.14   9.0
 9  0.001  2.54   0.08    0.0    1.0    0.0    3.35   1.0    0.0    0.1    12.62  0.06   0.0   0.0    30.5
10  0.0    28.04  20.0    0.18   26.74  20.0   0.01   1.4    1.12   0.83   3.0    0.0    2.54  0.0    39.0
11  0.0    20.0   3.0     0.26   2.15   4.76   0.41   6.6    12.62  0.3    6.6    0.037  0.4   0.04   28.0
12  27.5   2.0    2.54    0.88   26.74  0.0    0.09   2.0    1.4    0.1    5.0    7.41   1.4   14.25  12.0
13  0.0    6.0    100.0   0.157  1.0    1.07   0.0    1.0    5.0    0.83   5.0    20.0   0.4   0.0    8.0
14  0.0    15.0   8.6     0.03   1.0    0.0    0.34   2.0    1.07   0.22   15.0   0.1    2.3   0.82   38.0
15  0.0    32.88  402.0   0.41   3.0    0.0    0.1    1.0    0.0    0.3    6.0    0.0    0.0   0.0    32.0
16  0.0    0.8    0.02    5.2    1.0    0.0    0.26   0.1    2.79   0.83   32.88  37.74  0.09  0.33   22.0
17  3.0    10.17  0.4     1.03   0.308  0.0    0.148  20.0   0.75   0.83   1.56   0.11   1.07  0.04   9.0
18  0.0    5.0    0.05    0.9    2.8    0.0    0.006  0.84   1.11   0.75   1.2    0.0    0.0   0.0    21.0
19  27.5   28.04  0.0     0.39   1.4    0.0    0.09   0.846  1.4    0.1    2.031  0.07   1.4   0.03   15.3
20  0.0    8.5    0.029   0.27   0.0    0.0    0.41   0.0    0.0    0.75   12.62  0.06   0.84  0.0    31.8
21  0.0    6.37   5.425   1.03   0.0    0.0    0.18   0.289  0.443  0.3    2.2    0.065  1.07  0.04   19.0
22  1.464  20.0   80.0    0.26   2.15   4.76   1.513  2.0    12.62  0.385  12.62  0.037  1.0   0.0    25.0
23  0.0    6.0    100.0   0.65   0.175  1.284  0.0    0.6    5.0    0.83   5.395  20.0   0.4   0.0    8.6
```

The web port's default at load is the last entry of SELECTED_POINTS (row 21) for both pen and background, and it also has a list of "landing presets" (pen and background pairs) that start the demo on something attractive. Not every preset behaves well in every implementation, so tune, and keep only presets that look good and are stable. Expect to need a handful (4 to 8) of curated presets. Note the presets are tuned for a 1280x736 simulation (pixelScaleFactor 250); Bleuje's Medium and High modes at 1920x1088 use pixelScaleFactor 300, so distances scale roughly with resolution, but check visually.

**Reference GPU pipeline (Bleuje), per frame, and its WebGPU translation:**
1. Zero a `u32` counter buffer (one counter per pixel).
2. Agent pass (one thread per agent): read agent state, sense, turn, move, then `atomicAdd(counter[pixelIndex], 1)` at the new pixel. Respawn: each agent carries a progress value; every 1/0.001 = 1000 iterations it teleports to a random position (hash from position). This keeps the pattern from collapsing.
3. Deposit pass (one thread per pixel): `count = min(counter, 100)`; `trail += sqrt(count) * depositFactor` (reference depositFactor 0.003). The sqrt saturation is Bleuje's own idea; it prevents runaway brightness where many agents stack. Also write display data here.
4. Diffuse and decay pass: 3x3 box blur with wrap, then multiply by decayFactor (0.75). Ping-pong the trail texture.

Reference scale: 1280x736 simulation, about 5.77M agents (512*512*22), 60 fps on an RTX 2060. For this project 200k to 1M agents at 1080p-class resolution is the sensible starting range; make agent count a preset (low, medium, high) and measure.

**Browser reference pipeline (Bleuje's WebGL2 port, read from its source; this is proof the algorithm works in a browser without compute shaders):**
- Particle state lives in two ping-pong `RGBA32UI` textures (2048 wide for large counts). Each texel packs one particle: `x` = position as two unorm16, `y` = (age, heading/2pi) as two unorm16, `z` = velocity as two half floats, `w` = the particle's deposit position (unorm16 pair). Texture size, not a buffer, sets the particle count.
- Pass 1, move: a full-screen triangle whose fragment shader reads each particle texel plus the trail texture (`texelFetch`, nearest, wrap by `mod`), computes sensing, turning, movement, pen blending, waves, spawn and inertia, and writes the new state. Blending disabled.
- Pass 2, count: clear a float count texture, enable additive blending (`blendFunc(ONE, ONE)`), and draw `gl.POINTS` with one vertex per particle. The vertex shader reads the particle's deposit position from the state texture (vertex texture fetch by `gl_VertexID`), rounds it to a pixel and sets `gl_PointSize = 1`. The fragment outputs red = 1, so the blend unit accumulates the per-pixel particle count. This replaces the desktop version's `atomicAdd` on a counter buffer. It needs `EXT_color_buffer_float` in WebGL2.
- Pass 3, deposit: per-pixel fragment shader reads the trail and the count. `added = sqrt(min(count * countScale, 100)) * depositFactor`, writes the new trail (x channel) and, in a second color attachment, the display color (multiple render targets).
- Pass 4, diffuse and decay: 3x3 box blur with wrap, `decayed = blurred.x * 0.75`, and `y = 0.8 * decayed + 0.2 * blurred.y` (that y channel is the delayed copy used for color).
- Blit the display texture to the canvas.
- Display color: `countValue = min(1, pow(tanh(7.5 * pow(max(count - 1, 0) / 1000, 0.3)), 8.5) * 1.1)`, then a palette (six 5 to 7 stop gradients: purpleFire, arctic, orangeBlue, green, neonInferno, zorgPurple) is chosen per color mode, blended toward monochrome or another palette by `blend = tanh(500 * (trail - delayedTrail) + 2 * offset)` where `offset` is the distance from the screen center. That temporal difference is what makes changing regions look different from stable ones. Ten color modes (0 to 9).
- Everything runs in one `webgl2` context created with `alpha:false, antialias:false, depth:false, powerPreference:"high-performance"`, plus `webglcontextlost` handling that shows an error and asks for a reload.
- The move shader in this port is the same logic as the desktop compute shader you already have described above (parameter blend by `parameterMix = exp(-d^2 / sigma^2)` with `d` distorted by `0.9 + 0.2 * noise3(6 * p, 0.6 * time)`; `moveBias = 5 * parameterMix * noise3(20 * p, 0.8 * time) * biasVector`; waves with `delay = -0.1 + d/0.3 * waveNoise + 0.4 * pow(0.5 + 0.5 * cos(18 * angle + 10 * dirSign * d), 0.3)`, `waveSum = 1.7 * tanh(w/1.7) + 0.4 * tanh(4 * w)`; inertia `velocity = 0.98 * velocity + (cos h, sin h) + 0.2 * L2 * moveBias`, `dt = 0.07 * moveDistance^1.4`, `position = mix(classic, inertia, 0.6 * L2 + 0.8 * waveSum)`; spawn fraction 0.1; respawn every 1000 steps). Copy the structure, do not reinvent it. Note the desktop version's `MoveBias`, waves and spawn are optional, keep whatever supports your controls.

In WebGPU the natural translation is: particle state in a storage buffer (no texture-size limits), the move pass as a compute shader that does `atomicAdd` on a `u32` per-pixel counter buffer directly (no point-splat pass), then the deposit and diffuse passes as compute or fragment passes. If WebGPU turns out unusable on the presentation machine, the WebGL2 pipeline above is a known-good fallback, so consider keeping the simulation core behind a small interface so a WebGL2 backend could be added later (do not build it unless Kiwi asks).

WebGPU notes (verify against the current spec, these were written from general knowledge):
- Atomics are supported on `u32`/`i32` in storage buffers (and workgroup memory). Float atomics are not. Use a `u32` counter buffer like Bleuje.
- Core storage-texture formats include r32float and rgba16float. `r32float` is not filterable unless the `float32-filterable` feature is enabled, so read it with `textureLoad` and do any interpolation manually, or use rgba16float. Prefer ping-pong textures over read_write storage textures.
- Pack agent state compactly if you want more agents (Bleuje packs position and heading into unorm16 pairs). Start unpacked (vec4f: x, y, heading, progress); optimize only if bandwidth-bound.
- The reference uses nearest-pixel sensing (not bilinear). Nearest is cheaper and Bleuje says bilinear is not necessarily more interesting.

**Interaction layer (from interactive-physarum, adopt the idea, it is the best control primitive we found):**
Two parameter sets, a background preset and a pen preset. For each agent, blend every parameter with
`t = exp(-d^2 / sigma^2)`, `param = (1 - t) * background + t * pen`, where d is the aspect-corrected distance from the agent to the pen (pointer), with a little noise distortion (reference: distance multiplied by 0.9 + 0.2 * noise). sigma is the pen radius, adjustable live. The pen region literally runs different rules from the rest of the world, and the performer moves it by hand.
Other interactive ideas from the same source, all optional and cheap:
- Spawn: a small fraction (reference 0.1) of agents teleport to a circle around the pen, or to a few offsets near it, for one frame. No agents are created or destroyed.
- Waves: expanding wavefronts (reference duration 5 s, up to 5 at once) that transiently raise the sensed value and blend in inertia. Triggered by the performer, never by a timer.
- Move bias: near the pen, add a noise-modulated push in the direction of the performer's drag.
- Inertia mode: `v = 0.98 * v + (cos h, sin h)`; `dt = 0.07 * moveDistance^1.4`; `p_inertia = p + dt * v`; final position is `mix(p_classic, p_inertia, a)`. Amount `a` is a continuous control.
- Color from trail dynamics: keep a second, delayed copy of the trail (reference: `delayed = 0.8 * decayed + 0.2 * delayed_prev`), and use the difference between current and delayed to shift the color. Areas that are changing look different from stable ones. This is the main tool for visual richness without extra agents.

### 5.2 Flow field

References: Tyler Hobbs https://www.tylerxhobbs.com/words/flow-fields (static drawing, but the construction is exactly what we need), Nature of Code chapter 5 https://natureofcode.com/autonomous-agents/ and its example sources in https://github.com/nature-of-code/noc-book-2/tree/main/content/examples/05_steering (noc_5_04_flow_field is the reference), and the professor's referenced sketch by Sofia Lezcano Arenas: https://editor.p5js.org/juanferfranco/full/FDhBzlroM (source obtainable through https://editor.p5js.org/editor/juanferfranco/projects/FDhBzlroM). Warning: Sofia's sketch drives the field speed and particle brightness from audio amplitude. That violates our no-audio-analysis rule, use it only as a reference for the flow field construction (grid of 20 px cells, 3D noise `noise(x*0.05, y*0.05, zoff) * TWO_PI * 2`, time advance through zoff).

The unit explicitly wants the field of directions distinguished from the rule the agent uses to consult it. Keep both explicit in code and docs:
- The field: a texture (or buffer) with one direction per cell. Built each frame (or slowly evolving) from noise, plus performer edits. Keep it as data, not as an inline function of agent position, so it can be visualized and painted.
- The consulting rule: a steering behavior. `desired = fieldVector * maxSpeed`; `steer = desired - velocity`; clamp to maxForce; apply. Optionally sample the field at a predicted future position (Reynolds) instead of the current one. Note that Sofia's sketch instead adds the field vector directly to acceleration; that is not steering and we do not want it.

Field construction options (Hobbs): Perlin or simplex noise mapped to an angle (angle = noise * 2 pi), noise scale about 0.005 per pixel at reference resolution, quantized angles (multiples of pi/10 or pi/4) for a rockier look, a grid larger than the canvas so agents can re-enter. Curl noise gives a divergence-free look with fewer sinks. Nearest-cell lookup produces visible stepping; interpolate the angle or the vector for smooth motion (a vector interpolation avoids angle wraparound problems).

Nature of Code notes on fields (read in full): a noise value mapped to an angle in 0..2pi prefers flowing left, because Perlin noise clusters near the middle of its range; the book counters this by mapping to 0..4pi. Fields can also be constant, random per cell, swirls around a point (rotate the vector from the cell to the center by pi/2), or derived from an image (vectors from dark to light). Time evolution is the third noise dimension.

Performer edits (brushes): paint a swirl, a vortex, a wall or an attractor into the field near the pen; adjust noise scale, evolution speed, quantization. All of these are perceptible at once.

Flow followers can be their own agent family (thin luminous strokes, Hobbs-like), or they can be the mechanism that biases Physarum movement. Decide during prototyping, based on what looks coherent, and log the decision.

### 5.3 Steering behaviors (the shared agent model)

Reference: Craig Reynolds, "Steering Behaviors For Autonomous Characters": https://www.red3d.com/cwr/papers/1999/gdc99steer.pdf (HTML version https://www.red3d.com/cwr/steer/gdc99/) and Nature of Code chapter 5. The paper was read in full (HTML version). Points worth knowing that are easy to miss: the steering formula in the printed seek definition appears to have a sign typo (desired velocity points toward the target); steering behaviors return a null or zero value when they have nothing to say, which is what makes priority blending work; and Reynolds says a plain linear combination of components has been sufficient over several reimplementations of boids.

Vehicle model (Nature of Code example values): position, velocity, acceleration; `maxSpeed = 8` and `maxForce = 0.2` in the book's first example (flocking example uses maxSpeed 3, maxForce 0.05). Update: `velocity += acceleration; velocity = limit(velocity, maxSpeed); position += velocity; acceleration = 0`.
Core rule: `steer = limit(desiredVelocity - velocity, maxForce)`. Behaviors differ only in how desiredVelocity is chosen:
- seek: desired = normalize(target - position) * maxSpeed.
- flee: the same, negated.
- arrive: as seek, but inside a slowing radius (book: 100 px) desired speed maps linearly from maxSpeed down to 0.
- wander: seek a point on a small circle projected ahead of the agent; the point drifts randomly. Book values: circle radius 25, distance ahead 80, angle change up to +/-0.3 per frame.
- pursue and evade: seek or flee the target's predicted future position (position + velocity * T; Reynolds estimates T proportional to distance).
- path following: predict a future position (book: 25 px on a single segment, 50 px on a multi-segment path), find the normal point on each segment, pick the closest, and seek a point a few px further along the segment if the distance exceeds the path radius (book: 20).
- containment or boundary: steer back when near walls.
- flow following: see 5.2.

Boundaries (book, Example 5.3 "stay within walls"): if within `offset` (25 px in the example) of an edge, the desired velocity keeps the vehicle's other axis and points the crossing axis directly away from the wall at maxSpeed; if not near a wall the desired velocity stays `null` and no steering is applied. The `null` matters: a zero desired velocity would brake the vehicle to a stop, so only apply steering when a desire exists.

Combining behaviors (Reynolds, read in full): (1) weighted sum of steering vectors, simple but can let components cancel each other; (2) momentum filtering: compute only one component per frame and let inertia blend them (cheaper); (3) prioritized arbitration: check behaviors in priority order and use the first non-null result; (4) prioritized dithering: each behavior is tried with some probability, falling through to the next if skipped or null; (5) prioritized acceleration allocation (the original 1987 boids), where higher priorities consume a steering budget first. He reports that the linear combination proved sufficient, and that flocking combined with other behaviors has worked with both simple summing and prioritized dither. Separately, discrete action selection (mode switches, like caribou switching from grazing to fleeing) sits above steering and does not blend. Our controls map onto exactly this split: continuous weights are blending, key presses that switch presets are action selection. Start with weighted sum, which is what the book uses and is easiest to explain and expose as live controls.

Use of steering in this project: the flock is steering (seek toward cohesion target, etc.), flow followers are steering, pointer interaction is seek or flee, scouts can wander. This is what satisfies the "steering behaviors" part of the brief; make it visible in the code structure (a shared steering library in WGSL, imported by the flock and follower passes).

### 5.4 Flocking

References: Nature of Code example sources (Vehicle/Boid separation example: noc_5_07_separation), the 1st-edition port https://github.com/nature-of-code/noc-examples-p5.js/tree/master/chp06_agents/NOC_6_09_Flocking (branch master, the 2nd-edition flocking example folder name was not found), the Coding Train challenge https://github.com/CodingTrain/website/tree/main/CodingChallenges/CC_124_Flocking_Boids/P5, and the three.js GPU flocking example https://github.com/mrdoob/three.js/blob/dev/examples/webgl_gpgpu_birds.html.

Nature of Code 2nd edition, chapter 5, now read in full (Examples 5.9 to 5.14 and Exercises 5.12 to 5.21 are the relevant ones):
- The book defines three flocking rules: separation (steer to avoid crowding neighbors), alignment (steer toward the neighbors' average velocity), cohesion (seek the neighbors' average position). Flocking is a weighted sum: `separation * 1.5`, `alignment * 1.0`, `cohesion * 1.0` ("arbitrary weights, try different ones"). Each rule computes a desired velocity, sets its magnitude to maxSpeed, subtracts current velocity, limits to maxForce (cohesion reuses seek). Neighbor distance for alignment and cohesion is 50 px; separation uses `desiredSeparation = r * 2` (vehicle size based) and a push scaled as 1/d. The example flock is 120 boids. Neighbors must exclude the boid itself (`this !== other`).
- Reynolds (read in full) defines each group behavior with a neighborhood of a distance AND a field-of-view angle (nine parameters in total for flocking: a weight, a distance and an angle for each of the three), and says separation weights each neighbor's push by a 1/r factor (the position offset vector scaled by 1/r^2, "just a setting that has worked well"). Reynolds also suggests normalizing each component before scaling by its weight.
- The book's own three principles of a complex system, which we can reuse in the defense: simple units have short-range relationships; they operate in parallel; the system exhibits emergent phenomena. Its extra qualities: nonlinearity, competition and cooperation (separation is the competition, alignment and cohesion the cooperation; removing either kills the complexity, a great live demo), and feedback.
- Book exercises worth borrowing as controls: make all flock parameters (three weights, maxForce, maxSpeed) change by user interaction; a fourth Gary Flake "view" rule (move laterally away from any boid that blocks the view); limit vision to a line of sight; combine flocking with other steering behaviors.
- Optimization: the book explains why the naive version is O(N^2) and recommends Reynolds' bin-lattice spatial subdivision (grid of cells, each boid looks at its own and the 8 neighboring cells; most effective when boids are evenly distributed) or a quadtree for uneven distributions, plus magnitude-squared distance checks and avoiding temporary vector allocations. Reynolds' paper on it is "Interaction with Groups of Autonomous Characters" (2000). Our GPU grid (below) is the same idea.

Other reference implementations of the same rules (numbers useful for tuning):
- The 1st-edition port https://github.com/nature-of-code/noc-examples-p5.js/tree/master/chp06_agents/NOC_6_09_Flocking (branch master): maxSpeed 3, maxForce 0.05, weights 1.5, 1.0, 1.0, radii 25 (separation) and 50 (align, cohesion), O(N^2).
- The Coding Train variant: sliders 0 to 2 (default 1) for each weight, radii 50, 50, 100, maxForce 1, maxSpeed 4, 200 boids, separation weighted by 1/d^2.
- The three.js GPU example: one zone radius divided into three bands by distance (separation nearest, alignment middle, cohesion outer), band widths are the live parameters, mouse is a predator inside a 150 unit repel radius that also raises the speed limit, weak pull to the center, brute force on the GPU for 1024 birds.


Our requirement is many boids, so do not do O(N^2) beyond a few thousand agents. Recommended: uniform grid with cell size equal to the largest perception radius, built each frame on the GPU (count per cell with atomics, prefix sum, scatter agent indices; the standard counting-sort spatial hash). Each boid then reads the 3x3 cells around it. This keeps neighbor perception exact within the radius and is easy to explain. A cheaper fallback that changes semantics slightly: splat per-cell sums of position and velocity as fixed-point integers with atomics and let boids read the aggregate of the 3x3 cells (perception becomes "the average of my neighborhood cells"). If you use the fallback, document that approximation clearly, because the professor may ask.

Perception model to document per boid: neighbors within radius R, optionally within a field of view angle (Reynolds recommends a view cone, second-hand), blind to everything else. No leader, no global information other than the optional pointer.

Live-adjustable flock parameters (brush candidates): perception radii, the three weights, maxSpeed, maxForce, predator/pointer strength.

### 5.5 Optional stretch module: fluid-driven flow field

The user pointed to Karl Sims, "Fluid Flow Tutorial": https://karlsims.com/fluid-flow.html (fully readable, loaded 100%; the figures are images and the two stencil diagrams are not in text). It is a simple GPU-friendly variation on Jos Stam's Stable Fluids: http://www.dgp.toronto.edu/people/stam/reality/Research/pdf/ns.pdf. Related: https://karlsims.com/flow.html.

Method summary:
- State: a grid of 2D velocity vectors (the flow field). No separate pressure or dye array.
- Per step: (1) advect the flow field by itself (semi-Lagrangian: each cell reads from upstream, opposite the flow direction, with interpolation); (2) add external forces (pointer drag, injected jets, buoyancy, damping, optional viscosity as a slight diffusion); (3) remove divergence by repeatedly adding the gradient of the divergence to the field, using one combined 3x3 kernel with a 1/8 stability factor, "perhaps 50 iterations per frame or more"; (4) advect tracers.
- Boundary options: zero (closed box), repeat (open), scaled repeat (soft), wrap (toroidal), obstacles (force normal component to zero).
- Speedups: multigrid (solve at half resolution and add the correction back, recursively); multiple substeps per frame for fast flow; bicubic interpolation; cumulative warping for repeatedly warped images.
- Kernel as printed on the page (spec author could not verify it, the first dot-product term looks incomplete, likely missing a multiplication by a constant vector). Derive it from the prose (divergence at cell corners is the sum of the four adjacent vectors' dot products with their outward diagonals; the gradient at a cell center is the difference of the corner values) and validate numerically, or cross-check with Stam's paper, before trusting it:
  `f'[x,y] = f[x,y] + (dot(f[x-1,y-1] + f[x+1,y+1], {1,1}) + dot(f[x-1,y+1] + f[x+1,y-1], {1,-1}) * {1,-1} + (f[x-1,y] + f[x+1,y] - f[x,y-1] - f[x,y+1]) * {2,-2} + f[x,y] * -4) * 1/8`

Policy for this module: it is a candidate to replace the noise-based flow field with an environment that the performer can stir by hand, which would be a very strong "human in the loop" control. BUT the brief allows only steering, flocking, flow fields and Physarum. A fluid solver is arguably a way to generate a flow field, while the agents that consult it stay steering agents, yet a strict professor could read it as a fifth algorithm. Therefore: build it last (milestone 9), behind a feature flag, keep it fully off by default, and escalate to Kiwi in ESCALATIONS.md before it becomes part of the presented instrument. Kiwi should ask the professor. Do not let the core instrument depend on it.

---

## 6. Coupling design (what makes it one image)

Starting design, change it if prototyping shows better coherence, and log why:

1. The flow field bends Physarum motion: add a small steering-style bias toward the local field direction to each Physarum agent's heading update (weight is a control). Physarum structures then align with the flow.
2. Boids deposit into the trail with lower weight than Physarum agents, and boids also sense the trail gradient (a mild attraction). Flocks then travel along and reinforce Physarum veins, and Physarum reinforces where flocks pass.
3. The pen (pointer) is the shared intervention: it blends Physarum presets (5.1), locally edits the flow field (5.2), and acts as attractor or predator for boids (5.4). One gesture, three families, one visible region.

Every coupling channel needs a live scalar control ("how strongly does X perceive Y") because that is exactly what the brief calls intervening on perception.

---

## 7. Rendering and visual coherence

Goal: unmistakably one artwork, and something you would want to project.

- One color system: a single scalar-to-color mapping (1D palette textures) applied to the combined energy or trail data. Palettes are discrete regime switches (keys). Provide 4 to 6 curated palettes, avoid default rainbow ramps.
- Trail display: map count or trail through a saturating nonlinearity (Bleuje: `pow(tanh(7.5 * pow(max(0, (count - 1) / 1000), 0.3)), 8.5) * 1.1`, or a simpler tanh mapping) so bright cores do not clip harshly. Use the delayed-trail difference color trick (section 5.1) for richness.
- Boids and flow followers must be rendered in the same visual language as the trail (soft, additive, same palette family, similar blur), not as flat shapes. Either splat them into the trail or draw them as small oriented soft quads with the same tone mapping. Decide by testing.
- Consider one lightweight post pass (subtle bloom or vignette) only if it improves coherence without costing more than about 1 ms.
- Full screen: `requestFullscreen()`, handle resize and devicePixelRatio, optionally hide the cursor in performance mode (but keep the pen visible as a soft ring, it is the performer's instrument, and it helps the audience read the interventions).
- No UI clutter in performance mode. A hidden debug HUD (toggle key) shows fps, frame ms, agent counts, current preset names and parameter values.

Coherence acceptance test: capture screenshots at a calm state, a dense state and a mid-transition state. If any of them reads as "several visualizations stacked", fix palette, blur, brightness balance, or coupling before adding features.

---

## 8. Scenes and controls (human interpretation)

### 8.1 Design principles (Kiwi's lived problem, do not regress on these)

Kiwi has previously lost the feeling of a piece because live control meant remembering many distinct keys and combinations. So:
- During performance the performer never touches a raw parameter.
- No chords, no modifier keys (no Shift, Ctrl, Alt combinations) for anything used live.
- The live vocabulary is about four things: where (the pen), how much (one macro), when (accent), and which scene. Everything else is rehearsal-time or emergency-only.
- The picture must respond immediately and coherently to each live gesture, so every gesture moves many parameters together along curves tuned in rehearsal.
- Brushes and keys, as Kiwi calls them: brushes are continuous gestures (position, amount, direction), keys are discrete regime switches. Scene changes are keys, everything else live is brushes.

### 8.2 Live control surface (mouse and keyboard)

Right hand, mouse:
| Input | Meaning | Notes |
|---|---|---|
| Move | The pen: a circular region where the world runs its alternate state (section 8.4) | Soft ring drawn at the cursor so the audience can read it |
| Wheel | The one live macro axis, "intensity" | Maps to many parameters through the current scene's curves. Accumulate wheel input into a smoothed value, with a gentle return-to-scene-default only if the scene says so. Also scales pen radius |
| Left click | Accent (a "hit"): expanding wave or burst at the cursor | Momentary, same meaning in every scene, its look is scene-defined |
| Hold right button and move | Stir: your drag direction and speed become move bias and local flow edits inside the pen | This is the gestural "brush stroke" |

Left hand, keyboard (all within reach of the home position, high-frequency actions on big keys):
| Key | Meaning |
|---|---|
| Space | Next scene |
| One key near Space (you choose, document it) | Previous scene |
| Number keys 1 to 9 | Jump to scene N directly (backup when lost, or to return to an opening scene at the end) |
| One key (for example F) | Freeze: hold the picture (simulation paused), press again to resume |
| One key (for example R) | Reset: agents scatter and the trail clears, keeping the current scene |
| Esc or one key | Safe mode: instantly drop agent counts and resolution to survive a stutter |
| H | Toggle help overlay |
| C | Toggle the cue panel (8.6) |

That is the whole live vocabulary: pen, wheel, click, stir, next, previous, jump, freeze, reset, safe. Debug overlays, the tuning panel and preset browsing use other keys and are hidden from performance. Do not add live inputs without escalating to Kiwi. A second macro axis is explicitly NOT built by default, only if rehearsal proves a real need and Kiwi approves.

Every control must have a perceptible, explainable effect, and none may be driven by anything but the performer's input (no LFOs, no timers that change parameters, no audio analysis).

### 8.3 Scenes (the core abstraction)

A scene is a data-defined bundle, stored as JSON or a typed object (`scenes.json` or `scenes.ts`), so that adding or editing scenes never requires touching simulation code. Suggested schema (Claude Code may refine field names, but keep the structure):

```
scene {
  id, name,                       // name is a phrase the performer would say out loud
  note,                           // Kiwi's own words about the feeling (free text, kept in the file)
  physarum: {
    backgroundPreset, penPreset,  // rows of the preset matrix, or custom 15-vectors
    decay, depositFactor, activeAgentFraction, inertia, respawnRate
  },
  flow: {
    noiseScale, evolutionSpeed, quantization, strength,
    followersActive, followerDensity, biasOnPhysarum
  },
  flock: {
    active, activeCount, weights{sep,ali,coh}, radii, maxSpeed, maxForce,
    penMode: attract | predator | none
  },
  coupling: { flowToPhysarum, boidsToTrail, trailToBoids, ... },
  world: { boundary: wrap | contain, seeding: uniform | ring | center | line | clusters },
  look: { palette, toneCurve, blur, brightness, trailDelayColorAmount },
  pen: { radius, altStateDescription },   // 8.4
  macro: { intensity: [ {param, min, max, curve} ... ] },   // what the wheel moves in this scene
  accent: { type: wave | burst | ring, strength, size },
  entry: { transitionSeconds, easing, entryBurst: none | ring | center },
  onLeave: null
}
```

Enrichment per scene is encouraged and is where the film-like quality comes from, but it must stay inside the four allowed families plus presentation: agent mix (which families are visible or dominant), field structure, coupling strengths, boundaries, seeding pattern, palette, tone, blur and glow, accent style, and how the pen behaves. Do not add images, video, text, or anything not produced by those agents in the picture.

Transitions: the performer's key press starts an eased transition (default 1 to 2 s, per-scene override). Numeric parameters interpolate. Discrete ones (palette, boundary mode, preset row) crossfade or switch at a moment chosen to be least visible, and this must be documented. Interpolating Physarum presets by blending the 15-vectors is what the reference does (0.5 s in the desktop app), but not every pair of presets blends into something stable, so check each planned transition visually and log any that need a shorter, longer or two-step path. A transition triggered by the performer is not "automation", but nothing may start a transition on its own (no timers, no song position triggers).

### 8.4 The pen, meaning per scene, gesture always the same

The gesture is always "a circular region around the cursor where the world is in another state". What that alternate state is belongs to the scene: for example Physarum runs the pen preset inside the circle, the flow field is bent into a swirl there, boids are attracted or repelled by it. Keep the concept constant across scenes so the performer's hand memory stays valid, and let the scene decide which of the three families the pen mainly pushes. Document it in each scene's `pen.altStateDescription`.

### 8.5 Macro axis: intensity

One curve set per scene: as the wheel value goes from 0 to 1, a scene-defined list of parameters moves through defined ranges with defined easing. Typical members: active agent fraction, trail decay, move speed or flow evolution speed, flow turbulence, flock cohesion versus separation balance, pen radius, brightness. Design rules:
- Nonlinear response with a clear sweet spot, never a straight line from dead to chaos.
- The range must never leave the scene's character (a calm scene at intensity 1 is "agitated calm", not another scene).
- The value at scene entry is defined per scene (usually the middle), and the scene may also define a slow gentle return.
- Each scene's intensity mapping is documented in one sentence in EXPLAINER.md (what turning it up does, what turning it down does), because criterion 2 asks the performer to predict effects.

### 8.6 Cue panel (rehearsal and performance aid, not automation)

A small unobtrusive panel, toggled by a key, showing: the current scene name and note, the NEXT scene's name and note, the song's elapsed time (read from the audio element clock, display only), and the scene list. The clock triggers nothing, ever. This is a lookup aid for the performer. It can also be shown on a second screen or a separate window if simple to do.

### 8.7 Rehearsal tooling (where the complexity goes)

- A hidden tuning panel (toggle key, never shown in performance) exposing every parameter of the current scene with sliders and numeric fields.
- "Capture current state as scene N": snapshot the live state into the scene data, exportable and importable as JSON (browser download and file picker), plus autosave to localStorage as a convenience (wrap all storage access in try/catch, it can be empty or blocked).
- Scene hot reload: edit the scene file, see the change without restarting.
- A "rehearse" mode that steps through scenes and shows the transition, with a readout of which parameters are changing.
- Ship 3 clearly labeled PLACEHOLDER scenes (for example calm, dense, scattered) so the system is testable before Kiwi's song and scene content exist. They must be marked `placeholder: true` in the data and in the cue panel, and replaced by Kiwi's real scenes. Do not write the real scene content, names or notes, those come from Kiwi after he picks the song.

Design guidance for a typical song: 4 to 6 scenes for a 3 to 4 minute piece. If the song has fewer than two clearly different sections, tell Kiwi (write it in ESCALATIONS.md) rather than inventing contrast.

### 8.8 Risk to watch: "playback" feel

A scene-driven film can start to feel pre-rendered. Criterion 4 wants the performer to respond to what emerges. Protect that: scenes are regimes, not clips, so the world inside a scene must stay alive and different every run (seeded randomness only in test mode), the pen, wheel, click and stir must visibly change the picture in every scene, and no scene may be so tightly tuned that live gestures do nothing. Add a test: in each scene, wheel and pen changes must produce a measurable and visible difference.

---

### 8.9 Song description intake and translation protocol

Kiwi will choose the song and describe it. That description is the design brief. Your job is to translate it into scenes (scenes.json), macro curves, palette, pen meaning and accent behavior, not to invent the interpretation. Until a description passes the checklist below, work only on engine milestones and PLACEHOLDER scenes. Never write real scene content from a thin description.

**8.9.1 Where the description lives.** Kiwi delivers it as SONG_BRIEF.md in the repo root (or pastes it in chat, in which case you save it there verbatim and never rewrite his words). Keep his wording untouched. Your derived material goes elsewhere (DECISIONS.md, EXPLAINER.md, scenes.json), with a pointer back to the brief line that justified each choice.

**8.9.2 What a complete description contains.**

1. Song identity and structure: title, artist, duration, and a section map with timestamps (intro, verse, chorus, bridge, drop, outro, or his own names). Rough timestamps are enough.
2. Core feeling as a tension pair, not a single word (for example "calm on the surface, pressure underneath", "joy that is slightly desperate").
3. Material metaphor: what the world is made of (smoke, mycelium, a swarm of insects, ink in water, neon rain, a tide).
4. Motion verbs: how things should move, per section if it changes (drift, cling, scatter, converge, pulse, tear, settle).
5. Light and temperature: dark or bright base, warm or cold, contrast level, saturation, and whether light is glow, grain, or flat.
6. Arc: 3 to 6 named states from start to end, with the feel of each transition (slow melt, hard cut, slow build then release).
7. Must never look like: at least one or two explicit anti-references (for example "never a screensaver", "never rainbow", "never cute").
8. Relationship to the song: illustrates the lyrics, mirrors the mood, contradicts it on purpose, or holds space while the song leads.
9. Per-scene notes in his own words, including which moments deserve an accent (click) and where the pen should mean something specific.
10. Performance intent: which moments he wants to be able to push (wheel) and which he wants to leave alone.

Items 1, 2, 4, 6 and 7 are required. Items 3, 5, 8, 9 and 10 are strongly wanted, but you may propose defaults for them and mark them "proposed, needs Kiwi's confirmation" in ESCALATIONS.md.

**8.9.3 Completeness check (do this first, write the result in ESCALATIONS.md).** For each of the ten items, mark: present, thin (feeling words with no behavior attached), or missing. Then ask only what is needed, batched into one list, each question with a suggested default so he can answer with "yes" or a short correction. Do not block: keep working on engine tasks and placeholder scenes while waiting.

**8.9.4 When to ask for more.**

- A section is missing or the timestamps are absent, so you cannot tell how many scenes exist.
- Emotion words appear with no behavior ("melancholic", "epic", "dreamy" alone). Ask: what does the swarm do, what does the light do, how fast, how dense.
- Two statements contradict each other (calm and frantic in the same scene, "dark" and "bright neon" with no ratio). Ask which wins per scene.
- The arc has states but no transition feel, or the transitions are all the same.
- The description names imagery you cannot make with the allowed families (specific objects, faces, text, lyrics as words). Ask what feeling that imagery carries, and translate the feeling instead.
- The relationship to the song is unstated, since it changes whether the visuals lead, follow, or oppose.
- A scene has no distinct pen meaning and no distinct look from its neighbor, so it would be invisible in performance.

**8.9.5 When to push back.** Push back directly and respectfully, aim at the reasoning or plan and never at Kiwi, give the concrete reason, propose an alternative, and state it once. If he decides otherwise, log his decision in DECISIONS.md and follow it (one further challenge at most, only if it breaks a hard constraint).

- The song is flat: fewer than two clearly different sections, or a mood that never changes. Say so, and suggest either choosing sections by sub-texture (density, speed, temperature) or picking a different song. Also log it in ESCALATIONS.md.
- Too many scenes to perform: more than about 8 to 9 scenes, or scenes shorter than roughly 15 seconds each, since the jump keys and the cue panel stop being readable. Propose merging, or using the wheel (intensity) for variation inside one scene.
- He implies controls outside the live vocabulary of 8.2 (per-instrument keys, chords, modifier combinations, live parameter sliders). Explain the playback-feel and cognitive-load reasoning of 8.1, and offer the scene or wheel equivalent.
- He wants audio reactivity, beat sync, or automatic timelines. This is a hard constraint (CLAUDE.md rule 2). Say so once, and offer the human-driven equivalent (cue panel, click accent, the wheel).
- He wants a behavior family outside the four allowed (particle life, reaction-diffusion, physics). Hard constraint. Offer the closest expression with Physarum, flow fields, steering or flocking, and only escalate a change if he explicitly asks for it.
- The design intent is scoped down without a reason, or the ambition seems larger than the time allows (for example asking for a distinct algorithm per section). Name the gap between what is described and what is feasible, then propose a prioritized cut.
- A described look would break visual coherence (section 7), for example unrelated palettes per behavior layer.

**8.9.6 Translation method (description to scenes).**

1. Segment: one scene per distinct state in the arc, not per song section. Merge sections that feel the same, split a section that changes feel.
2. For each scene, choose the dominant driver (Physarum, flow followers, or flock) and the supporting ones, following the mapping table below. Keep at most one dominant driver per scene, so the scene reads clearly.
3. Set parameters from the feeling, then tune by eye in the rehearsal panel. Record each mapping as: brief line, parameter choice, why.
4. Define the wheel (macro intensity) per scene: which two or three parameters move together, their ranges, and their curves. The wheel at 0 must still look correct and intentional, and at 1 must be the strongest version of that same scene, not a different scene.
5. Define the pen meaning per scene (attract, repel, carve, ignite, calm), the accent (click) type and strength, and the entry transition (duration, easing, entry burst) from the transition feel he described.
6. Palette and tone from the light and temperature notes; keep one palette family per scene and evolve it across the arc so the film feels continuous.
7. Check the arc as a whole: adjacent scenes must be visibly distinct, the first and last scenes must bookend, and the peak scene must be reachable without a preceding flat stretch.
8. Present the scene table (scene, source lines from the brief, dominant driver, key parameters, pen, accent, wheel) to Kiwi for approval before treating it as final. This is a gate: he owns the score.

**8.9.7 Feeling to control mapping (starting point, tune by eye).**

| Feeling or quality | Levers to try |
|---|---|
| Calm, drifting | low flow strength, slow flow evolution, wide sensor angle, long decay, low deposit, low flock speed |
| Tension, held breath | high inertia, narrow sensor angle, high alignment, slow but rising density, reduced blur |
| Anxiety, jitter | high wander, short flow quantization, short trail decay, high respawn, small sensor distance |
| Aggression, attack | high max speed and max force, strong separation, high deposit, sharp tone curve, hard entry burst |
| Warmth, intimacy | high cohesion, low speed, soft blur, warm palette, pen as attractor |
| Coldness, distance | high separation, wide spacing, low deposit, cool or desaturated palette, pen as repeller |
| Growth, organic | Physarum dominant, medium decay, branching presets, slow respawn |
| Decay, fading | rising decay, dropping deposit fraction, palette moving to desaturated, fewer active agents |
| Chaos, breakdown | high flow evolution, low quantization, high noise scale, unstable weights, freeze available as a cutaway |
| Order, geometry | quantized flow angles, high alignment, low noise scale, regular spawn |
| Euphoria, release | high active fraction, bright palette, trail delay color amount up, large accent bursts |
| Loneliness, emptiness | low agent count, high contrast, one small dominant structure, large dark space |

**8.9.8 Ownership and records.** Kiwi owns the song, the brief, the scene names, the notes and the score. You own the mapping and must be able to justify every scene parameter in one sentence for his defense (criteria 2 and 3). Keep EXPLAINER.md's "why this scene looks like this" section in his vocabulary (canvas vs score, brushes vs keys), and mark it as needing his edit so it ends up in his voice. When the brief changes, re-run the completeness check, list which scenes are affected, and do not silently overwrite tuned scenes.

**8.9.9 Until the brief exists.** Use only the three PLACEHOLDER scenes and the mapping table to test the engine. Do not guess a song, do not write real scene names, and do not treat placeholder tuning as final.

## 9. Performance and robustness

Targets: 60 fps sustained at the presentation resolution. Provide three quality presets (agent counts, trail resolution, flock counts) and a live-adjustable resolution scale. Target hardware for development is a desktop with a mid-range or better GPU, the presentation machine's exact GPU is unknown, so measure and leave headroom (aim for 30 to 40% spare frame time).

- Measure frame time, optionally with GPU timestamp queries if the `timestamp-query` feature is available. Otherwise use frame-to-frame timing on the CPU and document the limitation.
- Avoid per-frame allocations and CPU readbacks in the hot path. No `mapAsync` per frame.
- Create pipelines and bind groups once; update uniforms through a small uniform buffer written with `queue.writeBuffer`.
- Handle `device.lost`: show a clear message, try to recreate the device, and make sure the performance mode survives a browser tab visibility change.
- Fail gracefully if `navigator.gpu` is missing: a plain message, not a blank page. Do not build a WebGL2 fallback unless Kiwi asks.
- Rehearsal safety: a "safe mode" key that drops agent counts and resolution instantly in case of stutter during the presentation.

---

## 10. Verification and explainability (criteria 1 and 2)

The performer must be able to explain and defend the system live, including predicting what a parameter change will do. Build the tools that make that possible.

1. EXPLAINER.md, one section per agent family: what it perceives (with numbers), limits, how it computes its action (formula), what emerges, and a table "parameter, what it changes, predicted visible effect". Predictions are testable statements (for example "increasing sensor angle from 0.3 to 0.9 rad makes filaments branch more and the network coarser"). Kiwi owns the final predictions and will verify or correct them, so draft them and mark them as "draft, to be verified by Kiwi". Do not present drafted predictions as verified.
2. Debug overlays (toggle keys): flow field arrows; for a selected Physarum agent, its three sensor positions and readings; for a selected boid, its perception radius and neighbors; the flock grid; per-family parameter readouts; trail or counter buffer views.
3. Parameter sweep tool: a dev-only page or mode that steps one parameter across a range and saves screenshots at fixed simulation times from a fixed seed, so predictions can be compared with outcomes. This supports the logbook evidence. Seeded randomness is required for this (hash-based RNG seeded from a uniform).
4. CPU reference implementations for small N of the steering vehicle update, the flocking rules and the Physarum turning rule, plus tests comparing the GPU output of small controlled scenarios (for example three agents on a known trail) against the CPU reference. Lesson from Kiwi's previous unit: a permissive test harness hid a production bug that only appeared in the browser. So tests must use the same numeric constraints as the runtime, and you must state exactly what is and is not covered. Do not claim GPU tests ran unless a real WebGPU adapter was used. A software adapter in headless Chromium may or may not be available in your sandbox, so check and say so.
5. Smoke test: load the page, confirm device creation, run N frames, confirm no validation errors and no NaN in a read-back sample (read-back allowed in tests only).

---

## 11. Documentation deliverables (in the repo)

- README.md: what it is, how to run, controls, credits and licenses (Bleuje, Sage Jenson, Jones, Reynolds, Shiffman, Karl Sims and Jos Stam if used).
- EXPLAINER.md: see section 10.
- DECISIONS.md: the autonomous decisions log (see CLAUDE.md).
- ESCALATIONS.md: open questions for Kiwi.
- LOGBOOK.md: the course "bitacora". Record experiments, decisions, tests and rehearsals as you go, with dates. It is a space for work and reflection, not graded on its own. Include a self-evaluation skeleton with the four criteria (0 to 25 each) and empty score fields plus an "evidence" list per criterion that you pre-fill with links to code, screenshots and tests. Kiwi writes the scores and reflections himself. Do not invent scores.
- SCORE_TEMPLATE.md: a blank visual score template, organized by scene. One row per song passage: (music timestamp or passage, what I hear, the scene to be in, intended feeling, live gestures to use on this passage: pen, wheel level, accent hits, stir, and any freeze). Because the score is a list of scenes and gestures, not keystrokes, the template has no columns for parameters. Do NOT fill in content, the score and the song belong to Kiwi. An optional printable HTML version is fine.

Language: default to English for code and technical docs. The course and logbook are likely in Spanish, so leave LOGBOOK.md and SCORE_TEMPLATE.md headings bilingual (English with Spanish in parentheses) until Kiwi says otherwise. Log this in ESCALATIONS.md as an open question.

---

## 12. Milestones and acceptance criteria

Commit at the end of each milestone. Keep the app runnable at every commit.

- M0, scaffold: repo, bundler, WebGPU device init with graceful failure, fullscreen toggle, fps HUD, audio file picker with plain playback. Acceptance: opens, clears the screen to a color, shows fps, plays a chosen audio file, no console errors.
- M1, classic Physarum: agents, counter buffer, deposit, diffuse and decay, display. Acceptance: at least 200k agents at 60 fps, recognizable Physarum networks, parameters SD, SA, RA, MD, decay live-adjustable.
- M2, extended Physarum plus pen: `A + B*S^C` mode, the full preset matrix, background/pen blend with Gaussian, eased preset transitions, pen radius, spawn burst, wave. Acceptance: pointer visibly changes the local structure of the network in a stable, explainable way; at least 4 presets curated and each candidate preset-to-preset transition checked visually.
- M3, flow field and steering library: explicit field texture with noise, debug arrows, followers using steering (desired minus velocity), pen edits to the field. Acceptance: flow followers visibly trace the field; field parameters are live controls; steering formula documented and unit tested on CPU.
- M4, flocking on GPU: spatial grid (counting sort preferred), separation, alignment, cohesion with live weights and radius, pointer as predator or attractor. Acceptance: at least 20k boids at 60 fps together with M1 and M3 running; flock structure changes visibly with each weight.
- M5, coupling and coherence: implement coupling channels from section 6, unify palette and rendering. Acceptance: passes the coherence acceptance test in section 7; all coupling strengths are live controls.
- M6, scenes and instrument: scene data format and loader, transitions, live control surface from 8.2 (pen, wheel intensity macro, click accent, right-drag stir, next, previous, jump, freeze, reset, safe), cue panel, help overlay, tuning panel with capture-to-scene and JSON export and import, three PLACEHOLDER scenes. Acceptance: a person who has never seen the app can walk through the three placeholder scenes and shape each one using only the help overlay; every live input has an observable effect in every scene; no live input requires a modifier key or chord.
- M7, verification and docs: overlays, sweep tool, CPU references and tests, EXPLAINER.md, LOGBOOK.md skeleton, SCORE_TEMPLATE.md, README. Acceptance: for each agent family, a documented set of predictions each accompanied by a reproducible check.
- M8, rehearsal hardening: 20 minute continuous run without degradation or memory growth, device-lost recovery, full-screen at the presentation resolution, safe mode verified. Acceptance: no console errors over the run, frame time stable.
- M9, stretch (optional, escalate first): fluid-driven flow field (section 5.5), behind a flag.

---

## 13. Things explicitly NOT to do

- Do not map audio amplitude, spectrum, tempo or beats to anything, including "just for the palette".
- Do not add live inputs beyond the set in 8.2, do not add modifier keys or chords for anything used live, and do not build a second macro axis without Kiwi's approval.
- Do not add timelines, keyframe automation, scripted transitions, or "auto" modes that change parameters on their own.
- Do not add behavior families outside the four allowed ones (no particle life, Lenia, reaction-diffusion, DLA, neural nets, rigid bodies), even if they look good. Karl Sims's fluid module is the one gray area and is handled in section 5.5.
- Do not silently swap a documented algorithm for a different one. If a reference algorithm cannot be ported as described, log it in DECISIONS.md with the reason.
- Do not write the visual score content, choose the song, fill in self-evaluation scores, or claim predictions are verified.
- Do not use em dashes in any prose.

---

## 14. Known gaps in the research behind this spec

Read completely (via a real browser session, no truncation): the unit page, Nature of Code chapter 5, Reynolds' paper (HTML version), Bleuje's article including its hidden code blocks, Bleuje's web port sources (main.js, shaders.js, parameters.js), the Patt Vira video page and its p5 sketch, Karl Sims' fluid tutorial (text only), Hobbs' essay (text only), Sofia's sketch source.

Still not seen or not verified:
- The Patt Vira video itself was not watched or transcribed; only its description, chapter list and sketch code were read. Chapter list: What is a slime mold (0:10), algorithm and approach (1:16), Mold class (2:20), sensor variables (7:00), pixels array (12:19), sensing from the canvas (19:16), turning rule (21:41), alpha fade for the trail (26:20), modulo wrapping (31:02).
- Bleuje's desktop input handling file (keyboard, mouse, gamepad actions) was not found; the web port's main.js (52 KB) does contain equivalent handling and was only skimmed for the render loop and setup. Read it for the control mapping of the web demo.
- Karl Sims' stencil diagrams are images, so the printed kernel could not be verified (see 5.5). Hobbs' images and the Sofia sketch's runtime behavior were not viewed.
- The Reynolds paper's figures were not viewed. The book's interactive examples were not run.
- All WebGPU API notes in this spec come from general knowledge. Check them against the current spec and browser behavior before relying on them.

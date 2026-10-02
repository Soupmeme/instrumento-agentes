// Physarum on the GPU (SPEC 5.1, "reference GPU pipeline", WebGPU translation), in two modes:
//   classic:   the textbook rule, three sensors, four parameters (move.wgsl).
//   extended:  "36 Points" rule, parameters depend on the trail under the agent, a pen region
//              runs a second preset, waves, inertia, stir, spawn bursts (move_extended.wgsl).
//
// One simulation step:
//   1. clear the per-pixel counter
//   2. agent pass    (one thread per agent)  sense, turn, move, atomicAdd into the counter
//   3. deposit pass  (one thread per pixel)  trail += sqrt(count) * depositFactor
//   4. diffuse pass  (one thread per pixel)  3x3 blur, times decay, into the other trail buffer
// The two trail buffers swap roles every step (ping-pong). The display pass reads whichever
// holds the newest trail.
//
// The trail and counter are plain storage buffers, not textures: no format restrictions, the
// same buffer can be read by any pass, and later fields (flow, flock grid) can work the same
// way. Positions are stored normalised (0..1) so the grid can be resized without moving agents.

import type { Gpu } from '../gpu';
import { MODE_EXTENDED, type PhysarumParams } from './params';
import { PARAM_COUNT, presetOfSlot } from './presets';
import { countScaleFor, ease, pixelScaleFor } from './extended';
import commonWgsl from './common.wgsl?raw';
import initWgsl from './init.wgsl?raw';
import moveWgsl from './move.wgsl?raw';
import moveExtendedWgsl from './move_extended.wgsl?raw';
import depositWgsl from './deposit.wgsl?raw';
import diffuseWgsl from './diffuse.wgsl?raw';
import displayWgsl from './display.wgsl?raw';
import probeOverlayWgsl from './probe_overlay.wgsl?raw';
import pickWgsl from './pick.wgsl?raw';
import resampleWgsl from './resample.wgsl?raw';
import steeringWgsl from '../steering/steering.wgsl?raw';
import fieldSampleWgsl from '../flow/field_sample.wgsl?raw';
import flowBiasWgsl from '../coupling/flow_bias.wgsl?raw';
import { paletteWgsl, PALETTE_COUNT } from '../render/palettes';
import { FlowLayer, type FlowInput } from '../flow/flow';
import { FlockLayer, MAX_BOIDS, type FlockInput } from '../flock/flock';

/** Agents allocated up front. `params.agentCount` of them are awake. 2M x 16 B = 32 MB. */
export const MAX_AGENTS = 2_000_000;
const AGENT_BYTES = 16; // vec2f pos, f32 heading, f32 progress
const VELOCITY_BYTES = 8; // vec2f, used only by the extended mode (inertia)
const PARAM_BYTES = 112;
/** The probe index when no agent is followed (the agent pass compares its own index against it). */
const NO_PROBE = 0xffffffff;
/** Words in the probe buffer (see move.wgsl for what each one holds). */
export const PROBE_WORDS = 24;
/** Edge darkening of the display (0 = none). A fixed, subtle value; see DECISIONS (M5). */
const VIGNETTE = 0.15;
const EXT_FLOATS = 64;
const WORKGROUP = 256;

/** Simulation steps per second. The frame loop and every time-based effect use this. */
export const SIM_HZ = 60;
const WAVE_COUNT = 5;
const WAVE_LIFETIME = 5; // seconds (must match the shader)
const NEVER = -12345; // trigger time of a wave that has not happened
const STIR_DECAY = 0.85; // per step: the stir push fades when the pointer stops (about 15 steps to 10%)
const SPAWN_FRACTION = 0.1;
/** The accent's pointer surge fades by this factor per step (about 0.3 s to a tenth). */
const SURGE_DECAY = 0.96;
/** At full surge the boids' pointer weight rises by this factor, and the field edit goes to full strength. */
const SURGE_BOOST = 3;

export interface PassTimings {
  agent: number;
  deposit: number;
  diffuse: number;
  render: number;
  field: number;
  followers: number;
  /** The three spatial-grid passes of the flock (count, scan, scatter), together. */
  flockGrid: number;
  flock: number;
}

// Timestamp slots: pass k uses queries 2k (begin) and 2k+1 (end).
const PASS_AGENT = 0;
const PASS_DEPOSIT = 1;
const PASS_DIFFUSE = 2;
const PASS_RENDER = 3;
const PASS_FIELD = 4;
const PASS_FOLLOW = 5;
const PASS_FLOCK_GRID = 6;
const PASS_FLOCK = 7;
const PASS_COUNT = 8;

export type SpawnMode = 'ring' | 'center';

export class Physarum {
  readonly params: PhysarumParams;
  /** Milliseconds per pass, from GPU timestamps (NaN when unsupported or not yet read). */
  readonly timings: PassTimings = { agent: NaN, deposit: NaN, diffuse: NaN, render: NaN, field: NaN, followers: NaN, flockGrid: NaN, flock: NaN };
  /** Set by the HUD: only read timings back while someone is looking at them. */
  wantTimings = false;
  /** While true the frame loop takes no simulation steps (Freeze, and the test harness). */
  paused = false;
  /** Steps taken since the page loaded (never reset, used by the soak monitor). */
  totalSteps = 0;

  /** The pen, in 0..1 across the world. `active` is false when the pointer is elsewhere. */
  readonly pen = { x: 0.5, y: 0.5, active: false, stirX: 0, stirY: 0 };

  /** The flow layer: the flow field, the flow followers and the debug arrows. */
  readonly flow: FlowLayer;
  /** Draw the flow field as arrows over the picture (debug overlay, key V). */
  fieldArrows = false;

  /** The flock layer: boids, the spatial grid that finds their neighbours, the debug overlay. */
  readonly flock: FlockLayer;
  /** Draw the flock's grid and what the selected boid perceives over the picture (debug overlay, key G). */
  flockDebug = false;
  /** Draw the sensors of one Physarum agent over the picture (debug overlay, key A). */
  probeOverlay = false;
  /** The agent the sensor overlay follows (an index into the agent buffer), or -1 for none. */
  probeAgent = -1;
  /** Which buffer the display shows (debug, key O): 0 the picture, 1 trail, 2 delayed trail, 3 change, 4 agents per pixel. */
  viewMode = 0;

  private gpu: Gpu;
  private width = 0;
  private height = 0;
  private canvasWidth = 1;
  private canvasHeight = 1;
  private frame = 0;
  private seed = 0;
  /** Index (0 or 1) of the trail buffer that holds the newest trail. */
  private cur = 0;

  private paramsBuf: GPUBuffer;
  private extBuf: GPUBuffer;
  private probeBuf: GPUBuffer;
  private probePipe!: GPURenderPipeline;
  private probeBG!: GPUBindGroup;
  private pickDistancePipe!: GPUComputePipeline;
  private pickIndexPipe!: GPUComputePipeline;
  private agentsBuf: GPUBuffer;
  private velocityBuf: GPUBuffer;
  private trail: GPUBuffer[] = [];
  private counter!: GPUBuffer;
  /** The delayed trail (see diffuse.wgsl): where the trail has been changing shows up in the colour. */
  private slow!: GPUBuffer;

  private initPipe: GPUComputePipeline;
  private movePipe: GPUComputePipeline;
  private moveExtPipe: GPUComputePipeline;
  private depositPipe: GPUComputePipeline;
  private diffusePipe: GPUComputePipeline;
  private displayPipe: GPURenderPipeline;

  private initBG: GPUBindGroup;
  // One bind group per value of `cur`, because the buffers swap roles.
  private moveBG: GPUBindGroup[] = [];
  private moveExtBG: GPUBindGroup[] = [];
  private depositBG: GPUBindGroup[] = [];
  private diffuseBG: GPUBindGroup[] = [];
  private displayBG: GPUBindGroup[] = [];

  // Extended mode state. Vectors are 16 floats (15 used) so they upload as four vec4f.
  private bgNow = new Float32Array(16);
  private penNow = new Float32Array(16);
  private bgFrom = new Float32Array(16);
  private penFrom = new Float32Array(16);
  private bgTo = new Float32Array(16);
  private penTo = new Float32Array(16);
  private transitionStart = 0;
  private appliedBg = -1;
  private appliedPen = -1;
  /** Waves, packed for the shader as x, y, trigger time, sigma. */
  private waves = new Float32Array(WAVE_COUNT * 4);
  private nextWave = 0;
  private pendingSpawn: 0 | 1 | 2 = 0;
  private pendingFraction = SPAWN_FRACTION;
  private surgeValue = 0;
  /** Safe mode and quality presets: fraction of the configured agent, follower and boid counts that run (1 = all). */
  countScale = 1;
  /** Which passes ran in the most recent step (for the timing readout). */
  private ranLast: boolean[] = new Array(PASS_COUNT).fill(false);

  private querySet: GPUQuerySet | null = null;
  private resolveBuf: GPUBuffer | null = null;
  private stagingBuf: GPUBuffer | null = null;
  private stagingBusy = false;
  private stepRanSinceResolve = false;
  private pendingRead = false;

  constructor(gpu: Gpu, params: PhysarumParams, simWidth: number, simHeight: number) {
    this.gpu = gpu;
    this.params = params;
    const { device } = gpu;
    this.flow = new FlowLayer(gpu);
    this.flock = new FlockLayer(gpu);

    this.paramsBuf = device.createBuffer({
      label: 'physarum params',
      size: PARAM_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.extBuf = device.createBuffer({
      label: 'physarum extended uniforms',
      size: EXT_FLOATS * 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.probeBuf = device.createBuffer({
      label: 'physarum probe',
      size: PROBE_WORDS * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });
    this.agentsBuf = device.createBuffer({
      label: 'physarum agents',
      size: MAX_AGENTS * AGENT_BYTES,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });
    this.velocityBuf = device.createBuffer({
      label: 'physarum velocities',
      size: MAX_AGENTS * VELOCITY_BYTES,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });

    const compute = (label: string, code: string) =>
      device.createComputePipeline({
        label,
        layout: 'auto',
        compute: { module: device.createShaderModule({ label, code: commonWgsl + code }), entryPoint: 'main' },
      });
    this.initPipe = compute('physarum init', initWgsl);
    // The two agent shaders also steer toward the flow field when the coupling is on.
    const coupling = steeringWgsl + fieldSampleWgsl + flowBiasWgsl;
    this.movePipe = compute('physarum move', coupling + moveWgsl);
    this.moveExtPipe = compute('physarum move extended', coupling + moveExtendedWgsl);
    this.depositPipe = compute('physarum deposit', depositWgsl);
    this.diffusePipe = compute('physarum diffuse', diffuseWgsl);

    const displayModule = device.createShaderModule({ label: 'physarum display', code: commonWgsl + paletteWgsl() + displayWgsl });
    this.displayPipe = device.createRenderPipeline({
      label: 'physarum display',
      layout: 'auto',
      vertex: { module: displayModule, entryPoint: 'vs' },
      fragment: { module: displayModule, entryPoint: 'fs', targets: [{ format: gpu.format }] },
      primitive: { topology: 'triangle-list' },
    });

    // Sensor overlay: one full-screen pass that draws what the probe buffer says, blended over the picture.
    const probeModule = device.createShaderModule({ label: 'physarum probe overlay', code: commonWgsl + probeOverlayWgsl });
    this.probePipe = device.createRenderPipeline({
      label: 'physarum probe overlay',
      layout: 'auto',
      vertex: { module: probeModule, entryPoint: 'vs' },
      fragment: {
        module: probeModule,
        entryPoint: 'fs',
        targets: [{
          format: gpu.format,
          blend: {
            color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          },
        }],
      },
      primitive: { topology: 'triangle-list' },
    });
    this.probeBG = device.createBindGroup({
      layout: this.probePipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.paramsBuf } },
        { binding: 1, resource: { buffer: this.probeBuf } },
      ],
    });
    const pickModule = device.createShaderModule({ label: 'pick nearest', code: pickWgsl });
    const pickPipe = (entryPoint: string) =>
      device.createComputePipeline({ label: entryPoint, layout: 'auto', compute: { module: pickModule, entryPoint } });
    this.pickDistancePipe = pickPipe('pickDistance');
    this.pickIndexPipe = pickPipe('pickIndex');

    this.initBG = device.createBindGroup({
      layout: this.initPipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.paramsBuf } },
        { binding: 1, resource: { buffer: this.agentsBuf } },
      ],
    });

    if (gpu.hasTimestampQuery) {
      this.querySet = device.createQuerySet({ type: 'timestamp', count: 2 * PASS_COUNT });
      this.resolveBuf = device.createBuffer({
        size: 16 * PASS_COUNT,
        usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
      });
      this.stagingBuf = device.createBuffer({
        size: 16 * PASS_COUNT,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
      });
    }

    this.allocateGrid(simWidth, simHeight);
    this.reset();
  }

  get gridWidth(): number {
    return this.width;
  }
  get gridHeight(): number {
    return this.height;
  }
  get agentBuffer(): GPUBuffer {
    return this.agentsBuf;
  }
  get velocityBuffer(): GPUBuffer {
    return this.velocityBuf;
  }
  get trailBuffer(): GPUBuffer {
    return this.trail[this.cur];
  }
  get counterBuffer(): GPUBuffer {
    return this.counter;
  }
  /** The delayed copy of the trail (display colour trick). */
  get delayedBuffer(): GPUBuffer {
    return this.slow;
  }
  /** Simulation time in seconds (resets with Reset). */
  get simTime(): number {
    return this.frame / SIM_HZ;
  }
  /** The blended preset vectors the shader is using right now (mid-transition included). */
  get currentPresets(): { background: Float32Array; pen: Float32Array } {
    return { background: this.bgNow, pen: this.penNow };
  }

  /**
   * Change the simulation grid size (only the shape of the window changes it, see presentation.ts).
   * Agents keep their normalised place and the trail and its delayed copy are carried over to the
   * new grid with a bilinear filter, so going full screen stretches the picture a little instead of
   * wiping it.
   */
  resize(simWidth: number, simHeight: number): void {
    if (simWidth === this.width && simHeight === this.height) return;
    const { device } = this.gpu;
    const oldTrail = this.trail[this.cur];
    const oldSlow = this.slow;
    const oldDims = [this.width, this.height];
    // The buffers that are not carried over are released now; the two being read are released after the copy.
    this.trail.forEach((b) => { if (b !== oldTrail) b.destroy(); });
    this.counter.destroy();
    this.allocateGrid(simWidth, simHeight);

    const uniform = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(uniform, 0, new Uint32Array([oldDims[0], oldDims[1], this.width, this.height]));
    const pipe = device.createComputePipeline({
      label: 'resample trail',
      layout: 'auto',
      compute: { module: device.createShaderModule({ label: 'resample', code: resampleWgsl }), entryPoint: 'main' },
    });
    const enc = device.createCommandEncoder({ label: 'resample trail' });
    for (const [from, to] of [[oldTrail, this.trail[0]], [oldSlow, this.slow]] as const) {
      const pass = enc.beginComputePass();
      pass.setPipeline(pipe);
      pass.setBindGroup(0, device.createBindGroup({
        layout: pipe.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: uniform } },
          { binding: 1, resource: { buffer: from } },
          { binding: 2, resource: { buffer: to } },
        ],
      }));
      pass.dispatchWorkgroups(Math.ceil(this.width / 16), Math.ceil(this.height / 16));
      pass.end();
    }
    device.queue.submit([enc.finish()]);
    // Destroying a buffer that a submitted pass reads is safe: the queue keeps it alive until the work is done.
    oldTrail.destroy();
    oldSlow.destroy();
    uniform.destroy();
  }

  private allocateGrid(w: number, h: number): void {
    const { device } = this.gpu;
    this.width = w;
    this.height = h;
    const bytes = w * h * 4;
    const storage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
    this.trail = [0, 1].map((i) => device.createBuffer({ label: `physarum trail ${i}`, size: bytes, usage: storage }));
    this.counter = device.createBuffer({ label: 'physarum counter', size: bytes, usage: storage });
    this.slow = device.createBuffer({ label: 'physarum delayed trail', size: bytes, usage: storage });
    this.flow.resize(w, h); // the flow layer's grid-sized buffers follow the grid
    this.flock.resize(w, h, this.trail as [GPUBuffer, GPUBuffer]);
    this.cur = 0;

    const entry = (binding: number, buffer: GPUBuffer): GPUBindGroupEntry => ({ binding, resource: { buffer } });
    const params = entry(0, this.paramsBuf);
    this.moveBG = [];
    this.moveExtBG = [];
    this.depositBG = [];
    this.diffuseBG = [];
    this.displayBG = [];
    for (const c of [0, 1]) {
      const here = this.trail[c];
      const other = this.trail[1 - c];
      this.moveBG.push(
        device.createBindGroup({
          layout: this.movePipe.getBindGroupLayout(0),
          entries: [params, entry(1, this.agentsBuf), entry(2, here), entry(3, this.counter), entry(4, this.flow.fieldBuffer), entry(5, this.probeBuf)],
        }),
      );
      this.moveExtBG.push(
        device.createBindGroup({
          layout: this.moveExtPipe.getBindGroupLayout(0),
          entries: [
            params,
            entry(1, this.agentsBuf),
            entry(2, here),
            entry(3, this.counter),
            entry(4, this.extBuf),
            entry(5, this.velocityBuf),
            entry(6, this.flow.fieldBuffer),
            entry(7, this.probeBuf),
          ],
        }),
      );
      this.depositBG.push(
        device.createBindGroup({
          layout: this.depositPipe.getBindGroupLayout(0),
          entries: [params, entry(1, this.counter), entry(2, here), entry(3, this.flow.counterBuffer), entry(4, this.flock.counterBuffer)],
        }),
      );
      this.diffuseBG.push(
        device.createBindGroup({
          layout: this.diffusePipe.getBindGroupLayout(0),
          entries: [params, entry(1, here), entry(2, other), entry(3, this.slow)],
        }),
      );
      // After a step the newest trail sits in `other`, and `cur` flips to `1 - c`, so the
      // display group for cur = k reads trail[k].
      this.displayBG.push(
        device.createBindGroup({
          layout: this.displayPipe.getBindGroupLayout(0),
          entries: [params, entry(1, here), entry(2, this.slow), entry(3, this.counter)],
        }),
      );
    }
  }

  /** Scatter all agents randomly and clear the trail. Pass a seed for a repeatable start. */
  reset(seed?: number): void {
    const { device } = this.gpu;
    this.seed = seed ?? (Math.random() * 0x100000000) >>> 0;
    this.frame = 0;
    this.writeParams();

    const enc = device.createCommandEncoder({ label: 'physarum reset' });
    this.trail.forEach((b) => enc.clearBuffer(b));
    enc.clearBuffer(this.slow);
    enc.clearBuffer(this.counter);
    enc.clearBuffer(this.velocityBuf);
    const pass = enc.beginComputePass({ label: 'physarum init' });
    pass.setPipeline(this.initPipe);
    pass.setBindGroup(0, this.initBG);
    this.dispatch1D(pass, MAX_AGENTS);
    pass.end();
    device.queue.submit([enc.finish()]);
    this.cur = 0;

    this.flow.reset(this.seed, this.flowInput());
    this.flock.reset(this.seed, this.flockInput());

    // Waves, bursts, stir and the accent's surge belong to the run that just ended. (The surge was
    // left out until M7, when a check found two runs from the same seed differing after an accent.)
    for (let w = 0; w < WAVE_COUNT; w++) this.waves.set([0.5, 0.5, NEVER, 0.5], w * 4);
    this.nextWave = 0;
    this.pendingSpawn = 0;
    this.surgeValue = 0;
    this.pen.stirX = 0;
    this.pen.stirY = 0;
    // Presets restart settled on their targets.
    this.appliedBg = -1;
    this.appliedPen = -1;
    this.syncPresets();
  }

  // ---- Extended mode: presets, pen, waves, spawn ----

  private static fill(target: Float32Array, values: readonly number[]): void {
    target.fill(0);
    for (let i = 0; i < PARAM_COUNT; i++) target[i] = values[i];
  }

  /**
   * Notice a change of `params.backgroundPreset` / `params.penPreset` and start easing toward
   * it over `params.presetSeconds`. The first call (after construction or Reset) snaps.
   */
  private syncPresets(): void {
    const { backgroundPreset, penPreset, presetSeconds } = this.params;
    if (backgroundPreset === this.appliedBg && penPreset === this.appliedPen) return;
    const first = this.appliedBg < 0;
    this.bgFrom.set(this.bgNow);
    this.penFrom.set(this.penNow);
    Physarum.fill(this.bgTo, presetOfSlot(backgroundPreset));
    Physarum.fill(this.penTo, presetOfSlot(penPreset));
    this.appliedBg = backgroundPreset;
    this.appliedPen = penPreset;
    this.transitionStart = this.simTime;
    if (first || presetSeconds <= 0) {
      this.bgNow.set(this.bgTo);
      this.penNow.set(this.penTo);
      this.bgFrom.set(this.bgTo);
      this.penFrom.set(this.penTo);
    }
  }

  private advanceTransition(): void {
    const { presetSeconds } = this.params;
    const progress = presetSeconds > 0 ? (this.simTime - this.transitionStart) / presetSeconds : 1;
    const e = ease(progress);
    for (let i = 0; i < 16; i++) {
      this.bgNow[i] = this.bgFrom[i] + (this.bgTo[i] - this.bgFrom[i]) * e;
      this.penNow[i] = this.penFrom[i] + (this.penTo[i] - this.penFrom[i]) * e;
    }
  }

  /** True when the pen means something: the extended mode, followers with a pen edit, or boids with a pointer role. */
  get penUsed(): boolean {
    const p = this.params;
    return p.mode === MODE_EXTENDED || (p.followerCount > 0 && p.penFieldMode > 0) || (p.flockCount > 0 && p.flockPenMode > 0);
  }

  private flockInput(): FlockInput {
    return { params: this.effectiveParams(), gridWidth: this.width, gridHeight: this.height, frame: this.frame, seed: this.seed, pen: this.pen };
  }

  private flowInput(): FlowInput {
    return {
      params: this.effectiveParams(),
      gridWidth: this.width,
      gridHeight: this.height,
      frame: this.frame,
      seed: this.seed,
      time: this.simTime,
      pen: this.pen,
    };
  }

  /** True while a preset transition is still easing. */
  get transitioning(): boolean {
    return this.params.presetSeconds > 0 && this.simTime - this.transitionStart < this.params.presetSeconds;
  }

  /** Move the pen. x and y are 0..1 across the world; `active` false hides it. */
  setPen(x: number, y: number, active: boolean): void {
    this.pen.x = Math.min(1, Math.max(0, x));
    this.pen.y = Math.min(1, Math.max(0, y));
    this.pen.active = active;
  }

  /**
   * Add to the stir push, a vector of length at most 1 (the reference takes it from a stick
   * axis in -1..1; the shader multiplies by 5, so at most about 5 px per step). It fades by
   * itself when input stops.
   */
  addStir(dx: number, dy: number): void {
    const max = 1;
    const sx = this.pen.stirX + dx;
    const sy = this.pen.stirY + dy;
    const m = Math.hypot(sx, sy);
    const k = m > max ? max / m : 1;
    this.pen.stirX = sx * k;
    this.pen.stirY = sy * k;
  }

  /** Start an expanding wave at the pen (or at x, y). At most 5 at once, oldest replaced. */
  triggerWave(x = this.pen.x, y = this.pen.y, sizeMultiplier = 1): void {
    this.waves.set([x, y, this.simTime, this.params.penRadius * sizeMultiplier], this.nextWave * 4);
    this.nextWave = (this.nextWave + 1) % WAVE_COUNT;
  }

  /** Teleport a fraction of the agents around (ring) or onto (center) the pen for one step. */
  spawn(mode: SpawnMode, fraction = SPAWN_FRACTION): void {
    this.pendingSpawn = mode === 'ring' ? 1 : 2;
    this.pendingFraction = Math.min(0.5, Math.max(0.01, fraction));
  }

  /**
   * The accent's momentary surge (SPEC 8.2): the pointer's forces on boids and on the flow field
   * rise by `amount` (0..1) and fade by themselves within about a second. Always at least the
   * current surge, so two clicks in a row do not cancel each other.
   */
  surge(amount: number): void {
    this.surgeValue = Math.max(this.surgeValue, Math.min(1, Math.max(0, amount)));
  }

  get currentSurge(): number {
    return this.surgeValue;
  }

  /**
   * The parameters as the GPU passes see them this step: the configured ones, with the counts
   * scaled down in safe mode and the pointer's forces raised by the accent's surge. The same
   * object when neither applies (the normal case allocates nothing).
   */
  private effectiveParams(): PhysarumParams {
    const p = this.params;
    if (this.countScale === 1 && this.surgeValue <= 0) return p;
    const s = this.surgeValue;
    return {
      ...p,
      agentCount: Math.floor(p.agentCount * this.countScale),
      followerCount: Math.floor(p.followerCount * this.countScale),
      flockCount: Math.floor(p.flockCount * this.countScale),
      flockPenStrength: p.flockPenStrength * (1 + SURGE_BOOST * s),
      penFieldStrength: p.penFieldStrength + s * (1 - p.penFieldStrength),
    };
  }

  /** Number of waves still alive (for the HUD and tests). */
  get activeWaves(): number {
    let n = 0;
    for (let w = 0; w < WAVE_COUNT; w++) if (this.simTime - this.waves[w * 4 + 2] <= WAVE_LIFETIME) n++;
    return n;
  }

  private writeExt(): void {
    const buf = new ArrayBuffer(EXT_FLOATS * 4);
    const f = new Float32Array(buf);
    const u = new Uint32Array(buf);
    f.set(this.bgNow, 0);
    f.set(this.penNow, 16);
    f.set(this.waves, 32);
    f[52] = this.pen.x;
    f[53] = this.pen.y;
    f[54] = this.params.penRadius;
    f[55] = this.pen.active ? 1 : 0;
    f[56] = this.pen.stirX;
    f[57] = this.pen.stirY;
    f[58] = this.params.inertia;
    f[59] = this.simTime;
    f[60] = pixelScaleFor(this.width, this.height);
    u[61] = this.pendingSpawn;
    f[62] = this.pendingFraction;
    this.gpu.device.queue.writeBuffer(this.extBuf, 0, buf);
  }

  private writeParams(): void {
    const p = this.effectiveParams();
    const n = Math.max(0, Math.min(MAX_AGENTS, Math.floor(p.agentCount)));
    const buf = new ArrayBuffer(PARAM_BYTES);
    const u = new Uint32Array(buf);
    const f = new Float32Array(buf);
    u[0] = this.width;
    u[1] = this.height;
    u[2] = n;
    u[3] = this.frame >>> 0;
    u[4] = this.seed >>> 0;
    f[5] = p.sensorDistance;
    f[6] = p.sensorAngle;
    f[7] = p.rotationAngle;
    f[8] = p.moveDistance;
    f[9] = p.depositFactor;
    f[10] = p.decay;
    f[11] = p.respawnRate;
    f[12] = p.displayGain;
    f[13] = this.canvasWidth;
    f[14] = this.canvasHeight;
    f[15] = p.mode === MODE_EXTENDED && n > 0 ? countScaleFor(n, this.width, this.height) : 1;
    f[16] = p.followerDeposit;
    f[17] = p.boidDeposit;
    u[18] = this.flow.fieldWidth;
    u[19] = this.flow.fieldHeight;
    f[20] = p.flowToPhysarum;
    u[21] = Math.max(0, Math.min(PALETTE_COUNT - 1, Math.floor(p.palette)));
    f[22] = p.changeColour;
    f[23] = VIGNETTE;
    u[24] = Math.max(0, Math.min(PALETTE_COUNT - 1, Math.floor(p.paletteB)));
    f[25] = Math.min(1, Math.max(0, p.paletteMix));
    u[26] = this.probeAgent >= 0 ? this.probeAgent >>> 0 : NO_PROBE;
    u[27] = Math.max(0, Math.min(4, Math.floor(this.viewMode)));
    this.gpu.device.queue.writeBuffer(this.paramsBuf, 0, buf);
  }

  /** Large agent counts exceed 65535 workgroups in one dimension, so spill into y. */
  private dispatch1D(pass: GPUComputePassEncoder, threads: number): void {
    const groups = Math.ceil(threads / WORKGROUP);
    const x = Math.min(groups, 65535);
    pass.dispatchWorkgroups(x, Math.ceil(groups / x));
  }

  private stamps(pass: number): GPUComputePassTimestampWrites | undefined {
    if (!this.querySet) return undefined;
    return { querySet: this.querySet, beginningOfPassWriteIndex: 2 * pass, endOfPassWriteIndex: 2 * pass + 1 };
  }

  /** Advance the simulation by one step. Submits its own work. */
  step(): void {
    const { device } = this.gpu;
    const p = this.effectiveParams();
    const extended = p.mode === MODE_EXTENDED;

    if (extended) {
      this.syncPresets();
      this.advanceTransition();
      this.writeExt();
      this.pendingSpawn = 0; // a spawn lasts exactly one step
    }
    this.writeParams();

    // Which agent families run this step. The field is built when something reads it (the
    // followers) or shows it (the debug arrows).
    const physarumAgents = p.physarumOn ? Math.max(0, Math.floor(p.agentCount)) : 0;
    const followers = Math.max(0, Math.min(1_000_000, Math.floor(p.followerCount)));
    // The flow -> Physarum coupling reads the field too, so the field is also built for it.
    const needField = followers > 0 || this.fieldArrows || (physarumAgents > 0 && p.flowToPhysarum > 0);
    if (needField) this.flow.writeUniform(this.flowInput());
    const boids = Math.max(0, Math.min(MAX_BOIDS, Math.floor(p.flockCount)));
    if (boids > 0) this.flock.writeUniform(this.flockInput());

    // The pen's stir push fades by itself once the pointer stops.
    this.pen.stirX *= STIR_DECAY;
    this.pen.stirY *= STIR_DECAY;

    const groupsX = Math.ceil(this.width / 8);
    const groupsY = Math.ceil(this.height / 8);
    const ran = new Array<boolean>(PASS_COUNT).fill(false);

    const enc = device.createCommandEncoder({ label: 'physarum step' });
    enc.clearBuffer(this.counter);
    enc.clearBuffer(this.flow.counterBuffer);
    enc.clearBuffer(this.flock.counterBuffer);

    if (needField) {
      this.flow.encodeField(enc, this.stamps(PASS_FIELD));
      ran[PASS_FIELD] = true;
    }

    if (physarumAgents > 0) {
      const pass = enc.beginComputePass({ label: 'agents', timestampWrites: this.stamps(PASS_AGENT) });
      pass.setPipeline(extended ? this.moveExtPipe : this.movePipe);
      pass.setBindGroup(0, (extended ? this.moveExtBG : this.moveBG)[this.cur]);
      this.dispatch1D(pass, physarumAgents);
      pass.end();
      ran[PASS_AGENT] = true;
    }

    if (followers > 0) {
      this.flow.encodeFollowers(enc, followers, this.stamps(PASS_FOLLOW));
      ran[PASS_FOLLOW] = true;
    }

    if (boids > 0) {
      const gridStamps = this.querySet ? { querySet: this.querySet, begin: 2 * PASS_FLOCK_GRID, end: 2 * PASS_FLOCK_GRID + 1 } : undefined;
      this.flock.encodeStep(enc, boids, this.cur, gridStamps, this.stamps(PASS_FLOCK));
      ran[PASS_FLOCK_GRID] = true;
      ran[PASS_FLOCK] = true;
    }

    let pass = enc.beginComputePass({ label: 'deposit', timestampWrites: this.stamps(PASS_DEPOSIT) });
    pass.setPipeline(this.depositPipe);
    pass.setBindGroup(0, this.depositBG[this.cur]);
    pass.dispatchWorkgroups(groupsX, groupsY);
    pass.end();

    pass = enc.beginComputePass({ label: 'diffuse', timestampWrites: this.stamps(PASS_DIFFUSE) });
    pass.setPipeline(this.diffusePipe);
    pass.setBindGroup(0, this.diffuseBG[this.cur]);
    pass.dispatchWorkgroups(groupsX, groupsY);
    pass.end();
    ran[PASS_DEPOSIT] = true;
    ran[PASS_DIFFUSE] = true;

    device.queue.submit([enc.finish()]);
    this.cur = 1 - this.cur; // the diffuse pass wrote the newest trail into the other buffer
    this.frame++;
    this.totalSteps++;
    this.ranLast = ran;
    this.stepRanSinceResolve = true;
    this.surgeValue = this.surgeValue * SURGE_DECAY < 0.01 ? 0 : this.surgeValue * SURGE_DECAY;
  }

  /** Resolves when the GPU has finished everything submitted so far. Tests and tools only. */
  whenIdle(): Promise<void> {
    return this.gpu.device.queue.onSubmittedWorkDone();
  }

  /** Draw the newest trail into `view`. Call afterSubmit() once the encoder was submitted. */
  render(encoder: GPUCommandEncoder, view: GPUTextureView, canvasWidth: number, canvasHeight: number): void {
    this.canvasWidth = canvasWidth;
    this.canvasHeight = canvasHeight;
    this.writeParams();

    const stamps = this.querySet
      ? { querySet: this.querySet, beginningOfPassWriteIndex: 2 * PASS_RENDER, endOfPassWriteIndex: 2 * PASS_RENDER + 1 }
      : undefined;
    const pass = encoder.beginRenderPass({
      label: 'display',
      colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0.043, g: 0.051, b: 0.078, a: 1 } }],
      timestampWrites: stamps,
    });
    pass.setPipeline(this.displayPipe);
    pass.setBindGroup(0, this.displayBG[this.cur]);
    pass.draw(3);
    pass.end();

    if (this.fieldArrows) this.flow.renderArrows(encoder, view, canvasWidth, canvasHeight);
    if (this.probeOverlay && this.probeAgent >= 0) {
      const probe = encoder.beginRenderPass({ label: 'probe overlay', colorAttachments: [{ view, loadOp: 'load', storeOp: 'store' }] });
      probe.setPipeline(this.probePipe);
      probe.setBindGroup(0, this.probeBG);
      probe.draw(3);
      probe.end();
    }
    if (this.flockDebug && this.params.flockCount > 0) {
      this.flock.renderDebug(encoder, view, canvasWidth, canvasHeight, Math.min(MAX_BOIDS, Math.floor(this.params.flockCount * this.countScale)));
    }

    // Timings are read back only while the HUD is open, once per step, never in the normal path.
    if (this.wantTimings && this.stepRanSinceResolve && this.querySet && !this.stagingBusy) {
      encoder.resolveQuerySet(this.querySet, 0, 2 * PASS_COUNT, this.resolveBuf!, 0);
      encoder.copyBufferToBuffer(this.resolveBuf!, 0, this.stagingBuf!, 0, 16 * PASS_COUNT);
      this.pendingRead = true;
      this.stepRanSinceResolve = false;
    }
  }

  /** Start reading the timestamps, if render() queued them. Call right after queue.submit. */
  afterSubmit(): void {
    if (!this.pendingRead || !this.stagingBuf) return;
    this.pendingRead = false;
    this.stagingBusy = true;
    const staging = this.stagingBuf;
    staging
      .mapAsync(GPUMapMode.READ)
      .then(() => {
        const t = new BigUint64Array(staging.getMappedRange().slice(0));
        staging.unmap();
        // A pass that did not run in the latest step has no fresh timestamps: report NaN.
        const ms = (k: number) => (k === PASS_RENDER || this.ranLast[k] ? Number(t[2 * k + 1] - t[2 * k]) / 1e6 : NaN);
        this.timings.agent = ms(PASS_AGENT);
        this.timings.deposit = ms(PASS_DEPOSIT);
        this.timings.diffuse = ms(PASS_DIFFUSE);
        this.timings.render = ms(PASS_RENDER);
        this.timings.field = ms(PASS_FIELD);
        this.timings.followers = ms(PASS_FOLLOW);
        this.timings.flockGrid = ms(PASS_FLOCK_GRID);
        this.timings.flock = ms(PASS_FLOCK);
      })
      .catch(() => undefined)
      .finally(() => {
        this.stagingBusy = false;
      });
  }

  // ---- Debug overlays: choosing what to look at. ----

  /**
   * The item of `items` (agents or boids: 16-byte entries that start with a position in 0..1)
   * nearest to the point (x, y) in 0..1, found on the GPU (pick.wgsl). `count` items are awake.
   * The answer is read back once, because a key press asked for it; nothing here runs per frame.
   */
  async pickNearest(items: GPUBuffer, count: number, x: number, y: number): Promise<{ index: number; distance: number }> {
    const { device } = this.gpu;
    if (count <= 0) return { index: 0, distance: Infinity };
    const uniform = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const best = device.createBuffer({ size: 8, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
    const staging = device.createBuffer({ size: 8, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const data = new ArrayBuffer(32);
    const f = new Float32Array(data);
    f[0] = x;
    f[1] = y;
    f[2] = this.width;
    f[3] = this.height;
    new Uint32Array(data)[4] = count >>> 0;
    device.queue.writeBuffer(uniform, 0, data);
    device.queue.writeBuffer(best, 0, new Uint32Array([0xffffffff, 0xffffffff]));
    const enc = device.createCommandEncoder({ label: 'pick nearest' });
    for (const pipe of [this.pickDistancePipe, this.pickIndexPipe]) {
      const pass = enc.beginComputePass();
      pass.setPipeline(pipe);
      pass.setBindGroup(0, device.createBindGroup({
        layout: pipe.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: uniform } },
          { binding: 1, resource: { buffer: items } },
          { binding: 2, resource: { buffer: best } },
        ],
      }));
      this.dispatch1D(pass, count);
      pass.end();
    }
    enc.copyBufferToBuffer(best, 0, staging, 0, 8);
    device.queue.submit([enc.finish()]);
    await staging.mapAsync(GPUMapMode.READ);
    const out = new Uint32Array(staging.getMappedRange().slice(0));
    staging.unmap();
    uniform.destroy();
    best.destroy();
    staging.destroy();
    return { index: out[1], distance: Math.sqrt(new Float32Array(out.buffer)[0]) };
  }

  /** Follow the awake Physarum agent nearest to (x, y) in 0..1 with the sensor overlay. Returns its index. */
  async selectAgent(x: number, y: number): Promise<number> {
    const n = Math.max(0, Math.min(MAX_AGENTS, Math.floor(this.effectiveParams().agentCount)));
    const { index } = await this.pickNearest(this.agentsBuf, n, x, y);
    this.gpu.device.queue.writeBuffer(this.probeBuf, 0, new Float32Array(PROBE_WORDS)); // forget the last agent's numbers
    this.probeAgent = index;
    return index;
  }

  /** Follow the awake boid nearest to (x, y) in 0..1 with the flock overlay. Returns its index. */
  async selectBoid(x: number, y: number): Promise<number> {
    const n = Math.min(MAX_BOIDS, Math.floor(this.effectiveParams().flockCount));
    const { index } = await this.pickNearest(this.flock.boidBuffer, n, x, y);
    this.flock.debugIndex = index;
    return index;
  }

  /** What the followed agent perceived and decided in the last step (words listed in move.wgsl). */
  async readProbe(): Promise<Float32Array> {
    return new Float32Array(await this.debugRead(this.probeBuf, PROBE_WORDS * 4));
  }

  // ---- Test and debug support. Read-backs are for tests only, never in the frame loop. ----

  /** The canvas size the display last drew at, in pixels (the grid is the simulation's size, see presentation.ts). */
  get canvasPixels(): [number, number] {
    return [this.canvasWidth, this.canvasHeight];
  }

  /**
   * Draw the display pass `count` times into an off-screen texture of the canvas's size and return
   * the wall time per draw in milliseconds. Dev measurements only (presentation_bench.ts).
   */
  async benchRender(count: number, forTimings = false, size?: [number, number]): Promise<number> {
    const { device, format } = this.gpu;
    const w = Math.max(1, Math.round(size ? size[0] : this.canvasWidth));
    const h = Math.max(1, Math.round(size ? size[1] : this.canvasHeight));
    const texture = device.createTexture({ size: [w, h], format, usage: GPUTextureUsage.RENDER_ATTACHMENT });
    const view = texture.createView();
    await this.whenIdle();
    const start = performance.now();
    for (let i = 0; i < count; i++) {
      const enc = device.createCommandEncoder({ label: 'bench render' });
      if (forTimings) this.wantTimings = true; // the frame loop resets this between awaits
      this.render(enc, view, w, h);
      device.queue.submit([enc.finish()]);
      this.afterSubmit();
      if (forTimings) await this.whenIdle();
    }
    await this.whenIdle();
    const ms = (performance.now() - start) / count;
    texture.destroy();
    return ms;
  }

  /**
   * Draw the picture as the display shows it (palette, tone, overlays that are on) into an
   * off-screen texture of the given size and read it back as RGBA pixels. Tests and the sweep tool
   * only: the screenshots they save are exactly what the audience would see at that moment.
   */
  async renderToPixels(width: number, height: number): Promise<{ width: number; height: number; data: Uint8ClampedArray }> {
    const { device, format } = this.gpu;
    const texture = device.createTexture({ size: [width, height], format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
    const rowBytes = Math.ceil((width * 4) / 256) * 256; // copies need rows padded to 256 bytes
    const staging = device.createBuffer({ size: rowBytes * height, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const enc = device.createCommandEncoder({ label: 'render to pixels' });
    this.render(enc, texture.createView(), width, height);
    enc.copyTextureToBuffer({ texture }, { buffer: staging, bytesPerRow: rowBytes }, [width, height]);
    device.queue.submit([enc.finish()]);
    this.afterSubmit();
    await staging.mapAsync(GPUMapMode.READ);
    const raw = new Uint8Array(staging.getMappedRange().slice(0));
    staging.unmap();
    staging.destroy();
    texture.destroy();
    const bgra = format.startsWith('bgra');
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const from = y * rowBytes + x * 4;
        const to = (y * width + x) * 4;
        data[to] = raw[from + (bgra ? 2 : 0)];
        data[to + 1] = raw[from + 1];
        data[to + 2] = raw[from + (bgra ? 0 : 2)];
        data[to + 3] = 255;
      }
    }
    return { width, height, data };
  }

  /** Overwrite the first agents (x, y normalised; heading radians; progress). Tests only. */
  debugWriteAgents(data: Float32Array): void {
    this.gpu.device.queue.writeBuffer(this.agentsBuf, 0, data);
  }

  /** Overwrite the start of any of our buffers. Tests only. */
  debugWriteBuffer(buffer: GPUBuffer, data: ArrayBufferView): void {
    this.gpu.device.queue.writeBuffer(buffer, 0, data.buffer, data.byteOffset, data.byteLength);
  }

  /** Overwrite the newest trail with a full grid of values. Tests only. */
  debugWriteTrail(data: Float32Array): void {
    this.gpu.device.queue.writeBuffer(this.trail[this.cur], 0, data);
  }

  /** Copy any of our buffers to the CPU. Tests only (uses mapAsync). */
  async debugRead(buffer: GPUBuffer, bytes: number): Promise<ArrayBuffer> {
    const { device } = this.gpu;
    const staging = device.createBuffer({ size: bytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const enc = device.createCommandEncoder();
    enc.copyBufferToBuffer(buffer, 0, staging, 0, bytes);
    device.queue.submit([enc.finish()]);
    await staging.mapAsync(GPUMapMode.READ);
    const out = staging.getMappedRange().slice(0);
    staging.unmap();
    staging.destroy();
    return out;
  }
}

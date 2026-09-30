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
import { FlowLayer, type FlowInput } from '../flow/flow';

/** Agents allocated up front. `params.agentCount` of them are awake. 2M x 16 B = 32 MB. */
export const MAX_AGENTS = 2_000_000;
const AGENT_BYTES = 16; // vec2f pos, f32 heading, f32 progress
const VELOCITY_BYTES = 8; // vec2f, used only by the extended mode (inertia)
const PARAM_BYTES = 80;
const EXT_FLOATS = 64;
const WORKGROUP = 256;
const MAX_GRID_SIDE = 1920;

/** Simulation steps per second. The frame loop and every time-based effect use this. */
export const SIM_HZ = 60;
const WAVE_COUNT = 5;
const WAVE_LIFETIME = 5; // seconds (must match the shader)
const NEVER = -12345; // trigger time of a wave that has not happened
const STIR_DECAY = 0.85; // per step: the stir push fades when the pointer stops (about 15 steps to 10%)
const SPAWN_FRACTION = 0.1;

/** Simulation grid for a canvas: same aspect, longest side at most MAX_GRID_SIDE. */
export function simSizeFor(canvasWidth: number, canvasHeight: number): [number, number] {
  const k = Math.min(1, MAX_GRID_SIDE / Math.max(canvasWidth, canvasHeight));
  return [Math.max(8, Math.round(canvasWidth * k)), Math.max(8, Math.round(canvasHeight * k))];
}

export interface PassTimings {
  agent: number;
  deposit: number;
  diffuse: number;
  render: number;
  field: number;
  followers: number;
}

// Timestamp slots: pass k uses queries 2k (begin) and 2k+1 (end).
const PASS_AGENT = 0;
const PASS_DEPOSIT = 1;
const PASS_DIFFUSE = 2;
const PASS_RENDER = 3;
const PASS_FIELD = 4;
const PASS_FOLLOW = 5;
const PASS_COUNT = 6;

export type SpawnMode = 'ring' | 'center';

export class Physarum {
  readonly params: PhysarumParams;
  /** Milliseconds per pass, from GPU timestamps (NaN when unsupported or not yet read). */
  readonly timings: PassTimings = { agent: NaN, deposit: NaN, diffuse: NaN, render: NaN, field: NaN, followers: NaN };
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
  private agentsBuf: GPUBuffer;
  private velocityBuf: GPUBuffer;
  private trail: GPUBuffer[] = [];
  private counter!: GPUBuffer;

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
    this.movePipe = compute('physarum move', moveWgsl);
    this.moveExtPipe = compute('physarum move extended', moveExtendedWgsl);
    this.depositPipe = compute('physarum deposit', depositWgsl);
    this.diffusePipe = compute('physarum diffuse', diffuseWgsl);

    const displayModule = device.createShaderModule({ label: 'physarum display', code: commonWgsl + displayWgsl });
    this.displayPipe = device.createRenderPipeline({
      label: 'physarum display',
      layout: 'auto',
      vertex: { module: displayModule, entryPoint: 'vs' },
      fragment: { module: displayModule, entryPoint: 'fs', targets: [{ format: gpu.format }] },
      primitive: { topology: 'triangle-list' },
    });

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
  /** Simulation time in seconds (resets with Reset). */
  get simTime(): number {
    return this.frame / SIM_HZ;
  }
  /** The blended preset vectors the shader is using right now (mid-transition included). */
  get currentPresets(): { background: Float32Array; pen: Float32Array } {
    return { background: this.bgNow, pen: this.penNow };
  }

  /** Change the simulation grid size. The trail is cleared, agents keep their place. */
  resize(simWidth: number, simHeight: number): void {
    if (simWidth === this.width && simHeight === this.height) return;
    this.trail.forEach((b) => b.destroy());
    this.counter.destroy();
    this.allocateGrid(simWidth, simHeight);
  }

  private allocateGrid(w: number, h: number): void {
    const { device } = this.gpu;
    this.width = w;
    this.height = h;
    const bytes = w * h * 4;
    const storage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
    this.trail = [0, 1].map((i) => device.createBuffer({ label: `physarum trail ${i}`, size: bytes, usage: storage }));
    this.counter = device.createBuffer({ label: 'physarum counter', size: bytes, usage: storage });
    this.flow.resize(w, h); // the flow layer's grid-sized buffers follow the grid
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
          entries: [params, entry(1, this.agentsBuf), entry(2, here), entry(3, this.counter)],
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
          ],
        }),
      );
      this.depositBG.push(
        device.createBindGroup({
          layout: this.depositPipe.getBindGroupLayout(0),
          entries: [params, entry(1, this.counter), entry(2, here), entry(3, this.flow.counterBuffer)],
        }),
      );
      this.diffuseBG.push(
        device.createBindGroup({
          layout: this.diffusePipe.getBindGroupLayout(0),
          entries: [params, entry(1, here), entry(2, other)],
        }),
      );
      // After a step the newest trail sits in `other`, and `cur` flips to `1 - c`, so the
      // display group for cur = k reads trail[k].
      this.displayBG.push(
        device.createBindGroup({
          layout: this.displayPipe.getBindGroupLayout(0),
          entries: [params, entry(1, here)],
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

    // Waves, bursts and stir belong to the run that just ended.
    for (let w = 0; w < WAVE_COUNT; w++) this.waves.set([0.5, 0.5, NEVER, 0.5], w * 4);
    this.nextWave = 0;
    this.pendingSpawn = 0;
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

  /** True when the pen means something: the extended mode, or followers with a pen edit. */
  get penUsed(): boolean {
    return this.params.mode === MODE_EXTENDED || (this.params.followerCount > 0 && this.params.penFieldMode > 0);
  }

  private flowInput(): FlowInput {
    return {
      params: this.params,
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
  triggerWave(x = this.pen.x, y = this.pen.y): void {
    this.waves.set([x, y, this.simTime, this.params.penRadius], this.nextWave * 4);
    this.nextWave = (this.nextWave + 1) % WAVE_COUNT;
  }

  /** Teleport a fraction of the agents around (ring) or onto (center) the pen for one step. */
  spawn(mode: SpawnMode): void {
    this.pendingSpawn = mode === 'ring' ? 1 : 2;
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
    f[62] = SPAWN_FRACTION;
    this.gpu.device.queue.writeBuffer(this.extBuf, 0, buf);
  }

  private writeParams(): void {
    const p = this.params;
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
    const p = this.params;
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
    const needField = followers > 0 || this.fieldArrows;
    if (needField) this.flow.writeUniform(this.flowInput());

    // The pen's stir push fades by itself once the pointer stops.
    this.pen.stirX *= STIR_DECAY;
    this.pen.stirY *= STIR_DECAY;

    const groupsX = Math.ceil(this.width / 8);
    const groupsY = Math.ceil(this.height / 8);
    const ran = new Array<boolean>(PASS_COUNT).fill(false);

    const enc = device.createCommandEncoder({ label: 'physarum step' });
    enc.clearBuffer(this.counter);
    enc.clearBuffer(this.flow.counterBuffer);

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
      })
      .catch(() => undefined)
      .finally(() => {
        this.stagingBusy = false;
      });
  }

  // ---- Test and debug support. Read-backs are for tests only, never in the frame loop. ----

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

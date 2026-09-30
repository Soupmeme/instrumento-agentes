// Classic Physarum on the GPU (SPEC 5.1, "reference GPU pipeline", WebGPU translation).
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
import type { PhysarumParams } from './params';
import commonWgsl from './common.wgsl?raw';
import initWgsl from './init.wgsl?raw';
import moveWgsl from './move.wgsl?raw';
import depositWgsl from './deposit.wgsl?raw';
import diffuseWgsl from './diffuse.wgsl?raw';
import displayWgsl from './display.wgsl?raw';

/** Agents allocated up front. `params.agentCount` of them are awake. 2M x 16 B = 32 MB. */
export const MAX_AGENTS = 2_000_000;
const AGENT_BYTES = 16; // vec2f pos, f32 heading, f32 progress
const PARAM_BYTES = 64;
const WORKGROUP = 256;
const MAX_GRID_SIDE = 1920;

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
}

// Timestamp slots: pass k uses queries 2k (begin) and 2k+1 (end).
const PASS_AGENT = 0;
const PASS_DEPOSIT = 1;
const PASS_DIFFUSE = 2;
const PASS_RENDER = 3;

export class Physarum {
  readonly params: PhysarumParams;
  /** Milliseconds per pass, from GPU timestamps (NaN when unsupported or not yet read). */
  readonly timings: PassTimings = { agent: NaN, deposit: NaN, diffuse: NaN, render: NaN };
  /** Set by the HUD: only read timings back while someone is looking at them. */
  wantTimings = false;
  /** While true the frame loop takes no simulation steps (Freeze, and the test harness). */
  paused = false;
  /** Steps taken since the page loaded (never reset, used by the soak monitor). */
  totalSteps = 0;

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
  private agentsBuf: GPUBuffer;
  private trail: GPUBuffer[] = [];
  private counter!: GPUBuffer;

  private initPipe: GPUComputePipeline;
  private movePipe: GPUComputePipeline;
  private depositPipe: GPUComputePipeline;
  private diffusePipe: GPUComputePipeline;
  private displayPipe: GPURenderPipeline;

  private initBG: GPUBindGroup;
  // One bind group per value of `cur`, because the buffers swap roles.
  private moveBG: GPUBindGroup[] = [];
  private depositBG: GPUBindGroup[] = [];
  private diffuseBG: GPUBindGroup[] = [];
  private displayBG: GPUBindGroup[] = [];

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

    this.paramsBuf = device.createBuffer({
      label: 'physarum params',
      size: PARAM_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.agentsBuf = device.createBuffer({
      label: 'physarum agents',
      size: MAX_AGENTS * AGENT_BYTES,
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
      this.querySet = device.createQuerySet({ type: 'timestamp', count: 8 });
      this.resolveBuf = device.createBuffer({
        size: 64,
        usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
      });
      this.stagingBuf = device.createBuffer({
        size: 64,
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
  get trailBuffer(): GPUBuffer {
    return this.trail[this.cur];
  }
  get counterBuffer(): GPUBuffer {
    return this.counter;
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
    this.cur = 0;

    const entry = (binding: number, buffer: GPUBuffer): GPUBindGroupEntry => ({ binding, resource: { buffer } });
    const params = entry(0, this.paramsBuf);
    this.moveBG = [];
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
      this.depositBG.push(
        device.createBindGroup({
          layout: this.depositPipe.getBindGroupLayout(0),
          entries: [params, entry(1, this.counter), entry(2, here)],
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
    const pass = enc.beginComputePass({ label: 'physarum init' });
    pass.setPipeline(this.initPipe);
    pass.setBindGroup(0, this.initBG);
    this.dispatch1D(pass, MAX_AGENTS);
    pass.end();
    device.queue.submit([enc.finish()]);
    this.cur = 0;
  }

  private writeParams(): void {
    const p = this.params;
    const buf = new ArrayBuffer(PARAM_BYTES);
    const u = new Uint32Array(buf);
    const f = new Float32Array(buf);
    u[0] = this.width;
    u[1] = this.height;
    u[2] = Math.max(0, Math.min(MAX_AGENTS, Math.floor(p.agentCount)));
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
    this.writeParams();
    const groupsX = Math.ceil(this.width / 8);
    const groupsY = Math.ceil(this.height / 8);

    const enc = device.createCommandEncoder({ label: 'physarum step' });
    enc.clearBuffer(this.counter);

    let pass = enc.beginComputePass({ label: 'agents', timestampWrites: this.stamps(PASS_AGENT) });
    pass.setPipeline(this.movePipe);
    pass.setBindGroup(0, this.moveBG[this.cur]);
    this.dispatch1D(pass, this.params.agentCount);
    pass.end();

    pass = enc.beginComputePass({ label: 'deposit', timestampWrites: this.stamps(PASS_DEPOSIT) });
    pass.setPipeline(this.depositPipe);
    pass.setBindGroup(0, this.depositBG[this.cur]);
    pass.dispatchWorkgroups(groupsX, groupsY);
    pass.end();

    pass = enc.beginComputePass({ label: 'diffuse', timestampWrites: this.stamps(PASS_DIFFUSE) });
    pass.setPipeline(this.diffusePipe);
    pass.setBindGroup(0, this.diffuseBG[this.cur]);
    pass.dispatchWorkgroups(groupsX, groupsY);
    pass.end();

    device.queue.submit([enc.finish()]);
    this.cur = 1 - this.cur; // the diffuse pass wrote the newest trail into the other buffer
    this.frame++;
    this.totalSteps++;
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

    // Timings are read back only while the HUD is open, once per step, never in the normal path.
    if (this.wantTimings && this.stepRanSinceResolve && this.querySet && !this.stagingBusy) {
      encoder.resolveQuerySet(this.querySet, 0, 8, this.resolveBuf!, 0);
      encoder.copyBufferToBuffer(this.resolveBuf!, 0, this.stagingBuf!, 0, 64);
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
        const ms = (k: number) => Number(t[2 * k + 1] - t[2 * k]) / 1e6;
        this.timings.agent = ms(PASS_AGENT);
        this.timings.deposit = ms(PASS_DEPOSIT);
        this.timings.diffuse = ms(PASS_DIFFUSE);
        this.timings.render = ms(PASS_RENDER);
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

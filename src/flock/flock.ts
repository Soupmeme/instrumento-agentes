// The flock layer: boids (steering agents that perceive their neighbours), the spatial grid that
// finds those neighbours, and the debug overlay. Owned by the Physarum world (physarum.ts),
// which decides when each pass runs inside its own command encoder, so all agent families share
// one frame and one trail.
//
// One flock step (four passes; see the header of each shader):
//   1. count    each boid adds itself to its grid cell's counter        (flock_grid.wgsl)
//   2. scan     prefix sum of the counts gives each cell's start        (flock_grid.wgsl)
//   3. scatter  each boid copies its state into its cell's slot          (flock_grid.wgsl)
//   4. flock    each boid reads the 3 x 3 cells around it, steers, moves (flock.wgsl)
// Boids are double buffered: pass 4 reads the state at the start of the step and writes the next
// one, so no boid ever sees a neighbour that has already moved.
//
// Like the followers, boids do not write the trail directly. They add themselves to their own
// per-pixel counter (`counterBuffer`); the world's deposit pass turns that into trail with the
// boid weight.

import type { Gpu } from '../gpu';
import type { PhysarumParams } from '../physarum/params';
import commonWgsl from '../physarum/common.wgsl?raw';
import steeringWgsl from '../steering/steering.wgsl?raw';
import flockCommonWgsl from './flock_common.wgsl?raw';
import flockInitWgsl from './flock_init.wgsl?raw';
import flockGridWgsl from './flock_grid.wgsl?raw';
import flockWgsl from './flock.wgsl?raw';
import debugWgsl from './flock_debug.wgsl?raw';
import { MAX_CELLS, cellCapFor, cosHalfFov, gridDims } from './flocking.ts';
import { TRAIL_SENSE_PX } from '../coupling/coupling.ts';

/** Boids allocated up front. `params.flockCount` of them are awake. 262144 x 16 B x 2 = 8 MB. */
export const MAX_BOIDS = 262_144;
const BOID_BYTES = 16; // vec4f: position xy (0..1), velocity zw (pixels per step)
const FLOCK_BYTES = 96;
const WORKGROUP = 256;

/** What the flock layer needs to know about the world each step. */
export interface FlockInput {
  params: PhysarumParams;
  gridWidth: number;
  gridHeight: number;
  frame: number;
  seed: number;
  pen: { x: number; y: number; active: boolean };
}

export class FlockLayer {
  private gpu: Gpu;
  private gridW = 1;
  private gridH = 1;
  private cellsX = 3;
  private cellsY = 3;
  /** Tests only: force the work guard's per-cell cap (undefined = the normal budget rule). */
  cellCapOverride: number | undefined;
  /** Index of the boid buffer that holds the newest state. */
  private cur = 0;

  private flockBuf: GPUBuffer;
  private debugBuf: GPUBuffer;
  private boids: GPUBuffer[];
  private cellCountBuf: GPUBuffer;
  private cellStartBuf: GPUBuffer;
  private rankBuf: GPUBuffer;
  private sortedBuf: GPUBuffer; // boid states ordered by grid cell
  private counterBuf!: GPUBuffer;

  private layout: GPUBindGroupLayout;
  private countPipe: GPUComputePipeline;
  private scanPipe: GPUComputePipeline;
  private scatterPipe: GPUComputePipeline;
  private flockPipe: GPUComputePipeline;
  private initPipe: GPUComputePipeline;
  private debugGridPipe: GPURenderPipeline;
  private debugBoidPipe: GPURenderPipeline;
  private debugBG: GPUBindGroup[] = [];
  /** One bind group per (boid buffer in use, trail buffer in use), because both pairs swap roles. Index: boidCur * 2 + trailCur. */
  private bg: GPUBindGroup[] = [];

  constructor(gpu: Gpu) {
    this.gpu = gpu;
    const { device } = gpu;
    const storage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;

    this.flockBuf = device.createBuffer({ label: 'flock uniforms', size: FLOCK_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.debugBuf = device.createBuffer({ label: 'flock debug uniforms', size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.boids = [0, 1].map((i) => device.createBuffer({ label: `boids ${i}`, size: MAX_BOIDS * BOID_BYTES, usage: storage }));
    this.cellCountBuf = device.createBuffer({ label: 'flock cell counts', size: MAX_CELLS * 4, usage: storage });
    this.cellStartBuf = device.createBuffer({ label: 'flock cell starts', size: MAX_CELLS * 4, usage: storage });
    this.rankBuf = device.createBuffer({ label: 'flock ranks', size: MAX_BOIDS * 4, usage: storage });
    this.sortedBuf = device.createBuffer({ label: 'flock sorted boids', size: MAX_BOIDS * BOID_BYTES, usage: storage });

    // One explicit layout for all four flock passes (a pass binds only what its shader uses).
    const entry = (binding: number, type: GPUBufferBindingType): GPUBindGroupLayoutEntry => ({
      binding,
      visibility: GPUShaderStage.COMPUTE,
      buffer: { type },
    });
    this.layout = device.createBindGroupLayout({
      label: 'flock layout',
      entries: [
        entry(0, 'uniform'),
        entry(1, 'storage'), // boids in
        entry(2, 'storage'), // boids out
        entry(3, 'storage'), // cell counts
        entry(4, 'storage'), // cell starts
        entry(5, 'storage'), // ranks
        entry(6, 'storage'), // boid states ordered by cell
        entry(7, 'storage'), // per-pixel counter
        entry(8, 'storage'), // the trail (trail -> boids coupling)
      ],
    });
    const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [this.layout] });
    const compute = (label: string, code: string, entryPoint: string) =>
      device.createComputePipeline({
        label,
        layout: pipelineLayout,
        compute: { module: device.createShaderModule({ label, code }), entryPoint },
      });
    const gridCode = commonWgsl + flockCommonWgsl + flockGridWgsl;
    this.countPipe = compute('flock count', gridCode, 'count');
    this.scanPipe = compute('flock scan', gridCode, 'scan');
    this.scatterPipe = compute('flock scatter', gridCode, 'scatter');
    this.flockPipe = compute('flock', commonWgsl + steeringWgsl + flockCommonWgsl + flockWgsl, 'main');
    this.initPipe = compute('flock init', commonWgsl + flockCommonWgsl + flockInitWgsl, 'main');

    // Debug overlay: grid lines and perception circles of boid 0, then every boid as a small quad.
    const debugModule = device.createShaderModule({ label: 'flock debug', code: commonWgsl + flockCommonWgsl + debugWgsl });
    const blend: GPUBlendState = {
      color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
    };
    const debugPipe = (vs: string, fs: string) =>
      device.createRenderPipeline({
        label: `flock debug ${vs}`,
        layout: 'auto',
        vertex: { module: debugModule, entryPoint: vs },
        fragment: { module: debugModule, entryPoint: fs, targets: [{ format: gpu.format, blend }] },
        primitive: { topology: 'triangle-list' },
      });
    this.debugGridPipe = debugPipe('vsGrid', 'fsGrid');
    this.debugBoidPipe = debugPipe('vsBoid', 'fsBoid');

    // Both boid buffers exist from the start, so the bind groups can be built once.
    // The grid-sized counter does not exist yet: resize() completes them.
  }

  get boidCount(): number {
    return MAX_BOIDS;
  }
  /** Boids' per-pixel counter (grid sized), read by the world's deposit pass. */
  get counterBuffer(): GPUBuffer {
    return this.counterBuf;
  }
  /** The buffer holding the newest boid state (x, y in 0..1, then velocity). */
  get boidBuffer(): GPUBuffer {
    return this.boids[this.cur];
  }
  get cellCountBuffer(): GPUBuffer {
    return this.cellCountBuf;
  }
  get cellStartBuffer(): GPUBuffer {
    return this.cellStartBuf;
  }
  /** Boid states ordered by grid cell (x, y, vx, vy per boid), as built by the last step. */
  get sortedBuffer(): GPUBuffer {
    return this.sortedBuf;
  }
  /** The grid used by the most recent step: cells per side. */
  get grid(): { cellsX: number; cellsY: number } {
    return { cellsX: this.cellsX, cellsY: this.cellsY };
  }

  /** Rebuild the grid-sized buffers for a new simulation grid. */
  resize(gridW: number, gridH: number, trail: readonly [GPUBuffer, GPUBuffer]): void {
    const { device } = this.gpu;
    this.counterBuf?.destroy();
    this.gridW = gridW;
    this.gridH = gridH;
    const storage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
    this.counterBuf = device.createBuffer({ label: 'boid counter', size: gridW * gridH * 4, usage: storage });

    const e = (binding: number, buffer: GPUBuffer): GPUBindGroupEntry => ({ binding, resource: { buffer } });
    this.bg = [0, 1, 2, 3].map((k) => {
      const c = k >> 1; // which boid buffer is the current one
      const t = k & 1; // which trail buffer is the newest
      return device.createBindGroup({
        label: `flock bind group ${c}/${t}`,
        layout: this.layout,
        entries: [
          e(0, this.flockBuf),
          e(1, this.boids[c]),
          e(2, this.boids[1 - c]),
          e(3, this.cellCountBuf),
          e(4, this.cellStartBuf),
          e(5, this.rankBuf),
          e(6, this.sortedBuf),
          e(7, this.counterBuf),
          e(8, trail[t]),
        ],
      });
    });
    this.debugBG = [0, 1].map((c) => [
      device.createBindGroup({ layout: this.debugGridPipe.getBindGroupLayout(0), entries: [e(0, this.flockBuf), e(1, this.boids[c]), e(2, this.debugBuf)] }),
      device.createBindGroup({ layout: this.debugBoidPipe.getBindGroupLayout(0), entries: [e(0, this.flockBuf), e(1, this.boids[c]), e(2, this.debugBuf)] }),
    ]).flat();
  }

  /** Scatter all boids (on the GPU): random places, random headings. */
  reset(seed: number, input: FlockInput): void {
    this.cur = 0;
    this.writeUniform({ ...input, seed });
    const enc = this.gpu.device.createCommandEncoder({ label: 'flock reset' });
    const pass = enc.beginComputePass({ label: 'flock init' });
    pass.setPipeline(this.initPipe);
    pass.setBindGroup(0, this.bg[0]); // boids[0] is binding 1, the one the init shader fills (the trail is not used)
    const groups = Math.ceil(MAX_BOIDS / WORKGROUP);
    const x = Math.min(groups, 65535);
    pass.dispatchWorkgroups(x, Math.ceil(groups / x));
    pass.end();
    this.gpu.device.queue.submit([enc.finish()]);
  }

  /** Write everything the flock passes need this step. */
  writeUniform(i: FlockInput): void {
    const p = i.params;
    const count = Math.max(0, Math.min(MAX_BOIDS, Math.floor(p.flockCount)));
    const { cellsX, cellsY } = gridDims(this.gridW, this.gridH, Math.max(p.flockSepRadius, p.flockNbrRadius));
    this.cellsX = cellsX;
    this.cellsY = cellsY;
    const buf = new ArrayBuffer(FLOCK_BYTES);
    const u = new Uint32Array(buf);
    const f = new Float32Array(buf);
    u[0] = this.gridW;
    u[1] = this.gridH;
    u[2] = cellsX;
    u[3] = cellsY;
    u[4] = count;
    u[5] = i.frame >>> 0;
    u[6] = i.seed >>> 0;
    u[7] = p.flockPenMode;
    f[8] = p.flockSpeed;
    f[9] = p.flockForce;
    f[10] = p.flockSepWeight;
    f[11] = p.flockAliWeight;
    f[12] = p.flockCohWeight;
    f[13] = p.flockSepRadius;
    f[14] = p.flockNbrRadius;
    f[15] = cosHalfFov(p.flockFov);
    f[16] = i.pen.x;
    f[17] = i.pen.y;
    f[18] = p.penRadius;
    f[19] = i.pen.active ? 1 : 0;
    f[20] = p.flockPenStrength;
    f[22] = p.trailToBoids;
    f[23] = TRAIL_SENSE_PX;
    u[21] = this.cellCapOverride ?? cellCapFor(count);
    this.gpu.device.queue.writeBuffer(this.flockBuf, 0, buf);
  }

  private dispatch1D(pass: GPUComputePassEncoder, threads: number): void {
    const groups = Math.ceil(Math.max(1, threads) / WORKGROUP);
    const x = Math.min(groups, 65535);
    pass.dispatchWorkgroups(x, Math.ceil(groups / x));
  }

  /**
   * Encode the flock step: grid (count, scan, scatter) then the boid pass. `trailCur` is the index
   * of the newest trail buffer (the boids sense it). `gridStamps` covers
   * the three grid passes together, `flockStamps` the boid pass.
   */
  encodeStep(
    enc: GPUCommandEncoder,
    count: number,
    trailCur: number,
    gridStamps?: { querySet: GPUQuerySet; begin: number; end: number },
    flockStamps?: GPUComputePassTimestampWrites,
  ): void {
    const bg = this.bg[this.cur * 2 + trailCur];
    enc.clearBuffer(this.cellCountBuf, 0, this.cellsX * this.cellsY * 4);

    let pass = enc.beginComputePass({
      label: 'flock count',
      timestampWrites: gridStamps && { querySet: gridStamps.querySet, beginningOfPassWriteIndex: gridStamps.begin },
    });
    pass.setPipeline(this.countPipe);
    pass.setBindGroup(0, bg);
    this.dispatch1D(pass, count);
    pass.end();

    pass = enc.beginComputePass({ label: 'flock scan' });
    pass.setPipeline(this.scanPipe);
    pass.setBindGroup(0, bg);
    pass.dispatchWorkgroups(1);
    pass.end();

    pass = enc.beginComputePass({
      label: 'flock scatter',
      timestampWrites: gridStamps && { querySet: gridStamps.querySet, endOfPassWriteIndex: gridStamps.end },
    });
    pass.setPipeline(this.scatterPipe);
    pass.setBindGroup(0, bg);
    this.dispatch1D(pass, count);
    pass.end();

    pass = enc.beginComputePass({ label: 'flock boids', timestampWrites: flockStamps });
    pass.setPipeline(this.flockPipe);
    pass.setBindGroup(0, bg);
    this.dispatch1D(pass, count);
    pass.end();

    this.cur = 1 - this.cur; // the boid pass wrote the next state into the other buffer
  }

  /**
   * Draw the debug overlay over whatever is already in `view`: the grid, the perception radii and
   * view cone of one selected boid, and every boid coloured by how the selected boid sees it.
   */
  renderDebug(encoder: GPUCommandEncoder, view: GPUTextureView, canvasW: number, canvasH: number, count: number): void {
    this.gpu.device.queue.writeBuffer(this.debugBuf, 0, new Float32Array([canvasW, canvasH, 0, 0]));
    const pass = encoder.beginRenderPass({
      label: 'flock debug',
      colorAttachments: [{ view, loadOp: 'load', storeOp: 'store' }],
    });
    // After a step `cur` names the newest buffer, which is the one the debug bind groups read.
    pass.setPipeline(this.debugGridPipe);
    pass.setBindGroup(0, this.debugBG[this.cur * 2]);
    pass.draw(3);
    pass.setPipeline(this.debugBoidPipe);
    pass.setBindGroup(0, this.debugBG[this.cur * 2 + 1]);
    pass.draw(6, Math.max(1, count));
    pass.end();
  }
}

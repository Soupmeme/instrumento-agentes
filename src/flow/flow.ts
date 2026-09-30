// The flow layer: the flow field (data), the flow followers (steering agents that read it) and
// the debug arrows. Owned by the Physarum world (physarum.ts), which decides when each pass runs
// inside its own command encoder, so all agent families share one frame and one trail.
//
// Followers do not write the trail directly. They add themselves to their own per-pixel counter
// (`counterBuffer`); the world's deposit pass turns that counter into trail with the follower
// weight. So Physarum agents and followers live in the same material and can see each other's
// marks, and each family's share of the picture is one live number.

import type { Gpu } from '../gpu';
import type { PhysarumParams } from '../physarum/params';
import commonWgsl from '../physarum/common.wgsl?raw';
import steeringWgsl from '../steering/steering.wgsl?raw';
import flowCommonWgsl from './flow_common.wgsl?raw';
import noiseWgsl from './noise.wgsl?raw';
import fieldWgsl from './field.wgsl?raw';
import fieldSampleWgsl from './field_sample.wgsl?raw';
import followersWgsl from './followers.wgsl?raw';
import followersInitWgsl from './followers_init.wgsl?raw';
import arrowsWgsl from './arrows.wgsl?raw';

/** Followers allocated up front. `params.followerCount` of them are awake. 1M x 16 B = 16 MB. */
export const MAX_FOLLOWERS = 1_000_000;
const VEHICLE_BYTES = 16; // vec4f: position xy (0..1), velocity zw (pixels per step)
/** Field cell size in simulation pixels. Coarse on purpose: the field is smooth data. */
export const FIELD_CELL_PX = 16;
const FLOW_BYTES = 128;
const WORKGROUP = 256;

/** What the flow layer needs to know about the world each step. */
export interface FlowInput {
  params: PhysarumParams;
  gridWidth: number;
  gridHeight: number;
  frame: number;
  seed: number;
  /** Simulation seconds. */
  time: number;
  pen: { x: number; y: number; active: boolean; stirX: number; stirY: number };
}

export class FlowLayer {
  private gpu: Gpu;
  private gridW = 1;
  private gridH = 1;
  private fw = 1;
  private fh = 1;

  private flowBuf: GPUBuffer;
  private arrowBuf: GPUBuffer;
  private fieldBuf!: GPUBuffer;
  private counterBuf!: GPUBuffer;
  private vehicleBuf: GPUBuffer;

  private fieldPipe: GPUComputePipeline;
  private followPipe: GPUComputePipeline;
  private initPipe: GPUComputePipeline;
  private arrowPipe: GPURenderPipeline;

  private fieldBG!: GPUBindGroup;
  private followBG!: GPUBindGroup;
  private initBG: GPUBindGroup;
  private arrowBG!: GPUBindGroup;

  constructor(gpu: Gpu) {
    this.gpu = gpu;
    const { device } = gpu;

    this.flowBuf = device.createBuffer({
      label: 'flow uniforms',
      size: FLOW_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.arrowBuf = device.createBuffer({
      label: 'arrow uniforms',
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.vehicleBuf = device.createBuffer({
      label: 'follower vehicles',
      size: MAX_FOLLOWERS * VEHICLE_BYTES,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });

    const compute = (label: string, code: string) =>
      device.createComputePipeline({
        label,
        layout: 'auto',
        compute: { module: device.createShaderModule({ label, code }), entryPoint: 'main' },
      });
    this.fieldPipe = compute('flow field', commonWgsl + noiseWgsl + flowCommonWgsl + fieldWgsl);
    this.followPipe = compute('flow followers', commonWgsl + steeringWgsl + flowCommonWgsl + fieldSampleWgsl + followersWgsl);
    this.initPipe = compute('flow followers init', commonWgsl + flowCommonWgsl + followersInitWgsl);

    const arrowModule = device.createShaderModule({ label: 'flow arrows', code: arrowsWgsl });
    this.arrowPipe = device.createRenderPipeline({
      label: 'flow arrows',
      layout: 'auto',
      vertex: { module: arrowModule, entryPoint: 'vs' },
      fragment: {
        module: arrowModule,
        entryPoint: 'fs',
        targets: [
          {
            format: gpu.format,
            blend: {
              color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
              alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            },
          },
        ],
      },
      primitive: { topology: 'triangle-list' },
    });

    this.initBG = device.createBindGroup({
      layout: this.initPipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.flowBuf } },
        { binding: 1, resource: { buffer: this.vehicleBuf } },
      ],
    });
  }

  get fieldWidth(): number {
    return this.fw;
  }
  get fieldHeight(): number {
    return this.fh;
  }
  /** The flow field: fieldWidth x fieldHeight vectors as x, y pairs of f32. */
  get fieldBuffer(): GPUBuffer {
    return this.fieldBuf;
  }
  /** Followers' per-pixel counter (grid sized), read by the world's deposit pass. */
  get counterBuffer(): GPUBuffer {
    return this.counterBuf;
  }
  get vehicleBuffer(): GPUBuffer {
    return this.vehicleBuf;
  }

  /** Rebuild the grid-sized buffers for a new simulation grid. */
  resize(gridW: number, gridH: number): void {
    const { device } = this.gpu;
    this.fieldBuf?.destroy();
    this.counterBuf?.destroy();
    this.gridW = gridW;
    this.gridH = gridH;
    this.fw = Math.max(4, Math.ceil(gridW / FIELD_CELL_PX));
    this.fh = Math.max(4, Math.ceil(gridH / FIELD_CELL_PX));
    const storage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
    this.fieldBuf = device.createBuffer({ label: 'flow field', size: this.fw * this.fh * 8, usage: storage });
    this.counterBuf = device.createBuffer({ label: 'follower counter', size: gridW * gridH * 4, usage: storage });

    const e = (binding: number, buffer: GPUBuffer): GPUBindGroupEntry => ({ binding, resource: { buffer } });
    this.fieldBG = device.createBindGroup({
      layout: this.fieldPipe.getBindGroupLayout(0),
      entries: [e(0, this.flowBuf), e(1, this.fieldBuf)],
    });
    this.followBG = device.createBindGroup({
      layout: this.followPipe.getBindGroupLayout(0),
      entries: [e(0, this.flowBuf), e(1, this.vehicleBuf), e(2, this.fieldBuf), e(3, this.counterBuf)],
    });
    this.arrowBG = device.createBindGroup({
      layout: this.arrowPipe.getBindGroupLayout(0),
      entries: [e(0, this.arrowBuf), e(1, this.fieldBuf)],
    });
  }

  /** Scatter all followers at rest (on the GPU). */
  reset(seed: number, input: FlowInput): void {
    this.writeUniform({ ...input, seed });
    const enc = this.gpu.device.createCommandEncoder({ label: 'follower reset' });
    const pass = enc.beginComputePass({ label: 'follower init' });
    pass.setPipeline(this.initPipe);
    pass.setBindGroup(0, this.initBG);
    const groups = Math.ceil(MAX_FOLLOWERS / WORKGROUP);
    const x = Math.min(groups, 65535);
    pass.dispatchWorkgroups(x, Math.ceil(groups / x));
    pass.end();
    this.gpu.device.queue.submit([enc.finish()]);
  }

  /** Write everything the field and follower passes need this step. */
  writeUniform(i: FlowInput): void {
    const p = i.params;
    const buf = new ArrayBuffer(FLOW_BYTES);
    const u = new Uint32Array(buf);
    const f = new Float32Array(buf);
    u[0] = this.gridW;
    u[1] = this.gridH;
    u[2] = this.fw;
    u[3] = this.fh;
    u[4] = p.fieldKind;
    u[5] = Math.max(0, Math.round(p.fieldQuantSteps));
    u[6] = Math.max(0, Math.min(MAX_FOLLOWERS, Math.floor(p.followerCount)));
    u[7] = i.frame >>> 0;
    u[8] = i.seed >>> 0;
    u[9] = p.penFieldMode;
    f[12] = p.fieldFrequency;
    f[13] = p.fieldEvolution;
    f[14] = p.fieldStrength;
    f[15] = i.time;
    f[16] = i.pen.x;
    f[17] = i.pen.y;
    f[18] = p.penRadius;
    f[19] = i.pen.active ? 1 : 0;
    f[20] = p.penFieldStrength;
    f[21] = i.pen.stirX;
    f[22] = i.pen.stirY;
    f[23] = p.followerSpeed;
    f[24] = p.followerForce;
    f[25] = p.followerLookahead;
    f[26] = p.followerRespawn;
    this.gpu.device.queue.writeBuffer(this.flowBuf, 0, buf);
  }

  /** Encode the field pass: one thread per cell, rebuilds the whole field. */
  encodeField(enc: GPUCommandEncoder, timestampWrites?: GPUComputePassTimestampWrites): void {
    const pass = enc.beginComputePass({ label: 'flow field', timestampWrites });
    pass.setPipeline(this.fieldPipe);
    pass.setBindGroup(0, this.fieldBG);
    pass.dispatchWorkgroups(Math.ceil(this.fw / 8), Math.ceil(this.fh / 8));
    pass.end();
  }

  /** Encode the follower pass: one thread per awake follower. */
  encodeFollowers(enc: GPUCommandEncoder, count: number, timestampWrites?: GPUComputePassTimestampWrites): void {
    const pass = enc.beginComputePass({ label: 'flow followers', timestampWrites });
    pass.setPipeline(this.followPipe);
    pass.setBindGroup(0, this.followBG);
    const groups = Math.ceil(Math.max(1, count) / WORKGROUP);
    const x = Math.min(groups, 65535);
    pass.dispatchWorkgroups(x, Math.ceil(groups / x));
    pass.end();
  }

  /** Draw the field as arrows over whatever is already in `view` (debug overlay). */
  renderArrows(encoder: GPUCommandEncoder, view: GPUTextureView, canvasW: number, canvasH: number): void {
    this.gpu.device.queue.writeBuffer(this.arrowBuf, 0, new Float32Array([canvasW, canvasH, this.fw, this.fh]));
    const pass = encoder.beginRenderPass({
      label: 'flow arrows',
      colorAttachments: [{ view, loadOp: 'load', storeOp: 'store' }],
    });
    pass.setPipeline(this.arrowPipe);
    pass.setBindGroup(0, this.arrowBG);
    pass.draw(9, this.fw * this.fh);
    pass.end();
  }
}

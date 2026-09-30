// CPU reference of the flow field and of the rule that consults it (SPEC 5.2). This is the
// readable definition that field.wgsl and followers.wgsl implement; unit tests and the
// in-browser GPU self-test compare against it. Small N only.
//
// The unit wants two things kept apart, so the code keeps them apart:
//   THE FIELD    one direction per cell, built from noise (plus the pen's edits). It is data.
//   THE RULE     a steering behaviour that reads the field: desired = field * maxSpeed,
//                steer = limit(desired - velocity, maxForce).
//
// What a follower perceives: the field vector at ONE place, its own position, or (Reynolds) the
// place it will reach in `lookahead` steps if it keeps its velocity. The field is interpolated
// between cells, so it senses a smooth direction, not stepped cells. It does not see other
// agents, the trail, or anything else.

import { limitLength, steerToward, type Vec2 } from '../steering/steering.ts';

const TAU = Math.PI * 2;

// ---------------------------------------------------------------- 3D Perlin noise

const u32 = (n: number) => n >>> 0;
const mul = (a: number, b: number) => Math.imul(a, b) >>> 0;

/** Integer hash of a lattice point. Same operations, in the same order, as hash3 in noise.wgsl. */
export function hash3(ix: number, iy: number, iz: number): number {
  let x = u32(mul(u32(ix), 1664525) + 1013904223);
  let y = u32(mul(u32(iy), 1664525) + 1013904223);
  let z = u32(mul(u32(iz), 1664525) + 1013904223);
  x = u32(x + mul(y, z));
  y = u32(y + mul(z, x));
  z = u32(z + mul(x, y));
  x = u32(x ^ (x >>> 16));
  y = u32(y ^ (y >>> 16));
  z = u32(z ^ (z >>> 16));
  x = u32(x + mul(y, z));
  y = u32(y + mul(z, x));
  z = u32(z + mul(x, y));
  return x;
}

const GRADS: readonly (readonly [number, number, number])[] = [
  [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
  [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
  [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1],
];

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Classic Perlin gradient noise in 3 dimensions, roughly in [-1, 1]. */
export function noise3(x: number, y: number, z: number): number {
  const fx = Math.floor(x);
  const fy = Math.floor(y);
  const fz = Math.floor(z);
  const dx = x - fx;
  const dy = y - fy;
  const dz = z - fz;
  const corner = (ox: number, oy: number, oz: number) => {
    const g = GRADS[hash3(fx + ox, fy + oy, fz + oz) % 12];
    return g[0] * (dx - ox) + g[1] * (dy - oy) + g[2] * (dz - oz);
  };
  const u = fade(dx);
  const v = fade(dy);
  const w = fade(dz);
  return lerp(
    lerp(lerp(corner(0, 0, 0), corner(1, 0, 0), u), lerp(corner(0, 1, 0), corner(1, 1, 0), u), v),
    lerp(lerp(corner(0, 0, 1), corner(1, 0, 1), u), lerp(corner(0, 1, 1), corner(1, 1, 1), u), v),
    w,
  );
}

// ---------------------------------------------------------------- the field

export const KIND_NOISE_ANGLE = 0; // angle = noise mapped to 0..4pi (Nature of Code)
export const KIND_CURL = 1; // direction = 90 degree turn of the noise gradient (no sinks)

export const PEN_NONE = 0;
export const PEN_SWIRL = 1;
export const PEN_ATTRACT = 2;
export const PEN_REPEL = 3;

export interface FieldConfig {
  kind: number;
  /** Noise features per screen height. */
  frequency: number;
  /** How fast the field drifts through the noise's third dimension, per second. */
  evolution: number;
  /** Length of every field vector (0..1). Desired speed is this times maxSpeed. */
  strength: number;
  /** 0 = smooth angles, n = angles snapped to multiples of 2pi/n. */
  quantSteps: number;
  /** Simulation seconds. */
  time: number;
  /** World width / height, so noise is not stretched. */
  aspect: number;
  penX: number;
  penY: number;
  /** Pen radius in screen-height units. */
  penSigma: number;
  penActive: boolean;
  penMode: number;
  /** How strongly the pen's edit replaces the noise at the pen (0..1). */
  penStrength: number;
  stirX: number;
  stirY: number;
}

const CURL_EPS = 0.01;

/** Snap an angle to the nearest multiple of 2pi/steps (steps 0 leaves it alone). */
export function quantize(angle: number, steps: number): number {
  if (steps <= 0) return angle;
  const q = TAU / steps;
  return Math.round(angle / q) * q;
}

function safeNormalize(v: Vec2, fallback: Vec2): Vec2 {
  const l = Math.hypot(v[0], v[1]);
  return l < 1e-5 ? fallback : [v[0] / l, v[1] / l];
}

/** The field vector at normalised world position (nx, ny) in [0, 1). Length = strength. */
export function fieldVector(c: FieldConfig, nx: number, ny: number): Vec2 {
  const px = nx * c.aspect * c.frequency;
  const py = ny * c.frequency;
  const z = c.time * c.evolution;

  let angle: number;
  if (c.kind === KIND_CURL) {
    const dpsiDy = noise3(px, py + CURL_EPS, z) - noise3(px, py - CURL_EPS, z);
    const dpsiDx = noise3(px + CURL_EPS, py, z) - noise3(px - CURL_EPS, py, z);
    const d = safeNormalize([dpsiDy, -dpsiDx], [1, 0]);
    angle = Math.atan2(d[1], d[0]);
  } else {
    const n = Math.min(1, Math.max(-1, noise3(px, py, z)));
    angle = (0.5 + 0.5 * n) * 2 * TAU; // 0..4pi: counters noise's habit of hugging the middle
  }
  angle = quantize(angle, c.quantSteps);
  let dir: Vec2 = [Math.cos(angle), Math.sin(angle)];

  // Pen edits: near the pen the noise direction is blended toward the edit direction.
  const toPen: Vec2 = [(nx - c.penX) * c.aspect, ny - c.penY];
  const d = Math.hypot(toPen[0], toPen[1]);
  const t = c.penActive ? Math.exp(-(d * d) / (c.penSigma * c.penSigma)) : 0;
  if (c.penMode !== PEN_NONE && t > 0) {
    let edit: Vec2 = dir;
    if (c.penMode === PEN_SWIRL) edit = safeNormalize([-toPen[1], toPen[0]], dir);
    else if (c.penMode === PEN_ATTRACT) edit = safeNormalize([-toPen[0], -toPen[1]], dir);
    else if (c.penMode === PEN_REPEL) edit = safeNormalize(toPen, dir);
    const w = Math.min(1, Math.max(0, t * c.penStrength));
    dir = safeNormalize([dir[0] + (edit[0] - dir[0]) * w, dir[1] + (edit[1] - dir[1]) * w], edit);
  }
  // Stir: the drag direction bends the field toward it, in proportion to the drag strength.
  const stirLen = Math.hypot(c.stirX, c.stirY);
  if (stirLen > 0.001 && t > 0) {
    const s: Vec2 = [c.stirX / stirLen, c.stirY / stirLen];
    const w = Math.min(1, Math.max(0, t * stirLen));
    dir = safeNormalize([dir[0] + (s[0] - dir[0]) * w, dir[1] + (s[1] - dir[1]) * w], s);
  }
  return [dir[0] * c.strength, dir[1] * c.strength];
}

// ---------------------------------------------------------------- consulting the field

const wrap01 = (v: number) => v - Math.floor(v);

/**
 * The field vector at normalised position (nx, ny), interpolated between the four nearest
 * cells (vector interpolation, so there is no angle wrap-around problem). `field` holds
 * fw * fh vectors as x, y pairs. The world wraps.
 */
export function sampleField(field: ArrayLike<number>, fw: number, fh: number, nx: number, ny: number): Vec2 {
  const gx = wrap01(nx) * fw - 0.5;
  const gy = wrap01(ny) * fh - 0.5;
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const fx = gx - x0;
  const fy = gy - y0;
  const cell = (x: number, y: number): Vec2 => {
    const i = (((y % fh) + fh) % fh) * fw + (((x % fw) + fw) % fw);
    return [field[2 * i], field[2 * i + 1]];
  };
  const a = cell(x0, y0);
  const b = cell(x0 + 1, y0);
  const c = cell(x0, y0 + 1);
  const d = cell(x0 + 1, y0 + 1);
  const top: Vec2 = [lerp(a[0], b[0], fx), lerp(a[1], b[1], fx)];
  const bottom: Vec2 = [lerp(c[0], d[0], fx), lerp(c[1], d[1], fx)];
  return [lerp(top[0], bottom[0], fy), lerp(top[1], bottom[1], fy)];
}

export interface FollowerConfig {
  /** World size in simulation pixels. */
  width: number;
  height: number;
  fieldW: number;
  fieldH: number;
  maxSpeed: number;
  maxForce: number;
  /** Steps ahead at which the field is sampled (0 = at the agent). */
  lookahead: number;
}

/** The rule that consults the field: desired = field at the (predicted) place * maxSpeed. */
export function followFieldDesired(field: ArrayLike<number>, pos: Vec2, vel: Vec2, c: FollowerConfig): Vec2 {
  const ahead: Vec2 = [pos[0] + vel[0] * c.lookahead, pos[1] + vel[1] * c.lookahead];
  const f = sampleField(field, c.fieldW, c.fieldH, ahead[0] / c.width, ahead[1] / c.height);
  return [f[0] * c.maxSpeed, f[1] * c.maxSpeed];
}

/** One follower step: consult the field, steer, cap the speed, move, wrap. */
export function stepFollower(field: ArrayLike<number>, pos: Vec2, vel: Vec2, c: FollowerConfig): { pos: Vec2; vel: Vec2 } {
  const desired = followFieldDesired(field, pos, vel, c);
  const force = steerToward(desired, vel, c.maxForce);
  const v = limitLength([vel[0] + force[0], vel[1] + force[1]], c.maxSpeed);
  const wrap = (a: number, size: number) => ((a % size) + size) % size;
  return { pos: [wrap(pos[0] + v[0], c.width), wrap(pos[1] + v[1], c.height)], vel: v };
}

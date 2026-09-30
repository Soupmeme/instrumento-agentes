// CPU reference of the extended ("36 Points") agent rule, SPEC 5.1. This is the readable
// definition that move_extended.wgsl implements; unit tests and the in-browser GPU self-test
// compare against it. Small N only. The waves, stir and inertia paths are not in this
// reference (they are covered by separate checks, see selftest.ts).
//
// What one agent perceives, in the extended mode:
//   - the trail under itself (shifted a little by the preset), which sets S in (0, 1];
//   - then, at a distance that itself depends on S, the trail at three points ahead.
// S is the agent's "how crowded is it here" feeling. Every behaviour parameter is
// A + B * S^C, so agents in dense trail look farther or nearer, turn harder or softer, and
// move faster or slower than agents in empty space.

import { wrap, type AgentState } from './reference.ts';

/** exp(-d^2 / sigma^2): 1 at the pen, falling to 0. d and sigma in screen-height units. */
export function penMix(distance: number, sigma: number, active = true): number {
  if (!active) return 0;
  return Math.exp(-(distance * distance) / (sigma * sigma));
}

/** Linear blend of two preset vectors (used both for background/pen and for transitions). */
export function mixVectors(a: ArrayLike<number>, b: ArrayLike<number>, t: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < a.length; i++) out.push(a[i] + (b[i] - a[i]) * t);
  return out;
}

/** Eased progress 0..1 for preset transitions (smoothstep: no jump at either end). */
export function ease(progress: number): number {
  const p = Math.min(1, Math.max(0, progress));
  return p * p * (3 - 2 * p);
}

export interface ExtendedValues {
  sensorDistance: number;
  sensorAngle: number;
  rotationAngle: number;
  moveDistance: number;
  bias1: number;
  bias2: number;
  scale: number;
}

/**
 * The A + B * S^C parameters for an agent whose sensed value is S, given a 15-vector.
 * Pass the already-blended vector (background mixed with pen).
 */
export function extendedValues(v: ArrayLike<number>, S: number, pixelScale: number): ExtendedValues {
  return {
    sensorDistance: v[0] + v[2] * Math.pow(S, v[1]) * pixelScale,
    sensorAngle: v[3] + v[5] * Math.pow(S, v[4]),
    rotationAngle: v[6] + v[8] * Math.pow(S, v[7]),
    moveDistance: v[9] + v[11] * Math.pow(S, v[10]) * pixelScale,
    bias1: v[12],
    bias2: v[13],
    scale: v[14],
  };
}

export interface ExtendedContext {
  width: number;
  height: number;
  pixelScale: number;
  /** Preset vectors and the pen weight for this agent (0 = background, 1 = pen preset). */
  background: ArrayLike<number>;
  pen: ArrayLike<number>;
  penWeight: number;
}

const clampS = (x: number) => Math.min(1, Math.max(1e-9, x));

/**
 * One step without waves, stir or inertia: sense S, derive the four parameters, sense the
 * three points, turn, move. `coin` decides the random turn (middle lowest).
 */
export function stepAgentExtended(
  a: AgentState,
  trail: (ix: number, iy: number) => number,
  c: ExtendedContext,
  coin: boolean,
): AgentState & { S: number; values: ExtendedValues } {
  const v = mixVectors(c.background, c.pen, c.penWeight);
  const cell = (x: number, y: number) => trail(wrap(Math.floor(x), c.width), wrap(Math.floor(y), c.height));

  const dir = [Math.cos(a.heading), Math.sin(a.heading)];
  const S = clampS(cell(a.x + v[13] * dir[0], a.y + v[13] * dir[1] + v[12]) * v[14]);
  const values = extendedValues(v, S, c.pixelScale);

  const read = (angle: number) =>
    cell(a.x + Math.cos(a.heading + angle) * values.sensorDistance, a.y + Math.sin(a.heading + angle) * values.sensorDistance);
  const left = read(-values.sensorAngle);
  const middle = read(0);
  const right = read(values.sensorAngle);

  let heading = a.heading;
  if (middle > left && middle > right) {
    // straight ahead wins
  } else if (middle < left && middle < right) {
    heading += coin ? values.rotationAngle : -values.rotationAngle;
  } else if (right < left) {
    heading -= values.rotationAngle;
  } else if (left < right) {
    heading += values.rotationAngle;
  }
  heading = wrap(heading, Math.PI * 2);

  return {
    x: wrap(a.x + Math.cos(heading) * values.moveDistance, c.width),
    y: wrap(a.y + Math.sin(heading) * values.moveDistance, c.height),
    heading,
    S,
    values,
  };
}

/** Distance scale of the presets: 250 at the reference 1280x736 grid, proportional to sqrt(area). */
export function pixelScaleFor(width: number, height: number): number {
  return 250 * Math.sqrt((width * height) / (1280 * 736));
}

/** Reference agents per pixel (Bleuje's high quality: 512*512*50 agents on 1920x1088). */
export const REFERENCE_DENSITY = (512 * 512 * 50) / (1920 * 1088);

/**
 * Deposit is scaled so the trail has the same statistics as at the reference agent density.
 * Without it, fewer agents would give a weaker trail and the presets, which were tuned on
 * S = trail * SF, would behave differently. 1 in classic mode.
 */
export function countScaleFor(agentCount: number, width: number, height: number): number {
  return REFERENCE_DENSITY / (agentCount / (width * height));
}

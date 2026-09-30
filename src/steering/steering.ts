// CPU twin of steering.wgsl: the readable definition of the steering behaviours, used by the
// unit tests and the GPU self-test. Small N only, never used to drive the picture.
//
// The core rule (Reynolds 1999, Nature of Code chapter 5):
//     steer = limit(desired - velocity, maxForce)
// A behaviour is only a rule for choosing `desired`.

export type Vec2 = readonly [number, number];

export const length = (v: Vec2): number => Math.hypot(v[0], v[1]);

/** Shorten v to at most maxLen, keeping its direction. */
export function limitLength(v: Vec2, maxLen: number): Vec2 {
  const l = length(v);
  return l > maxLen && l > 0 ? [(v[0] * maxLen) / l, (v[1] * maxLen) / l] : v;
}

/** v with length exactly len (a zero vector stays zero). */
export function withLength(v: Vec2, len: number): Vec2 {
  const l = length(v);
  return l === 0 ? [0, 0] : [(v[0] * len) / l, (v[1] * len) / l];
}

/** The steering force: what to add to the velocity, given what the agent wants. */
export function steerToward(desired: Vec2, velocity: Vec2, maxForce: number): Vec2 {
  return limitLength([desired[0] - velocity[0], desired[1] - velocity[1]], maxForce);
}

/** Shortest offset from a to b on a world that wraps at `size` on both axes. */
export function wrappedOffset(a: Vec2, b: Vec2, size: Vec2): Vec2 {
  const d = [b[0] - a[0], b[1] - a[1]];
  // WGSL round() rounds halves to even, Math.round rounds them up. Only matters at exactly
  // half the world, where either shortest path is as good as the other.
  return [d[0] - size[0] * Math.round(d[0] / size[0]), d[1] - size[1] * Math.round(d[1] / size[1])];
}

/** Seek: run straight at the target at full speed. */
export const seekDesired = (offsetToTarget: Vec2, maxSpeed: number): Vec2 => withLength(offsetToTarget, maxSpeed);

/** Flee: the opposite of seek. */
export function fleeDesired(offsetToTarget: Vec2, maxSpeed: number): Vec2 {
  const d = withLength(offsetToTarget, maxSpeed);
  return [-d[0], -d[1]];
}

/** Arrive: like seek, but inside slowRadius the desired speed falls linearly to zero. */
export function arriveDesired(offsetToTarget: Vec2, maxSpeed: number, slowRadius: number): Vec2 {
  const d = length(offsetToTarget);
  return withLength(offsetToTarget, d < slowRadius ? (maxSpeed * d) / slowRadius : maxSpeed);
}

/**
 * One vehicle step with a given desired velocity: apply the steering force, cap the speed,
 * move. The same three lines the Nature of Code uses for every behaviour.
 */
export function stepVehicle(pos: Vec2, vel: Vec2, desired: Vec2, maxSpeed: number, maxForce: number): { pos: Vec2; vel: Vec2 } {
  const force = steerToward(desired, vel, maxForce);
  const v = limitLength([vel[0] + force[0], vel[1] + force[1]], maxSpeed);
  return { pos: [pos[0] + v[0], pos[1] + v[1]], vel: v };
}

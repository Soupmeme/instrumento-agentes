// CPU reference of one classic Physarum agent step. This is the readable definition of the
// rule that move.wgsl implements; the unit tests and the in-browser GPU self-test compare
// against it. It is only for small N (tests), never used to drive the picture.
//
// What one agent perceives: the trail value at three points at distance SD from itself, one
// straight ahead and two rotated by +SA and -SA. It ignores everything else (other agents,
// the trail anywhere else). Limits: it senses one pixel per sensor (nearest pixel, no
// interpolation), and it cannot turn by more than RA per step.

export interface AgentState {
  /** Position in simulation pixels, in [0, width) x [0, height). */
  x: number;
  y: number;
  /** Heading in radians. */
  heading: number;
}

export interface StepParams {
  width: number;
  height: number;
  sensorDistance: number;
  sensorAngle: number;
  rotationAngle: number;
  moveDistance: number;
}

/** Wrap a pixel coordinate into [0, size), also for negative values (the world is a torus). */
export function wrap(v: number, size: number): number {
  return ((v % size) + size) % size;
}

/** Trail cell (ix, iy) that a sensor at `angle` reads for an agent at (x, y). */
export function sensorCell(a: AgentState, angle: number, p: StepParams): [number, number] {
  const sx = a.x + Math.cos(angle) * p.sensorDistance;
  const sy = a.y + Math.sin(angle) * p.sensorDistance;
  return [wrap(Math.floor(sx), p.width), wrap(Math.floor(sy), p.height)];
}

/**
 * The classic turning rule (SPEC 5.1). f, l, r are the trail values ahead, on the +SA side
 * ("left") and on the -SA side ("right"). `coin` decides the random turn when the middle
 * sensor is lower than both sides. Returns the change of heading in radians.
 */
export function turnDelta(f: number, l: number, r: number, ra: number, coin: boolean): number {
  if (f > l && f > r) return 0; // middle strictly highest: keep going straight
  if (f < l && f < r) return coin ? ra : -ra; // middle lowest: pick a side at random
  if (l > r) return ra; // turn toward the higher side
  if (r > l) return -ra;
  return 0; // all equal (for example on empty ground): no preference
}

/** One full step: sense, turn, move. The deposit happens afterwards, in the trail passes. */
export function stepAgent(
  a: AgentState,
  trail: (ix: number, iy: number) => number,
  p: StepParams,
  coin: boolean,
): AgentState {
  const read = (angle: number) => {
    const [ix, iy] = sensorCell(a, angle, p);
    return trail(ix, iy);
  };
  const f = read(a.heading);
  const l = read(a.heading + p.sensorAngle);
  const r = read(a.heading - p.sensorAngle);

  const TAU = Math.PI * 2;
  const heading = wrap(a.heading + turnDelta(f, l, r, p.rotationAngle, coin), TAU);
  return {
    x: wrap(a.x + Math.cos(heading) * p.moveDistance, p.width),
    y: wrap(a.y + Math.sin(heading) * p.moveDistance, p.height),
    heading,
  };
}

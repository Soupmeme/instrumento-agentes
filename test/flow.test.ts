// CPU-only tests of the steering library and the flow field reference. They do NOT test the
// GPU shaders; the in-browser self-test compares those against these references
// (src/physarum/selftest.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  limitLength, withLength, steerToward, wrappedOffset, seekDesired, fleeDesired, arriveDesired, stepVehicle, length,
  type Vec2,
} from '../src/steering/steering.ts';
import {
  hash3, noise3, fieldVector, quantize, sampleField, followFieldDesired, stepFollower,
  KIND_NOISE_ANGLE, KIND_CURL, PEN_NONE, PEN_SWIRL, PEN_ATTRACT, PEN_REPEL, type FieldConfig, type FollowerConfig,
} from '../src/flow/flowfield.ts';

const near = (a: number, b: number, eps = 1e-9, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} ${a} vs ${b}`);
const nearVec = (a: Vec2, b: Vec2, eps = 1e-9) => {
  near(a[0], b[0], eps, 'x');
  near(a[1], b[1], eps, 'y');
};

// ---------------------------------------------------------------- steering

test('limitLength shortens long vectors, keeps direction, leaves short ones alone', () => {
  nearVec(limitLength([3, 4], 2.5), [1.5, 2]);
  nearVec(limitLength([1, 1], 5), [1, 1]);
  nearVec(limitLength([0, 0], 1), [0, 0]);
});

test('withLength sets the length exactly; a zero vector stays zero', () => {
  nearVec(withLength([3, 4], 10), [6, 8]);
  nearVec(withLength([0, 0], 10), [0, 0]);
});

test('[FO-10] steer = limit(desired - velocity, maxForce)', () => {
  // small difference: the force IS the difference
  nearVec(steerToward([1, 0], [0.9, 0], 0.5), [0.1, 0]);
  // large difference: capped at maxForce, in the direction of (desired - velocity)
  const f = steerToward([0, 10], [10, 0], 0.5);
  near(length(f), 0.5);
  nearVec(f, [-0.5 / Math.SQRT2, 0.5 / Math.SQRT2]);
  // already at the desired velocity: no force
  nearVec(steerToward([2, 3], [2, 3], 1), [0, 0]);
});

test('the force depends on the current velocity, not only on the desire', () => {
  // Adding the desire straight to the acceleration would give (0, 1) both times.
  const a = steerToward([0, 1], [0, 0], 10);
  const b = steerToward([0, 1], [1, 0], 10);
  nearVec(a, [0, 1]);
  nearVec(b, [-1, 1]);
});

test('an agent cannot turn instantly: maxForce limits how fast the heading changes', () => {
  let pos: Vec2 = [0, 0];
  let vel: Vec2 = [2, 0]; // going east at full speed
  const desired: Vec2 = [0, 2]; // wants to go north
  const step = stepVehicle(pos, vel, desired, 2, 0.1);
  const heading1 = Math.atan2(step.vel[1], step.vel[0]);
  assert.ok(heading1 > 0 && heading1 < 0.1, `turned a little: ${heading1}`);
  for (let i = 0; i < 200; i++) {
    const s = stepVehicle(pos, vel, desired, 2, 0.1);
    pos = s.pos;
    vel = s.vel;
  }
  assert.ok(Math.abs(Math.atan2(vel[1], vel[0]) - Math.PI / 2) < 1e-6, 'ends up heading north');
  assert.ok(length(vel) <= 2 + 1e-9, 'never exceeds maxSpeed');
});

test('[FO-10] speed is capped even when the steering force would exceed it', () => {
  const s = stepVehicle([0, 0], [1.9, 0], [100, 0], 2, 5);
  near(length(s.vel), 2);
});

test('seek, flee and arrive choose the desired velocity', () => {
  nearVec(seekDesired([3, 4], 10), [6, 8]);
  nearVec(fleeDesired([3, 4], 10), [-6, -8]);
  nearVec(arriveDesired([30, 40], 10, 100), [3, 4]); // 50 away, inside 100: speed 5
  nearVec(arriveDesired([300, 400], 10, 100), [6, 8]); // outside the slowing radius: full speed
  nearVec(arriveDesired([0, 0], 10, 100), [0, 0]);
});

test('wrappedOffset takes the short way round a wrapping world', () => {
  nearVec(wrappedOffset([1, 5], [99, 5], [100, 100]), [-2, 0]);
  nearVec(wrappedOffset([50, 2], [50, 98], [100, 100]), [0, -4]);
  nearVec(wrappedOffset([10, 10], [20, 30], [100, 100]), [10, 20]);
});

// ---------------------------------------------------------------- noise

test('hash3 is deterministic and differs between neighbouring lattice points', () => {
  assert.equal(hash3(3, 4, 5), hash3(3, 4, 5));
  const seen = new Set<number>();
  for (let x = 0; x < 6; x++) for (let y = 0; y < 6; y++) for (let z = 0; z < 6; z++) seen.add(hash3(x, y, z));
  assert.ok(seen.size > 200, `only ${seen.size} distinct hashes of 216`);
  assert.equal(typeof hash3(-7, 2, 9), 'number');
  assert.ok(hash3(-7, 2, 9) >= 0 && hash3(-7, 2, 9) < 2 ** 32);
});

test('noise3 is zero at lattice points, bounded, roughly centred and continuous', () => {
  near(noise3(3, 7, 2), 0);
  near(noise3(-4, 0, 9), 0);
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let worstJump = 0;
  const N = 20000;
  for (let i = 0; i < N; i++) {
    const x = (i * 0.137) % 40;
    const y = (i * 0.211) % 40;
    const z = (i * 0.0173) % 10;
    const n = noise3(x, y, z);
    min = Math.min(min, n);
    max = Math.max(max, n);
    sum += n;
    worstJump = Math.max(worstJump, Math.abs(noise3(x + 1e-4, y, z) - n));
  }
  assert.ok(min >= -1.1 && max <= 1.1, `range ${min} .. ${max}`);
  assert.ok(Math.abs(sum / N) < 0.05, `mean ${sum / N}`);
  assert.ok(worstJump < 1e-3, `a step of 1e-4 changed the value by ${worstJump}`);
});

// ---------------------------------------------------------------- the field

const CFG: FieldConfig = {
  kind: KIND_NOISE_ANGLE, frequency: 3, evolution: 0.1, strength: 1, quantSteps: 0, time: 4, aspect: 1.5,
  penX: 0.5, penY: 0.5, penSigma: 0.2, penActive: false, penMode: PEN_NONE, penStrength: 1, stirX: 0, stirY: 0,
};

test('every field vector has length equal to the strength', () => {
  for (const strength of [0.3, 1]) {
    for (let i = 0; i < 50; i++) {
      const v = fieldVector({ ...CFG, strength }, (i * 0.0193) % 1, (i * 0.0311) % 1);
      near(length(v), strength, 1e-9);
    }
  }
  nearVec(fieldVector({ ...CFG, strength: 0 }, 0.3, 0.4), [0, 0]);
});

test('the field is smooth in space and drifts in time', () => {
  const a = fieldVector(CFG, 0.4, 0.4);
  const b = fieldVector(CFG, 0.4005, 0.4);
  assert.ok(length([a[0] - b[0], a[1] - b[1]]) < 0.05, 'neighbouring places agree');
  const later = fieldVector({ ...CFG, time: CFG.time + 20 }, 0.4, 0.4);
  assert.ok(length([a[0] - later[0], a[1] - later[1]]) > 0.05, 'the field changes with time');
  const frozen = fieldVector({ ...CFG, evolution: 0, time: 99 }, 0.4, 0.4);
  const frozen2 = fieldVector({ ...CFG, evolution: 0, time: 0 }, 0.4, 0.4);
  nearVec(frozen, frozen2);
});

test('quantize snaps angles to multiples of 2pi / steps', () => {
  near(quantize(0.1, 4), 0);
  near(quantize(1.4, 4), Math.PI / 2);
  near(quantize(2.0, 8), (3 * Math.PI) / 4); // 2.0 rad is nearest the third multiple of pi/4
  assert.equal(quantize(1.234, 0), 1.234);
  for (let i = 0; i < 40; i++) {
    const v = fieldVector({ ...CFG, quantSteps: 8 }, (i * 0.029) % 1, (i * 0.047) % 1);
    const angle = Math.atan2(v[1], v[0]);
    const k = angle / (Math.PI / 4);
    near(k, Math.round(k), 1e-9, 'angle is a multiple of pi/4');
  }
});

test('the curl field runs along contours: perpendicular to the noise gradient', () => {
  const cfg = { ...CFG, kind: KIND_CURL };
  const eps = 1e-3;
  for (let i = 0; i < 20; i++) {
    const nx = (i * 0.0371 + 0.1) % 1;
    const ny = (i * 0.0533 + 0.2) % 1;
    const v = fieldVector(cfg, nx, ny);
    const px = nx * cfg.aspect * cfg.frequency;
    const py = ny * cfg.frequency;
    const z = cfg.time * cfg.evolution;
    const gx = noise3(px + eps, py, z) - noise3(px - eps, py, z);
    const gy = noise3(px, py + eps, z) - noise3(px, py - eps, z);
    const gl = Math.hypot(gx, gy);
    if (gl < 1e-6) continue;
    assert.ok(Math.abs((v[0] * gx + v[1] * gy) / gl) < 0.05, `not perpendicular at ${i}`);
  }
});

// ---------------------------------------------------------------- pen edits

const PEN_AT_CENTRE = { ...CFG, penActive: true, penX: 0.5, penY: 0.5, penSigma: 0.3, penStrength: 1 };
const at = (nx: number, ny: number) => [nx, ny] as const;

test('with the pen inactive or no edit mode the field is the plain noise field', () => {
  const plain = fieldVector(CFG, 0.55, 0.5);
  nearVec(fieldVector({ ...PEN_AT_CENTRE, penActive: false, penMode: PEN_SWIRL }, 0.55, 0.5), plain);
  nearVec(fieldVector({ ...PEN_AT_CENTRE, penMode: PEN_NONE }, 0.55, 0.5), plain);
});

test('swirl: at the pen the field runs perpendicular to the direction to the pen', () => {
  const cfg = { ...PEN_AT_CENTRE, penMode: PEN_SWIRL, penStrength: 1 };
  const [nx, ny] = at(0.5 + 0.02, 0.5); // just to the right of the pen
  const v = fieldVector(cfg, nx, ny);
  // offset from pen is (+x); the swirl direction is perpendicular, so mostly vertical
  assert.ok(Math.abs(v[1]) > 0.95 && Math.abs(v[0]) < 0.3, `got ${v}`);
  // and the same rotation sense on the opposite side flips it
  const w = fieldVector(cfg, 0.5 - 0.02, 0.5);
  assert.ok(v[1] * w[1] < 0, 'opposite sides circulate in opposite directions across the pen');
});

test('attract points at the pen, repel points away from it', () => {
  const [nx, ny] = at(0.5 + 0.03, 0.5 + 0.02);
  const toward: Vec2 = [-0.03 * CFG.aspect, -0.02];
  const l = Math.hypot(toward[0], toward[1]);
  const a = fieldVector({ ...PEN_AT_CENTRE, penMode: PEN_ATTRACT }, nx, ny);
  const r = fieldVector({ ...PEN_AT_CENTRE, penMode: PEN_REPEL }, nx, ny);
  assert.ok((a[0] * toward[0] + a[1] * toward[1]) / l > 0.9, `attract ${a}`);
  assert.ok((r[0] * toward[0] + r[1] * toward[1]) / l < -0.9, `repel ${r}`);
});

test('far from the pen the edit fades out and the noise field returns', () => {
  const plain = fieldVector(CFG, 0.95, 0.05);
  const edited = fieldVector({ ...PEN_AT_CENTRE, penMode: PEN_SWIRL, penSigma: 0.1 }, 0.95, 0.05);
  nearVec(edited, plain, 1e-6);
});

test('stir bends the field toward the drag direction at the pen', () => {
  const v = fieldVector({ ...PEN_AT_CENTRE, stirX: 1, stirY: 0 }, 0.5, 0.5);
  assert.ok(v[0] > 0.99, `got ${v}`);
  const none = fieldVector({ ...PEN_AT_CENTRE, stirX: 0, stirY: 0 }, 0.5, 0.5);
  nearVec(none, fieldVector(CFG, 0.5, 0.5));
});

// ---------------------------------------------------------------- consulting the field

/** A 4 x 2 field: left two columns point right, right two columns point left. */
const HALVES = [1, 0, 1, 0, -1, 0, -1, 0, 1, 0, 1, 0, -1, 0, -1, 0];
const FC: FollowerConfig = { width: 400, height: 200, fieldW: 4, fieldH: 2, maxSpeed: 2, maxForce: 0.5, lookahead: 0 };

test('sampleField returns a cell at its centre and interpolates vectors between cells', () => {
  const uniform = Array.from({ length: 16 }, (_, i) => (i % 2 === 0 ? 0.5 : 0.25));
  nearVec(sampleField(uniform, 4, 2, 0.3, 0.7), [0.5, 0.25]);
  // centre of cell (0,0) is at normalised (0.125, 0.25): exactly that cell's vector
  nearVec(sampleField(HALVES, 4, 2, 0.125, 0.25), [1, 0]);
  // halfway between a right-pointing and a left-pointing column the vectors cancel
  nearVec(sampleField(HALVES, 4, 2, 0.5, 0.25), [0, 0], 1e-9);
  // a quarter of the way across: 3/4 right + 1/4 ... between cell 1 (+1) and cell 2 (-1)
  nearVec(sampleField(HALVES, 4, 2, 0.4375, 0.25), [0.5, 0], 1e-9);
  // wraps: just left of the world edge is between the last (-1) and first (+1) column
  nearVec(sampleField(HALVES, 4, 2, 0.0, 0.25), [0, 0], 1e-9);
});

test('the rule: desired = field at the agent * maxSpeed', () => {
  nearVec(followFieldDesired(HALVES, [50, 50], [0, 0], FC), [2, 0]); // left half, points right
  nearVec(followFieldDesired(HALVES, [350, 50], [0, 0], FC), [-2, 0]); // right half, points left
});

test('lookahead samples the field where the agent is going to be (Reynolds)', () => {
  const here = followFieldDesired(HALVES, [140, 50], [3, 0], FC);
  const ahead = followFieldDesired(HALVES, [140, 50], [3, 0], { ...FC, lookahead: 40 }); // 120 px ahead
  assert.ok(here[0] > 0, 'no lookahead: sees the right-pointing half');
  assert.ok(ahead[0] < 0, 'with lookahead: sees the left-pointing half it is about to enter');
});

test('a follower steered by a uniform field ends up moving along it at full speed', () => {
  const field = Array.from({ length: 16 }, (_, i) => (i % 2 === 0 ? 0 : 1)); // everything points +y (down)
  let pos: Vec2 = [200, 100];
  let vel: Vec2 = [0, 0];
  for (let i = 0; i < 100; i++) {
    const s = stepFollower(field, pos, vel, FC);
    pos = s.pos;
    vel = s.vel;
  }
  nearVec(vel, [0, 2], 1e-6);
  assert.ok(pos[0] >= 0 && pos[0] < 400 && pos[1] >= 0 && pos[1] < 200, 'stays inside the wrapping world');
});

test('a weaker maxForce follows a changing field more loosely', () => {
  // The field flips from east to west at x = 200. A weakly steered agent overshoots.
  const run = (maxForce: number) => {
    let pos: Vec2 = [10, 50];
    let vel: Vec2 = [2, 0];
    let maxX = 0;
    for (let i = 0; i < 300; i++) {
      const s = stepFollower(HALVES, pos, vel, { ...FC, maxForce });
      pos = s.pos;
      vel = s.vel;
      if (pos[0] > maxX && pos[0] < 300) maxX = pos[0];
    }
    return maxX;
  };
  assert.ok(run(0.02) > run(1), 'lower force overshoots the flip further');
});

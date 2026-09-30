// CPU-only tests of the coupling rules (src/coupling/coupling.ts), their use in the agent
// references, and the palette data. The GPU shaders are compared with these references by the
// in-browser self-test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FLOW_FORCE, TRAIL_SENSE_PX, flowBiasedHeading, trailGradient } from '../src/coupling/coupling.ts';
import { stepAgent } from '../src/physarum/reference.ts';
import { flockForces, PEN_NONE, type Boid, type FlockConfig } from '../src/flock/flocking.ts';
import { BACKGROUND, PALETTES, PALETTE_COUNT, luminance, paletteColour, paletteWgsl } from '../src/render/palettes.ts';

const D = Math.PI / 180;
const angleDiff = (a: number, b: number) => ((a - b + Math.PI * 3) % (Math.PI * 2)) - Math.PI;

test('flow bias: weight 0, no field or a zero field leave the heading alone', () => {
  assert.equal(flowBiasedHeading(1.2, 1.5, [1, 0], 0), 1.2);
  assert.equal(flowBiasedHeading(1.2, 1.5, null, 1), 1.2);
  assert.equal(flowBiasedHeading(1.2, 1.5, [0, 0], 1), 1.2, 'a zero field is silent, it does not brake or turn');
});

test('flow bias turns the heading toward the field, the short way round', () => {
  // Heading 10 degrees, field along +x (0 degrees): turn clockwise (down).
  const a = flowBiasedHeading(10 * D, 1.5, [1, 0], 1);
  assert.ok(a < 10 * D && a >= 0);
  // Heading -170 degrees, field along 170 degrees: 20 degrees apart across the wrap, turn toward it.
  const b = flowBiasedHeading(-170 * D, 1.5, [Math.cos(170 * D), Math.sin(170 * D)], 1);
  assert.ok(Math.abs(angleDiff(b, 170 * D)) < 20 * D, 'moved closer to 170 degrees');
});

test('flow bias snaps onto a nearby field direction and is limited against a far one', () => {
  // 4 degrees apart: the chord is well under the force limit, so the agent lands exactly on the field.
  const near = flowBiasedHeading(4 * D, 2, [1, 0], 1);
  assert.ok(Math.abs(angleDiff(near, 0)) < 1e-9);
  // 90 degrees apart (sideways to the field): limited, and close to the most it can turn, about 14 degrees.
  const side = flowBiasedHeading(90 * D, 2, [1, 0], 1);
  const maxTurn = 2 * Math.asin(FLOW_FORCE / 2);
  assert.ok(Math.abs(maxTurn / D - 14.36) < 0.05, 'about 14 degrees at weight 1');
  const sideTurn = Math.abs(angleDiff(side, 90 * D));
  assert.ok(sideTurn <= maxTurn + 1e-9 && sideTurn > 0.8 * maxTurn, `turned ${sideTurn / D} degrees`);
  // Nearly head-on (170 degrees apart): the force mostly slows the agent instead of turning it, so
  // the turn is small. That is how steering works (desired minus velocity); a constant-speed
  // agent only feels the sideways part.
  const headOn = Math.abs(angleDiff(flowBiasedHeading(170 * D, 2, [1, 0], 1), 170 * D));
  assert.ok(headOn < 0.25 * maxTurn, `turned ${headOn / D} degrees`);
});

test('flow bias: the turn grows with the weight', () => {
  const turn = (w: number) => Math.abs(angleDiff(flowBiasedHeading(120 * D, 1.5, [1, 0], w), 120 * D));
  assert.ok(turn(0.25) < turn(0.5) && turn(0.5) < turn(1));
});

test('an agent on empty ground with the bias on ends up heading along the field', () => {
  const p = { width: 200, height: 200, sensorDistance: 10, sensorAngle: 0.7, rotationAngle: 0.5, moveDistance: 1.5, flowBias: 1, flowVector: () => [0, 1] as [number, number] };
  let a = { x: 100, y: 100, heading: 0 }; // heading along +x, field along +y (90 degrees)
  for (let i = 0; i < 12; i++) a = stepAgent(a, () => 0, p, true);
  assert.ok(Math.abs(angleDiff(a.heading, Math.PI / 2)) < 1e-9, `heading ${a.heading / D} degrees`);
  // Without the coupling the same agent keeps its heading on empty ground.
  let b = { x: 100, y: 100, heading: 0 };
  for (let i = 0; i < 12; i++) b = stepAgent(b, () => 0, { ...p, flowBias: 0 }, true);
  assert.equal(b.heading, 0);
});

test('the trail still decides: a strong trail ahead keeps a weakly biased agent roughly on course', () => {
  const p = { width: 200, height: 200, sensorDistance: 10, sensorAngle: 0.7, rotationAngle: 0.5, moveDistance: 1.5 };
  // Hot trail straight ahead along +x; the field pulls 90 degrees away. One step with a small weight
  // moves the heading by far less than the agent's own turn RA would.
  const hot = (ix: number, iy: number) => (Math.abs(iy - 100) < 2 && ix > 100 ? 1 : 0);
  const a = stepAgent({ x: 100.5, y: 100.5, heading: 0 }, hot, { ...p, flowBias: 0.25, flowVector: () => [0, 1] }, true);
  assert.ok(Math.abs(angleDiff(a.heading, 0)) < 8 * D, `turned ${a.heading / D} degrees`);
});

test('trail gradient points uphill, wraps, and is zero on a flat trail', () => {
  const slope = (ix: number) => ix / 100; // rises to the right
  const g = trailGradient((ix) => slope(ix), [50, 50], TRAIL_SENSE_PX, 100, 100);
  assert.ok(g[0] > 0 && g[1] === 0);
  assert.deepEqual(trailGradient(() => 0.3, [10, 10], 8, 100, 100), [0, 0]);
  // Across the left edge: a hill at the far right column is uphill for a point near x = 0 (to its left).
  const hill = (ix: number) => (ix >= 90 ? 1 : 0);
  const e = trailGradient(hill, [2, 50], 8, 100, 100);
  assert.ok(e[0] < 0, 'the hill is to the left across the wrap');
});

const CFG: FlockConfig = {
  width: 400, height: 300, maxSpeed: 3, maxForce: 0.1, sepWeight: 1, aliWeight: 1, cohWeight: 1, sepRadius: 10, nbrRadius: 40,
  fov: 2 * Math.PI, penMode: PEN_NONE, penX: 0, penY: 0, penSigma: 50, penStrength: 4, penActive: false,
};
const boid = (x: number, y: number, vx = 0, vy = 0): Boid => ({ pos: [x, y], vel: [vx, vy] });

test('boids climb the trail: the force points uphill, scales with the weight, and is silent on a flat trail', () => {
  const me = [boid(100, 100, 0, 0)];
  const uphillRight = (ix: number) => ix / 400;
  const f = (weight: number, at = uphillRight) => flockForces(0, me, [0], { ...CFG, trail: { at, weight, sense: 8 } });
  const one = f(1);
  assert.ok(one.trail && one.trail[0] > 0, 'toward rising trail');
  assert.ok(Math.abs(f(2).total[0] - 2 * one.total[0]) < 1e-12);
  assert.equal(f(1, () => 0.5).trail, null);
  assert.equal(f(0).trail, null);
  assert.deepEqual(flockForces(0, me, [0], CFG).total, [0, 0], 'no trail coupling configured: nothing');
});

test('the trail force is limited to maxForce before weighting, like every other behaviour', () => {
  const steep = (ix: number) => ix;
  const f = flockForces(0, [boid(100, 100, 0, 0)], [0], { ...CFG, trail: { at: steep, weight: 1, sense: 8 } });
  assert.ok(f.trail && Math.hypot(f.trail[0], f.trail[1]) <= CFG.maxForce + 1e-12);
});

test('six palettes, each starting at the page background and brightening at every stop', () => {
  assert.equal(PALETTE_COUNT, 6);
  assert.equal(new Set(PALETTES.map((p) => p.name)).size, 6);
  for (const p of PALETTES) {
    assert.deepEqual([...p.stops[0]], [...BACKGROUND], p.name);
    for (let i = 1; i < 5; i++) assert.ok(luminance(p.stops[i]) > luminance(p.stops[i - 1]), `${p.name} stop ${i} brighter`);
    for (const c of [...p.stops, p.accent]) for (const x of c) assert.ok(x >= 0 && x <= 1);
    assert.ok(luminance(p.stops[4]) > 0.8, `${p.name} ends near white`);
  }
});

test('palette lookup hits the stops, interpolates and clamps', () => {
  for (let k = 0; k < PALETTE_COUNT; k++) {
    for (let i = 0; i < 5; i++) assert.deepEqual(paletteColour(k, i / 4).map((x) => +x.toFixed(9)), [...PALETTES[k].stops[i]].map((x) => +x.toFixed(9)));
    assert.deepEqual(paletteColour(k, -1), [...BACKGROUND]);
    assert.deepEqual(paletteColour(k, 5), [...PALETTES[k].stops[4]]);
  }
  const mid = paletteColour(0, 0.125);
  assert.ok(Math.abs(mid[0] - (PALETTES[0].stops[0][0] + PALETTES[0].stops[1][0]) / 2) < 1e-12);
});

test('the WGSL generated from the palettes contains every colour', () => {
  const w = paletteWgsl();
  assert.ok(w.includes(`array<vec3f, ${PALETTE_COUNT * 5}>`) && w.includes(`array<vec3f, ${PALETTE_COUNT}>`));
  assert.equal((w.match(/vec3f\(/g) ?? []).length, PALETTE_COUNT * 5 + PALETTE_COUNT);
});

// CPU-only tests of the reference rule. They cover the turning logic and the geometry of
// sensing, moving and wrapping. They do NOT test the GPU shader; that is compared against
// this reference in the browser by src/physarum/selftest.ts (see LOGBOOK.md for its result).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { turnDelta, sensorCell, stepAgent, wrap, type StepParams } from '../src/physarum/reference.ts';

const RA = 0.5;
const P: StepParams = { width: 100, height: 80, sensorDistance: 10, sensorAngle: 0.7, rotationAngle: RA, moveDistance: 2 };

test('[PC-12] middle strictly highest keeps heading', () => {
  assert.equal(turnDelta(1, 0.5, 0.2, RA, true), 0);
  assert.equal(turnDelta(1, 0.5, 0.2, RA, false), 0);
});

test('[PC-12] middle lower than both sides turns by RA, direction from the coin', () => {
  assert.equal(turnDelta(0.1, 1, 1, RA, true), RA);
  assert.equal(turnDelta(0.1, 1, 1, RA, false), -RA);
  assert.equal(turnDelta(0.1, 1, 0.5, RA, true), RA); // still lower than both
});

test('[PC-12] otherwise turns toward the higher side', () => {
  assert.equal(turnDelta(0.5, 1, 0.2, RA, true), RA); // left higher
  assert.equal(turnDelta(0.5, 0.2, 1, RA, true), -RA); // right higher
  assert.equal(turnDelta(1, 1, 0.2, RA, true), RA); // middle ties with left, left beats right
});

test('[PC-12] empty ground gives no turn', () => {
  assert.equal(turnDelta(0, 0, 0, RA, true), 0);
  assert.equal(turnDelta(0.3, 0.3, 0.3, RA, false), 0);
});

test('wrap handles negatives and exact multiples', () => {
  assert.equal(wrap(-1, 100), 99);
  assert.equal(wrap(100, 100), 0);
  assert.equal(wrap(250, 100), 50);
  assert.equal(wrap(-250, 100), 50);
});

test('[PC-13] sensor cells: straight ahead, and wrapped across the left edge', () => {
  assert.deepEqual(sensorCell({ x: 20.5, y: 30.5, heading: 0 }, 0, P), [30, 30]);
  // heading pi points to -x: 5.2 - 10 = -4.8, floor -5, wraps to 95
  const [ix] = sensorCell({ x: 5.2, y: 30.5, heading: Math.PI }, Math.PI, P);
  assert.equal(ix, 95);
});

test('a step moves by MD along the new heading and wraps', () => {
  const empty = () => 0;
  const s = stepAgent({ x: 99.5, y: 10, heading: 0 }, empty, P, true);
  assert.ok(Math.abs(s.x - 1.5) < 1e-9, `x wraps to 1.5, got ${s.x}`);
  assert.ok(Math.abs(s.y - 10) < 1e-9);
  assert.equal(s.heading, 0);
});

test('an agent turns toward a trail placed on its left sensor', () => {
  const a = { x: 40.5, y: 40.5, heading: 0 };
  const [lx, ly] = sensorCell(a, a.heading + P.sensorAngle, P);
  const trail = (ix: number, iy: number) => (ix === lx && iy === ly ? 1 : 0);
  const s = stepAgent(a, trail, P, true);
  assert.ok(Math.abs(s.heading - RA) < 1e-9);
});

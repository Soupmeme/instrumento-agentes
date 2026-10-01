// Prediction checks that restate a rule in the CPU references (no GPU). Each test title starts
// with the prediction id of src/verify/predictions.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { penMix } from '../src/physarum/extended.ts';
import { CURATED_SLOTS, PARAM_COUNT, SLOT_COUNT, presetOfSlot } from '../src/physarum/presets.ts';
import { stepVehicle, type Vec2 } from '../src/steering/steering.ts';
import { FLOW_FORCE, flowBiasedHeading } from '../src/coupling/coupling.ts';

test('[PE-08] the pen weight is exp(-d^2/sigma^2): 0.37 at one radius, tiny at three, the same shape for any radius', () => {
  assert.equal(penMix(0, 0.2), 1);
  assert.ok(Math.abs(penMix(0.2, 0.2) - Math.exp(-1)) < 1e-12);
  assert.ok(penMix(0.6, 0.2) < 0.02, `three radii away: ${penMix(0.6, 0.2)}`);
  for (const sigma of [0.05, 0.2, 0.5]) {
    for (const k of [0.3, 1, 2]) assert.ok(Math.abs(penMix(k * sigma, sigma) - penMix(k * 0.1, 0.1)) < 1e-12, `shape at ${k} radii for radius ${sigma}`);
  }
});

test('[PE-09] 22 selectable presets, 8 of them curated, each with the 15 numbers the shader reads', () => {
  assert.equal(SLOT_COUNT, 22);
  assert.equal(CURATED_SLOTS.length, 8);
  assert.equal(PARAM_COUNT, 15);
  for (let slot = 0; slot < SLOT_COUNT; slot++) {
    const preset = presetOfSlot(slot);
    assert.equal(preset.length, PARAM_COUNT, `slot ${slot}`);
    assert.ok(preset.every(Number.isFinite), `slot ${slot} has a non-finite number`);
  }
  for (const slot of CURATED_SLOTS) assert.ok(slot >= 0 && slot < SLOT_COUNT, `curated slot ${slot} is selectable`);
});

test('[FO-09] turning radius is about speed squared over force', () => {
  // A vehicle that always asks for a velocity far to its left, so the steering force is saturated at
  // maxForce and points sideways: the speed is capped at maxSpeed, so only the direction turns.
  for (const [speed, force] of [[3, 0.05], [2, 0.1], [4, 0.2]] as const) {
    let pos: Vec2 = [0, 0];
    let vel: Vec2 = [speed, 0];
    const points: Vec2[] = [];
    for (let i = 0; i <= 400; i++) {
      points.push(pos);
      // "Left" of the velocity (perpendicular). The huge length makes the force hit the limit.
      const desired: Vec2 = [vel[0] - vel[1] * 1e6, vel[1] + vel[0] * 1e6];
      const next = stepVehicle(pos, vel, desired, speed, force);
      pos = next.pos;
      vel = next.vel;
    }
    // The circle through three points of the path (steps 0, 150 and 300).
    const [a, b, c] = [points[0], points[150], points[300]];
    const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
    const ux = ((a[0] ** 2 + a[1] ** 2) * (b[1] - c[1]) + (b[0] ** 2 + b[1] ** 2) * (c[1] - a[1]) + (c[0] ** 2 + c[1] ** 2) * (a[1] - b[1])) / d;
    const uy = ((a[0] ** 2 + a[1] ** 2) * (c[0] - b[0]) + (b[0] ** 2 + b[1] ** 2) * (a[0] - c[0]) + (c[0] ** 2 + c[1] ** 2) * (b[0] - a[0])) / d;
    const radius = Math.hypot(a[0] - ux, a[1] - uy);
    const predicted = (speed * speed) / force;
    assert.ok(Math.abs(radius - predicted) / predicted < 0.05, `speed ${speed}, force ${force}: radius ${radius.toFixed(1)}, predicted ${predicted.toFixed(1)}`);
  }
});

test('[CP-05] the flow turns a heading by at most asin(weight * 0.25) per step, and not at all at weight 0', () => {
  assert.equal(FLOW_FORCE, 0.25);
  const field: Vec2 = [1, 0];
  const angleDiff = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
  for (const weight of [0, 0.25, 0.5, 1]) {
    let worst = 0;
    for (let k = 0; k < 360; k++) {
      const heading = (k * Math.PI) / 180;
      const turned = flowBiasedHeading(heading, 1.5, field, weight);
      worst = Math.max(worst, angleDiff(turned, heading));
    }
    const limit = Math.asin(weight * FLOW_FORCE);
    assert.ok(worst <= limit + 1e-9, `weight ${weight}: largest turn ${worst} rad, limit ${limit}`);
    if (weight > 0) assert.ok(worst >= 0.9 * limit, `weight ${weight}: the limit is reached (${worst} of ${limit})`);
    else assert.equal(worst, 0);
  }
  // About 14 degrees at full weight.
  assert.ok(Math.abs((Math.asin(FLOW_FORCE) * 180) / Math.PI - 14.5) < 0.1);
});

// CPU-only tests of the extended rule and the preset data. They do NOT test the GPU shader;
// the in-browser self-test compares that against this reference (src/physarum/selftest.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PARAMETER_MATRIX, SELECTED_POINTS, SLOT_COUNT, LANDING_PAIRS, PARAM_COUNT, rowOfSlot, presetOfSlot,
} from '../src/physarum/presets.ts';
import {
  penMix, mixVectors, ease, extendedValues, stepAgentExtended, pixelScaleFor, countScaleFor, REFERENCE_DENSITY,
} from '../src/physarum/extended.ts';

test('the preset matrix has 24 rows of 15 finite, non-negative numbers', () => {
  assert.equal(PARAMETER_MATRIX.length, 24);
  for (const row of PARAMETER_MATRIX) {
    assert.equal(row.length, PARAM_COUNT);
    for (const v of row) assert.ok(Number.isFinite(v) && v >= 0);
  }
});

test('the matrix matches the copy printed in SPEC.md, value for value', () => {
  const spec = readFileSync(new URL('../SPEC.md', import.meta.url), 'utf8');
  const rows = new Map<number, number[]>();
  for (const line of spec.split(/\r?\n/)) {
    const m = /^\s*(\d{1,2})\s+((?:-?\d+(?:\.\d+)?\s*){15})$/.exec(line);
    if (m) rows.set(Number(m[1]), m[2].trim().split(/\s+/).map(Number));
  }
  assert.equal(rows.size, 24, 'found all 24 rows in SPEC.md');
  rows.forEach((values, index) => assert.deepEqual([...PARAMETER_MATRIX[index]], values, `row ${index}`));
});

test('the 22 selectable slots point at distinct, valid rows; slot 21 is row 21', () => {
  assert.equal(SLOT_COUNT, 22);
  assert.equal(new Set(SELECTED_POINTS).size, 22);
  for (const row of SELECTED_POINTS) assert.ok(row >= 0 && row < 24);
  assert.equal(rowOfSlot(21), 21);
  assert.equal(rowOfSlot(-1), 21); // wraps
  assert.equal(rowOfSlot(22), 0);
  assert.equal(presetOfSlot(0), PARAMETER_MATRIX[0]);
});

test('landing pairs decode to valid slots', () => {
  assert.equal(LANDING_PAIRS.length, 23);
  for (const p of LANDING_PAIRS) {
    assert.ok(p.penSlot >= 0 && p.penSlot < SLOT_COUNT, p.code);
    assert.ok(p.backgroundSlot >= 0 && p.backgroundSlot < SLOT_COUNT, p.code);
  }
  // "LU2": pen L = slot 11 (row 10), background U = slot 20 (row 20)
  const lu = LANDING_PAIRS[0];
  assert.deepEqual([lu.penSlot, lu.backgroundSlot], [11, 20]);
});

test('penMix is 1 at the pen, exp(-1) one sigma away, and 0 when the pen is off', () => {
  assert.equal(penMix(0, 0.3), 1);
  assert.ok(Math.abs(penMix(0.3, 0.3) - Math.exp(-1)) < 1e-12);
  assert.ok(penMix(3, 0.3) < 1e-30);
  assert.equal(penMix(0, 0.3, false), 0);
});

test('mixVectors interpolates every component', () => {
  assert.deepEqual(mixVectors([0, 10, 4], [10, 20, 4], 0.25), [2.5, 12.5, 4]);
  assert.deepEqual(mixVectors([1, 2], [3, 4], 0), [1, 2]);
  assert.deepEqual(mixVectors([1, 2], [3, 4], 1), [3, 4]);
});

test('ease starts and ends flat and passes through the middle', () => {
  assert.equal(ease(0), 0);
  assert.equal(ease(1), 1);
  assert.equal(ease(0.5), 0.5);
  assert.equal(ease(-2), 0);
  assert.equal(ease(3), 1);
  assert.ok(ease(0.1) < 0.1 && ease(0.9) > 0.9);
});

test('A + B * S^C, worked by hand for row 21 (the reference default)', () => {
  const row = PARAMETER_MATRIX[21];
  const S = 0.5;
  const v = extendedValues(row, S, 250);
  // SD = 0 + 5.425 * 0.5^6.37 * 250
  assert.ok(Math.abs(v.sensorDistance - 5.425 * Math.pow(0.5, 6.37) * 250) < 1e-9);
  // SA = 1.03 + 0 * anything
  assert.equal(v.sensorAngle, 1.03);
  // RA = 0.18 + 0.443 * 0.5^0.289
  assert.ok(Math.abs(v.rotationAngle - (0.18 + 0.443 * Math.pow(0.5, 0.289))) < 1e-12);
  // MD = 0.3 + 0.065 * 0.5^2.2 * 250
  assert.ok(Math.abs(v.moveDistance - (0.3 + 0.065 * Math.pow(0.5, 2.2) * 250)) < 1e-9);
  assert.equal(v.scale, 19);
});

test('denser trail (larger S) makes an agent move slower, look nearer and turn more (row 21)', () => {
  const lo = extendedValues(PARAMETER_MATRIX[21], 0.05, 250);
  const hi = extendedValues(PARAMETER_MATRIX[21], 0.95, 250);
  assert.ok(hi.sensorDistance > lo.sensorDistance); // SDE 6.37, SDA > 0: looks farther when dense
  assert.ok(hi.rotationAngle > lo.rotationAngle);
  assert.ok(hi.moveDistance < lo.moveDistance + 1e9); // just checking it is finite
  assert.ok(Number.isFinite(hi.moveDistance));
});

test('pixel scale is 250 at the reference grid and grows with the grid', () => {
  assert.ok(Math.abs(pixelScaleFor(1280, 736) - 250) < 1e-9);
  assert.ok(pixelScaleFor(1920, 1080) > pixelScaleFor(1280, 736));
});

test('count scale keeps deposit density constant: more agents means a smaller scale', () => {
  const grid = [1920, 1080] as const;
  assert.ok(Math.abs(countScaleFor(REFERENCE_DENSITY * grid[0] * grid[1], ...grid) - 1) < 1e-9);
  assert.ok(countScaleFor(400_000, ...grid) > countScaleFor(2_000_000, ...grid));
});

const CTX = {
  width: 200,
  height: 160,
  pixelScale: 250,
  background: PARAMETER_MATRIX[2],
  pen: PARAMETER_MATRIX[20],
  penWeight: 0,
};

test('with the pen weight at 0 the agent uses the background preset, at 1 the pen preset', () => {
  const a = { x: 100.5, y: 80.5, heading: 0.4 };
  const empty = () => 0;
  const bg = stepAgentExtended(a, empty, { ...CTX, penWeight: 0 }, true);
  const pen = stepAgentExtended(a, empty, { ...CTX, penWeight: 1 }, true);
  assert.deepEqual(bg.values, extendedValues(PARAMETER_MATRIX[2], bg.S, 250));
  assert.deepEqual(pen.values, extendedValues(PARAMETER_MATRIX[20], pen.S, 250));
});

test('on empty ground S clamps to 1e-9 and the agent does not turn', () => {
  const a = { x: 50.5, y: 50.5, heading: 1.0 };
  const s = stepAgentExtended(a, () => 0, CTX, true);
  assert.equal(s.S, 1e-9);
  assert.equal(s.heading, 1.0);
});

test('an agent turns toward trail on its +SA side (the left sensor is at -SA)', () => {
  const a = { x: 100.5, y: 80.5, heading: 0 };
  // Row 2 (vertebrata): with S at the floor, SD = 17.92, SA = 0.52, RA = 0.18.
  const SD = 17.92;
  const SA = 0.52;
  const hot = [Math.floor(a.x + Math.cos(SA) * SD), Math.floor(a.y + Math.sin(SA) * SD)];
  const trail = (ix: number, iy: number) => (ix === hot[0] && iy === hot[1] ? 1e-3 : 0);
  const s = stepAgentExtended(a, trail, CTX, true);
  assert.ok(Math.abs(s.heading - 0.18) < 1e-9, `turned to ${s.heading}`);
});

test('S is measured from the trail under the agent, shifted by the preset offsets', () => {
  // Row 5 has SB1 = 0.2 (sideways) and SB2 = 0.9 (forward).
  const ctx = { ...CTX, background: PARAMETER_MATRIX[5], pen: PARAMETER_MATRIX[5] };
  const a = { x: 60.2, y: 70.3, heading: 0 };
  const cx = Math.floor(60.2 + 0.9);
  const cy = Math.floor(70.3 + 0.2);
  const trail = (ix: number, iy: number) => (ix === cx && iy === cy ? 0.02 : 0);
  const s = stepAgentExtended(a, trail, ctx, true);
  assert.ok(Math.abs(s.S - 0.02 * 31.5) < 1e-12, `S = ${s.S}`);
});

test('mode defaults: extended uses the reference trail values and a denser swarm', async () => {
  const { modeDefaults, setMode, resetToDefaults, DEFAULT_PARAMS, MODE_CLASSIC, MODE_EXTENDED } = await import('../src/physarum/params.ts');
  assert.deepEqual(modeDefaults(MODE_EXTENDED), {
    decay: 0.75, depositFactor: 0.003, displayGain: 30, respawnRate: 0.001, agentCount: 1_000_000, followerDeposit: 0.02, boidDeposit: 0.02,
  });
  assert.equal(modeDefaults(MODE_CLASSIC).agentCount, 400_000);
  assert.equal(modeDefaults(MODE_CLASSIC).followerDeposit, 0.05);
  assert.equal(modeDefaults(MODE_CLASSIC).boidDeposit, 0.05);

  const p = { ...DEFAULT_PARAMS };
  setMode(p, MODE_EXTENDED);
  assert.equal(p.mode, MODE_EXTENDED);
  assert.equal(p.decay, 0.75);
  p.penRadius = 0.6;
  resetToDefaults(p);
  assert.equal(p.mode, MODE_EXTENDED, 'Defaults keeps the current mode');
  assert.equal(p.penRadius, DEFAULT_PARAMS.penRadius, 'and restores the pen radius');
  assert.equal(p.agentCount, 1_000_000);
});

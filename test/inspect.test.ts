// The wording of the debug readouts (src/inspect_text.ts): the per-family parameter lines and the
// description of what the followed agent perceived and decided. CPU only. The numbers that feed
// them are checked against the GPU by the self-test (probe: and pick: checks).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeProbe, familyReadout, readProbeWords, VIEW_NAMES, type Probe } from '../src/inspect_text.ts';
import { DEFAULT_PARAMS, MODE_EXTENDED } from '../src/physarum/params.ts';

/** The probe buffer as the shaders write it (layout in move.wgsl). */
function words(over: Partial<Probe> = {}): Float32Array {
  const p: Probe = {
    agent: 42, step: 7, x: 100.5, y: 200.25, heading: 1, S: 0.2, sensorDistance: 16, sensorAngle: 0.7854, rotationAngle: 0.7854, moveDistance: 1.5,
    plus: { x: 0, y: 0, reading: 0.1 }, middle: { x: 0, y: 0, reading: 0.5 }, minus: { x: 0, y: 0, reading: 0.2 }, turn: 0, nextX: 101, nextY: 201,
    ...over,
  };
  const w = new Float32Array(24);
  w.set([p.agent, p.step + 1, p.x, p.y, p.heading, p.S, p.sensorDistance, p.sensorAngle, p.rotationAngle, p.moveDistance]);
  w.set([p.plus.x, p.plus.y, p.plus.reading, p.middle.x, p.middle.y, p.middle.reading, p.minus.x, p.minus.y, p.minus.reading], 10);
  w[19] = p.turn;
  w[22] = p.nextX;
  w[23] = p.nextY;
  return w;
}

test('the probe buffer reads back as named values, and an empty buffer is "nothing yet"', () => {
  assert.equal(readProbeWords(new Float32Array(24)), null);
  const p = readProbeWords(words())!;
  assert.equal(p.agent, 42);
  assert.equal(p.step, 7);
  assert.ok(Math.abs(p.sensorAngle - 0.7854) < 1e-6);
  assert.equal(p.middle.reading, 0.5);
});

test('the description names the reason for each of the four decisions of the rule', () => {
  const ra = 0.7854;
  const straight = describeProbe(readProbeWords(words()), false);
  assert.match(straight, /middle is strictly highest: kept its heading/);
  const plus = describeProbe(readProbeWords(words({ plus: { x: 0, y: 0, reading: 0.9 }, turn: ra })), false);
  assert.match(plus, /turned 45 deg toward the plus side, the higher reading/);
  const minus = describeProbe(readProbeWords(words({ minus: { x: 0, y: 0, reading: 0.9 }, turn: -ra })), false);
  assert.match(minus, /toward the minus side/);
  const coin = describeProbe(readProbeWords(words({ middle: { x: 0, y: 0, reading: 0.01 }, turn: -ra })), false);
  assert.match(coin, /middle is lower than both sides: turned 45 deg to the minus side, picked at random/);
  const empty = describeProbe(readProbeWords(words({ plus: { x: 0, y: 0, reading: 0 }, middle: { x: 0, y: 0, reading: 0 }, minus: { x: 0, y: 0, reading: 0 } })), false);
  assert.match(empty, /no side stands out/);
});

test('S appears only for the extended rule, and the numbers are the ones in the buffer', () => {
  const classic = describeProbe(readProbeWords(words()), false);
  const extended = describeProbe(readProbeWords(words()), true);
  assert.ok(!classic.includes('S (trail under it)'));
  assert.match(extended, /S \(trail under it\) 0\.200/);
  assert.match(classic, /Agent 42 at \(100\.5, 200\.3\) px/);
  assert.match(classic, /sensor distance 16\.0 px, sensor angle 45 deg, turn 45 deg, move 1\.50 px/);
  assert.match(classic, /reads: plus side 0\.100, middle 0\.500, minus side 0\.200/);
  assert.match(describeProbe(null, false), /waiting for the first step/);
});

test('the family readout has a line per family, says off when a family is off, and names the rule in use', () => {
  const classic = familyReadout({ ...DEFAULT_PARAMS, physarumOn: 1, followerCount: 0, flockCount: 0 });
  assert.match(classic, /^Physarum \(classic\): sensor distance 16 px, sensor angle 45 deg/m);
  assert.match(classic, /^Followers: off$/m);
  assert.match(classic, /^Boids: off$/m);
  assert.match(classic, /^Coupling: flow to Physarum/m);
  const all = familyReadout({ ...DEFAULT_PARAMS, mode: MODE_EXTENDED, followerCount: 1000, flockCount: 1000 });
  assert.match(all, /Physarum \(extended\): background preset/);
  assert.match(all, /Followers: force 0\.120, speed 2\.5/);
  assert.match(all, /Boids: separation 2 \(radius 12\)/);
  assert.match(familyReadout({ ...DEFAULT_PARAMS, physarumOn: 0 }), /^Physarum: off$/m);
});

test('there is a name for each of the five display views', () => {
  assert.equal(VIEW_NAMES.length, 5);
  assert.equal(VIEW_NAMES[0], 'picture');
});

test('the readout texts contain no em dashes (project rule 8)', () => {
  const text = [describeProbe(readProbeWords(words()), true), familyReadout(DEFAULT_PARAMS), ...VIEW_NAMES].join('\n');
  assert.ok(!text.includes('—'));
});

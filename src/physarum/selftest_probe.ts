// Self-test of the debug probes (M7), part of runSelfTest (selftest.ts). Two things are checked:
//   probe: the numbers the agent pass writes for the followed agent (sensor positions, readings,
//          the four governing values, the turn) equal the CPU reference computed from a read-back
//          of the same step, so the overlay shows exactly what the shader used (TL-01)
//   pick:  the agent or boid chosen at a point is the nearest one, against a brute-force search
//          (TL-02), and the chosen index keeps naming the same agent while it moves
// Everything here runs on the real GPU and is compared with plain CPU code.

import type { Physarum } from './physarum';
import { DEFAULT_PARAMS, MODE_CLASSIC, MODE_EXTENDED, modeDefaults } from './params';
import { sensorCell, turnDelta, wrap, type AgentState, type StepParams } from './reference';
import { stepAgentExtended, pixelScaleFor } from './extended';
import { presetOfSlot } from './presets';
import { readProbeWords } from '../inspect_text';

type Check = { name: string; ok: boolean; detail: string };

const TAU = Math.PI * 2;
const angleDiff = (a: number, b: number) => wrap(a - b + Math.PI, TAU) - Math.PI;
/** A deterministic pseudo-random number in [0, 1) from an integer (for a trail with no ties). */
const hash01 = (i: number) => {
  let h = (Math.imul(i, 2654435761) ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 3266489917) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

export async function probeChecks(p: Physarum): Promise<Check[]> {
  const checks: Check[] = [];
  const check = (name: string, ok: boolean, detail = '') => checks.push({ name, ok, detail });
  const W = p.gridWidth;
  const H = p.gridHeight;
  const savedProbe = p.probeAgent;

  // ---------------------------------------------------------------- classic rule
  Object.assign(p.params, DEFAULT_PARAMS, {
    mode: MODE_CLASSIC, physarumOn: 1, followerCount: 0, flockCount: 0, respawnRate: 0,
    sensorDistance: 10, sensorAngle: 0.7, rotationAngle: 0.5, moveDistance: 2,
  });
  const sp: StepParams = { width: W, height: H, sensorDistance: 10, sensorAngle: 0.7, rotationAngle: 0.5, moveDistance: 2 };
  // A trail with a different value in every pixel, so the three readings never tie by accident.
  const trail = new Float32Array(W * H);
  for (let i = 0; i < trail.length; i++) trail[i] = 0.01 + 0.5 * hash01(i);
  const agents: AgentState[] = [
    { x: 0.2 * W + 0.5, y: 0.3 * H + 0.5, heading: 0.3 },
    { x: 0.4 * W + 0.5, y: 0.3 * H + 0.5, heading: 1.0 },
    { x: 0.6 * W + 0.5, y: 0.6 * H + 0.5, heading: 2.0 },
    { x: 0.8 * W + 0.5, y: 0.8 * H + 0.5, heading: 4.0 },
    { x: 3.5, y: 0.5 * H + 0.5, heading: Math.PI + 0.05 }, // sensors wrap across the left edge
  ];
  const flat = new Float32Array(agents.length * 4);
  agents.forEach((a, i) => flat.set([a.x / W, a.y / H, a.heading, 0], i * 4));
  p.params.agentCount = agents.length;
  let worstPos = 0;
  let readingsOk = true;
  let turnsOk = true;
  let governingOk = true;
  const turns: number[] = [];
  for (let k = 0; k < agents.length; k++) {
    p.probeAgent = k;
    p.reset(1);
    p.debugWriteAgents(flat);
    p.debugWriteTrail(trail);
    p.step();
    const probe = readProbeWords(await p.readProbe());
    const a = agents[k];
    if (!probe || probe.agent !== k) { readingsOk = false; continue; }
    const read = (angle: number) => {
      const [ix, iy] = sensorCell(a, angle, sp);
      return trail[iy * W + ix];
    };
    const plus = read(a.heading + sp.sensorAngle);
    const middle = read(a.heading);
    const minus = read(a.heading - sp.sensorAngle);
    readingsOk = readingsOk && probe.plus.reading === plus && probe.middle.reading === middle && probe.minus.reading === minus;
    const at = (angle: number) => [a.x + Math.cos(angle) * sp.sensorDistance, a.y + Math.sin(angle) * sp.sensorDistance];
    for (const [got, angle] of [[probe.plus, a.heading + sp.sensorAngle], [probe.middle, a.heading], [probe.minus, a.heading - sp.sensorAngle]] as const) {
      const [wx, wy] = at(angle);
      worstPos = Math.max(worstPos, Math.abs(got.x - wx), Math.abs(got.y - wy));
    }
    // The turn: any of +RA, -RA, 0 as the rule says; the coin is whichever side the GPU took.
    const coin = probe.turn > 0;
    const want = turnDelta(middle, plus, minus, sp.rotationAngle, coin);
    turnsOk = turnsOk && Math.abs(probe.turn - want) < 1e-6;
    turns.push(probe.turn);
    governingOk = governingOk && probe.sensorDistance === 10 && Math.abs(probe.sensorAngle - 0.7) < 1e-6 && Math.abs(probe.rotationAngle - 0.5) < 1e-6 && probe.moveDistance === 2;
  }
  check('probe: classic, the three readings are the trail under each sensor', readingsOk, `${agents.length} agents, trail with no ties`);
  check('probe: classic, sensor positions equal the geometry', worstPos < 1e-3 * Math.max(1, sp.sensorDistance), `worst position error ${worstPos.toExponential(1)} px`);
  check('probe: classic, the recorded turn is the rule applied to the readings', turnsOk && turns.some((t) => t !== 0), `turns ${turns.map((t) => t.toFixed(2)).join(', ')}`);
  check('probe: classic, the four governing values are the parameters in use', governingOk, 'SD 10, SA 0.7, RA 0.5, MD 2');

  // ---------------------------------------------------------------- extended rule
  Object.assign(p.params, DEFAULT_PARAMS, modeDefaults(MODE_EXTENDED), {
    mode: MODE_EXTENDED, physarumOn: 1, followerCount: 0, flockCount: 0, backgroundPreset: 21, penPreset: 21,
    presetSeconds: 0, respawnRate: 0, inertia: 0,
  });
  p.setPen(0.5, 0.5, false);
  const preset = presetOfSlot(21);
  const ctx = { width: W, height: H, pixelScale: pixelScaleFor(W, H), background: preset, pen: preset, penWeight: 0 };
  // Row 21 reads S as trail times a scale; trail values around 0.02 to 0.05 keep S well inside (0, 1].
  for (let i = 0; i < trail.length; i++) trail[i] = 0.02 + 0.03 * hash01(i + 7);
  const extAgents: AgentState[] = [
    { x: 0.25 * W + 0.5, y: 0.3 * H + 0.5, heading: 0.3 },
    { x: 0.45 * W + 0.5, y: 0.4 * H + 0.5, heading: 1.0 },
    { x: 0.65 * W + 0.5, y: 0.6 * H + 0.5, heading: 2.0 },
    { x: 0.85 * W + 0.5, y: 0.7 * H + 0.5, heading: 4.0 },
    { x: 4.5, y: 0.6 * H + 0.5, heading: Math.PI + 0.1 },
  ];
  const extFlat = new Float32Array(extAgents.length * 4);
  extAgents.forEach((a, i) => extFlat.set([a.x / W, a.y / H, a.heading, 0], i * 4));
  p.params.agentCount = extAgents.length;
  let sOk = true;
  let valuesOk = true;
  let extReadOk = true;
  let extTurnOk = true;
  let worstValue = 0;
  for (let k = 0; k < extAgents.length; k++) {
    p.probeAgent = k;
    p.reset(1);
    p.debugWriteAgents(extFlat);
    p.debugWriteTrail(trail);
    p.step();
    const probe = readProbeWords(await p.readProbe());
    const a = extAgents[k];
    if (!probe || probe.agent !== k) { sOk = false; continue; }
    const cell = (x: number, y: number) => trail[wrap(Math.floor(y), H) * W + wrap(Math.floor(x), W)];
    const guess = stepAgentExtended(a, (ix, iy) => trail[iy * W + ix], ctx, probe.turn > 0);
    const v = guess.values;
    sOk = sOk && Math.abs(probe.S - guess.S) < 1e-5 * Math.max(1, guess.S);
    const diffs = [probe.sensorDistance - v.sensorDistance, probe.sensorAngle - v.sensorAngle, probe.rotationAngle - v.rotationAngle, probe.moveDistance - v.moveDistance];
    worstValue = Math.max(worstValue, ...diffs.map(Math.abs));
    valuesOk = valuesOk && diffs.every((d) => Math.abs(d) < 1e-3);
    // The readings come from the sensor positions the shader used; the CPU reads the trail there.
    extReadOk = extReadOk
      && probe.plus.reading === cell(probe.plus.x, probe.plus.y)
      && probe.middle.reading === cell(probe.middle.x, probe.middle.y)
      && probe.minus.reading === cell(probe.minus.x, probe.minus.y);
    // Sensor positions follow from the agent, heading and the governing values.
    const dist = (x: number, y: number, angle: number) =>
      Math.hypot(x - (a.x + Math.cos(angle) * probe.sensorDistance), y - (a.y + Math.sin(angle) * probe.sensorDistance));
    extReadOk = extReadOk
      && dist(probe.plus.x, probe.plus.y, a.heading + probe.sensorAngle) < 1e-2
      && dist(probe.middle.x, probe.middle.y, a.heading) < 1e-2
      && dist(probe.minus.x, probe.minus.y, a.heading - probe.sensorAngle) < 1e-2;
    // The turn: heading change of the CPU reference (no flow, no inertia, no waves) is the rule's turn.
    extTurnOk = extTurnOk && Math.abs(angleDiff(guess.heading, a.heading) - probe.turn) < 1e-3;
  }
  check('probe: extended, S and the four governing values equal the CPU reference', sOk && valuesOk, `worst value error ${worstValue.toExponential(1)}`);
  check('probe: extended, the readings are the trail where the sensors are, and the sensors are where the values say', extReadOk, `${extAgents.length} agents`);
  check('probe: extended, the recorded turn equals the heading change of the CPU reference', extTurnOk, '');

  // ---------------------------------------------------------------- pick
  const N = 100_000;
  Object.assign(p.params, DEFAULT_PARAMS, { mode: MODE_CLASSIC, physarumOn: 1, followerCount: 0, flockCount: 20_000, agentCount: N, respawnRate: 0, moveDistance: 1.5 });
  p.probeAgent = -1;
  p.reset(5);
  for (let i = 0; i < 20; i++) p.step();
  await p.whenIdle();
  const read = async (buf: GPUBuffer, n: number) => new Float32Array(await p.debugRead(buf, n * 16));
  const A = await read(p.agentBuffer, N);
  const B = await read(p.flock.boidBuffer, 20_000);
  const nearest = (items: Float32Array, n: number, x: number, y: number) => {
    let best = Infinity;
    for (let i = 0; i < n; i++) {
      let dx = (items[i * 4] - x) * W;
      let dy = (items[i * 4 + 1] - y) * H;
      dx -= W * Math.round(dx / W);
      dy -= H * Math.round(dy / H);
      best = Math.min(best, Math.hypot(dx, dy));
    }
    return best;
  };
  const distanceTo = (items: Float32Array, i: number, x: number, y: number) => {
    let dx = (items[i * 4] - x) * W;
    let dy = (items[i * 4 + 1] - y) * H;
    dx -= W * Math.round(dx / W);
    dy -= H * Math.round(dy / H);
    return Math.hypot(dx, dy);
  };
  let worstAgent = 0;
  let worstBoid = 0;
  // 15 random points and 5 on the world's edges and corner, where the nearest item can be across the edge.
  const points: [number, number][] = Array.from({ length: 15 }, (_, t) => [hash01(1000 + t), hash01(2000 + t)]);
  points.push([0.0004, 0.5], [0.9996, 0.37], [0.61, 0.0004], [0.23, 0.9996], [0.9998, 0.9998]);
  for (const [x, y] of points) {
    const a = await p.pickNearest(p.agentBuffer, N, x, y);
    worstAgent = Math.max(worstAgent, Math.abs(distanceTo(A, a.index, x, y) - nearest(A, N, x, y)), Math.abs(a.distance - nearest(A, N, x, y)));
    const b = await p.pickNearest(p.flock.boidBuffer, 20_000, x, y);
    worstBoid = Math.max(worstBoid, Math.abs(distanceTo(B, b.index, x, y) - nearest(B, 20_000, x, y)), Math.abs(b.distance - nearest(B, 20_000, x, y)));
  }
  check('pick: the agent chosen at a point is the nearest one (15 random points and 5 at the edges, brute force on a read-back)', worstAgent < 0.05, `worst distance error ${worstAgent.toExponential(1)} px of ${N.toLocaleString()} agents`);
  check('pick: the boid chosen at a point is the nearest one (15 random points and 5 at the edges)', worstBoid < 0.05, `worst distance error ${worstBoid.toExponential(1)} px of 20,000 boids`);

  // The chosen agent keeps its index: over 60 steps it never moves more than one step length.
  const chosen = await p.selectAgent(0.5, 0.5);
  let prev = await read(p.agentBuffer, N);
  let px = prev[chosen * 4];
  let py = prev[chosen * 4 + 1];
  let worstJump = 0;
  for (let s = 0; s < 60; s++) {
    p.step();
    await p.whenIdle();
    const now = await read(p.agentBuffer, N);
    let dx = (now[chosen * 4] - px) * W;
    let dy = (now[chosen * 4 + 1] - py) * H;
    dx -= W * Math.round(dx / W);
    dy -= H * Math.round(dy / H);
    worstJump = Math.max(worstJump, Math.hypot(dx, dy));
    px = now[chosen * 4];
    py = now[chosen * 4 + 1];
    prev = now;
  }
  check('pick: the chosen agent is the same agent for 60 steps (it moves at most one step length per step)', worstJump <= 1.5 + 0.01, `largest move ${worstJump.toFixed(3)} px, move distance 1.5`);

  p.probeAgent = savedProbe;
  return checks;
}

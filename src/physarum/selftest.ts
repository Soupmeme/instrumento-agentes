// In-browser self-test of the Physarum GPU code. Run from the console in a dev build:
//   await __physarumSelfTest()
// It needs a real WebGPU adapter, so it cannot run under Node. What it covers:
//   1. Agent rule: a few agents on a hand-built trail are stepped once by the GPU shader and
//      compared with the CPU reference (reference.ts): sensing, all turn cases, movement,
//      wrapping across the world edge. The random turn is checked to be +RA or -RA.
//   2. Counter invariant: after a step, the per-pixel counts add up to exactly the number of
//      awake agents (no agent lost or counted twice).
//   3. Health: no NaN in agents or trail, positions inside the world, trail non-negative.
//   4. Determinism: the same seed and the same number of steps give bit-identical agents.
// What it does NOT cover: the blur and decay values (only that they are finite and
// non-negative), the display pass, visual quality, or any GPU other than the one running it.

import type { Physarum } from './physarum';
import { sensorCell, stepAgent, wrap, type AgentState, type StepParams } from './reference';

export interface SelfTestResult {
  adapter: string;
  passed: boolean;
  checks: { name: string; ok: boolean; detail: string }[];
}

const TAU = Math.PI * 2;
/** Signed smallest difference between two angles. */
const angleDiff = (a: number, b: number) => wrap(a - b + Math.PI, TAU) - Math.PI;

export async function runSelfTest(p: Physarum): Promise<SelfTestResult> {
  const checks: SelfTestResult['checks'] = [];
  const check = (name: string, ok: boolean, detail = '') => checks.push({ name, ok, detail });

  const saved = { ...p.params };
  const W = p.gridWidth;
  const H = p.gridHeight;

  // ---- 1. Agent rule against the CPU reference ----
  Object.assign(p.params, { sensorDistance: 10, sensorAngle: 0.7, rotationAngle: 0.5, moveDistance: 2, respawnRate: 0 });
  const sp: StepParams = {
    width: W,
    height: H,
    sensorDistance: 10,
    sensorAngle: 0.7,
    rotationAngle: 0.5,
    moveDistance: 2,
  };

  type Case = { name: string; a: AgentState; hot: 'F' | 'L' | 'R' | 'LR' | 'none'; random?: boolean };
  const cases: Case[] = [
    { name: 'keep straight (F highest)', a: { x: 0.2 * W + 0.5, y: 0.3 * H + 0.5, heading: 0.3 }, hot: 'F' },
    { name: 'turn toward left sensor', a: { x: 0.4 * W + 0.5, y: 0.3 * H + 0.5, heading: 1.0 }, hot: 'L' },
    { name: 'turn toward right sensor', a: { x: 0.6 * W + 0.5, y: 0.3 * H + 0.5, heading: 2.0 }, hot: 'R' },
    { name: 'middle lowest, random side', a: { x: 0.8 * W + 0.5, y: 0.3 * H + 0.5, heading: 4.0 }, hot: 'LR', random: true },
    { name: 'empty ground, no turn', a: { x: 0.3 * W + 0.5, y: 0.7 * H + 0.5, heading: 5.0 }, hot: 'none' },
    // Near the left edge, heading left (pi): the left-side sensor wraps to the right edge.
    { name: 'sensing and moving across the edge', a: { x: 3.5, y: 0.5 * H + 0.5, heading: Math.PI + 0.05 }, hot: 'L' },
  ];

  const trail = new Float32Array(W * H);
  for (const c of cases) {
    const cell = (angle: number) => sensorCell(c.a, angle, sp);
    const set = (angle: number, v: number) => {
      const [ix, iy] = cell(angle);
      trail[iy * W + ix] = v;
    };
    if (c.hot === 'F') set(c.a.heading, 1);
    if (c.hot === 'L') set(c.a.heading + sp.sensorAngle, 1);
    if (c.hot === 'R') set(c.a.heading - sp.sensorAngle, 1);
    if (c.hot === 'LR') {
      set(c.a.heading + sp.sensorAngle, 1);
      set(c.a.heading - sp.sensorAngle, 1);
    }
  }
  const agents = new Float32Array(cases.length * 4);
  cases.forEach((c, i) => agents.set([c.a.x / W, c.a.y / H, c.a.heading, 0], i * 4));

  p.params.agentCount = cases.length;
  p.reset(1);
  p.debugWriteAgents(agents);
  p.debugWriteTrail(trail);
  p.step();
  const out = new Float32Array(await p.debugRead(p.agentBuffer, cases.length * 16));

  cases.forEach((c, i) => {
    const got: AgentState = { x: out[i * 4] * W, y: out[i * 4 + 1] * H, heading: out[i * 4 + 2] };
    const trailAt = (ix: number, iy: number) => trail[iy * W + ix];
    let coin = true;
    if (c.random) coin = angleDiff(got.heading, c.a.heading) > 0; // take whichever side the GPU chose
    const want = stepAgent(c.a, trailAt, sp, coin);

    const dh = Math.abs(angleDiff(got.heading, want.heading));
    const dx = Math.abs(got.x - want.x);
    const dy = Math.abs(got.y - want.y);
    let ok = dh < 1e-4 && dx < 2e-3 && dy < 2e-3;
    let detail = `heading err ${dh.toExponential(1)} rad, position err ${Math.max(dx, dy).toExponential(1)} px`;
    if (c.random) {
      const turned = Math.abs(Math.abs(angleDiff(got.heading, c.a.heading)) - sp.rotationAngle);
      ok = ok && turned < 1e-4;
      detail += `, turned ${angleDiff(got.heading, c.a.heading) > 0 ? '+' : '-'}RA`;
    }
    check(`agent rule: ${c.name}`, ok, detail);
  });

  // ---- 2 and 3. Counter invariant and health, with the real agent count ----
  const N = 100_000;
  Object.assign(p.params, saved, { agentCount: N });
  p.reset(1234);
  for (let i = 0; i < 5; i++) p.step();

  const counts = new Uint32Array(await p.debugRead(p.counterBuffer, W * H * 4));
  let sum = 0;
  for (const v of counts) sum += v;
  check('counter invariant: counts add up to the awake agents', sum === N, `sum ${sum}, agents ${N}`);

  const ag = new Float32Array(await p.debugRead(p.agentBuffer, N * 16));
  let bad = 0;
  let outside = 0;
  for (let i = 0; i < N; i++) {
    const x = ag[i * 4];
    const y = ag[i * 4 + 1];
    const h = ag[i * 4 + 2];
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(h)) bad++;
    else if (x < 0 || x >= 1 || y < 0 || y >= 1 || h < 0 || h > TAU + 1e-4) outside++;
  }
  check('agents: no NaN or infinity', bad === 0, `${bad} bad`);
  check('agents: positions in [0,1), headings in [0, 2pi]', outside === 0, `${outside} outside`);

  const tr = new Float32Array(await p.debugRead(p.trailBuffer, W * H * 4));
  let tBad = 0;
  let tMin = Infinity;
  let tMax = -Infinity;
  for (const v of tr) {
    if (!Number.isFinite(v)) tBad++;
    else {
      if (v < tMin) tMin = v;
      if (v > tMax) tMax = v;
    }
  }
  check('trail: finite, non-negative, not empty', tBad === 0 && tMin >= 0 && tMax > 0, `min ${tMin}, max ${tMax.toFixed(3)}, bad ${tBad}`);

  // ---- 4. Determinism ----
  const run = async () => {
    p.reset(42);
    for (let i = 0; i < 10; i++) p.step();
    return new Float32Array(await p.debugRead(p.agentBuffer, N * 16));
  };
  const a = await run();
  const b = await run();
  let diff = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++;
  check('determinism: same seed and steps give identical agents', diff === 0, `${diff} differing values of ${a.length}`);

  // Leave the instrument as we found it, with a fresh random start.
  Object.assign(p.params, saved);
  p.reset();

  return {
    adapter: 'real WebGPU adapter (see HUD)',
    passed: checks.every((c) => c.ok),
    checks,
  };
}

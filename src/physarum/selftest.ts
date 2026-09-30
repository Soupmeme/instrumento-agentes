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
//   5. Extended mode (36 Points rule): controlled agents on a hand-built trail are stepped once
//      by move_extended.wgsl and compared with the CPU reference (extended.ts), for the
//      background preset, for the pen preset (pen exactly on the agent), for trail-dependent
//      parameters (S), for empty ground and for wrapping; plus counter sum, no NaN, positions in
//      [0,1) and determinism in extended mode.
// What it does NOT cover: the blur and decay values (only that they are finite and
// non-negative), the display pass, visual quality, or any GPU other than the one running it.
// Also not covered on the GPU: waves, stir, inertia, spawn and the noise wobble of the pen
// edge (measured with __exp.effects() instead, which reports numbers rather than pass or fail).

import type { Physarum } from './physarum';
import { sensorCell, stepAgent, wrap, type AgentState, type StepParams } from './reference.ts';
import { extendedValues, mixVectors, pixelScaleFor, stepAgentExtended } from './extended.ts';
import { MODE_CLASSIC, MODE_EXTENDED, modeDefaults } from './params';
import { presetOfSlot } from './presets';

export interface SelfTestResult {
  adapter: string;
  passed: boolean;
  checks: { name: string; ok: boolean; detail: string }[];
}

const TAU = Math.PI * 2;
/** Signed smallest difference between two angles. */
const angleDiff = (a: number, b: number) => wrap(a - b + Math.PI, TAU) - Math.PI;

/**
 * Runs every check with the frame loop paused. Without this the loop's own 60 Hz steps land
 * between the test's steps and two "identical" runs take different numbers of steps (this made
 * the determinism check fail once extended mode made the runs slower; in M1 it passed only by
 * luck of timing).
 */
export async function runSelfTest(p: Physarum): Promise<SelfTestResult> {
  const wasPaused = p.paused;
  p.paused = true;
  try {
    return await runChecks(p);
  } finally {
    p.paused = wasPaused;
  }
}

async function runChecks(p: Physarum): Promise<SelfTestResult> {
  const checks: SelfTestResult['checks'] = [];
  const check = (name: string, ok: boolean, detail = '') => checks.push({ name, ok, detail });

  const saved = { ...p.params };
  const W = p.gridWidth;
  const H = p.gridHeight;

  // ---- 1. Agent rule against the CPU reference ----
  Object.assign(p.params, { mode: MODE_CLASSIC, sensorDistance: 10, sensorAngle: 0.7, rotationAngle: 0.5, moveDistance: 2, respawnRate: 0 });
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
  Object.assign(p.params, saved, { mode: MODE_CLASSIC, agentCount: N });
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

  // ---- 5. Extended mode ----
  checks.push(...(await extendedChecks(p)));

  // Leave the instrument as we found it, with a fresh random start.
  Object.assign(p.params, saved);
  p.reset();

  return {
    adapter: 'real WebGPU adapter (see HUD)',
    passed: checks.every((c) => c.ok),
    checks,
  };
}

/** Checks of the extended (36 Points) mode. See the header of this file. */
async function extendedChecks(p: Physarum): Promise<SelfTestResult['checks']> {
  const checks: SelfTestResult['checks'] = [];
  const check = (name: string, ok: boolean, detail = '') => checks.push({ name, ok, detail });
  const W = p.gridWidth;
  const H = p.gridHeight;
  const pixelScale = pixelScaleFor(W, H);

  // bg: slot 21 (row 21), strongly S dependent. pen: slot 13 (row 12), very different values.
  const BG = 21;
  const PEN = 13;
  Object.assign(p.params, modeDefaults(MODE_EXTENDED), {
    mode: MODE_EXTENDED,
    backgroundPreset: BG,
    penPreset: PEN,
    presetSeconds: 0,
    respawnRate: 0,
    inertia: 0,
    penRadius: 0.2,
  });
  const bgRow = presetOfSlot(BG);
  const penRow = presetOfSlot(PEN);

  type Case = { name: string; a: AgentState; penOn: boolean; sValue: number; hot: 'L' | 'R' | 'F' | 'none'; random?: boolean };
  const cases: Case[] = [
    { name: 'empty ground, background preset', a: { x: 0.2 * W + 0.5, y: 0.3 * H + 0.5, heading: 0.3 }, penOn: false, sValue: 0, hot: 'none' },
    { name: 'trail under agent sets S (background), turn toward +SA side', a: { x: 0.4 * W + 0.5, y: 0.3 * H + 0.5, heading: 1.0 }, penOn: false, sValue: 0.5 / 19, hot: 'R' },
    // The S values below are chosen so the sensor distance is large (16 to 30 px). With a tiny
    // distance all three sensors read the same cell, no turn is exercised, and a broken turn
    // rule would pass unnoticed (a mutation check caught exactly that with S = 0.3, SD 0.64).
    { name: 'trail under agent sets S (background), turn toward -SA side', a: { x: 0.6 * W + 0.5, y: 0.3 * H + 0.5, heading: 2.0 }, penOn: false, sValue: 0.55 / 19, hot: 'L' },
    { name: 'forward sensor strongest keeps heading', a: { x: 0.8 * W + 0.5, y: 0.3 * H + 0.5, heading: 4.0 }, penOn: false, sValue: 0.5 / 19, hot: 'F' },
    { name: 'wrap across the edge', a: { x: 4.5, y: 0.6 * H + 0.5, heading: Math.PI + 0.1 }, penOn: false, sValue: 0.6 / 19, hot: 'R' },
    { name: 'random turn (middle lowest)', a: { x: 0.3 * W + 0.5, y: 0.7 * H + 0.5, heading: 5.0 }, penOn: false, sValue: 0.45 / 19, hot: 'none', random: true },
  ];
  const penCases: Case[] = [
    { name: 'pen preset, empty ground', a: { x: 0.5 * W + 0.5, y: 0.5 * H + 0.5, heading: 0.7 }, penOn: true, sValue: 0, hot: 'none' },
    { name: 'pen preset, S from trail, turn', a: { x: 0.5 * W + 0.5, y: 0.5 * H + 0.5, heading: 2.2 }, penOn: true, sValue: 0.05 / 12, hot: 'R' },
  ];

  const run = async (list: Case[], penOn: boolean) => {
    const trail = new Float32Array(W * H);
    const ctxOf = (c: Case) => ({
      width: W,
      height: H,
      pixelScale,
      background: bgRow,
      pen: penRow,
      penWeight: c.penOn ? 1 : 0,
    });
    for (const c of list) {
      const v = mixVectors(bgRow, penRow, c.penOn ? 1 : 0);
      const dir = [Math.cos(c.a.heading), Math.sin(c.a.heading)];
      const sx = Math.floor(c.a.x + v[13] * dir[0]);
      const sy = Math.floor(c.a.y + v[13] * dir[1] + v[12]);
      trail[wrap(sy, H) * W + wrap(sx, W)] = c.sValue;
      const S = Math.min(1, Math.max(1e-9, c.sValue * v[14]));
      const vals = extendedValues(v, S, pixelScale);
      const cellAt = (angle: number) => [
        wrap(Math.floor(c.a.x + Math.cos(angle) * vals.sensorDistance), W),
        wrap(Math.floor(c.a.y + Math.sin(angle) * vals.sensorDistance), H),
      ];
      const set = (angle: number, value: number) => {
        const [ix, iy] = cellAt(angle);
        trail[iy * W + ix] = Math.max(trail[iy * W + ix], value);
      };
      // The rule reads left at heading - SA and right at heading + SA.
      if (c.hot === 'L') set(c.a.heading - vals.sensorAngle, 1e-3);
      if (c.hot === 'R') set(c.a.heading + vals.sensorAngle, 1e-3);
      if (c.hot === 'F') set(c.a.heading, 1e-3);
    }
    const agents = new Float32Array(list.length * 4);
    list.forEach((c, i) => agents.set([c.a.x / W, c.a.y / H, c.a.heading, 0], i * 4));

    p.params.agentCount = list.length;
    p.reset(1);
    // The pen sits exactly on the first agent, so its pen weight is exactly 1 (distance 0).
    // Going through Float32Array makes the pen and the stored agent agree to the last bit.
    const f32 = new Float32Array([list[0].a.x / W, list[0].a.y / H]);
    p.setPen(f32[0], f32[1], penOn);
    p.debugWriteAgents(agents);
    p.debugWriteTrail(trail);
    p.step();
    const out = new Float32Array(await p.debugRead(p.agentBuffer, list.length * 16));

    list.forEach((c, i) => {
      const got: AgentState = { x: out[i * 4] * W, y: out[i * 4 + 1] * H, heading: out[i * 4 + 2] };
      let coin = true;
      if (c.random) coin = angleDiff(got.heading, c.a.heading) > 0;
      const want = stepAgentExtended(c.a, (ix, iy) => trail[iy * W + ix], ctxOf(c), coin);
      const dh = Math.abs(angleDiff(got.heading, want.heading));
      const dx = Math.abs(wrap(got.x - want.x + W / 2, W) - W / 2);
      const dy = Math.abs(wrap(got.y - want.y + H / 2, H) - H / 2);
      const ok = dh < 2e-4 && dx < 5e-3 && dy < 5e-3;
      check(
        `extended rule: ${c.name}`,
        ok,
        `S ${want.S.toExponential(2)}, SD ${want.values.sensorDistance.toFixed(2)}, MD ${want.values.moveDistance.toFixed(3)}, heading err ${dh.toExponential(1)} rad, position err ${Math.max(dx, dy).toExponential(1)} px`,
      );
    });
  };

  await run(cases, false);
  // The pen checks use one agent each, run separately so the pen can sit on it.
  for (const c of penCases) await run([c], true);

  // Counter, health and determinism with the real extended rule and a real agent count.
  const N = 100_000;
  Object.assign(p.params, { agentCount: N, respawnRate: 0.001 });
  p.setPen(0.5, 0.5, true); // a live pen, so the blend and the noise wobble are exercised
  const runSteps = async (seed: number) => {
    p.reset(seed);
    for (let i = 0; i < 10; i++) p.step();
    await p.whenIdle();
    return new Float32Array(await p.debugRead(p.agentBuffer, N * 16));
  };
  const first = await runSteps(42);
  const counts = new Uint32Array(await p.debugRead(p.counterBuffer, W * H * 4));
  let sum = 0;
  for (const v of counts) sum += v;
  check('extended counter invariant: counts add up to the awake agents', sum === N, `sum ${sum}, agents ${N}`);
  let bad = 0;
  let outside = 0;
  for (let i = 0; i < N; i++) {
    const x = first[i * 4];
    const y = first[i * 4 + 1];
    const h = first[i * 4 + 2];
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(h)) bad++;
    else if (x < 0 || x >= 1 || y < 0 || y >= 1 || h < 0 || h > TAU + 1e-4) outside++;
  }
  check('extended agents: no NaN, positions in [0,1), headings in [0, 2pi]', bad === 0 && outside === 0, `${bad} bad, ${outside} outside`);
  const second = await runSteps(42);
  let diff = 0;
  for (let i = 0; i < first.length; i++) if (first[i] !== second[i]) diff++;
  check('extended determinism: same seed and steps give identical agents', diff === 0, `${diff} differing values of ${first.length}`);

  p.setPen(0.5, 0.5, false);
  return checks;
}

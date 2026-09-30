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
//   6. Flow layer: the field pass (noise angle, curl, quantized, pen swirl with stir) is compared
//      cell by cell with the CPU reference (flowfield.ts); the follower pass is compared with the
//      CPU steering rule using the GPU's own field as data (so it isolates the steering and the
//      interpolation from the noise); plus counter sum, no NaN, speed cap and determinism.
//   7. Flock: grid, boid step and health checks (see src/flock/selftest_flock.ts).
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
import { flockChecks } from '../flock/selftest_flock';
import { fieldVector, stepFollower, KIND_NOISE_ANGLE, KIND_CURL, PEN_NONE, PEN_SWIRL, type FieldConfig, type FollowerConfig } from '../flow/flowfield.ts';

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
  Object.assign(p.params, { mode: MODE_CLASSIC, physarumOn: 1, followerCount: 0, sensorDistance: 10, sensorAngle: 0.7, rotationAngle: 0.5, moveDistance: 2, respawnRate: 0 });
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
  Object.assign(p.params, saved, { mode: MODE_CLASSIC, physarumOn: 1, followerCount: 0, agentCount: N });
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

  // ---- 6. Flow field and flow followers ----
  checks.push(...(await flowChecks(p)));

  // ---- 7. Flock ----
  checks.push(...(await flockChecks(p)));

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
    physarumOn: 1,
    followerCount: 0,
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

/** Checks of the flow field pass and the flow followers. See the header of this file. */
async function flowChecks(p: Physarum): Promise<SelfTestResult['checks']> {
  const checks: SelfTestResult['checks'] = [];
  const check = (name: string, ok: boolean, detail = '') => checks.push({ name, ok, detail });
  const W = p.gridWidth;
  const H = p.gridHeight;
  const fw = p.flow.fieldWidth;
  const fh = p.flow.fieldHeight;

  // Followers only, no Physarum, nothing random: the field is rebuilt by every step.
  Object.assign(p.params, {
    mode: MODE_CLASSIC,
    physarumOn: 0,
    followerCount: 1,
    followerSpeed: 2.5,
    followerForce: 0.12,
    followerLookahead: 0,
    followerRespawn: 0,
    fieldStrength: 0.8,
    penFieldMode: PEN_NONE,
    penFieldStrength: 0.9,
    penRadius: 0.25,
  });

  // ---- the field pass against the CPU reference ----
  type FieldCase = { name: string; set: Partial<typeof p.params>; pen?: boolean; tolerantCells?: number };
  const fieldCases: FieldCase[] = [
    { name: 'noise angle', set: { fieldKind: KIND_NOISE_ANGLE, fieldFrequency: 3.7, fieldEvolution: 0.3, fieldQuantSteps: 0 } },
    { name: 'curl noise', set: { fieldKind: KIND_CURL, fieldFrequency: 5, fieldEvolution: 0.2, fieldQuantSteps: 0 } },
    // A cell whose angle sits within float error of a snapping boundary can land on the other
    // side, so a tiny share of quantized cells may differ by one snap step.
    { name: 'quantized to 6 angles', set: { fieldKind: KIND_NOISE_ANGLE, fieldFrequency: 3, fieldEvolution: 0.1, fieldQuantSteps: 6 }, tolerantCells: Math.ceil(fw * fh * 0.01) },
    { name: 'pen swirl with stir', set: { fieldKind: KIND_NOISE_ANGLE, fieldFrequency: 3, fieldEvolution: 0.1, fieldQuantSteps: 0, penFieldMode: PEN_SWIRL }, pen: true },
  ];

  for (const c of fieldCases) {
    Object.assign(p.params, c.set);
    p.reset(5);
    p.setPen(0.4, 0.6, !!c.pen);
    for (let i = 0; i < 29; i++) p.step();
    p.pen.stirX = c.pen ? 0.5 : 0;
    p.pen.stirY = c.pen ? -0.3 : 0;
    const stirUsed: [number, number] = [p.pen.stirX, p.pen.stirY];
    p.step(); // the field of this step uses simulation time 29 / 60 and the stir set above
    const gpuField = new Float32Array(await p.debugRead(p.flow.fieldBuffer, fw * fh * 8));

    const cfg: FieldConfig = {
      kind: p.params.fieldKind,
      frequency: p.params.fieldFrequency,
      evolution: p.params.fieldEvolution,
      strength: p.params.fieldStrength,
      quantSteps: p.params.fieldQuantSteps,
      time: 29 / 60,
      aspect: W / H,
      penX: 0.4,
      penY: 0.6,
      penSigma: p.params.penRadius,
      penActive: !!c.pen,
      penMode: p.params.penFieldMode,
      penStrength: p.params.penFieldStrength,
      stirX: stirUsed[0],
      stirY: stirUsed[1],
    };
    let worst = 0;
    let bad = 0;
    for (let cy = 0; cy < fh; cy++) {
      for (let cx = 0; cx < fw; cx++) {
        const want = fieldVector(cfg, (cx + 0.5) / fw, (cy + 0.5) / fh);
        const i = cy * fw + cx;
        const err = Math.hypot(gpuField[2 * i] - want[0], gpuField[2 * i + 1] - want[1]);
        worst = Math.max(worst, err);
        if (err > 2e-3) bad++;
      }
    }
    const allowed = c.tolerantCells ?? 0;
    check(`flow field: ${c.name}`, bad <= allowed, `${fw}x${fh} cells, ${bad} differ by more than 2e-3 (allowed ${allowed}), worst ${worst.toExponential(1)}`);
  }

  // ---- the follower step against the CPU steering rule, on the GPU's own field ----
  Object.assign(p.params, { fieldKind: KIND_NOISE_ANGLE, fieldFrequency: 3, fieldEvolution: 0.1, fieldQuantSteps: 0, penFieldMode: PEN_NONE });
  const cases: { name: string; pos: [number, number]; vel: [number, number]; lookahead: number; force: number }[] = [
    { name: 'at rest, accelerates toward the field', pos: [0.2 * W, 0.3 * H], vel: [0, 0], lookahead: 0, force: 0.12 },
    { name: 'moving against the field, turns around within the force limit', pos: [0.5 * W, 0.5 * H], vel: [-2.5, 0], lookahead: 0, force: 0.12 },
    { name: 'strong force snaps onto the field', pos: [0.7 * W, 0.4 * H], vel: [1, 1], lookahead: 0, force: 5 },
    { name: 'weak force barely changes velocity', pos: [0.3 * W, 0.8 * H], vel: [2, -1], lookahead: 0, force: 0.005 },
    { name: 'look-ahead reads the field ahead', pos: [0.6 * W, 0.6 * H], vel: [2.4, 0.5], lookahead: 25, force: 0.3 },
    { name: 'wraps across the world edge', pos: [W - 0.4, 0.5 * H], vel: [2.5, 0], lookahead: 10, force: 0.4 },
  ];
  for (const c of cases) {
    p.params.followerCount = 1;
    p.params.followerForce = c.force;
    p.params.followerLookahead = c.lookahead;
    p.reset(6);
    p.debugWriteBuffer(p.flow.vehicleBuffer, new Float32Array([c.pos[0] / W, c.pos[1] / H, c.vel[0], c.vel[1]]));
    p.step();
    const gpuField = new Float32Array(await p.debugRead(p.flow.fieldBuffer, fw * fh * 8));
    const out = new Float32Array(await p.debugRead(p.flow.vehicleBuffer, 16));

    const fc: FollowerConfig = {
      width: W, height: H, fieldW: fw, fieldH: fh, maxSpeed: p.params.followerSpeed, maxForce: c.force, lookahead: c.lookahead,
    };
    // The vehicle was stored as float32 normalised position: use the same rounded value.
    const start = new Float32Array([c.pos[0] / W, c.pos[1] / H]);
    const want = stepFollower(gpuField, [start[0] * W, start[1] * H], c.vel, fc);
    const dpx = Math.abs((((out[0] * W - want.pos[0]) + W / 2) % W + W) % W - W / 2);
    const dpy = Math.abs((((out[1] * H - want.pos[1]) + H / 2) % H + H) % H - H / 2);
    const dv = Math.hypot(out[2] - want.vel[0], out[3] - want.vel[1]);
    check(
      `follower steering: ${c.name}`,
      dpx < 2e-3 && dpy < 2e-3 && dv < 1e-4,
      `velocity (${out[2].toFixed(3)}, ${out[3].toFixed(3)}), speed ${Math.hypot(out[2], out[3]).toFixed(3)} of max ${fc.maxSpeed}, position err ${Math.max(dpx, dpy).toExponential(1)} px, velocity err ${dv.toExponential(1)}`,
    );
  }

  // ---- counter, health, determinism with a real number of followers ----
  const N = 100_000;
  Object.assign(p.params, { followerCount: N, followerForce: 0.12, followerLookahead: 6, followerRespawn: 0.002, fieldKind: KIND_CURL });
  const runSteps = async (seed: number) => {
    p.reset(seed);
    for (let i = 0; i < 20; i++) p.step();
    await p.whenIdle();
    return new Float32Array(await p.debugRead(p.flow.vehicleBuffer, N * 16));
  };
  const first = await runSteps(77);
  const counts = new Uint32Array(await p.debugRead(p.flow.counterBuffer, W * H * 4));
  let sum = 0;
  for (const v of counts) sum += v;
  check('follower counter invariant: counts add up to the awake followers', sum === N, `sum ${sum}, followers ${N}`);
  let bad = 0;
  let outside = 0;
  let fast = 0;
  for (let i = 0; i < N; i++) {
    const x = first[i * 4];
    const y = first[i * 4 + 1];
    const speed = Math.hypot(first[i * 4 + 2], first[i * 4 + 3]);
    if (![x, y, speed].every(Number.isFinite)) bad++;
    else {
      if (x < 0 || x >= 1 || y < 0 || y >= 1) outside++;
      if (speed > p.params.followerSpeed + 1e-4) fast++;
    }
  }
  check('followers: no NaN, positions in [0,1), speed never above maxSpeed', bad === 0 && outside === 0 && fast === 0, `${bad} bad, ${outside} outside, ${fast} too fast`);
  const second = await runSteps(77);
  let diff = 0;
  for (let i = 0; i < first.length; i++) if (first[i] !== second[i]) diff++;
  check('follower determinism: same seed and steps give identical followers', diff === 0, `${diff} differing values of ${first.length}`);

  return checks;
}

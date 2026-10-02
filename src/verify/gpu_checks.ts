// The GPU checks of the prediction registry (src/verify/predictions.ts). Each one is registered
// under the id of the prediction it tests, runs on the real WebGPU adapter from a fixed seed (7),
// and returns pass or fail with the numbers behind it. Run them from the console of the development
// server:
//
//   await __exp.verify()                  every GPU check (a few minutes; it is a background job, poll window.__verify)
//   await __exp.verify(['PC-01', 'FO-02'])  only those
//   await __exp.verify('flock')           only one family
//
// How to read a result: `pass` says whether the prediction, as worded in the registry, held in
// this run. The thresholds are written in the checks and repeated in the registry statement. A
// check that is `origin: 'earlier'` re-runs something stated and measured in M1 to M6, so a pass
// means "still true". A failure is a finding: either the claim is wrong or something broke.
//
// Limits: one machine, one seed, one grid size, one adapter. Dev only (it reads buffers back and
// loops over pixels and agents on the CPU, as every test tool here does; CLAUDE.md rule 3 allows
// that for tests).

import type { Physarum } from '../physarum/physarum';
import { DEFAULT_PARAMS, MODE_EXTENDED, modeDefaults, type PhysarumParams } from '../physarum/params';
import { CURATED_SLOTS } from '../physarum/presets';
import type * as X from '../physarum/experiments';
import { couplingStats as couplingStatsFn } from '../coupling/experiments_coupling';
import { sceneTest, transitionTest } from '../scenes/experiments_scenes';
import { sweepShots } from './sweep_shots';
import { PREDICTIONS, type Family } from './predictions';

export interface Tools {
  p: Physarum;
  x: typeof X;
}
export interface CheckResult {
  pass: boolean;
  values: Record<string, unknown>;
  note?: string;
}
export type GpuCheck = (t: Tools) => Promise<CheckResult>;

const r = (v: number, d = 3) => +v.toFixed(d);
const deg = (d: number) => (d * Math.PI) / 180;
const f32 = async (p: Physarum, buf: GPUBuffer, bytes: number) => new Float32Array(await p.debugRead(buf, bytes));
const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const wrapDelta = (d: number, size: number) => (d > size / 2 ? d - size : d < -size / 2 ? d + size : d);

type Row = Record<string, number | string | boolean>;
const num = (row: Row, key: string) => Number(row[key]);

/** Sweep one parameter on the classic rule and return the numeric rows (no contact sheet left on screen). */
async function sweepRows(t: Tools, key: keyof PhysarumParams, values: number[], steps = 900): Promise<Row[]> {
  const rows = (await t.x.sweep(t.p, key, values, { steps })) as Row[];
  t.x.hideSheet();
  return rows;
}

/** Trail statistics at each checkpoint (steps) of one run from the seed. */
async function trailRun(t: Tools, set: Partial<PhysarumParams>, checkpoints: number[], seed = 7) {
  const { p } = t;
  const saved = { ...p.params };
  p.paused = true;
  const W = p.gridWidth;
  const H = p.gridHeight;
  try {
    Object.assign(p.params, DEFAULT_PARAMS, set);
    p.reset(seed);
    const out: ReturnType<typeof t.x.analyzeTrail>[] = [];
    let done = 0;
    for (const at of checkpoints) {
      while (done < at) {
        p.step();
        done++;
        if (done % 200 === 0) await p.whenIdle();
      }
      await p.whenIdle();
      out.push(t.x.analyzeTrail(await f32(p, p.trailBuffer, W * H * 4), W, H));
    }
    return out;
  } finally {
    Object.assign(p.params, saved);
    p.reset();
    p.paused = false;
  }
}

/** FNV-1a over the bits of the trail, the agents and the boids, after `steps` steps. `between` runs every `every` steps (for rendering). */
async function stateHash(t: Tools, set: Partial<PhysarumParams>, opts: { seed?: number; steps?: number; every?: number; between?: (step: number) => Promise<void> | void } = {}) {
  const { p } = t;
  const { seed = 7, steps = 300, every = 50, between } = opts;
  const saved = { ...p.params };
  p.paused = true;
  const W = p.gridWidth;
  const H = p.gridHeight;
  try {
    Object.assign(p.params, DEFAULT_PARAMS, set);
    p.reset(seed);
    for (let i = 1; i <= steps; i++) {
      p.step();
      if (i % every === 0) {
        await p.whenIdle();
        if (between) await between(i);
      }
    }
    await p.whenIdle();
    let h = 0x811c9dc5;
    const mix = (words: Uint32Array) => {
      for (let i = 0; i < words.length; i++) {
        h ^= words[i];
        h = Math.imul(h, 0x01000193) >>> 0;
      }
    };
    mix(new Uint32Array((await f32(p, p.trailBuffer, W * H * 4)).buffer));
    mix(new Uint32Array((await f32(p, p.agentBuffer, Math.min(p.params.agentCount, 400_000) * 16)).buffer));
    if (p.params.flockCount > 0) mix(new Uint32Array((await f32(p, p.flock.boidBuffer, Math.floor(p.params.flockCount) * 16)).buffer));
    return h >>> 0;
  } finally {
    Object.assign(p.params, saved);
    p.reset();
    p.paused = false;
  }
}

/** Extended-rule settings with the same preset everywhere (no pen difference), as the preset experiments use. */
const extendedSet = (extra: Partial<PhysarumParams> = {}): Partial<PhysarumParams> => ({
  ...modeDefaults(MODE_EXTENDED),
  mode: MODE_EXTENDED,
  backgroundPreset: 21,
  penPreset: 21,
  presetSeconds: 0,
  agentCount: 1_000_000,
  ...extra,
});

// The wave, stir and burst numbers come from one long experiment, shared by three checks.
let effectsCache: Record<string, unknown> | null = null;
async function effectsOnce(t: Tools) {
  effectsCache ??= await t.x.effects(t.p);
  t.x.hideSheet();
  return effectsCache as {
    spawn: { ringBandBefore: number; ringBandAfterRingBurst: number };
    wave: { correlationWithVsWithoutAtSteps: string; coverageAfterWave15s: number; coverageNoWave15s: number };
    stir: { meanDxPixelsOver60StepsWithStir: number; meanDxWithoutStir: number };
  };
}

/** Mean absolute change of direction between two consecutive displacements, in degrees, of agents that moved normally. */
async function pathTurnDegrees(t: Tools, inertia: number) {
  const { p } = t;
  const saved = { ...p.params };
  p.paused = true;
  const W = p.gridWidth;
  const H = p.gridHeight;
  const n = 300_000;
  try {
    Object.assign(p.params, DEFAULT_PARAMS, extendedSet({ agentCount: n, inertia }));
    p.reset(7);
    for (let i = 0; i < 600; i++) p.step();
    await p.whenIdle();
    const read = async () => f32(p, p.agentBuffer, n * 16);
    const a = await read();
    p.step();
    await p.whenIdle();
    const b = await read();
    p.step();
    await p.whenIdle();
    const c = await read();
    let sum = 0;
    let count = 0;
    for (let i = 0; i < n; i++) {
      const d1x = wrapDelta((b[i * 4] - a[i * 4]) * W, W);
      const d1y = wrapDelta((b[i * 4 + 1] - a[i * 4 + 1]) * H, H);
      const d2x = wrapDelta((c[i * 4] - b[i * 4]) * W, W);
      const d2y = wrapDelta((c[i * 4 + 1] - b[i * 4 + 1]) * H, H);
      const l1 = Math.hypot(d1x, d1y);
      const l2 = Math.hypot(d2x, d2y);
      if (l1 < 0.05 || l2 < 0.05 || l1 > 20 || l2 > 20) continue; // stuck, or a respawn
      sum += Math.abs(wrapAngle(Math.atan2(d2y, d2x) - Math.atan2(d1y, d1x)));
      count++;
    }
    return { degrees: (sum / count) * (180 / Math.PI), agents: count };
  } finally {
    Object.assign(p.params, saved);
    p.reset();
    p.paused = false;
  }
}

/** Share of the followers that stand in the most crowded 1% of the pixels, after a run. */
async function followerCrowding(t: Tools, respawn: number) {
  const { p } = t;
  const saved = { ...p.params };
  p.paused = true;
  p.setPen(0.5, 0.5, false);
  const W = p.gridWidth;
  const H = p.gridHeight;
  const n = 100_000;
  try {
    Object.assign(p.params, DEFAULT_PARAMS, { physarumOn: 0, followerCount: n, decay: 0.96, fieldKind: 0, followerRespawn: respawn });
    p.reset(7);
    for (let i = 0; i < 600; i++) p.step();
    await p.whenIdle();
    const v = await f32(p, p.flow.vehicleBuffer, n * 16);
    const counts = new Uint16Array(W * H);
    for (let i = 0; i < n; i++) counts[Math.min(H - 1, Math.floor(v[i * 4 + 1] * H)) * W + Math.min(W - 1, Math.floor(v[i * 4] * W))]++;
    const sorted = [...counts].sort((x, y) => y - x);
    const top = Math.floor(W * H * 0.01);
    let inTop = 0;
    for (let i = 0; i < top; i++) inTop += sorted[i];
    return inTop / n;
  } finally {
    Object.assign(p.params, saved);
    p.reset();
    p.paused = false;
  }
}

/** Wall-clock milliseconds per step at full speed (the GPU is the limit), for `steps` steps. */
async function msPerStep(t: Tools, steps: number) {
  const { p } = t;
  await p.whenIdle();
  const start = performance.now();
  for (let i = 0; i < steps; i++) {
    p.step();
    if (i % 50 === 49) await p.whenIdle();
  }
  await p.whenIdle();
  return (performance.now() - start) / steps;
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

export const GPU_CHECKS: Record<string, GpuCheck> = {
  // ------------------------------------------------------------ Physarum, classic
  'PC-01': async (t) => {
    const [lo, hi] = await sweepRows(t, 'decay', [0.6, 0.97]);
    const ratio = num(hi, 'trailMax') / num(lo, 'trailMax');
    const gain = num(hi, 'corr1s') - num(lo, 'corr1s');
    return { pass: ratio >= 5 && gain >= 0.3, values: { trailMax: [lo.trailMax, hi.trailMax], maxRatio: r(ratio, 1), corr1s: [lo.corr1s, hi.corr1s], corrGain: r(gain) } };
  },
  'PC-02': async (t) => {
    const [a, b] = await sweepRows(t, 'sensorDistance', [16, 48]);
    const ratio = num(b, 'coverage') / num(a, 'coverage');
    return { pass: ratio >= 1.2, values: { coverage: [a.coverage, b.coverage], ratio: r(ratio, 2) } };
  },
  'PC-03': async (t) => {
    const [small, base] = await sweepRows(t, 'sensorDistance', [4, 16]);
    const ratio = num(small, 'cells') / num(base, 'cells');
    return { pass: ratio <= 0.6, values: { cells: [small.cells, base.cells], ratio: r(ratio, 2) } };
  },
  'PC-04': async (t) => {
    const [narrow, wide] = await sweepRows(t, 'sensorAngle', [deg(15), deg(90)]);
    const ratio = num(wide, 'fracTurning') / num(narrow, 'fracTurning');
    return { pass: ratio <= 0.5, values: { fracTurning: [narrow.fracTurning, wide.fracTurning], ratio: r(ratio, 2) } };
  },
  'PC-05': async (t) => {
    const rows = await sweepRows(t, 'rotationAngle', [deg(15), deg(45), deg(90)]);
    const turn = rows.map((row) => num(row, 'meanAbsTurnDeg'));
    return { pass: turn[0] < turn[1] && turn[1] < turn[2] && turn[2] >= 5 * turn[0], values: { meanTurnDeg: turn, ratio90to15: r(turn[2] / turn[0], 1) } };
  },
  'PC-06': async (t) => {
    const without = await trailRun(t, { respawnRate: 0 }, [900, 6000]);
    const withRespawn = await trailRun(t, { respawnRate: 0.01 }, [900, 6000]);
    const kept0 = without[1].cells / without[0].cells;
    const kept1 = withRespawn[1].cells / withRespawn[0].cells;
    return { pass: kept0 <= 0.6 && kept1 >= 0.7, values: { cellsRespawn0: [without[0].cells, without[1].cells], cellsRespawn001: [withRespawn[0].cells, withRespawn[1].cells], kept0: r(kept0, 2), kept001: r(kept1, 2) } };
  },
  'PC-07': async (t) => {
    const e = (await t.x.exact(t.p)) as { depositScaling: { agentsDifferingAtX2: number; agentsDifferingAtX8: number; trailValuesNotExactlyDoubledAtX2: number } };
    const d = e.depositScaling;
    return { pass: d.agentsDifferingAtX2 === 0 && d.agentsDifferingAtX8 === 0 && d.trailValuesNotExactlyDoubledAtX2 === 0, values: { ...d } };
  },
  'PC-08': async (t) => {
    const view = () => t.p.renderToPixels(32, 24).then(() => undefined); // the display runs every 50 steps, with its settings
    const plain = await stateHash(t, { displayGain: 2, palette: 0, changeColour: 0 }, { between: view });
    const other = await stateHash(t, { displayGain: 20, palette: 3, changeColour: 1 }, { between: view });
    return { pass: plain === other, values: { hashGain2Palette0Tint0: plain, hashGain20Palette3Tint1: other } };
  },
  'PC-09': async (t) => {
    const [few, many] = await sweepRows(t, 'agentCount', [50_000, 400_000]);
    const ratio = num(many, 'cells') / num(few, 'cells');
    return { pass: ratio >= 1.5, values: { cells: [few.cells, many.cells], ratio: r(ratio, 2) } };
  },
  'PC-10': async (t) => {
    const [a, b] = await sweepRows(t, 'moveDistance', [1.5, 4]);
    const ratio = num(b, 'meanDisp') / num(a, 'meanDisp');
    return { pass: Math.abs(ratio / (4 / 1.5) - 1) <= 0.1, values: { meanDisplacement: [a.meanDisp, b.meanDisp], ratio: r(ratio, 2), expected: 2.67 } };
  },
  'PC-11': async (t) => {
    const a = await stateHash(t, {}, { seed: 7 });
    const b = await stateHash(t, {}, { seed: 7 });
    const c = await stateHash(t, {}, { seed: 8 });
    return { pass: a === b && a !== c, values: { seed7: a, seed7again: b, seed8: c } };
  },

  // ------------------------------------------------------------ Physarum, extended
  'PE-01': async (t) => {
    const rows = (await t.x.gallery(t.p, [...CURATED_SLOTS], { steps: 900, later: 2700 })) as Row[];
    t.x.hideSheet();
    const coverage = rows.map((row) => num(row, 'laterCoverage'));
    return { pass: coverage.every((c) => c >= 0.02), values: { slots: [...CURATED_SLOTS], coverageAfter45s: coverage } };
  },
  'PE-02': async (t) => {
    const { p } = t;
    const saved = { ...p.params };
    p.paused = true;
    const W = p.gridWidth;
    const H = p.gridHeight;
    const sigma = 0.22;
    const BLOCK = 8;
    try {
      const image = async (penOn: boolean) => {
        Object.assign(p.params, DEFAULT_PARAMS, extendedSet({ backgroundPreset: 21, penPreset: 4, penRadius: sigma }));
        p.reset(7);
        p.setPen(0.5, 0.5, false);
        for (let i = 0; i < 590; i++) {
          if (i === 500 && penOn) p.setPen(0.5, 0.5, true);
          p.step();
          if (i % 100 === 99) await p.whenIdle();
        }
        await p.whenIdle();
        return f32(p, p.trailBuffer, W * H * 4);
      };
      const on = await image(true);
      const off = await image(false);
      const gain = DEFAULT_PARAMS.displayGain;
      const cols = Math.floor(W / BLOCK);
      const rows = Math.floor(H / BLOCK);
      let inside = 0, insideN = 0, outside = 0, outsideN = 0;
      for (let by = 0; by < rows; by++) {
        for (let bx = 0; bx < cols; bx++) {
          let a = 0, b = 0;
          for (let y = 0; y < BLOCK; y++) for (let x = 0; x < BLOCK; x++) {
            const k = (by * BLOCK + y) * W + bx * BLOCK + x;
            a += Math.tanh(gain * on[k]);
            b += Math.tanh(gain * off[k]);
          }
          const d = Math.hypot((bx + 0.5) * BLOCK - 0.5 * W, (by + 0.5) * BLOCK - 0.5 * H) / H;
          const diff = Math.abs(a - b) / (BLOCK * BLOCK);
          if (d < 0.8 * sigma) { inside += diff; insideN++; } else if (d > 2 * sigma) { outside += diff; outsideN++; }
        }
      }
      const ins = inside / insideN;
      const out = outside / outsideN;
      return { pass: ins >= 0.03 && ins >= 2 * out, values: { insideDifference: r(ins), outsideDifference: r(out), ratio: r(ins / out, 1) }, note: 'warm start: 500 steps without the pen, then 90 steps with and without it' };
    } finally {
      Object.assign(p.params, saved);
      p.reset();
      p.paused = false;
    }
  },
  'PE-03': async (t) => {
    const rows = (await t.x.transitions(t.p, [[15, 21], [14, 19], [0, 4], [21, 2]], { seconds: 0.5 })) as Row[];
    t.x.hideSheet();
    const reached = rows.map((row) => num(row, 'reachedTarget'));
    const blank = rows.map((row) => Boolean(row.blankDuring));
    return { pass: reached.every((v) => v >= 0.7 && v <= 1.3) && blank.every((b) => !b), values: { pairs: rows.map((row) => row.pair), reachedTarget: reached, blankDuring: blank } };
  },
  'PE-04': async (t) => {
    const e = await effectsOnce(t);
    const corr = Number(/180:\s*(-?[\d.]+)/.exec(e.wave.correlationWithVsWithoutAtSteps)?.[1]);
    const cover = e.wave.coverageAfterWave15s / e.wave.coverageNoWave15s;
    return { pass: corr < 0.5 && Math.abs(cover - 1) <= 0.2, values: { correlationAt3s: corr, coverageAfterOverNoWave: r(cover, 2) } };
  },
  'PE-05': async (t) => {
    const e = await effectsOnce(t);
    const withStir = e.stir.meanDxPixelsOver60StepsWithStir;
    const without = e.stir.meanDxWithoutStir;
    return { pass: withStir >= 30 && withStir >= 20 * Math.max(Math.abs(without), 0.01), values: { meanDxWithStir: withStir, meanDxWithout: without } };
  },
  'PE-06': async (t) => {
    const e = await effectsOnce(t);
    const rise = e.spawn.ringBandAfterRingBurst - e.spawn.ringBandBefore;
    return { pass: rise >= 0.05, values: { ringBandBefore: e.spawn.ringBandBefore, ringBandAfter: e.spawn.ringBandAfterRingBurst, rise: r(rise, 4), requested: 0.1 } };
  },
  'PE-07': async (t) => {
    const none = await pathTurnDegrees(t, 0);
    const full = await pathTurnDegrees(t, 1);
    return { pass: full.degrees <= 0.75 * none.degrees, values: { meanDirectionChangeDeg: [r(none.degrees, 2), r(full.degrees, 2)], ratio: r(full.degrees / none.degrees, 2), agents: [none.agents, full.agents] } };
  },

  // ------------------------------------------------------------ followers (curl field unless stated, as in the EXPLAINER)
  'FO-01': async (t) => {
    const a: number[] = [];
    for (const f of [0.02, 0.12, 1]) a.push((await t.x.followerStats(t.p, { fieldKind: 1, followerForce: f })).alignment);
    const [lo, mid, hi] = a;
    return { pass: lo < mid && mid < hi && mid >= 0.9, values: { alignmentAtForce002_012_1: [lo, mid, hi] } };
  },
  'FO-02': async (t) => {
    const slow = (await t.x.followerStats(t.p, { fieldKind: 1, followerSpeed: 2.5 })).alignment;
    const fast = (await t.x.followerStats(t.p, { fieldKind: 1, followerSpeed: 6 })).alignment;
    return { pass: slow - fast >= 0.2, values: { alignmentAtSpeed2_5_6: [slow, fast], drop: r(slow - fast) } };
  },
  'FO-03': async (t) => {
    const near = (await t.x.followerStats(t.p, { fieldKind: 1, followerLookahead: 10 })).alignment;
    const far = (await t.x.followerStats(t.p, { fieldKind: 1, followerLookahead: 30 })).alignment;
    return { pass: far < near, values: { alignmentAtLookahead10_30: [near, far] } };
  },
  'FO-04': async (t) => {
    const half = (await t.x.followerStats(t.p, { fieldKind: 1, fieldStrength: 0.5 })).meanSpeedOfMax;
    const full = (await t.x.followerStats(t.p, { fieldKind: 1, fieldStrength: 1 })).meanSpeedOfMax;
    const ratio = half / full;
    return { pass: ratio >= 0.4 && ratio <= 0.6, values: { meanSpeedOfMax: [half, full], ratio: r(ratio, 2) } };
  },
  'FO-05': async (t) => {
    const turn: number[] = [];
    for (const f of [1.5, 3, 8]) turn.push((await t.x.followerStats(t.p, { fieldKind: 1, fieldFrequency: f })).meanTurnDeg);
    return { pass: turn[0] < turn[1] && turn[1] < turn[2], values: { meanTurnDegAtFrequency1_5_3_8: turn } };
  },
  'FO-06': async (t) => {
    // Curl field, as in the EXPLAINER: the noise-angle field has sinks that crowd the pen by themselves, which hides a repel.
    const set = { fieldKind: 1 };
    const none = await t.x.penFieldStats(t.p, 0, { set });
    const swirl = await t.x.penFieldStats(t.p, 1, { set });
    const attract = await t.x.penFieldStats(t.p, 2, { set });
    const repel = await t.x.penFieldStats(t.p, 3, { set });
    const emptied = repel.followersInsidePen / none.followersInsidePen;
    return {
      pass: Math.abs(swirl.meanTangential) >= 0.5 && attract.meanRadial <= -0.5 && emptied <= 0.8,
      values: { swirlCirculation: swirl.meanTangential, attractInward: attract.meanRadial, insidePenWithoutEdit: none.followersInsidePen, insidePenRepel: repel.followersInsidePen, repelOverNone: r(emptied, 2) },
    };
  },
  'FO-07': async (t) => {
    const n = 100_000;
    const frozen = await t.x.followerStats(t.p, { fieldKind: 1, fieldEvolution: 0 }, { count: n });
    const drifting = await t.x.followerStats(t.p, { fieldKind: 1, fieldEvolution: 0.08 }, { count: n });
    const stalled0 = 1 - frozen.moving / n;
    const stalled1 = 1 - drifting.moving / n;
    return { pass: stalled0 >= 0.05 && stalled1 <= 0.25 * stalled0, values: { stalledShareAtDrift0: r(stalled0, 3), stalledShareAtDrift008: r(stalled1, 3), ratio: r(stalled1 / stalled0, 2) } };
  },
  'FO-08': async (t) => {
    const none = await followerCrowding(t, 0);
    const some = await followerCrowding(t, 0.01);
    return { pass: some < none, values: { shareInMostCrowdedPercentAtRespawn0: r(none, 3), atRespawn001: r(some, 3) } };
  },

  // ------------------------------------------------------------ coupling and display
  'CP-01': async (t) => {
    const a: number[] = [];
    for (const w of [0, 0.25, 1]) a.push(Number((await couplingStatsFn(t.p, t.x.analyzeTrail, { flowToPhysarum: w, followerCount: 20_000, fieldKind: 1 })).flowAlignment));
    return { pass: a[0] < 0.05 && a[1] >= 0.05 && a[1] <= 0.3 && a[2] >= 0.6, values: { alignmentAtFlow0_025_1: a } };
  },
  'CP-02': async (t) => {
    const off = await couplingStatsFn(t.p, t.x.analyzeTrail, { flowToPhysarum: 0, followerCount: 20_000, fieldKind: 1 });
    const on = await couplingStatsFn(t.p, t.x.analyzeTrail, { flowToPhysarum: 1, followerCount: 20_000, fieldKind: 1 });
    const ratio = on.trail!.cells / off.trail!.cells;
    return { pass: ratio <= 0.5, values: { cellsAtFlow0_1: [off.trail!.cells, on.trail!.cells], ratio: r(ratio, 2) } };
  },
  'CP-03': async (t) => {
    const off = await couplingStatsFn(t.p, t.x.analyzeTrail, { flockCount: 20_000, trailToBoids: 0 });
    const on = await couplingStatsFn(t.p, t.x.analyzeTrail, { flockCount: 20_000, trailToBoids: 1 });
    return { pass: Number(on.enrichment) - Number(off.enrichment) >= 0.1, values: { enrichmentAtTrail0_1: [off.enrichment, on.enrichment] } };
  },
  'CP-04': async (t) => {
    const ok = await couplingStatsFn(t.p, t.x.analyzeTrail, { flockCount: 20_000, trailToBoids: 1 });
    const over = await couplingStatsFn(t.p, t.x.analyzeTrail, { flockCount: 20_000, trailToBoids: 1.75 });
    return {
      pass: over.flock!.nearest < 1.5 && Number(over.enrichment) >= 5 && ok.flock!.nearest > 3,
      values: { nearestAt1: ok.flock!.nearest, nearestAt175: over.flock!.nearest, enrichmentAt175: over.enrichment },
    };
  },

  // ------------------------------------------------------------ scenes and gestures
  'SC-01': async (t) => {
    const rows = await sceneRows(t);
    const ok = rows.every((row) => row.wheel.imageDifference0to1 >= 0.03 && new Set(row.wheel.dominantFamily).size === 1);
    return { pass: ok, values: { scenes: rows.map((row) => ({ scene: row.scene, wheelDifference: row.wheel.imageDifference0to1, dominant: row.wheel.dominantFamily })) } };
  },
  'SC-02': async (t) => {
    const rows = await sceneRows(t);
    const ok = rows.every((row) => row.pen.inside >= 0.03 && row.pen.inside >= 2 * row.pen.outside);
    return { pass: ok, values: { scenes: rows.map((row) => ({ scene: row.scene, inside: row.pen.inside, outside: row.pen.outside })) } };
  },
  'SC-03': async (t) => {
    const rows = await sceneRows(t);
    return { pass: rows.every((row) => row.accent.difference30StepsAfter >= 0.02), values: { scenes: rows.map((row) => ({ scene: row.scene, type: row.accent.type, difference: row.accent.difference30StepsAfter })) } };
  },
  'SC-05': async (t) => {
    const worst: number[] = [];
    for (const [from, to] of [[0, 1], [1, 2], [2, 0]]) worst.push(Number((await transitionTest(t.p, from, to)).transitionMaxStepChange));
    return { pass: worst.every((w) => w < 0.05), values: { largestStepChangeOfMeanTrail: worst } };
  },

  // ------------------------------------------------------------ tools
  // ------------------------------------------------------------ presentation resolution and safe mode
  'PR-03': async (t) => {
    const { p } = t;
    const safe = (window as unknown as { __safe?: { toggle: () => void; on: boolean } }).__safe;
    if (!safe) return { pass: false, values: { error: 'no safe-mode hook (dev server only)' } };
    const director = (window as unknown as { __director?: { setScenes: (s: unknown[], i: number) => void; scenes: unknown[] } }).__director!;
    const frames = (n: number) => new Promise<void>((res) => { let k = 0; const tick = () => (++k >= n ? res() : requestAnimationFrame(tick)); requestAnimationFrame(tick); });
    const mean = async () => {
      const tr = await f32(p, p.trailBuffer, p.gridWidth * p.gridHeight * 4);
      let sum = 0;
      for (let i = 0; i < tr.length; i++) sum += tr[i];
      return sum / tr.length;
    };
    const saved = { ...p.params };
    director.setScenes(director.scenes, 1);
    p.paused = false; // the live loop runs, as in a performance
    p.reset(7);
    await frames(240); // four simulated seconds
    const grid0 = [p.gridWidth, p.gridHeight];
    const out: Record<string, unknown> = { grid: grid0 };
    let worst = 0;
    let pass = true;
    const start = await mean();
    for (const label of ['enter', 'leave']) {
      const before = await mean();
      safe.toggle();
      let last = before;
      for (let f = 0; f < 60; f++) {
        await frames(1);
        const m = await mean();
        worst = Math.max(worst, Math.abs(m - last) / Math.max(last, 1e-9));
        last = m;
      }
      pass = pass && p.gridWidth === grid0[0] && p.gridHeight === grid0[1] && last > 0.3 * before;
      out[`${label}MeanBeforeAfter`] = [r(before, 5), r(last, 5)];
    }
    Object.assign(p.params, saved);
    const back = await mean();
    out.worstChangePerFrame = r(worst, 4);
    out.meanAtStartAndAfterLeaving = [r(start, 5), r(back, 5)];
    return { pass: pass && Math.abs(back / start - 1) <= 0.2, values: out, note: 'live loop, dense placeholder scene; the change per frame is informational (the trail dims at once because fewer agents deposit)' };
  },
  'PR-04': async (t) => {
    const { p } = t;
    const set: Partial<PhysarumParams> = { flockCount: 5000, followerCount: 5000, agentCount: 100_000 };
    const small = await stateHash(t, set, { between: () => p.renderToPixels(64, 48).then(() => undefined) });
    const large = await stateHash(t, set, { between: () => p.renderToPixels(1920, 1080).then(() => undefined) });
    return { pass: small === large, values: { hashWithDisplayAt64x48: small, hashWithDisplayAt1920x1080: large } };
  },
  'PR-05': async (t) => {
    const { p } = t;
    const saved = { ...p.params };
    const savedScale = p.countScale;
    p.paused = true;
    try {
      Object.assign(p.params, extendedSet({ agentCount: 1_000_000, followerCount: 500_000, fieldKind: 1, flockCount: 100_000, flowToPhysarum: 0.25 }));
      p.setPen(0.5, 0.5, false);
      p.reset(7);
      p.countScale = 1;
      for (let i = 0; i < 300; i++) p.step();
      await p.whenIdle();
      const full: number[] = [];
      const safe: number[] = [];
      const ratios: number[] = [];
      for (let round = 0; round < 8; round++) {
        const measure = async (scale: number) => {
          p.countScale = scale;
          return msPerStep(t, 60);
        };
        let a: number;
        let b: number;
        if (round % 2 === 0) { a = await measure(1); b = await measure(0.35); } else { b = await measure(0.35); a = await measure(1); }
        full.push(a);
        safe.push(b);
        ratios.push(b / a);
      }
      const ratio = median(ratios);
      const sorted = [...ratios].sort((x, y) => x - y);
      const spread = sorted[6] - sorted[1];
      return {
        pass: ratio <= 0.55 && spread < 0.2,
        values: { msPerStepFull: r(median(full), 3), msPerStepSafe: r(median(safe), 3), medianRatio: r(ratio, 3), spreadOfRounds: r(spread, 3) },
        note: spread >= 0.2 ? 'inconclusive: the rounds disagree (is another program using the GPU?)' : undefined,
      };
    } finally {
      p.countScale = savedScale;
      Object.assign(p.params, saved);
      p.reset();
      p.paused = false;
    }
  },
  'PR-06': async (t) => {
    const { p } = t;
    const director = (window as unknown as { __director?: { setScenes: (s: unknown[], i: number) => void; scenes: unknown[]; index: number } }).__director!;
    const savedIndex = director.index;
    const saved = { ...p.params };
    p.paused = true;
    const out: Record<string, unknown> = {};
    let pass = true;
    try {
      for (const kind of ['dense', 'heavy'] as const) {
        if (kind === 'dense') director.setScenes(director.scenes, 1);
        else Object.assign(p.params, extendedSet({ agentCount: 1_000_000, followerCount: 500_000, fieldKind: 1, flockCount: 100_000, flowToPhysarum: 0.25 }));
        p.setPen(0.5, 0.5, false);
        p.reset(7);
        for (let i = 0; i < 300; i++) p.step();
        await p.whenIdle();
        const step: number[] = [];
        for (let b = 0; b < 6; b++) step.push(await msPerStep(t, 100));
        const display = await p.benchRender(40, false, [1920, 1080]);
        const total = Math.min(...step) + display;
        out[kind] = { stepMsMin: r(Math.min(...step), 3), displayMs: r(display, 3), totalMs: r(total, 3), grid: [p.gridWidth, p.gridHeight] };
        pass = pass && total <= 8;
      }
      return { pass, values: out };
    } finally {
      director.setScenes(director.scenes, savedIndex);
      Object.assign(p.params, saved);
      p.reset();
      p.paused = false;
    }
  },
  'PR-08': async (t) => {
    const { p } = t;
    const saved = { ...p.params };
    const w0 = p.gridWidth;
    const h0 = p.gridHeight;
    p.paused = true;
    try {
      Object.assign(p.params, DEFAULT_PARAMS);
      p.reset(7);
      for (let i = 0; i < 400; i++) p.step();
      await p.whenIdle();
      const before = await f32(p, p.trailBuffer, w0 * h0 * 4);
      // A different shape (a 4:3 screen after a 16:9 one), asked for and read back in the same turn,
      // so nothing in the page's own frame loop can come between.
      const w1 = 1000;
      const h1 = 750;
      p.resize(w1, h1);
      const afterRead = p.debugRead(p.trailBuffer, w1 * h1 * 4);
      const after = new Float32Array(await afterRead);
      const coarse = (tr: Float32Array, w: number, h: number) => {
        const cols = 32;
        const rows = 18;
        const out = new Float32Array(cols * rows);
        for (let by = 0; by < rows; by++) for (let bx = 0; bx < cols; bx++) {
          let sum = 0;
          let n = 0;
          for (let y = Math.floor((by * h) / rows); y < Math.floor(((by + 1) * h) / rows); y++) for (let x = Math.floor((bx * w) / cols); x < Math.floor(((bx + 1) * w) / cols); x++) { sum += tr[y * w + x]; n++; }
          out[by * cols + bx] = Math.tanh((DEFAULT_PARAMS.displayGain * sum) / Math.max(1, n));
        }
        return out;
      };
      const a = coarse(before, w0, h0);
      const b = coarse(after, w1, h1);
      let diff = 0;
      for (let i = 0; i < a.length; i++) diff += Math.abs(a[i] - b[i]);
      diff /= a.length;
      const meanOf = (tr: Float32Array) => tr.reduce((x, y) => x + y, 0) / tr.length;
      const meanRatio = meanOf(after) / meanOf(before);
      return { pass: Math.abs(meanRatio - 1) <= 0.1 && diff < 0.05, values: { gridBefore: [w0, h0], gridAfter: [w1, h1], meanTrailAfterOverBefore: r(meanRatio, 3), coarseDifference: r(diff, 4) } };
    } finally {
      p.resize(w0, h0);
      Object.assign(p.params, saved);
      p.reset();
      p.paused = false;
    }
  },
  'TL-03': async (t) => {
    const { p } = t;
    const set: Partial<PhysarumParams> = { flockCount: 5000, followerCount: 5000, agentCount: 100_000 };
    const render = () => p.renderToPixels(64, 48).then(() => undefined);
    p.viewMode = 0;
    const plain = await stateHash(t, set, { between: render });
    // Everything on: arrows, the flock overlay on a chosen boid, the sensor overlay on a chosen agent, every view mode in turn.
    let mode = 0;
    const saved = { ...p.params };
    Object.assign(p.params, DEFAULT_PARAMS, set);
    p.reset(7);
    await p.selectBoid(0.5, 0.5);
    await p.selectAgent(0.5, 0.5);
    Object.assign(p.params, saved);
    p.fieldArrows = true;
    p.flockDebug = true;
    p.probeOverlay = true;
    const withOverlays = await stateHash(t, set, { between: () => { mode = (mode + 1) % 5; p.viewMode = mode; return render(); } });
    p.fieldArrows = false;
    p.flockDebug = false;
    p.probeOverlay = false;
    p.probeAgent = -1;
    p.viewMode = 0;
    return { pass: plain === withOverlays, values: { plain, withOverlaysAndViews: withOverlays, viewModesVisited: 5 } };
  },
  'TL-06': async (t) => {
    const { p } = t;
    // The pointer is a predator on the boids and the accent surges that force, so a leftover surge changes the run.
    const set: Partial<PhysarumParams> = { flockCount: 20_000, flockPenMode: 2, flockPenStrength: 3, agentCount: 100_000 };
    p.setPen(0.5, 0.5, true);
    p.surge(0);
    const clean = await stateHash(t, set, { steps: 120 });
    p.surge(1); // an accent has just been played
    p.reset(7);
    const leftover = p.currentSurge; // what a reset leaves of it
    p.surge(1);
    const afterAccent = await stateHash(t, set, { steps: 120 }); // which itself starts with a reset
    p.setPen(0.5, 0.5, false);
    return { pass: clean === afterAccent && leftover === 0, values: { clean, afterAccent, surgeLeftAfterReset: leftover } };
  },
  'TL-04': async (t) => {
    const set = { agentCount: 100_000 };
    const first = await sweepShots(t.p, 'decay', [0.8, 0.95], { times: [200], set, save: false, label: 'determinism' });
    const second = await sweepShots(t.p, 'decay', [0.8, 0.95], { times: [200], set, save: false, label: 'determinism' });
    const a = first.shots.map((s) => s.sha256);
    const b = second.shots.map((s) => s.sha256);
    const different = new Set(a).size === a.length;
    return { pass: a.every((h, i) => h === b[i]) && different, values: { files: first.shots.map((s) => s.file), identical: a.every((h, i) => h === b[i]), valuesDifferFromEachOther: different } };
  },
  'TL-05': async (t) => {
    const { p } = t;
    const saved = { ...p.params };
    p.paused = true;
    try {
      Object.assign(p.params, DEFAULT_PARAMS, extendedSet());
      p.reset(7);
      for (let i = 0; i < 300; i++) p.step();
      await p.whenIdle();
      // The GPU clock drifts over a run (the first version of this check saw 0.349 to 0.381 ms for the same
      // work). So the two settings alternate in blocks, the order swaps every round (off-on, on-off), and the
      // result is the median of the on/off ratio of each round, which the drift cancels out of.
      await p.selectAgent(0.5, 0.5);
      const chosen = p.probeAgent;
      const off: number[] = [];
      const on: number[] = [];
      const ratios: number[] = [];
      for (let round = 0; round < 12; round++) {
        const measure = async (probe: boolean) => {
          p.probeAgent = probe ? chosen : -1;
          return msPerStep(t, 200);
        };
        let a: number;
        let b: number;
        if (round % 2 === 0) { a = await measure(false); b = await measure(true); } else { b = await measure(true); a = await measure(false); }
        off.push(a);
        on.push(b);
        ratios.push(b / a);
      }
      p.probeAgent = -1;
      const change = median(ratios) - 1;
      // A bound of 3% cannot be shown when the rounds themselves disagree by more than that, which happens when
      // something else is using the GPU (a game, a video call). Then the check says so instead of passing by luck.
      const sorted = [...ratios].sort((x, y) => x - y);
      const spread = sorted[9] - sorted[2]; // from the 3rd lowest to the 3rd highest of 12 rounds
      const noisy = spread > 0.1;
      return {
        pass: !noisy && Math.abs(change) <= 0.03,
        values: { msPerStepOffMedian: r(median(off), 3), msPerStepOnMedian: r(median(on), 3), ratioPerRound: ratios.map((v) => r(v, 3)), medianChange: r(change, 3), spreadOfRounds: r(spread, 3) },
        note: noisy ? 'inconclusive: the rounds disagree by more than 10%, so a 3% bound cannot be shown (is another program using the GPU?)' : undefined,
      };
    } finally {
      Object.assign(p.params, saved);
      p.probeAgent = -1;
      p.reset();
      p.paused = false;
    }
  },
};

// The three scene checks share one run of sceneTest (about a minute).
type SceneRow = {
  scene: string;
  wheel: { imageDifference0to1: number; dominantFamily: string[] };
  pen: { inside: number; outside: number };
  accent: { type: string; difference30StepsAfter: number };
};
let effectsScene: unknown[] | null = null;
async function sceneRows(t: Tools): Promise<SceneRow[]> {
  effectsScene ??= await sceneTest(t.p, t.x.analyzeTrail);
  return effectsScene as unknown as SceneRow[];
}

export interface VerifyJob {
  status: 'running' | 'done' | 'error';
  startedAt: string;
  done: number;
  total: number;
  current: string;
  results: { id: string; family: Family; change: string; origin: string; pass: boolean; seconds: number; values: Record<string, unknown>; note?: string }[];
  error?: string;
  summary?: { passed: number; failed: number; failedIds: string[] };
}

/**
 * Run GPU checks one after another as a background job (poll `window.__verify`). `which` is a list
 * of ids, a family name, or nothing for all. The report is also sent to evidence/verify/ by the
 * development server.
 */
export function runVerify(t: Tools, which?: string[] | string): VerifyJob {
  const wanted = PREDICTIONS.filter((p) => p.gpu && GPU_CHECKS[p.id]).filter((p) => {
    if (!which) return true;
    if (typeof which === 'string') return p.family === which || p.family.startsWith(which);
    return which.includes(p.id);
  });
  const job: VerifyJob = { status: 'running', startedAt: new Date().toISOString(), done: 0, total: wanted.length, current: '', results: [] };
  (window as unknown as { __verify: VerifyJob }).__verify = job;
  effectsCache = null;
  effectsScene = null;
  void (async () => {
    try {
      for (const p of wanted) {
        job.current = p.id;
        const start = performance.now();
        let res: CheckResult;
        try {
          res = await GPU_CHECKS[p.id](t);
        } catch (e) {
          res = { pass: false, values: { error: String(e) } };
        }
        job.results.push({ id: p.id, family: p.family, change: p.change, origin: p.origin, pass: res.pass, seconds: r((performance.now() - start) / 1000, 1), values: res.values, note: res.note });
        job.done++;
      }
      const failedIds = job.results.filter((x) => !x.pass).map((x) => x.id);
      job.summary = { passed: job.results.length - failedIds.length, failed: failedIds.length, failedIds };
      job.status = 'done';
      const report = { ...job, adapter: (await navigator.gpu.requestAdapter())?.info?.description ?? 'unknown', grid: [t.p.gridWidth, t.p.gridHeight], seed: 7 };
      await fetch(`/__evidence?path=${encodeURIComponent(`verify/verify-${job.startedAt.slice(0, 19).replace(/[:T]/g, '-')}.json`)}`, { method: 'POST', body: JSON.stringify(report, null, 2) }).catch(() => undefined);
    } catch (e) {
      job.status = 'error';
      job.error = String(e);
    }
  })();
  return job;
}

export type { Family };

// Dev-only scene experiments (loaded through physarum/experiments.ts, never in the production
// bundle). They read buffers back and loop over pixels on the CPU, which is fine for tests and
// forbidden anywhere else (CLAUDE.md 3).
//
//   __exp.sceneTest(opts)            for each scene: wheel, pen and click make a measurable difference (SPEC 8.8)
//   __exp.transitionTest(from, to)   how smoothly a scene switch changes the picture
//   __exp.sceneSoak(opts)            accelerated long run with a simulated performer (background job)
//
// A "difference" is the mean absolute difference between two tone-mapped trail images
// (tanh(displayGain * trail), downsampled 8 times) of two runs that differ in ONE input only and
// share seed, scene and steps: 0 = identical, 1 = black against white. The runs are
// deterministic, so any difference is caused by the input under test.

import type { Physarum } from '../physarum/physarum';
import type { Director } from './director';
import type { SceneData } from './types';
import type { TrailStats } from '../physarum/experiments';
import { MODE_EXTENDED } from '../physarum/params';
import { countScaleFor } from '../physarum/extended.ts';
import { placeholderScenes, shippedScenes } from './index.ts';

/** Which scenes an experiment runs on: the performer's shipped set (default) or the three placeholders the regression checks use. */
export type SceneSet = 'shipped' | 'placeholder';
const listFor = (set: SceneSet | undefined): SceneData[] => (set === 'placeholder' ? placeholderScenes() : shippedScenes());

const r = (v: number, d = 3) => +v.toFixed(d);
const f32 = async (p: Physarum, buf: GPUBuffer, bytes: number) => new Float32Array(await p.debugRead(buf, bytes));
const u32 = async (p: Physarum, buf: GPUBuffer, bytes: number) => new Uint32Array(await p.debugRead(buf, bytes));
const director = (): Director => {
  const d = (window as unknown as { __director?: Director }).__director;
  if (!d) throw new Error('no director (dev hook window.__director missing)');
  return d;
};

const BLOCK = 8;

interface Run {
  /** Tone-mapped, downsampled trail. */
  image: Float32Array;
  cols: number;
  rows: number;
  stats: Pick<TrailStats, 'mean' | 'coverage' | 'cells'>;
  share: { physarum: number; followers: number; boids: number };
  pen: { x: number; y: number; radiusCells: number };
  /** The picture as the display draws it (RGBA, small), taken at `shotAt`, or null. A click's warm glow exists only here, not in the trail. */
  shot: Uint8ClampedArray | null;
}

interface RunOptions {
  scene: number;
  wheel?: number;
  pen?: { x: number; y: number } | null;
  /** The pen appears at this step (default: from the start). Starting it late compares only what follows the input. */
  penFrom?: number;
  /** Click (the accent) at this step. */
  clickAt?: number;
  /** Draw the display (160 x 90) after this step and keep it in `shot`. */
  shotAt?: number;
  steps?: number;
  seed?: number;
}

/** Enter a scene without a transition (as if the performer had been in it for a while), run it, and describe the trail. */
async function run(p: Physarum, analyzeTrail: (t: Float32Array, W: number, H: number) => TrailStats, o: RunOptions): Promise<Run> {
  const d = director();
  const { steps = 600, seed = 7 } = o;
  const W = p.gridWidth;
  const H = p.gridHeight;
  p.paused = true;
  d.setScenes(d.scenes as SceneData[], o.scene); // applies the scene at its entry wheel, no transition, no reset
  d.setIntensity(o.wheel ?? d.scene!.macro.entry);
  p.reset(seed);
  if (o.pen && !o.penFrom) p.setPen(o.pen.x, o.pen.y, true);
  else p.setPen(0.5, 0.5, false);
  let shot: Uint8ClampedArray | null = null;
  for (let i = 0; i < steps; i++) {
    if (o.pen && o.penFrom === i) p.setPen(o.pen.x, o.pen.y, true);
    if (o.clickAt === i) d.accent(o.pen?.x ?? 0.5, o.pen?.y ?? 0.5);
    d.update();
    p.step();
    if (o.shotAt === i) shot = (await p.renderToPixels(160, 90)).data;
    if (i % 100 === 99) await p.whenIdle();
  }
  await p.whenIdle();

  const q = p.params;
  const trail = await f32(p, p.trailBuffer, W * H * 4);
  const cols = Math.floor(W / BLOCK);
  const rows = Math.floor(H / BLOCK);
  const image = new Float32Array(cols * rows);
  for (let by = 0; by < rows; by++) {
    for (let bx = 0; bx < cols; bx++) {
      let sum = 0;
      for (let y = 0; y < BLOCK; y++) for (let x = 0; x < BLOCK; x++) sum += Math.tanh(q.displayGain * trail[(by * BLOCK + y) * W + bx * BLOCK + x]);
      image[by * cols + bx] = sum / (BLOCK * BLOCK);
    }
  }

  const energy = async (buf: GPUBuffer, scale: number, weight: number, active: boolean) => {
    if (!active) return 0;
    let e = 0;
    for (const n of await u32(p, buf, W * H * 4)) e += Math.sqrt(Math.min(n * scale, 100));
    return e * weight;
  };
  const ePhys = await energy(p.counterBuffer, q.mode === MODE_EXTENDED ? countScaleFor(Math.floor(q.agentCount), W, H) : 1, q.depositFactor, !!q.physarumOn && q.agentCount > 0);
  const eFol = await energy(p.flow.counterBuffer, 1, q.followerDeposit, q.followerCount > 0);
  const eBoid = await energy(p.flock.counterBuffer, 1, q.boidDeposit, q.flockCount > 0);
  const total = ePhys + eFol + eBoid || 1;
  const ts = analyzeTrail(trail, W, H);
  return {
    image, cols, rows,
    stats: { mean: ts.mean, coverage: ts.coverage, cells: ts.cells },
    share: { physarum: r(ePhys / total), followers: r(eFol / total), boids: r(eBoid / total) },
    pen: { x: o.pen?.x ?? 0.5, y: o.pen?.y ?? 0.5, radiusCells: (q.penRadius * H) / BLOCK },
    shot,
  };
}

/** Mean absolute difference of two runs' images; `region` restricts it to cells inside or outside the pen circle. */
function difference(a: Run, b: Run, region?: 'inside' | 'outside'): number {
  let sum = 0;
  let n = 0;
  for (let y = 0; y < a.rows; y++) {
    for (let x = 0; x < a.cols; x++) {
      if (region) {
        const d = Math.hypot(x + 0.5 - a.pen.x * a.cols, y + 0.5 - a.pen.y * a.rows);
        if (region === 'inside' && d > a.pen.radiusCells * 0.8) continue;
        if (region === 'outside' && d < a.pen.radiusCells * 2) continue;
      }
      sum += Math.abs(a.image[y * a.cols + x] - b.image[y * a.cols + x]);
      n++;
    }
  }
  return n ? sum / n : 0;
}

/** Mean absolute difference of two on-screen captures, 0 identical, 1 black against white. */
function screenDifference(a: Run, b: Run): number {
  if (!a.shot || !b.shot) return 0;
  let sum = 0;
  for (let i = 0; i < a.shot.length; i++) if (i % 4 !== 3) sum += Math.abs(a.shot[i] - b.shot[i]);
  return sum / ((a.shot.length / 4) * 3 * 255);
}

const dominant = (s: Run['share']) => (Object.entries(s).sort((x, y) => y[1] - x[1])[0][0]);
const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(1e-12, Math.abs(a), Math.abs(b));

/** SPEC 8.8: in each scene the wheel, the pen and the accent make a measurable, visible difference. */
export async function sceneTest(p: Physarum, analyzeTrail: (t: Float32Array, W: number, H: number) => TrailStats, opts: { steps?: number; seed?: number; set?: SceneSet } = {}) {
  const d = director();
  const saved = { ...p.params };
  const savedScenes = [...d.scenes] as SceneData[];
  const savedIndex = d.index;
  const out: Record<string, unknown>[] = [];
  try {
    d.setScenes(listFor(opts.set), 0);
    for (let i = 0; i < d.scenes.length; i++) {
      const common = { scene: i, steps: opts.steps ?? 600, seed: opts.seed ?? 7 };
      const pen = { x: 0.5, y: 0.5 };
      const lo = await run(p, analyzeTrail, { ...common, wheel: 0 });
      const mid = await run(p, analyzeTrail, { ...common });
      const hi = await run(p, analyzeTrail, { ...common, wheel: 1 });
      // The pen and the accent are compared from a warm world: 500 steps without the input, then
      // 90 (pen) or 30 (click) steps with it, against the identical run without it. Over a full
      // run the two worlds would drift apart anyway (the dynamics are chaotic), which says
      // nothing about the input.
      const penOn = await run(p, analyzeTrail, { ...common, steps: 590, pen, penFrom: 500 });
      const penOff = await run(p, analyzeTrail, { ...common, steps: 590 });
      const clicked = await run(p, analyzeTrail, { ...common, steps: 530, clickAt: 500, shotAt: 506, pen, penFrom: 500 });
      const quiet = await run(p, analyzeTrail, { ...common, steps: 530, shotAt: 506, pen, penFrom: 500 });
      out.push({
        scene: d.scenes[i].name,
        wheel: {
          imageDifference0to1: r(difference(lo, hi)),
          meanTrail: [r(lo.stats.mean, 4), r(mid.stats.mean, 4), r(hi.stats.mean, 4)],
          coverage: [r(lo.stats.coverage), r(mid.stats.coverage), r(hi.stats.coverage)],
          cells: [lo.stats.cells, mid.stats.cells, hi.stats.cells],
          biggestRelativeChange: r(Math.max(rel(lo.stats.mean, hi.stats.mean), rel(lo.stats.coverage, hi.stats.coverage), rel(lo.stats.cells, hi.stats.cells))),
          dominantFamily: [dominant(lo.share), dominant(mid.share), dominant(hi.share)],
          shareAt0: lo.share, shareAt1: hi.share,
        },
        pen: { inside: r(difference(penOn, penOff, 'inside')), outside: r(difference(penOn, penOff, 'outside')), whole: r(difference(penOn, penOff)) },
        accent: { type: d.scenes[i].accent.type, difference30StepsAfter: r(difference(clicked, quiet)), onScreen6StepsAfter: r(screenDifference(clicked, quiet)) },
      });
    }
  } finally {
    Object.assign(p.params, saved);
    d.setScenes(savedScenes, savedIndex);
    p.reset();
    p.paused = false;
  }
  return out;
}

/** One scene switch: the mean trail step by step, against the steady state before it. Runs with the world stepped by hand. */
export async function transitionTest(p: Physarum, from: number, to: number, opts: { seed?: number; set?: SceneSet } = {}) {
  const d = director();
  const saved = { ...p.params };
  const savedScenes = [...d.scenes] as SceneData[];
  const savedIndex = d.index;
  const W = p.gridWidth;
  const H = p.gridHeight;
  try {
    p.paused = true;
    d.setScenes(listFor(opts.set), from);
    p.reset(opts.seed ?? 7);
    p.setPen(0.5, 0.5, false);
    const mean = async () => (await f32(p, p.trailBuffer, W * H * 4)).reduce((a, b) => a + b, 0) / (W * H);
    for (let i = 0; i < 400; i++) {
      d.update();
      p.step();
      if (i % 100 === 99) await p.whenIdle();
    }
    // Steady state: the largest relative step-to-step change of the mean over 60 steps.
    let last = await mean();
    let steady = 0;
    for (let i = 0; i < 60; i++) {
      d.update();
      p.step();
      await p.whenIdle();
      const m = await mean();
      steady = Math.max(steady, Math.abs(m - last) / last);
      last = m;
    }
    d.goto(to);
    const total = Math.round(d.scene!.entry.seconds * 60) + 90;
    let worst = 0;
    let worstAt = 0;
    const series: number[] = [];
    for (let i = 0; i < total; i++) {
      d.update();
      p.step();
      await p.whenIdle();
      const m = await mean();
      const change = Math.abs(m - last) / last;
      if (change > worst) {
        worst = change;
        worstAt = i;
      }
      if (i % 15 === 0) series.push(r(m, 4));
      last = m;
    }
    return {
      from: d.scenes[from].name, to: d.scenes[to].name, transitionSeconds: d.scene!.entry.seconds, entryBurst: d.scene!.entry.burst,
      steadyMaxStepChange: r(steady, 4), transitionMaxStepChange: r(worst, 4), atStep: worstAt, meanTrailEvery15Steps: series,
    };
  } finally {
    Object.assign(p.params, saved);
    d.setScenes(savedScenes, savedIndex);
    p.reset();
    p.paused = false;
  }
}

/**
 * Accelerated long run with a simulated performer that uses every live input: scene keys (next,
 * previous, jump), the wheel, accents and the pen. Checks the health of all agents, boids and
 * followers at intervals. Runs in the background: poll window.__sceneSoak.
 */
export function sceneSoak(p: Physarum, opts: { steps?: number; checkEvery?: number; seed?: number } = {}) {
  const { steps = 18_000, checkEvery = 1800, seed = 11 } = opts;
  const job = {
    status: 'running' as 'running' | 'done' | 'error',
    done: 0, total: steps,
    events: { switches: 0, wheel: 0, accents: 0 },
    checks: [] as Record<string, unknown>[],
    batchMs: [] as number[],
    error: undefined as string | undefined,
  };
  (window as unknown as { __sceneSoak: typeof job }).__sceneSoak = job;
  const saved = { ...p.params };
  const d = director();

  void (async () => {
    try {
      p.paused = true;
      let s = seed;
      const rnd = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
      p.reset(seed);
      d.goto(0);
      const W = p.gridWidth;
      const H = p.gridHeight;
      const batch = 100;
      let next = checkEvery;
      while (job.done < steps) {
        const t0 = performance.now();
        for (let i = 0; i < batch; i++) {
          const step = job.done + i;
          // The performer: a pen moving in a slow loop, and now and then a scene key, a wheel turn or a click.
          p.setPen(0.5 + 0.3 * Math.cos(step * 0.011), 0.5 + 0.3 * Math.sin(step * 0.014), true);
          if (step % 1200 === 600) {
            const pick = rnd();
            if (pick < 0.5) d.next() || d.goto(0);
            else if (pick < 0.75) d.previous() || d.next();
            else d.goto(Math.floor(rnd() * d.scenes.length));
            job.events.switches++;
          }
          if (step % 240 === 0) {
            d.onWheel((rnd() - 0.5) * 1200);
            job.events.wheel++;
          }
          if (step % 420 === 210) {
            d.accent(0.3 + 0.4 * rnd(), 0.3 + 0.4 * rnd());
            job.events.accents++;
          }
          d.update();
          p.step();
        }
        await p.whenIdle();
        job.batchMs.push(r(performance.now() - t0, 1));
        job.done += batch;
        if (job.done >= next || job.done >= steps) {
          next += checkEvery;
          const q = p.params;
          const nA = q.physarumOn ? Math.min(Math.floor(q.agentCount), 400_000) : 0;
          const nF = Math.floor(q.followerCount);
          const nB = Math.floor(q.flockCount);
          let bad = 0;
          let outside = 0;
          const scan = (arr: Float32Array, n: number) => {
            for (let i = 0; i < n; i++) {
              const x = arr[i * 4];
              const y = arr[i * 4 + 1];
              if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(arr[i * 4 + 2]) || !Number.isFinite(arr[i * 4 + 3])) bad++;
              else if (x < 0 || x >= 1 || y < 0 || y >= 1) outside++;
            }
          };
          if (nA) scan(await f32(p, p.agentBuffer, nA * 16), nA);
          if (nF) scan(await f32(p, p.flow.vehicleBuffer, nF * 16), nF);
          if (nB) scan(await f32(p, p.flock.boidBuffer, nB * 16), nB);
          const trail = await f32(p, p.trailBuffer, W * H * 4);
          let trailBad = 0;
          let tMax = 0;
          for (const v of trail) {
            if (!Number.isFinite(v) || v < 0) trailBad++;
            else if (v > tMax) tMax = v;
          }
          const sum = async (buf: GPUBuffer) => (await u32(p, buf, W * H * 4)).reduce((a, b) => a + b, 0);
          job.checks.push({
            step: job.done, scene: d.index + 1, wheel: r(d.intensity, 2), transition: d.progress === null ? 'settled' : r(d.progress, 2),
            agents: nA, followers: nF, boids: nB, bad, outside, trailBad, trailMax: r(tMax, 2),
            counters: [await sum(p.counterBuffer), await sum(p.flow.counterBuffer), await sum(p.flock.counterBuffer)],
          });
        }
      }
      job.status = 'done';
    } catch (e) {
      job.status = 'error';
      job.error = String(e);
    } finally {
      Object.assign(p.params, saved);
      p.reset();
      p.paused = false;
    }
  })();
  return job;
}

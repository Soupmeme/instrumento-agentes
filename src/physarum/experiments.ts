// Dev-only experiment harness (never part of a performance, never in the production bundle).
// It exists to check the draft predictions in params.ts against measurements, and to soak
// test the simulation. Everything here reads buffers back to the CPU and loops over pixels
// and agents, which is fine for tests and forbidden anywhere else (CLAUDE.md 3).
//
// Console entry points, all under window.__exp:
//   sweep(key, values, opts)   run each value from the same seed, measure, draw a contact sheet
//   series(key, values, opts)  same, but measure over a long run (for slow effects)
//   exact()                    exact (bit-level) checks of the "does not change the simulation" claims
//   soak(cfg)                  accelerated long run with periodic health checks (background job)
//   monitor(seconds)           watch the real-time frame loop and GPU timings (background job)
// Background jobs report through window.__job and window.__mon.

import type { Physarum } from './physarum';
import { DEFAULT_PARAMS, type PhysarumParams } from './params';

const TAU = Math.PI * 2;

const f32 = async (p: Physarum, buf: GPUBuffer, bytes: number) => new Float32Array(await p.debugRead(buf, bytes));
const u32 = async (p: Physarum, buf: GPUBuffer, bytes: number) => new Uint32Array(await p.debugRead(buf, bytes));

const wrapAngle = (a: number) => {
  const t = ((a % TAU) + TAU) % TAU;
  return t > Math.PI ? t - TAU : t;
};
const wrapDelta = (d: number, size: number) => {
  if (d > size / 2) return d - size;
  if (d < -size / 2) return d + size;
  return d;
};

// ---------------------------------------------------------------- trail analysis

export interface TrailStats {
  mean: number;
  max: number;
  p99: number;
  /** Fraction of pixels brighter than 35% of the 99th percentile (the "veins"). */
  coverage: number;
  /** Dark regions enclosed by veins (4-connected, at least 30 px). */
  cells: number;
  meanCellArea: number;
  nonFinite: number;
}

export function analyzeTrail(trail: Float32Array, W: number, H: number): TrailStats {
  const n = W * H;
  let sum = 0;
  let max = 0;
  let bad = 0;
  for (let i = 0; i < n; i++) {
    const v = trail[i];
    if (!Number.isFinite(v)) bad++;
    else {
      sum += v;
      if (v > max) max = v;
    }
  }
  const bins = new Uint32Array(2048);
  const scale = max > 0 ? 2047 / max : 0;
  for (let i = 0; i < n; i++) if (Number.isFinite(trail[i])) bins[Math.min(2047, (trail[i] * scale) | 0)]++;
  let acc = 0;
  let p99 = max;
  for (let b = 0; b < 2048; b++) {
    acc += bins[b];
    if (acc >= 0.99 * n) {
      p99 = (b + 1) / (scale || 1);
      break;
    }
  }

  const thr = 0.35 * p99;
  const seen = new Uint8Array(n);
  const stack = new Int32Array(n);
  let dark = 0;
  let cells = 0;
  let cellPixels = 0;
  for (let s = 0; s < n; s++) {
    if (trail[s] >= thr || seen[s]) continue;
    let sp = 0;
    stack[sp++] = s;
    seen[s] = 1;
    let area = 0;
    while (sp > 0) {
      const i = stack[--sp];
      area++;
      const x = i % W;
      const y = (i - x) / W;
      if (x > 0 && !seen[i - 1] && trail[i - 1] < thr) { seen[i - 1] = 1; stack[sp++] = i - 1; }
      if (x < W - 1 && !seen[i + 1] && trail[i + 1] < thr) { seen[i + 1] = 1; stack[sp++] = i + 1; }
      if (y > 0 && !seen[i - W] && trail[i - W] < thr) { seen[i - W] = 1; stack[sp++] = i - W; }
      if (y < H - 1 && !seen[i + W] && trail[i + W] < thr) { seen[i + W] = 1; stack[sp++] = i + W; }
    }
    dark += area;
    if (area >= 30) {
      cells++;
      cellPixels += area;
    }
  }
  return {
    mean: sum / n,
    max,
    p99,
    coverage: 1 - dark / n,
    cells,
    meanCellArea: cells ? cellPixels / cells : 0,
    nonFinite: bad,
  };
}

function pearson(a: Float32Array, b: Float32Array): number {
  const n = a.length;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i];
    mb += b[i];
  }
  ma /= n;
  mb /= n;
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma;
    const db = b[i] - mb;
    sab += da * db;
    saa += da * da;
    sbb += db * db;
  }
  return sab / Math.sqrt(saa * sbb || 1);
}

// ---------------------------------------------------------------- agent analysis

export interface AgentStats {
  meanDisplacement: number;
  minDisplacement: number;
  /** Mean absolute heading change per step, radians, over agents that did not respawn. */
  meanAbsTurn: number;
  /** Fraction of agents whose heading changed this step. */
  fracTurning: number;
  /** Fraction of agents that teleported this step (should be about respawnRate). */
  respawnFrac: number;
  /** Fraction that moved less than half the expected distance (stuck). */
  stuckFrac: number;
}

/** Compare agent states before (A) and after (B) exactly one step. */
export function analyzeAgents(A: Float32Array, B: Float32Array, n: number, W: number, H: number, md: number): AgentStats {
  let count = 0;
  let disp = 0;
  let minDisp = Infinity;
  let absTurn = 0;
  let turning = 0;
  let respawned = 0;
  let stuck = 0;
  for (let i = 0; i < n; i++) {
    const dx = wrapDelta((B[i * 4] - A[i * 4]) * W, W);
    const dy = wrapDelta((B[i * 4 + 1] - A[i * 4 + 1]) * H, H);
    const d = Math.hypot(dx, dy);
    if (d > 2 * md + 2) {
      respawned++;
      continue;
    }
    count++;
    disp += d;
    if (d < minDisp) minDisp = d;
    if (d < 0.5 * md) stuck++;
    const dh = Math.abs(wrapAngle(B[i * 4 + 2] - A[i * 4 + 2]));
    absTurn += dh;
    if (dh > 1e-4) turning++;
  }
  return {
    meanDisplacement: disp / (count || 1),
    minDisplacement: minDisp,
    meanAbsTurn: absTurn / (count || 1),
    fracTurning: turning / (count || 1),
    respawnFrac: respawned / n,
    stuckFrac: stuck / (count || 1),
  };
}

// ---------------------------------------------------------------- contact sheet

function palette(v: number): [number, number, number] {
  const mix = (a: number[], b: number[], t: number): [number, number, number] => [
    a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t,
  ];
  const c0 = [0.043, 0.051, 0.078];
  const c1 = [0.10, 0.28, 0.55];
  const c2 = [0.35, 0.85, 0.75];
  const c3 = [1.0, 0.97, 0.85];
  if (v < 0.35) return mix(c0, c1, v / 0.35);
  if (v < 0.7) return mix(c1, c2, (v - 0.35) / 0.35);
  return mix(c2, c3, (v - 0.7) / 0.3);
}

/** Same tone mapping as display.wgsl, drawn 1:1 from the middle of the trail. */
function tile(trail: Float32Array, W: number, H: number, gain: number, size: number): HTMLCanvasElement {
  const s = Math.min(size, W, H);
  const x0 = Math.floor((W - s) / 2);
  const y0 = Math.floor((H - s) / 2);
  const canvas = document.createElement('canvas');
  canvas.width = s;
  canvas.height = s;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(s, s);
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const [r, g, b] = palette(Math.tanh(gain * trail[(y0 + y) * W + x0 + x]));
      const o = (y * s + x) * 4;
      img.data[o] = r * 255;
      img.data[o + 1] = g * 255;
      img.data[o + 2] = b * 255;
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function showSheet(tiles: { label: string; canvas: HTMLCanvasElement }[]): void {
  hideSheet();
  const sheet = document.createElement('div');
  sheet.id = 'exp-sheet';
  sheet.style.cssText =
    'position:fixed;inset:0;z-index:99;background:#05060a;display:flex;gap:8px;align-items:flex-start;' +
    'justify-content:center;flex-wrap:wrap;padding:8px;overflow:auto;color:#cfd6e4;font:12px monospace;';
  for (const t of tiles) {
    const fig = document.createElement('figure');
    fig.style.margin = '0';
    const cap = document.createElement('figcaption');
    cap.textContent = t.label;
    cap.style.padding = '2px 0';
    fig.append(t.canvas, cap);
    sheet.appendChild(fig);
  }
  sheet.addEventListener('click', hideSheet);
  document.body.appendChild(sheet);
}

function hideSheet(): void {
  document.getElementById('exp-sheet')?.remove();
}

// ---------------------------------------------------------------- experiments

interface SweepOptions {
  seed?: number;
  /** Steps before measuring (60 steps = 1 second of simulated time). */
  steps?: number;
  tile?: number;
}

const r = (v: number, d = 4) => +v.toFixed(d);

async function runOnce(p: Physarum, seed: number, steps: number) {
  p.reset(seed);
  for (let i = 0; i < steps; i++) p.step();
  await p.whenIdle();
}

export async function sweep(p: Physarum, key: keyof PhysarumParams, values: number[], opts: SweepOptions = {}) {
  const { seed = 7, steps = 600, tile: tileSize = 330 } = opts;
  const saved = { ...p.params };
  p.paused = true;
  const W = p.gridWidth;
  const H = p.gridHeight;
  const tiles: { label: string; canvas: HTMLCanvasElement }[] = [];
  const rows: Record<string, unknown>[] = [];
  try {
    for (const v of values) {
      Object.assign(p.params, DEFAULT_PARAMS, { [key]: v });
      const N = p.params.agentCount;
      await runOnce(p, seed, steps);
      const T1 = await f32(p, p.trailBuffer, W * H * 4);
      const A = await f32(p, p.agentBuffer, N * 16);
      p.step();
      await p.whenIdle();
      const B = await f32(p, p.agentBuffer, N * 16);
      for (let i = 0; i < 59; i++) p.step();
      await p.whenIdle();
      const T2 = await f32(p, p.trailBuffer, W * H * 4);
      const counts = await u32(p, p.counterBuffer, W * H * 4);

      const t = analyzeTrail(T1, W, H);
      const a = analyzeAgents(A, B, N, W, H, p.params.moveDistance);
      let occupied = 0;
      let maxCount = 0;
      for (const c of counts) {
        if (c > 0) occupied++;
        if (c > maxCount) maxCount = c;
      }
      const shown = key === 'sensorAngle' || key === 'rotationAngle' ? `${r((v * 180) / Math.PI, 1)}deg` : String(v);
      rows.push({
        [key]: shown,
        cells: t.cells,
        meanCellArea: Math.round(t.meanCellArea),
        coverage: r(t.coverage, 3),
        trailMean: r(t.mean),
        trailMax: r(t.max),
        corr1s: r(pearson(T1, T2), 3),
        meanAbsTurnDeg: r((a.meanAbsTurn * 180) / Math.PI, 1),
        fracTurning: r(a.fracTurning, 3),
        occupiedPx: occupied,
        maxAgentsInPx: maxCount,
        stuckFrac: r(a.stuckFrac, 5),
        respawnFrac: r(a.respawnFrac, 4),
        meanDisp: r(a.meanDisplacement, 3),
      });
      tiles.push({ label: `${key} = ${shown}  (${steps} steps, seed ${seed})`, canvas: tile(T1, W, H, DEFAULT_PARAMS.displayGain, tileSize) });
    }
  } finally {
    Object.assign(p.params, saved);
    p.reset();
    p.paused = false;
  }
  showSheet(tiles);
  return rows;
}

/** Long-run measurements at intervals, for effects that build up slowly (respawn, decay). */
export async function series(
  p: Physarum,
  key: keyof PhysarumParams,
  values: number[],
  opts: { seed?: number; steps?: number; every?: number } = {},
) {
  const { seed = 7, steps = 3000, every = 600 } = opts;
  const saved = { ...p.params };
  p.paused = true;
  const W = p.gridWidth;
  const H = p.gridHeight;
  const out: Record<string, unknown[]> = {};
  try {
    for (const v of values) {
      Object.assign(p.params, DEFAULT_PARAMS, { [key]: v });
      const N = p.params.agentCount;
      p.reset(seed);
      const rows: unknown[] = [];
      for (let s = every; s <= steps; s += every) {
        for (let i = 0; i < every; i++) p.step();
        await p.whenIdle();
        const t = analyzeTrail(await f32(p, p.trailBuffer, W * H * 4), W, H);
        const counts = await u32(p, p.counterBuffer, W * H * 4);
        let occupied = 0;
        let crowded = 0;
        for (const c of counts) {
          if (c > 0) occupied++;
          if (c >= 20) crowded += c;
        }
        rows.push({ step: s, cells: t.cells, meanCellArea: Math.round(t.meanCellArea), coverage: r(t.coverage, 3), occupiedPx: occupied, agentsInCrowdedPx: r(crowded / N, 3) });
      }
      out[`${key}=${v}`] = rows;
    }
  } finally {
    Object.assign(p.params, saved);
    p.reset();
    p.paused = false;
  }
  return out;
}

/** Bit-level checks of claims of the form "this does not change the simulation". */
export async function exact(p: Physarum) {
  const saved = { ...p.params };
  p.paused = true;
  const W = p.gridWidth;
  const H = p.gridHeight;
  const results: Record<string, unknown> = {};
  const snapshot = async (params: Partial<PhysarumParams>) => {
    Object.assign(p.params, DEFAULT_PARAMS, params);
    await runOnce(p, 7, 300);
    const N = p.params.agentCount;
    return {
      trail: await f32(p, p.trailBuffer, W * H * 4),
      agents: await f32(p, p.agentBuffer, N * 16),
    };
  };
  const differing = (a: Float32Array, b: Float32Array) => {
    let d = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
    return d;
  };
  try {
    const g2 = await snapshot({ displayGain: 2 });
    const g20 = await snapshot({ displayGain: 20 });
    results.displayGainChangesSimulation = {
      trailValuesDiffering: differing(g2.trail, g20.trail),
      agentValuesDiffering: differing(g2.agents, g20.agents),
    };

    // Doubling the deposit scales every trail value by exactly 2 (a power of two is exact in
    // floating point), so every comparison an agent makes is unchanged and agents must follow
    // exactly the same paths.
    const d1 = await snapshot({ depositFactor: 0.05 });
    const d2 = await snapshot({ depositFactor: 0.1 });
    const d8 = await snapshot({ depositFactor: 0.4 });
    const ratio = (a: Float32Array, b: Float32Array) => {
      let bad = 0;
      for (let i = 0; i < a.length; i++) if (a[i] * 2 !== b[i]) bad++;
      return bad;
    };
    results.depositScaling = {
      agentsDifferingAtX2: differing(d1.agents, d2.agents),
      agentsDifferingAtX8: differing(d1.agents, d8.agents),
      trailValuesNotExactlyDoubledAtX2: ratio(d1.trail, d2.trail),
    };
  } finally {
    Object.assign(p.params, saved);
    p.reset();
    p.paused = false;
  }
  return results;
}

// ---------------------------------------------------------------- soak (accelerated)

interface SoakConfig {
  label: string;
  params?: Partial<PhysarumParams>;
  steps: number;
  checkEvery: number;
  seed?: number;
  batch?: number;
}

interface Job {
  label: string;
  status: 'running' | 'done' | 'error';
  done: number;
  total: number;
  checks: Record<string, unknown>[];
  batchMs: number[];
  summary?: Record<string, unknown>;
  error?: string;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
const pct = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};

/**
 * Steps as fast as the GPU allows (not paced to 60 Hz) and inspects everything at intervals.
 * Wall-clock time per batch of steps shows GPU slowdowns over the run (thermal throttling,
 * leaks). Runs in the background: poll window.__job.
 */
export function soak(p: Physarum, cfg: SoakConfig): Job {
  const job: Job = { label: cfg.label, status: 'running', done: 0, total: cfg.steps, checks: [], batchMs: [] };
  (window as unknown as { __job: Job }).__job = job;
  const saved = { ...p.params };

  void (async () => {
    try {
      p.paused = true;
      Object.assign(p.params, DEFAULT_PARAMS, cfg.params);
      const W = p.gridWidth;
      const H = p.gridHeight;
      const N = p.params.agentCount;
      const md = p.params.moveDistance;
      const batch = cfg.batch ?? 200;
      p.reset(cfg.seed ?? 11);

      let nextCheck = cfg.checkEvery;
      while (job.done < cfg.steps) {
        const t0 = performance.now();
        for (let i = 0; i < batch; i++) p.step();
        await p.whenIdle();
        job.batchMs.push(r(performance.now() - t0, 2));
        job.done += batch;

        if (job.done >= nextCheck) {
          nextCheck += cfg.checkEvery;
          const A = await f32(p, p.agentBuffer, N * 16);
          p.step();
          await p.whenIdle();
          job.done++;
          const B = await f32(p, p.agentBuffer, N * 16);
          const counts = await u32(p, p.counterBuffer, W * H * 4);
          const trail = await f32(p, p.trailBuffer, W * H * 4);

          let nanAgents = 0;
          let outOfRange = 0;
          let atEdge = 0;
          let badHeading = 0;
          for (let i = 0; i < N; i++) {
            const x = B[i * 4];
            const y = B[i * 4 + 1];
            const h = B[i * 4 + 2];
            if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(h)) { nanAgents++; continue; }
            if (x < 0 || x > 1 || y < 0 || y > 1) outOfRange++;
            else if (x === 1 || y === 1) atEdge++;
            if (h < 0 || h > TAU + 1e-4) badHeading++;
          }
          let sum = 0;
          let maxCount = 0;
          let occupied = 0;
          for (const c of counts) {
            sum += c;
            if (c > maxCount) maxCount = c;
            if (c > 0) occupied++;
          }
          let crowded = 0;
          for (let i = 0; i < N; i++) {
            const x = Math.min(W - 1, Math.floor(B[i * 4] * W));
            const y = Math.min(H - 1, Math.floor(B[i * 4 + 1] * H));
            if (counts[y * W + x] >= 50) crowded++;
          }
          const ts = analyzeTrail(trail, W, H);
          const ag = analyzeAgents(A, B, N, W, H, md);
          const heap = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize;
          job.checks.push({
            step: job.done,
            nanAgents,
            outOfRange,
            atEdge,
            badHeading,
            counterSumMismatch: sum - N,
            maxAgentsInPx: maxCount,
            occupiedPx: occupied,
            agentsInPxOver50: r(crowded / N, 4),
            trailNonFinite: ts.nonFinite,
            trailMean: r(ts.mean),
            trailMax: r(ts.max),
            cells: ts.cells,
            meanDisp: r(ag.meanDisplacement, 3),
            minDisp: r(ag.minDisplacement, 3),
            stuckFrac: r(ag.stuckFrac, 5),
            respawnFrac: r(ag.respawnFrac, 4),
            heapMB: heap ? r(heap / 1048576, 1) : null,
          });
        }
      }

      const n = job.batchMs.length;
      const k = Math.max(1, Math.floor(n / 10));
      const first = job.batchMs.slice(0, k);
      const last = job.batchMs.slice(n - k);
      const perStep = (ms: number) => r(ms / batch, 3);
      const sumOf = (f: string) => job.checks.reduce((s, c) => s + Math.abs(Number(c[f]) || 0), 0);
      job.summary = {
        steps: job.done,
        simulatedMinutesAt60Hz: r(job.done / 3600, 1),
        msPerStepFirst10pct: perStep(median(first)),
        msPerStepLast10pct: perStep(median(last)),
        msPerStepMedian: perStep(median(job.batchMs)),
        msPerStepP99: perStep(pct(job.batchMs, 0.99)),
        msPerStepWorst: perStep(Math.max(...job.batchMs)),
        driftPercent: r((median(last) / median(first) - 1) * 100, 1),
        anomalies: {
          nanAgents: sumOf('nanAgents'),
          outOfRange: sumOf('outOfRange'),
          badHeading: sumOf('badHeading'),
          counterSumMismatch: sumOf('counterSumMismatch'),
          trailNonFinite: sumOf('trailNonFinite'),
          agentsExactlyAtEdge: sumOf('atEdge'),
        },
      };
      job.status = 'done';
    } catch (err) {
      job.status = 'error';
      job.error = String(err);
    } finally {
      Object.assign(p.params, saved);
      p.reset();
      p.paused = false;
    }
  })();
  return job;
}

// ---------------------------------------------------------------- real-time monitor

interface Monitor {
  status: 'running' | 'done';
  samples: Record<string, unknown>[];
  summary?: Record<string, unknown>;
}

/**
 * Watches the real frame loop for `seconds`: steps actually taken per second, frame intervals,
 * and GPU pass timings as the HUD reports them. Open the HUD (D) first, otherwise the
 * timings are never read back. Keep this tab visible: hidden tabs stop animating.
 */
export function monitor(p: Physarum, seconds: number): Monitor {
  const mon: Monitor = { status: 'running', samples: [] };
  (window as unknown as { __mon: Monitor }).__mon = mon;

  let dts: number[] = [];
  let last = performance.now();
  let lastSteps = p.totalSteps;
  let t = 0;
  let agent: number[] = [];
  let total: number[] = [];

  const onFrame = (now: number) => {
    if (mon.status !== 'running') return;
    dts.push(now - last);
    last = now;
    const tm = p.timings;
    if (Number.isFinite(tm.agent)) {
      agent.push(tm.agent);
      total.push(tm.agent + tm.deposit + tm.diffuse + tm.render);
    }
    requestAnimationFrame(onFrame);
  };
  requestAnimationFrame(onFrame);

  const timer = setInterval(() => {
    t++;
    const heap = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize;
    mon.samples.push({
      t,
      stepsPerSec: p.totalSteps - lastSteps,
      frames: dts.length,
      frameMsMedian: dts.length ? r(median(dts), 2) : null,
      frameMsWorst: dts.length ? r(Math.max(...dts), 1) : null,
      agentMsMedian: agent.length ? r(median(agent), 3) : null,
      agentMsMax: agent.length ? r(Math.max(...agent), 3) : null,
      gpuTotalMsMedian: total.length ? r(median(total), 3) : null,
      gpuTotalMsMax: total.length ? r(Math.max(...total), 3) : null,
      heapMB: heap ? r(heap / 1048576, 1) : null,
    });
    dts = [];
    agent = [];
    total = [];
    lastSteps = p.totalSteps;
    if (t >= seconds) {
      clearInterval(timer);
      mon.status = 'done';
      const s = mon.samples;
      const col = (f: string) => s.map((x) => Number(x[f])).filter(Number.isFinite);
      const quarter = Math.max(1, Math.floor(s.length / 4));
      const med = (f: string, from: number, to: number) => median(s.slice(from, to).map((x) => Number(x[f])).filter(Number.isFinite));
      mon.summary = {
        seconds: s.length,
        stepsPerSecMedian: median(col('stepsPerSec')),
        stepsPerSecMin: Math.min(...col('stepsPerSec')),
        frameMsWorstAnySecond: Math.max(...col('frameMsWorst')),
        gpuTotalMsMedianFirstQuarter: med('gpuTotalMsMedian', 0, quarter),
        gpuTotalMsMedianLastQuarter: med('gpuTotalMsMedian', s.length - quarter, s.length),
        gpuTotalMsMaxAnySecond: Math.max(...col('gpuTotalMsMax')),
        agentMsMedianFirstQuarter: med('agentMsMedian', 0, quarter),
        agentMsMedianLastQuarter: med('agentMsMedian', s.length - quarter, s.length),
        heapMBFirst: s[0].heapMB,
        heapMBLast: s[s.length - 1].heapMB,
      };
    }
  }, 1000);
  return mon;
}

export function installExperiments(p: Physarum): void {
  (window as unknown as Record<string, unknown>).__exp = {
    sweep: (k: keyof PhysarumParams, v: number[], o?: SweepOptions) => sweep(p, k, v, o),
    series: (k: keyof PhysarumParams, v: number[], o?: { seed?: number; steps?: number; every?: number }) => series(p, k, v, o),
    exact: () => exact(p),
    soak: (c: SoakConfig) => soak(p, c),
    monitor: (s: number) => monitor(p, s),
    hideSheet,
  };
}

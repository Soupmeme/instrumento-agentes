// Dev-only flock experiments (loaded through physarum/experiments.ts, never in the production
// bundle). Like the rest of the harness it reads buffers back and loops over boids on the CPU,
// which is fine for tests and forbidden anywhere else (CLAUDE.md 3).
//
//   __exp.flockStats(set, opts)   measure the flock after a run: order, spacing, flocks
//   __exp.flockSweep(key, values) flockStats for each value of one parameter (background job)
//   __exp.flockBench(counts, set) GPU time per pass and frame pacing at several boid counts
//   __exp.flockSoak(set, opts)    accelerated long run with periodic health checks (background job)

import type { Physarum } from '../physarum/physarum';
import { DEFAULT_PARAMS, type PhysarumParams } from '../physarum/params';
import { buildGrid, candidates } from './flocking.ts';

const r = (v: number, d = 3) => +v.toFixed(d);

export interface FlockStats {
  boids: number;
  /** Vicsek order parameter: length of the average heading. 1 = all the same way, about 0 = cancelling. */
  polarisation: number;
  /** Mean, over boids with neighbours, of the cosine between my heading and my neighbours' mean heading. */
  localAlignment: number;
  /** Mean speed as a fraction of max speed. */
  speedOfMax: number;
  /** Mean number of boids within the neighbour radius, and within the separation radius. */
  neighboursWithinNbr: number;
  neighboursWithinSep: number;
  /** Mean distance to the nearest other boid, in pixels. */
  nearestDistance: number;
  /** Groups of boids linked by being within 20 px of each other (at least 5 members), whatever the radii. */
  flocks: number;
  /** Share of all boids that belong to such a group, and the share in the largest group. */
  fractionInFlocks: number;
  largestFlockFraction: number;
  /** Fullest grid cell, against the average of the non-empty cells: how uneven the flock is. */
  maxCellCount: number;
  meanNonEmptyCellCount: number;
}

/** Measure a flock from a read-back of the boid buffer (x, y in 0..1, then velocity, 4 floats per boid). */
export function analyzeFlock(b: Float32Array, n: number, W: number, H: number, sepR: number, nbrR: number, maxSpeed: number): FlockStats {
  const pos: [number, number][] = [];
  for (let i = 0; i < n; i++) pos.push([b[i * 4] * W, b[i * 4 + 1] * H]);
  const grid = buildGrid(pos, W, H, Math.max(sepR, nbrR));
  const linkR = 20; // fixed, so the group counts of different radius settings can be compared

  const parent = Int32Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };

  let hx = 0, hy = 0, headed = 0, speed = 0;
  let alignSum = 0, alignN = 0, nbrCount = 0, sepCount = 0, nearest = 0;
  for (let i = 0; i < n; i++) {
    const vx = b[i * 4 + 2], vy = b[i * 4 + 3];
    const s = Math.hypot(vx, vy);
    speed += s;
    if (s > 1e-9) { hx += vx / s; hy += vy / s; headed++; }

    let ax = 0, ay = 0, k = 0, best = Infinity;
    for (const j of candidates(grid, pos[i], W, H)) {
      if (j === i) continue;
      let dx = pos[j][0] - pos[i][0];
      let dy = pos[j][1] - pos[i][1];
      dx -= W * Math.round(dx / W);
      dy -= H * Math.round(dy / H);
      const d = Math.hypot(dx, dy);
      if (d < best) best = d;
      if (d < nbrR) {
        nbrCount++;
        const sj = Math.hypot(b[j * 4 + 2], b[j * 4 + 3]);
        if (sj > 1e-9) { ax += b[j * 4 + 2] / sj; ay += b[j * 4 + 3] / sj; k++; }
      }
      if (d < sepR) sepCount++;
      if (d < linkR) parent[find(i)] = find(j);
    }
    nearest += Number.isFinite(best) ? best : 0;
    const am = Math.hypot(ax, ay);
    if (s > 1e-9 && k > 0 && am > 1e-9) { alignSum += (vx * ax + vy * ay) / (s * am); alignN++; }
  }

  const size = new Map<number, number>();
  for (let i = 0; i < n; i++) size.set(find(i), (size.get(find(i)) ?? 0) + 1);
  let flocks = 0, inFlocks = 0, largest = 0;
  for (const s of size.values()) {
    if (s >= 5) { flocks++; inFlocks += s; largest = Math.max(largest, s); }
  }

  let maxCell = 0, nonEmpty = 0, cellSum = 0;
  for (const c of grid.cellCount) {
    if (c > 0) { nonEmpty++; cellSum += c; maxCell = Math.max(maxCell, c); }
  }

  return {
    boids: n,
    polarisation: r(headed ? Math.hypot(hx, hy) / headed : 0),
    localAlignment: r(alignN ? alignSum / alignN : 0),
    speedOfMax: r(speed / n / maxSpeed),
    neighboursWithinNbr: r(nbrCount / n, 2),
    neighboursWithinSep: r(sepCount / n, 2),
    nearestDistance: r(nearest / n, 2),
    flocks,
    fractionInFlocks: r(inFlocks / n),
    largestFlockFraction: r(largest / n),
    maxCellCount: maxCell,
    meanNonEmptyCellCount: r(nonEmpty ? cellSum / nonEmpty : 0, 1),
  };
}

/** Run a flock alone from a seed, then measure it. `set` overrides any parameter. */
export async function flockStats(
  p: Physarum,
  set: Partial<PhysarumParams> = {},
  opts: { seed?: number; steps?: number; count?: number } = {},
): Promise<FlockStats> {
  const { seed = 7, steps = 900, count = 10_000 } = opts;
  const saved = { ...p.params };
  p.paused = true;
  p.setPen(0.5, 0.5, false);
  try {
    Object.assign(p.params, DEFAULT_PARAMS, { physarumOn: 0, followerCount: 0, flockCount: count, flockPenMode: 0 }, set);
    p.reset(seed);
    for (let i = 0; i < steps; i++) {
      p.step();
      if (i % 100 === 99) await p.whenIdle(); // keep the GPU queue short on slow settings
    }
    await p.whenIdle();
    const n = Math.min(count, p.params.flockCount);
    const b = new Float32Array(await p.debugRead(p.flock.boidBuffer, n * 16));
    return analyzeFlock(b, n, p.gridWidth, p.gridHeight, p.params.flockSepRadius, p.params.flockNbrRadius, p.params.flockSpeed);
  } finally {
    Object.assign(p.params, saved);
    p.reset();
    p.paused = false;
  }
}

/**
 * GPU time per pass and frame pacing at several boid counts, with the other families running at
 * the settings in `set`. The HUD must be visible (key D): timestamps are read back only then.
 * Runs in the background, poll window.__flockBench. Timestamps are quantised to about 0.066 ms.
 */
export function flockBench(p: Physarum, counts: number[], set: Partial<PhysarumParams> = {}, opts: { warmupMs?: number; frames?: number; seed?: number } = {}) {
  const { warmupMs = 4000, frames = 240, seed = 7 } = opts;
  const job: { status: 'running' | 'done'; results: Record<string, unknown>[]; saved?: PhysarumParams } = { status: 'running', results: [] };
  (window as unknown as { __flockBench: typeof job }).__flockBench = job;
  const keys = ['agent', 'followers', 'field', 'flockGrid', 'flock', 'deposit', 'diffuse', 'render'] as const;
  const med = (xs: number[]) => {
    const s = xs.filter(Number.isFinite).sort((a, b) => a - b);
    return s.length ? s[Math.floor(s.length / 2)] : NaN;
  };

  void (async () => {
    const saved = { ...p.params };
    try {
      for (const boids of counts) {
        Object.assign(p.params, DEFAULT_PARAMS, set, { flockCount: boids });
        p.reset(seed);
        await new Promise((res) => setTimeout(res, warmupMs));
        const samples: Record<string, number[]> = Object.fromEntries(keys.map((k) => [k, []]));
        const intervals: number[] = [];
        let last = performance.now();
        const steps0 = p.totalSteps;
        const t0 = last;
        await new Promise<void>((res) => {
          let n = 0;
          const tick = () => {
            const now = performance.now();
            intervals.push(now - last);
            last = now;
            for (const k of keys) samples[k].push(p.timings[k]);
            if (++n < frames) requestAnimationFrame(tick);
            else res();
          };
          requestAnimationFrame(tick);
        });
        const secs = (performance.now() - t0) / 1000;
        const totals = samples.agent.map((_, i) => keys.reduce((a, k) => a + (Number.isFinite(samples[k][i]) ? samples[k][i] : 0), 0));
        intervals.sort((a, b) => a - b);
        // A fixed-step loop that keeps up takes exactly 60 steps per second.
        job.results.push({
          boids,
          stepsPerSecond: r((p.totalSteps - steps0) / secs, 1),
          frameMedianMs: r(intervals[Math.floor(intervals.length / 2)], 1),
          frameWorstMs: r(intervals[intervals.length - 1], 1),
          gpuTotalMedianMs: r(med(totals)),
          gridMs: r(med(samples.flockGrid)),
          flockPassMs: r(med(samples.flock)),
          otherMs: r(med(totals) - (med(samples.flockGrid) || 0) - (med(samples.flock) || 0)),
        });
      }
    } finally {
      Object.assign(p.params, saved);
      p.reset();
      job.status = 'done';
    }
  })();
  return job;
}

/**
 * Accelerated long run (not paced to 60 Hz) with periodic health checks of the boids: no NaN, all
 * positions inside the world, no boid above max speed, counter sum equal to the awake boids, and
 * how clumped the flock is (fullest grid cell). Wall-clock time per batch shows slowdowns. Runs in
 * the background: poll window.__flockSoak.
 */
export function flockSoak(p: Physarum, set: Partial<PhysarumParams> = {}, opts: { steps?: number; checkEvery?: number; batch?: number; seed?: number } = {}) {
  const { steps = 18_000, checkEvery = 1800, batch = 100, seed = 11 } = opts;
  const job = {
    status: 'running' as 'running' | 'done' | 'error',
    done: 0,
    total: steps,
    checks: [] as Record<string, unknown>[],
    batchMs: [] as number[],
    error: undefined as string | undefined,
  };
  (window as unknown as { __flockSoak: typeof job }).__flockSoak = job;
  const saved = { ...p.params };

  void (async () => {
    try {
      p.paused = true;
      Object.assign(p.params, DEFAULT_PARAMS, { followerCount: 0, flockPenMode: 0 }, set);
      const n = Math.min(262_144, Math.floor(p.params.flockCount));
      const W = p.gridWidth;
      const H = p.gridHeight;
      p.reset(seed);
      p.setPen(0.5, 0.5, false);
      let nextCheck = checkEvery;
      while (job.done < steps) {
        const t0 = performance.now();
        for (let i = 0; i < batch; i++) p.step();
        await p.whenIdle();
        job.batchMs.push(r(performance.now() - t0, 1));
        job.done += batch;
        if (job.done >= nextCheck || job.done >= steps) {
          nextCheck += checkEvery;
          const b = new Float32Array(await p.debugRead(p.flock.boidBuffer, n * 16));
          let bad = 0, outside = 0, fast = 0;
          for (let i = 0; i < n; i++) {
            const speed = Math.hypot(b[i * 4 + 2], b[i * 4 + 3]);
            if (![b[i * 4], b[i * 4 + 1], speed].every(Number.isFinite)) bad++;
            else {
              if (b[i * 4] < 0 || b[i * 4] >= 1 || b[i * 4 + 1] < 0 || b[i * 4 + 1] >= 1) outside++;
              if (speed > p.params.flockSpeed + 1e-3) fast++;
            }
          }
          const counts = new Uint32Array(await p.debugRead(p.flock.counterBuffer, W * H * 4));
          let sum = 0;
          for (const c of counts) sum += c;
          const st = analyzeFlock(b, Math.min(n, 20_000), W, H, p.params.flockSepRadius, p.params.flockNbrRadius, p.params.flockSpeed);
          job.checks.push({
            step: job.done, bad, outside, fast, counterSum: sum, boids: n,
            speedOfMax: st.speedOfMax, nearest: st.nearestDistance, maxCell: st.maxCellCount, meanCell: st.meanNonEmptyCellCount,
            polarisation: st.polarisation, localAlignment: st.localAlignment,
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

/** flockStats for each value of one parameter, one after another. Runs in the background: poll window.__flockSweep. */
export function flockSweep(p: Physarum, key: keyof PhysarumParams, values: number[], set: Partial<PhysarumParams> = {}, opts: { seed?: number; steps?: number; count?: number } = {}) {
  const job = { status: 'running' as 'running' | 'done' | 'error', key, results: [] as { value: number; stats: FlockStats }[], error: undefined as string | undefined };
  (window as unknown as { __flockSweep: typeof job }).__flockSweep = job;
  void (async () => {
    try {
      for (const value of values) {
        const stats = await flockStats(p, { ...set, [key]: value }, opts);
        job.results.push({ value, stats });
      }
      job.status = 'done';
    } catch (e) {
      job.status = 'error';
      job.error = String(e);
    }
  })();
  return job;
}

// Dev-only coupling experiments (loaded through physarum/experiments.ts, never in the production
// bundle). Like the rest of the harness it reads buffers back and loops over agents on the CPU,
// which is fine for tests and forbidden anywhere else (CLAUDE.md 3).
//
//   __exp.couplingStats(set, opts)           one run, all the coupling metrics
//   __exp.couplingSweep(key, values, set)    couplingStats for each value (background, poll window.__couplingSweep)
//
// Metrics (see DECISIONS.md, M5):
//   flowAlignment   mean cosine between a Physarum agent's heading and the field direction at its position
//   crowded         share of Physarum agents standing in pixels with 8 or more agents (collapse onto lines)
//   cells, coverage closed cells and vein coverage of the trail (as in M1)
//   enrichment      mean trail under the boids divided by the mean trail over the world
//   flock           nearest-neighbour distance and fullest grid cell of the boids
//   share           each family's contribution to the trail energy this step, as a fraction of the total

import type { Physarum } from '../physarum/physarum';
import { DEFAULT_PARAMS, MODE_EXTENDED, modeDefaults, type PhysarumParams } from '../physarum/params';
import { sampleField } from '../flow/flowfield.ts';
import { analyzeFlock } from '../flock/experiments_flock';
import { countScaleFor } from '../physarum/extended.ts';
import type { TrailStats } from '../physarum/experiments';

const r = (v: number, d = 3) => +v.toFixed(d);
const f32 = async (p: Physarum, buf: GPUBuffer, bytes: number) => new Float32Array(await p.debugRead(buf, bytes));
const u32 = async (p: Physarum, buf: GPUBuffer, bytes: number) => new Uint32Array(await p.debugRead(buf, bytes));

export interface CouplingStats {
  flowAlignment: number | null;
  crowded: number | null;
  trail: Pick<TrailStats, 'cells' | 'coverage' | 'meanCellArea' | 'mean'> | null;
  enrichment: number | null;
  flock: { nearest: number; maxCell: number; speedOfMax: number } | null;
  share: { physarum: number; followers: number; boids: number };
}

/** Run from a seed, then measure. `set` overrides any parameter; the mode defaults are loaded first. */
export async function couplingStats(
  p: Physarum,
  analyzeTrail: (trail: Float32Array, W: number, H: number) => TrailStats,
  set: Partial<PhysarumParams> = {},
  opts: { seed?: number; steps?: number } = {},
): Promise<CouplingStats> {
  const { seed = 7, steps = 900 } = opts;
  const saved = { ...p.params };
  p.paused = true;
  p.setPen(0.5, 0.5, false);
  const W = p.gridWidth;
  const H = p.gridHeight;
  try {
    const mode = (set.mode ?? DEFAULT_PARAMS.mode) as number;
    Object.assign(p.params, DEFAULT_PARAMS, { mode }, modeDefaults(mode), set);
    p.reset(seed);
    for (let i = 0; i < steps; i++) {
      p.step();
      if (i % 100 === 99) await p.whenIdle();
    }
    await p.whenIdle();

    const q = p.params;
    const nA = q.physarumOn ? Math.min(Math.floor(q.agentCount), 400_000) : 0;
    const nF = Math.floor(q.followerCount);
    const nB = Math.floor(q.flockCount);
    const trail = await f32(p, p.trailBuffer, W * H * 4);
    const trailMean = trail.reduce((a, b) => a + b, 0) / trail.length;

    // Family shares from the last step's counters.
    const energy = async (buf: GPUBuffer, scale: number, weight: number) => {
      const c = await u32(p, buf, W * H * 4);
      let e = 0;
      for (const n of c) e += Math.sqrt(Math.min(n * scale, 100));
      return e * weight;
    };
    const ePhys = nA ? await energy(p.counterBuffer, q.mode === MODE_EXTENDED ? countScaleFor(Math.floor(q.agentCount), W, H) : 1, q.depositFactor) : 0;
    const eFol = nF ? await energy(p.flow.counterBuffer, 1, q.followerDeposit) : 0;
    const eBoid = nB ? await energy(p.flock.counterBuffer, 1, q.boidDeposit) : 0;
    const total = ePhys + eFol + eBoid || 1;

    // Physarum alignment with the field, and crowding.
    let flowAlignment: number | null = null;
    let crowded: number | null = null;
    if (nA) {
      const agents = await f32(p, p.agentBuffer, nA * 16);
      const fw = p.flow.fieldWidth;
      const fh = p.flow.fieldHeight;
      const field = await f32(p, p.flow.fieldBuffer, fw * fh * 8);
      let sum = 0;
      let n = 0;
      for (let i = 0; i < nA; i++) {
        const v = sampleField(field, fw, fh, agents[i * 4], agents[i * 4 + 1]);
        const len = Math.hypot(v[0], v[1]);
        if (len < 1e-6) continue;
        sum += Math.cos(agents[i * 4 + 2] - Math.atan2(v[1], v[0]));
        n++;
      }
      flowAlignment = n ? r(sum / n) : null;
      const counts = await u32(p, p.counterBuffer, W * H * 4);
      let inCrowd = 0;
      for (const c of counts) if (c >= 8) inCrowd += c;
      crowded = r(inCrowd / Math.floor(q.agentCount));
    }

    // Boids: how much trail they stand on, and the flock's health.
    let enrichment: number | null = null;
    let flock: CouplingStats['flock'] = null;
    if (nB) {
      const b = await f32(p, p.flock.boidBuffer, nB * 16);
      let onTrail = 0;
      for (let i = 0; i < nB; i++) {
        const x = Math.min(W - 1, Math.floor(b[i * 4] * W));
        const y = Math.min(H - 1, Math.floor(b[i * 4 + 1] * H));
        onTrail += trail[y * W + x];
      }
      enrichment = trailMean > 0 ? r(onTrail / nB / trailMean, 2) : null;
      const st = analyzeFlock(b, Math.min(nB, 20_000), W, H, q.flockSepRadius, q.flockNbrRadius, q.flockSpeed);
      flock = { nearest: st.nearestDistance, maxCell: st.maxCellCount, speedOfMax: st.speedOfMax };
    }

    const ts = analyzeTrail(trail, W, H);
    return {
      flowAlignment,
      crowded,
      trail: { cells: ts.cells, coverage: r(ts.coverage), meanCellArea: Math.round(ts.meanCellArea), mean: r(ts.mean, 4) },
      enrichment,
      flock,
      share: { physarum: r(ePhys / total), followers: r(eFol / total), boids: r(eBoid / total) },
    };
  } finally {
    Object.assign(p.params, saved);
    p.reset();
    p.paused = false;
  }
}

/** couplingStats for each value of one parameter, one after another (background job). */
export function couplingSweep(
  p: Physarum,
  analyzeTrail: (trail: Float32Array, W: number, H: number) => TrailStats,
  key: keyof PhysarumParams,
  values: number[],
  set: Partial<PhysarumParams> = {},
  opts: { seed?: number; steps?: number } = {},
) {
  const job = { status: 'running' as 'running' | 'done' | 'error', key, results: [] as { value: number; stats: CouplingStats }[], error: undefined as string | undefined };
  (window as unknown as { __couplingSweep: typeof job }).__couplingSweep = job;
  void (async () => {
    try {
      for (const value of values) job.results.push({ value, stats: await couplingStats(p, analyzeTrail, { ...set, [key]: value }, opts) });
      job.status = 'done';
    } catch (e) {
      job.status = 'error';
      job.error = String(e);
    }
  })();
  return job;
}

// Flock checks of the in-browser GPU self-test (called from src/physarum/selftest.ts). They need
// a real WebGPU adapter. What they cover:
//   * the spatial grid: cell counts, cell starts and cell membership against the CPU counting sort
//   * one flock step of thousands of boids against the CPU all-pairs reference (flocking.ts), in
//     seven cases: plain, view cone, separation only, cohesion only, pointer as predator and as
//     attractor, and a large radius. This also proves the grid misses no neighbour, because the
//     reference looks at every pair.
//   * the boid counter sum, no NaN, the speed cap, and bit-identical determinism (which holds
//     because the neighbour sums are fixed-point integers)
// What they do not cover: the debug overlay, the look of the flock, any other GPU.

import type { Physarum } from '../physarum/physarum';
import { MODE_CLASSIC } from '../physarum/params';
import { buildGrid, cellOf, stepFlockBrute, PEN_ATTRACT, PEN_NONE, PEN_PREDATOR, type Boid, type FlockConfig } from './flocking.ts';

const TAU = Math.PI * 2;

export type Check = { name: string; ok: boolean; detail: string };

export async function flockChecks(p: Physarum): Promise<Check[]> {
  const checks: Check[] = [];
  const check = (name: string, ok: boolean, detail = '') => checks.push({ name, ok, detail });
  const W = p.gridWidth;
  const H = p.gridHeight;

  Object.assign(p.params, {
    mode: MODE_CLASSIC,
    physarumOn: 0,
    followerCount: 0,
    flockSpeed: 3,
    flockForce: 0.08,
    penRadius: 0.2,
  });
  const defaults = {
    flockSepWeight: 1.5, flockAliWeight: 1, flockCohWeight: 1, flockSepRadius: 14, flockNbrRadius: 40,
    flockFov: TAU, flockPenMode: PEN_NONE, flockPenStrength: 4,
  };

  // A deterministic cloud. Positions and velocities are written as float32, and the CPU
  // reference starts from exactly those float32 values.
  const makeCloud = (n: number, seed: number) => {
    let s = seed >>> 0;
    const rnd = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
    const data = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const a = rnd() * TAU;
      const sp = 3 * (0.5 + 0.5 * rnd());
      data[i * 4] = rnd() * 0.999;
      data[i * 4 + 1] = rnd() * 0.999;
      data[i * 4 + 2] = Math.cos(a) * sp;
      data[i * 4 + 3] = Math.sin(a) * sp;
    }
    return data;
  };
  const toBoids = (d: Float32Array): Boid[] =>
    Array.from({ length: d.length / 4 }, (_, i) => ({ pos: [d[i * 4] * W, d[i * 4 + 1] * H], vel: [d[i * 4 + 2], d[i * 4 + 3]] }));

  // ---- the spatial grid against the CPU counting sort ----
  {
    const N = 3000;
    Object.assign(p.params, defaults, { flockCount: N });
    p.reset(9);
    const start = makeCloud(N, 4);
    p.debugWriteBuffer(p.flock.boidBuffer, start);
    p.step(); // the grid of this step is built from the boids as written above
    const { cellsX, cellsY } = p.flock.grid;
    const cells = cellsX * cellsY;
    const gpuCount = new Uint32Array(await p.debugRead(p.flock.cellCountBuffer, cells * 4));
    const gpuStart = new Uint32Array(await p.debugRead(p.flock.cellStartBuffer, cells * 4));
    const gpuSorted = new Float32Array(await p.debugRead(p.flock.sortedBuffer, N * 16));
    const boids = toBoids(start);
    const cpu = buildGrid(boids.map((b) => b.pos), W, H, Math.max(p.params.flockSepRadius, p.params.flockNbrRadius));
    let countDiff = 0;
    let startDiff = 0;
    for (let c = 0; c < cells; c++) {
      if (gpuCount[c] !== cpu.cellCount[c]) countDiff++;
      if (gpuStart[c] !== cpu.cellStart[c]) startDiff++;
    }
    check('flock grid: cell counts match the CPU counting sort', cellsX === cpu.cellsX && cellsY === cpu.cellsY && countDiff === 0, `${cellsX}x${cellsY} cells, ${countDiff} cells differ`);
    check('flock grid: cell starts are the prefix sum of the counts', startDiff === 0, `${startDiff} of ${cells} cells differ`);
    // The order inside a cell is arbitrary (atomics), so check that each copied state sits in its
    // own cell and that every boid was copied exactly once (positions are all different).
    let wrongCell = 0;
    const remaining = new Map<string, number>();
    for (let i = 0; i < N; i++) remaining.set(`${start[i * 4]},${start[i * 4 + 1]},${start[i * 4 + 2]},${start[i * 4 + 3]}`, 1);
    let unknown = 0;
    for (let c = 0; c < cells; c++) {
      for (let k = 0; k < gpuCount[c]; k++) {
        const s = gpuStart[c] + k;
        const key = `${gpuSorted[s * 4]},${gpuSorted[s * 4 + 1]},${gpuSorted[s * 4 + 2]},${gpuSorted[s * 4 + 3]}`;
        if (remaining.get(key) === 1) remaining.set(key, 0);
        else unknown++;
        if (cellOf([gpuSorted[s * 4] * W, gpuSorted[s * 4 + 1] * H], W, H, cellsX, cellsY) !== c) wrongCell++;
      }
    }
    let missing = 0;
    for (const v of remaining.values()) if (v !== 0) missing++;
    check('flock grid: every boid is copied exactly once, into its own cell', wrongCell === 0 && unknown === 0 && missing === 0, `${wrongCell} in the wrong cell, ${unknown} unexpected or repeated, ${missing} missing`);
  }

  // ---- one flock step against the CPU all-pairs reference ----
  type FlockCase = { name: string; set: Partial<typeof p.params>; pen?: { x: number; y: number }; n?: number };
  const cases: FlockCase[] = [
    { name: 'three behaviours, no blind spot', set: {} },
    { name: 'view cone of 120 degrees', set: { flockFov: (120 * Math.PI) / 180, flockNbrRadius: 55 } },
    { name: 'separation only', set: { flockAliWeight: 0, flockCohWeight: 0, flockSepWeight: 3 } },
    { name: 'cohesion only', set: { flockAliWeight: 0, flockSepWeight: 0, flockCohWeight: 2 } },
    { name: 'pointer as predator', set: { flockPenMode: PEN_PREDATOR, flockPenStrength: 5 }, pen: { x: 0.45, y: 0.5 } },
    { name: 'pointer as attractor', set: { flockPenMode: PEN_ATTRACT, flockPenStrength: 3 }, pen: { x: 0.5, y: 0.45 } },
    { name: 'large radius (wraps, many candidates)', set: { flockNbrRadius: 110, flockSepRadius: 30 }, n: 2500 },
  ];
  for (const c of cases) {
    const N = c.n ?? 4000;
    Object.assign(p.params, defaults, { flockCount: N }, c.set);
    p.reset(10);
    const start = makeCloud(N, 12);
    p.debugWriteBuffer(p.flock.boidBuffer, start);
    if (c.pen) p.setPen(c.pen.x, c.pen.y, true);
    else p.setPen(0.5, 0.5, false);
    p.step();
    const out = new Float32Array(await p.debugRead(p.flock.boidBuffer, N * 16));

    const cfg: FlockConfig = {
      width: W, height: H,
      maxSpeed: p.params.flockSpeed, maxForce: p.params.flockForce,
      sepWeight: p.params.flockSepWeight, aliWeight: p.params.flockAliWeight, cohWeight: p.params.flockCohWeight,
      sepRadius: p.params.flockSepRadius, nbrRadius: p.params.flockNbrRadius, fov: p.params.flockFov,
      penMode: p.params.flockPenMode,
      penX: (c.pen?.x ?? 0) * W, penY: (c.pen?.y ?? 0) * H, penSigma: p.params.penRadius * H,
      penStrength: p.params.flockPenStrength, penActive: !!c.pen,
    };
    const want = stepFlockBrute(toBoids(start), cfg);
    let worstV = 0;
    let worstP = 0;
    let bad = 0;
    let changed = 0; // boids whose velocity changed at all: the case must actually exercise the rule
    for (let i = 0; i < N; i++) {
      const dv = Math.hypot(out[i * 4 + 2] - want[i].vel[0], out[i * 4 + 3] - want[i].vel[1]);
      const dx = Math.abs((((out[i * 4] * W - want[i].pos[0]) + W / 2) % W + W) % W - W / 2);
      const dy = Math.abs((((out[i * 4 + 1] * H - want[i].pos[1]) + H / 2) % H + H) % H - H / 2);
      worstV = Math.max(worstV, dv);
      worstP = Math.max(worstP, dx, dy);
      if (dv > 2e-3 || dx > 2e-2 || dy > 2e-2) bad++;
      if (Math.hypot(start[i * 4 + 2] - want[i].vel[0], start[i * 4 + 3] - want[i].vel[1]) > 1e-6) changed++;
    }
    // A neighbour that sits within float error of the radius (or of the view cone edge) can be in
    // for the GPU (float32) and out for the CPU (float64). That changes one neighbour out of
    // dozens, so a handful of boids per thousand may differ by a few thousandths; a real bug
    // (a missed cell, a wrong sign) would change hundreds of them.
    const allowed = Math.ceil(N * 0.001);
    check(
      `flock step: ${c.name}`,
      bad <= allowed && changed > N / 10,
      `${N} boids, ${bad} differ by more than the tolerance (allowed ${allowed}; velocity worst ${worstV.toExponential(1)}, position worst ${worstP.toExponential(1)} px), ${changed} changed velocity`,
    );
  }

  // ---- the work guard: a crowded cell is sampled, and the flock still behaves ----
  // A well-conditioned case: alignment only, headings within about 0.6 rad of each other, so the
  // neighbours' average heading is well defined and a sample of it should be close. (Separation in
  // a crowd that surrounds a boid is a tiny leftover of big pushes: a sample of it says nothing
  // about the exact value, so it cannot be compared boid by boid.)
  {
    const N = 6000;
    const CAP = 64;
    Object.assign(p.params, defaults, { flockCount: N, flockSepWeight: 0, flockCohWeight: 0, flockAliWeight: 1.5 });
    p.reset(10);
    // All boids inside a 50 x 50 pixel patch: a few grid cells hold thousands each.
    const start = makeCloud(N, 14);
    for (let i = 0; i < N; i++) {
      start[i * 4] = 0.45 + (start[i * 4] / 0.999) * (50 / W);
      start[i * 4 + 1] = 0.45 + (start[i * 4 + 1] / 0.999) * (50 / H);
      const a = ((i % 97) / 97 - 0.5) * 0.6; // heading near +x
      const sp = 1.5 + ((i % 13) / 13) * 1.5;
      start[i * 4 + 2] = Math.cos(a) * sp;
      start[i * 4 + 3] = Math.sin(a) * sp;
    }
    p.setPen(0.5, 0.5, false);
    // Once with the guard forced on (cap 64 per cell, cells hold about 1500), once as normal
    // (the budget rule leaves this count alone), so the check can tell the guard did something.
    p.debugWriteBuffer(p.flock.boidBuffer, start);
    p.flock.cellCapOverride = CAP;
    p.step();
    p.flock.cellCapOverride = undefined;
    const out = new Float32Array(await p.debugRead(p.flock.boidBuffer, N * 16));
    p.reset(10);
    p.debugWriteBuffer(p.flock.boidBuffer, start);
    p.step();
    const plain = new Float32Array(await p.debugRead(p.flock.boidBuffer, N * 16));
    const cfg: FlockConfig = {
      width: W, height: H, maxSpeed: p.params.flockSpeed, maxForce: p.params.flockForce,
      sepWeight: 0, aliWeight: 1.5, cohWeight: 0,
      sepRadius: p.params.flockSepRadius, nbrRadius: p.params.flockNbrRadius, fov: p.params.flockFov,
      penMode: PEN_NONE, penX: 0, penY: 0, penSigma: 1, penStrength: 0, penActive: false,
    };
    const exact = stepFlockBrute(toBoids(start), cfg);
    let sum = 0;
    let bad = 0;
    let changed = 0;
    let plainSum = 0;
    const diffs: number[] = [];
    for (let i = 0; i < N; i++) {
      const dv = Math.hypot(out[i * 4 + 2] - exact[i].vel[0], out[i * 4 + 3] - exact[i].vel[1]);
      sum += dv;
      plainSum += Math.hypot(plain[i * 4 + 2] - exact[i].vel[0], plain[i * 4 + 3] - exact[i].vel[1]);
      diffs.push(dv);
      if (![out[i * 4], out[i * 4 + 1], dv].every(Number.isFinite) || Math.hypot(out[i * 4 + 2], out[i * 4 + 3]) > cfg.maxSpeed + 1e-4) bad++;
      if (Math.hypot(start[i * 4 + 2] - exact[i].vel[0], start[i * 4 + 3] - exact[i].vel[1]) > 1e-6) changed++;
    }
    // The force is at most 0.08 x 1.5 = 0.12 per step. About 256 sampled boids estimate the mean
    // heading to a few per cent of that, so the sampled step should differ from the exact one by a
    // few thousandths on average. A single boid can be further off (a 4 sigma draw among 6000), so
    // the bound is on the 99th percentile, not the worst.
    diffs.sort((a, b) => a - b);
    const p99 = diffs[Math.floor(N * 0.99)];
    check(
      'flock work guard: a crowded cell is sampled, the step stays close to the exact one',
      bad === 0 && changed > N / 2 && sum / N < 0.01 && p99 < 0.03 && sum > 5 * plainSum,
      `${N} boids in a 50 px patch, cap ${CAP} per cell: velocity difference mean ${(sum / N).toExponential(1)} (${(plainSum / N).toExponential(1)} without the guard, so it must be engaged), 99th percentile ${p99.toExponential(1)}, worst ${diffs[N - 1].toExponential(1)}, ${changed} boids changed velocity, ${bad} bad values`,
    );
  }

  // ---- counter, health, determinism with a real number of boids ----
  // 30,000 boids: the work guard (see flocking.ts) stays off at this count, which bit-exact
  // reproducibility needs (a sampled cell depends on the arbitrary order inside the cell).
  const N = 30_000;
  Object.assign(p.params, defaults, { flockCount: N });
  p.setPen(0.5, 0.5, false);
  const runSteps = async (seed: number) => {
    p.reset(seed);
    for (let i = 0; i < 20; i++) p.step();
    await p.whenIdle();
    return new Float32Array(await p.debugRead(p.flock.boidBuffer, N * 16));
  };
  const first = await runSteps(88);
  const counts = new Uint32Array(await p.debugRead(p.flock.counterBuffer, W * H * 4));
  let sum = 0;
  for (const v of counts) sum += v;
  check('boid counter invariant: counts add up to the awake boids', sum === N, `sum ${sum}, boids ${N}`);
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
      if (speed > p.params.flockSpeed + 1e-4) fast++;
    }
  }
  check('boids: no NaN, positions in [0,1), speed never above maxSpeed', bad === 0 && outside === 0 && fast === 0, `${bad} bad, ${outside} outside, ${fast} too fast`);
  const second = await runSteps(88);
  let diff = 0;
  for (let i = 0; i < first.length; i++) if (first[i] !== second[i]) diff++;
  check('boid determinism: same seed and steps give identical boids (fixed-point sums)', diff === 0, `${diff} differing values of ${first.length}`);

  return checks;
}

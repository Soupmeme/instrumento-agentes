// Flock measurements, shared by the browser experiments (experiments_flock.ts) and the CPU
// prediction tests (test/predictions_flock.test.ts), so that a prediction is checked with the
// same metric on both. Pure functions of a boid list: no GPU, no DOM.

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

// CPU reference of the flock (SPEC 5.4): the readable definition that flock.wgsl and
// flock_grid.wgsl implement. Unit tests and the in-browser GPU self-test compare against it.
// Small N only: it is never used to drive the picture.
//
// Reynolds (1999) and Nature of Code chapter 5 define flocking as three steering behaviours
// summed with weights. Each one is "choose a desired velocity, steer toward it":
//   separation  desired = away from close neighbours, nearer ones push harder (weight 1/d)
//   alignment   desired = the neighbours' average heading, at full speed
//   cohesion    desired = toward the neighbours' centre (this is just "seek")
//   steer_k     = limit(desired_k - velocity, maxForce)
//   velocity    = limit(velocity + sum_k weight_k * steer_k, maxSpeed)
//
// What a boid perceives: the other boids within a radius. For alignment and cohesion (whom to
// follow) only those in front of it count, inside a view cone of `fov` radians centred on its
// velocity (2 pi sees all around). For separation (personal space) it sees all around whatever
// the cone: a boid that could not see the one behind it would never be pushed by it, the pushes
// between two boids would stop being mutual, and flocks piled up (measured, LOGBOOK M4).
// It is blind to everything else. There is no leader, no global information, only the optional
// pointer.
//
// Two things make the GPU version exact rather than approximate, and this file defines both:
//   1. Neighbour search uses a uniform grid (buildGrid): cells at least as wide as the largest
//      radius, so the 3 x 3 cells around a boid contain every neighbour within the radius.
//   2. The sums over neighbours are added as fixed-point integers (toFixed), so their value does
//      not depend on the order in which the GPU visits the neighbours. The flock is therefore
//      reproducible: the same seed gives the same flock, bit for bit.

import {
  limitLength, seekDesired, steerToward, withLength, wrappedOffset, fleeDesired, type Vec2,
} from '../steering/steering.ts';

/**
 * Work guard. Every boid tests the boids in the 9 grid cells around it, so the cost of a step is
 * about (boids) x (boids per cell) x 9. A flock that gathers in one spot (the pointer as attractor
 * held still, or cohesion above separation) packs tens of thousands of boids into a few cells and
 * the cost explodes (measured: 55 ms for 50,000 boids, against 3 ms normally). To keep the frame
 * time bounded, a step may make about TEST_BUDGET neighbour tests in all (the boid pass ran about
 * 27 billion tests per second on the development GPU, so this is at most about 7 ms there). When
 * a cell holds more boids than its share allows, boids test an evenly spaced sample of that cell
 * instead of all of it (cellCapFor). Nothing changes while cells stay under the share, which is
 * the normal case up to about 50,000 boids at the default radii. The budget cannot be much lower:
 * at 222 boids per cell (a budget of 100 million at 50,000 boids) the fullest cells of a healthy
 * flock were sampled, and the sampled flock settled into a denser regime (measured, LOGBOOK M4),
 * so the guard must only bite in states that are already pathological.
 */
export const TEST_BUDGET = 200_000_000;
/** Fewest boids per cell a boid always looks at, whatever the boid count. */
export const MIN_CELL_CAP = 24;

/** The most boids of one cell that a boid examines, for a given number of boids. */
export function cellCapFor(count: number): number {
  return Math.max(MIN_CELL_CAP, Math.floor(TEST_BUDGET / (9 * Math.max(1, count))));
}

/** Fixed-point scale of the neighbour sums (1/1024 pixel resolution). */
export const FIXED = 1024;
/** Most cells the GPU grid may have (the cell buffers are this long). */
export const MAX_CELLS = 65536;
/** The grid never has fewer than 3 cells per side, so a boid's 9 cells are 9 different cells. */
export const MIN_CELLS_PER_SIDE = 3;

/** Round to the fixed-point grid, as an integer. Math.round and WGSL round() differ on exact halves only. */
export const toFixed = (v: number): number => Math.round(v * FIXED);

export interface FlockConfig {
  /** World size in simulation pixels. The world wraps. */
  width: number;
  height: number;
  maxSpeed: number;
  maxForce: number;
  sepWeight: number;
  aliWeight: number;
  cohWeight: number;
  /** Separation looks this far (pixels). */
  sepRadius: number;
  /** Alignment and cohesion look this far (pixels). */
  nbrRadius: number;
  /** View cone, full angle in radians. 2 pi (or more) means no blind spot. */
  fov: number;
  /** The pointer: 0 nothing, 1 attract (seek), 2 predator (flee). */
  penMode: number;
  /** Pen position in pixels, its radius (sigma, pixels), its weight, and whether it exists. */
  penX: number;
  penY: number;
  penSigma: number;
  penStrength: number;
  penActive: boolean;
}

export const PEN_NONE = 0;
export const PEN_ATTRACT = 1;
export const PEN_PREDATOR = 2;

export interface Boid {
  pos: Vec2; // pixels, 0..width, 0..height
  vel: Vec2; // pixels per step
}

/** cos(fov / 2), or a value below -1 when the boid has no blind spot. */
export const cosHalfFov = (fov: number): number => (fov >= 2 * Math.PI ? -2 : Math.cos(fov / 2));

/**
 * The grid for a perception radius: cells at least `maxRadius` wide in both directions, at least
 * MIN_CELLS_PER_SIDE per side, and at most MAX_CELLS in all (a huge count would make the scan
 * slow, so the cells then grow; the neighbourhood stays exact because bigger cells only add
 * candidates).
 */
export function gridDims(width: number, height: number, maxRadius: number): { cellsX: number; cellsY: number } {
  let cellsX = Math.max(MIN_CELLS_PER_SIDE, Math.floor(width / Math.max(maxRadius, 1e-3)));
  let cellsY = Math.max(MIN_CELLS_PER_SIDE, Math.floor(height / Math.max(maxRadius, 1e-3)));
  while (cellsX * cellsY > MAX_CELLS) {
    cellsX = Math.max(MIN_CELLS_PER_SIDE, Math.floor(cellsX * 0.9));
    cellsY = Math.max(MIN_CELLS_PER_SIDE, Math.floor(cellsY * 0.9));
  }
  return { cellsX, cellsY };
}

/** Which cell a position (pixels) falls in. The min() guards a position at exactly the world size. */
export function cellOf(pos: Vec2, width: number, height: number, cellsX: number, cellsY: number): number {
  const cx = Math.min(cellsX - 1, Math.max(0, Math.floor((pos[0] / width) * cellsX)));
  const cy = Math.min(cellsY - 1, Math.max(0, Math.floor((pos[1] / height) * cellsY)));
  return cy * cellsX + cx;
}

export interface Grid {
  cellsX: number;
  cellsY: number;
  /** Boids in each cell. */
  cellCount: Uint32Array;
  /** Where each cell's boids start in `sorted` (exclusive prefix sum of cellCount). */
  cellStart: Uint32Array;
  /** Boid indices ordered by cell: the boids of cell c are sorted[cellStart[c] .. + cellCount[c]]. */
  sorted: Uint32Array;
}

/**
 * Counting sort of the boids by cell: count per cell, prefix sum, scatter. The GPU does the same
 * three steps in three passes (flock_grid.wgsl). Within a cell the order is arbitrary on the GPU
 * (atomics), which is why the neighbour sums must not depend on it.
 */
export function buildGrid(positions: readonly Vec2[], width: number, height: number, maxRadius: number): Grid {
  const { cellsX, cellsY } = gridDims(width, height, maxRadius);
  const cells = cellsX * cellsY;
  const cellCount = new Uint32Array(cells);
  const cellStart = new Uint32Array(cells);
  const sorted = new Uint32Array(positions.length);
  const cellOfBoid = positions.map((p) => cellOf(p, width, height, cellsX, cellsY));
  const rank = cellOfBoid.map((c) => cellCount[c]++);
  let running = 0;
  for (let c = 0; c < cells; c++) {
    cellStart[c] = running;
    running += cellCount[c];
  }
  cellOfBoid.forEach((c, i) => (sorted[cellStart[c] + rank[i]] = i));
  return { cellsX, cellsY, cellCount, cellStart, sorted };
}

/** The 9 cells around (and including) the one that holds `pos`, wrapping at the world edge. */
export function neighbourCells(grid: Grid, pos: Vec2, width: number, height: number): number[] {
  const c = cellOf(pos, width, height, grid.cellsX, grid.cellsY);
  const cx = c % grid.cellsX;
  const cy = Math.floor(c / grid.cellsX);
  const out: number[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      out.push(((cy + dy + grid.cellsY) % grid.cellsY) * grid.cellsX + ((cx + dx + grid.cellsX) % grid.cellsX));
    }
  }
  return out;
}

/**
 * Indices of the boids in the 9 cells around `pos` (the candidates), using the grid. With a
 * `cellCap` (and the asking boid's index) a cell with more than cellCap boids contributes an
 * evenly spaced sample of about cellCap of them, as the GPU does; without one, all of them.
 */
export function candidates(grid: Grid, pos: Vec2, width: number, height: number, cellCap = Infinity, who = 0): number[] {
  const out: number[] = [];
  for (const c of neighbourCells(grid, pos, width, height)) {
    const n = grid.cellCount[c];
    const stride = n > cellCap ? Math.ceil(n / cellCap) : 1;
    for (let k = stride > 1 ? who % stride : 0; k < n; k += stride) out.push(grid.sorted[grid.cellStart[c] + k]);
  }
  return out;
}

/** What one boid perceives and decides: the three steering forces and the pointer's, before weighting. */
export interface FlockForces {
  separation: Vec2 | null;
  alignment: Vec2 | null;
  cohesion: Vec2 | null;
  pen: Vec2 | null;
  /** Neighbours counted for separation, and for alignment / cohesion. */
  sepCount: number;
  nbrCount: number;
  /** The weighted sum of all forces, before the speed limit. */
  total: Vec2;
}

/**
 * One boid's decision. `others` is the list of boids to examine: every other boid (brute force,
 * the plain definition) or only the grid candidates (what the GPU does). The two must agree.
 * `self` is excluded by index.
 */
export function flockForces(index: number, boids: readonly Boid[], others: Iterable<number>, cfg: FlockConfig): FlockForces {
  const me = boids[index];
  const size: Vec2 = [cfg.width, cfg.height];
  const speed = Math.hypot(me.vel[0], me.vel[1]);
  const cosHalf = cosHalfFov(cfg.fov);

  let sepX = 0, sepY = 0, sepN = 0;
  let aliX = 0, aliY = 0, cohX = 0, cohY = 0, nbrN = 0;

  for (const j of others) {
    if (j === index) continue;
    const off = wrappedOffset(me.pos, boids[j].pos, size);
    const d2 = off[0] * off[0] + off[1] * off[1];
    if (d2 === 0) continue; // on top of me: no direction to push or pull
    if (d2 >= Math.max(cfg.sepRadius, cfg.nbrRadius) ** 2) continue;

    if (d2 < cfg.sepRadius * cfg.sepRadius) {
      // Away from the neighbour, weighted 1/d: offset / d is a unit vector, / d again is the weight.
      const inv = 1 / Math.max(d2, 0.01);
      sepX += toFixed(-off[0] * inv);
      sepY += toFixed(-off[1] * inv);
      sepN++;
    }
    // View cone (alignment and cohesion only): the neighbour must be within fov / 2 of where I am
    // heading. A boid at rest has no heading and sees all around.
    const inView = speed <= 1e-6 || (off[0] * me.vel[0] + off[1] * me.vel[1]) / (Math.sqrt(d2) * speed) >= cosHalf;
    if (d2 < cfg.nbrRadius * cfg.nbrRadius && inView) {
      aliX += toFixed(boids[j].vel[0]);
      aliY += toFixed(boids[j].vel[1]);
      cohX += toFixed(off[0]);
      cohY += toFixed(off[1]);
      nbrN++;
    }
  }

  // A behaviour with nothing to perceive stays silent (it does not brake the boid), and so does
  // one whose perceptions cancel out exactly: a zero desired velocity would mean "stop".
  const separation = sepN > 0 && (sepX !== 0 || sepY !== 0)
    ? steerToward(withLength([sepX / FIXED, sepY / FIXED], cfg.maxSpeed), me.vel, cfg.maxForce) : null;
  const alignment = nbrN > 0 && (aliX !== 0 || aliY !== 0)
    ? steerToward(withLength([aliX / FIXED, aliY / FIXED], cfg.maxSpeed), me.vel, cfg.maxForce) : null;
  // Cohesion is seek toward the average of the neighbours' (wrapped) offsets.
  const cohesion = nbrN > 0 && (cohX !== 0 || cohY !== 0)
    ? steerToward(seekDesired([cohX / FIXED / nbrN, cohY / FIXED / nbrN], cfg.maxSpeed), me.vel, cfg.maxForce) : null;

  let pen: Vec2 | null = null;
  if (cfg.penActive && cfg.penMode !== PEN_NONE) {
    const off = wrappedOffset(me.pos, [cfg.penX, cfg.penY], size);
    const d2 = off[0] * off[0] + off[1] * off[1];
    // The same soft circle the Physarum pen uses: full weight at the pointer, 37% one sigma away.
    const reach = Math.exp(-d2 / (cfg.penSigma * cfg.penSigma));
    const desired = cfg.penMode === PEN_PREDATOR ? fleeDesired(off, cfg.maxSpeed) : seekDesired(off, cfg.maxSpeed);
    const f = steerToward(desired, me.vel, cfg.maxForce);
    pen = [f[0] * cfg.penStrength * reach, f[1] * cfg.penStrength * reach];
  }

  let tx = 0, ty = 0;
  if (separation) { tx += separation[0] * cfg.sepWeight; ty += separation[1] * cfg.sepWeight; }
  if (alignment) { tx += alignment[0] * cfg.aliWeight; ty += alignment[1] * cfg.aliWeight; }
  if (cohesion) { tx += cohesion[0] * cfg.cohWeight; ty += cohesion[1] * cfg.cohWeight; }
  if (pen) { tx += pen[0]; ty += pen[1]; }
  return { separation, alignment, cohesion, pen, sepCount: sepN, nbrCount: nbrN, total: [tx, ty] };
}

/** Apply the forces: velocity, speed limit, move, wrap. The same lines as every steering agent. */
export function stepBoid(index: number, boids: readonly Boid[], others: Iterable<number>, cfg: FlockConfig): Boid {
  const f = flockForces(index, boids, others, cfg);
  const me = boids[index];
  const vel = limitLength([me.vel[0] + f.total[0], me.vel[1] + f.total[1]], cfg.maxSpeed);
  const x = me.pos[0] + vel[0];
  const y = me.pos[1] + vel[1];
  return { pos: [x - cfg.width * Math.floor(x / cfg.width), y - cfg.height * Math.floor(y / cfg.height)], vel };
}

/** The whole flock one step, all-pairs: the plain definition (O(N squared), small flocks only). */
export function stepFlockBrute(boids: readonly Boid[], cfg: FlockConfig): Boid[] {
  const all = boids.map((_, i) => i);
  return boids.map((_, i) => stepBoid(i, boids, all, cfg));
}

/**
 * The whole flock one step, looking only at the 3 x 3 grid cells around each boid (what the GPU
 * does). `cellCap` is the work guard: Infinity (the default) reads every boid of every cell.
 */
export function stepFlockGrid(boids: readonly Boid[], cfg: FlockConfig, cellCap = Infinity): Boid[] {
  const grid = buildGrid(boids.map((b) => b.pos), cfg.width, cfg.height, Math.max(cfg.sepRadius, cfg.nbrRadius));
  return boids.map((b, i) => stepBoid(i, boids, candidates(grid, b.pos, cfg.width, cfg.height, cellCap, i), cfg));
}

// ---------------------------------------------------------------- measurements (tests, experiments)

/**
 * Polarisation: length of the average heading (unit vectors). 1 = everyone heads the same way,
 * about 0 = headings cancel out (a random gas, or a rotating mill). Vicsek's order parameter.
 */
export function polarisation(boids: readonly Boid[]): number {
  let x = 0, y = 0, n = 0;
  for (const b of boids) {
    const s = Math.hypot(b.vel[0], b.vel[1]);
    if (s > 1e-9) { x += b.vel[0] / s; y += b.vel[1] / s; n++; }
  }
  return n ? Math.hypot(x, y) / n : 0;
}

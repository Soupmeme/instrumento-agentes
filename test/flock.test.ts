// CPU-only tests of the flock reference (src/flock/flocking.ts). They do NOT test the GPU
// shaders; the in-browser self-test compares those against this reference.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FIXED, MAX_CELLS, MIN_CELL_CAP, TEST_BUDGET, cellCapFor, PEN_ATTRACT, PEN_NONE, PEN_PREDATOR, buildGrid, candidates, cellOf, cosHalfFov, flockForces,
  gridDims, neighbourCells, polarisation, stepBoid, stepFlockBrute, stepFlockGrid, toFixed,
  type Boid, type FlockConfig,
} from '../src/flock/flocking.ts';

const CFG: FlockConfig = {
  width: 400,
  height: 300,
  maxSpeed: 3,
  maxForce: 0.1,
  sepWeight: 1,
  aliWeight: 1,
  cohWeight: 1,
  sepRadius: 10,
  nbrRadius: 40,
  fov: 2 * Math.PI,
  penMode: PEN_NONE,
  penX: 0,
  penY: 0,
  penSigma: 50,
  penStrength: 4,
  penActive: false,
};

const boid = (x: number, y: number, vx = 0, vy = 0): Boid => ({ pos: [x, y], vel: [vx, vy] });
const all = (n: number) => Array.from({ length: n }, (_, i) => i);

// A small deterministic random generator so the random clouds are the same every run.
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
function cloud(n: number, cfg: FlockConfig, seed: number): Boid[] {
  const r = lcg(seed);
  return Array.from({ length: n }, () => {
    const a = r() * Math.PI * 2;
    const sp = cfg.maxSpeed * (0.5 + 0.5 * r());
    return boid(r() * cfg.width, r() * cfg.height, Math.cos(a) * sp, Math.sin(a) * sp);
  });
}

test('fixed point: rounds to 1/1024 and adds exactly, in any order', () => {
  assert.equal(toFixed(1), FIXED);
  assert.equal(toFixed(0.3), Math.round(0.3 * FIXED));
  const xs = [0.1234, -3.3, 2.71828, 0.0007, -0.5, 1.9999];
  const forward = xs.reduce((a, x) => a + toFixed(x), 0);
  const backward = [...xs].reverse().reduce((a, x) => a + toFixed(x), 0);
  assert.equal(forward, backward);
});

test('grid dimensions: cells are at least as wide as the radius, never fewer than 3 per side', () => {
  const { cellsX, cellsY } = gridDims(1000, 600, 40);
  assert.equal(cellsX, 25);
  assert.equal(cellsY, 15);
  assert.ok(1000 / cellsX >= 40 && 600 / cellsY >= 40);
  // A radius as large as the world still gives 3 cells per side.
  const big = gridDims(100, 100, 90);
  assert.deepEqual(big, { cellsX: 3, cellsY: 3 });
  // A tiny radius is capped so the cell buffers stay bounded.
  const tiny = gridDims(1920, 1080, 1);
  assert.ok(tiny.cellsX * tiny.cellsY <= MAX_CELLS);
});

test('work guard: the per-cell cap shrinks as the boid count grows, never below the minimum', () => {
  assert.ok(cellCapFor(20_000) >= 500 && cellCapFor(50_000) >= 200, 'a normal flock is never sampled');
  assert.ok(cellCapFor(50_000) < cellCapFor(20_000));
  assert.equal(cellCapFor(10_000_000), MIN_CELL_CAP);
  assert.equal(cellCapFor(0), Math.floor(TEST_BUDGET / 9));
  // The worst case is bounded: count x 9 cells x cap stays near the budget (or the floor).
  for (const n of [1000, 50_000, 100_000]) assert.ok(n * 9 * cellCapFor(n) <= TEST_BUDGET + 9 * n);
});

test('work guard: a crowded cell is sampled at an even stride, a small one is read in full', () => {
  // 300 boids in one cell and 10 in the cell next to it.
  const pos: [number, number][] = [];
  for (let i = 0; i < 300; i++) pos.push([5 + (i % 10), 5 + Math.floor(i / 30)]);
  for (let i = 0; i < 10; i++) pos.push([45 + i, 5]);
  const grid = buildGrid(pos, 400, 300, 40);
  const all = candidates(grid, [20, 10], 400, 300);
  assert.equal(all.length, 310);
  const capped = candidates(grid, [20, 10], 400, 300, 50, 7);
  // 300 boids with cap 50 is stride 6: 50 from the crowded cell, all 10 from the small one.
  assert.equal(capped.length, 60);
  const fromSmall = capped.filter((j) => j >= 300);
  assert.equal(fromSmall.length, 10);
  // A different asking boid starts at a different offset, so the samples differ.
  const other = candidates(grid, [20, 10], 400, 300, 50, 8);
  assert.notDeepEqual(new Set(capped), new Set(other));
  // Under the cap nothing changes.
  assert.deepEqual(candidates(grid, [20, 10], 400, 300, 1000, 7), all);
});

test('cellOf: corners, and a position at exactly the world size stays inside', () => {
  assert.equal(cellOf([0, 0], 400, 300, 10, 6), 0);
  assert.equal(cellOf([399.9, 299.9], 400, 300, 10, 6), 59);
  assert.equal(cellOf([400, 300], 400, 300, 10, 6), 59);
  assert.equal(cellOf([45, 55], 400, 300, 10, 6), 1 * 10 + 1);
});

test('buildGrid: counts add up, starts are the prefix sum, every boid is listed once in its cell', () => {
  const boids = cloud(500, CFG, 3);
  const grid = buildGrid(boids.map((b) => b.pos), CFG.width, CFG.height, 40);
  assert.equal(grid.cellCount.reduce((a, b) => a + b, 0), 500);
  let running = 0;
  for (let c = 0; c < grid.cellCount.length; c++) {
    assert.equal(grid.cellStart[c], running);
    running += grid.cellCount[c];
  }
  assert.deepEqual([...grid.sorted].sort((a, b) => a - b), all(500));
  for (let c = 0; c < grid.cellCount.length; c++) {
    for (let k = 0; k < grid.cellCount[c]; k++) {
      const i = grid.sorted[grid.cellStart[c] + k];
      assert.equal(cellOf(boids[i].pos, CFG.width, CFG.height, grid.cellsX, grid.cellsY), c);
    }
  }
});

test('the 9 neighbour cells wrap around the world edge and are all different', () => {
  const grid = buildGrid([], 400, 300, 40);
  const corner = neighbourCells(grid, [1, 1], 400, 300);
  assert.equal(new Set(corner).size, 9);
  assert.ok(corner.includes(grid.cellsX * grid.cellsY - 1), 'the opposite corner cell is a neighbour');
  assert.ok(corner.includes(grid.cellsX - 1), 'the cell on the far side of the x edge is a neighbour');
});

test('grid candidates contain every boid within the radius (the grid misses nobody)', () => {
  const radius = 40;
  const boids = cloud(400, CFG, 11);
  const grid = buildGrid(boids.map((b) => b.pos), CFG.width, CFG.height, radius);
  for (let i = 0; i < boids.length; i++) {
    const near = new Set(candidates(grid, boids[i].pos, CFG.width, CFG.height));
    for (let j = 0; j < boids.length; j++) {
      if (i === j) continue;
      let dx = boids[j].pos[0] - boids[i].pos[0];
      let dy = boids[j].pos[1] - boids[i].pos[1];
      dx -= CFG.width * Math.round(dx / CFG.width);
      dy -= CFG.height * Math.round(dy / CFG.height);
      if (Math.hypot(dx, dy) < radius) assert.ok(near.has(j), `boid ${i} misses neighbour ${j}`);
    }
  }
});

test('grid step equals the all-pairs step exactly (same boids examined, same sums)', () => {
  for (const [radiusScale, seed] of [[1, 1], [0.4, 2], [2, 3]] as const) {
    const cfg = { ...CFG, sepRadius: 10 * radiusScale, nbrRadius: 40 * radiusScale, fov: 4 };
    const boids = cloud(300, cfg, seed);
    const brute = stepFlockBrute(boids, cfg);
    const grid = stepFlockGrid(boids, cfg);
    assert.deepEqual(grid, brute, `radius scale ${radiusScale}`);
  }
});

test('separation: a close neighbour on the right pushes me left, one below pushes me up', () => {
  const right = flockForces(0, [boid(100, 100, 1, 0), boid(103, 100, 1, 0)], [0, 1], CFG);
  assert.ok(right.separation && right.separation[0] < 0);
  assert.equal(right.sepCount, 1);
  const two = flockForces(0, [boid(100, 100, 1, 0), boid(103, 100, 1, 0), boid(100, 104, 1, 0)], [0, 1, 2], CFG);
  assert.ok(two.separation && two.separation[1] < 0, 'a neighbour below pushes me up (negative y)');
});

test('separation ignores neighbours outside its radius, alignment and cohesion use the larger one', () => {
  const f = flockForces(0, [boid(100, 100, 1, 0), boid(130, 100, 1, 0.5)], [0, 1], CFG);
  assert.equal(f.separation, null);
  assert.equal(f.sepCount, 0);
  assert.equal(f.nbrCount, 1);
  assert.ok(f.alignment && f.cohesion);
  const beyond = flockForces(0, [boid(100, 100, 1, 0), boid(150, 100, 1, 0)], [0, 1], CFG);
  assert.equal(beyond.nbrCount, 0);
  assert.equal(beyond.alignment, null);
  assert.equal(beyond.cohesion, null);
});

test('alignment steers toward the neighbours\' heading; cohesion toward their centre', () => {
  // I head right; two neighbours head up and sit above and to the right.
  const boids = [boid(100, 100, 2, 0), boid(120, 90, 0, -2), boid(120, 80, 0, -2)];
  const f = flockForces(0, boids, all(3), CFG);
  assert.ok(f.alignment && f.cohesion);
  assert.ok(f.alignment[1] < 0, 'alignment turns me up (neighbours head up)');
  assert.ok(f.cohesion[1] < 0 && f.cohesion[0] >= 0, 'cohesion pulls me up and right, toward their centre');
});

test('every force is at most maxForce long; the total is the weighted sum', () => {
  const boids = cloud(60, CFG, 5);
  for (let i = 0; i < boids.length; i++) {
    const f = flockForces(i, boids, all(60), { ...CFG, sepWeight: 2, aliWeight: 0.5, cohWeight: 3 });
    for (const v of [f.separation, f.alignment, f.cohesion]) if (v) assert.ok(Math.hypot(v[0], v[1]) <= CFG.maxForce + 1e-12);
    const want: [number, number] = [0, 0];
    if (f.separation) { want[0] += 2 * f.separation[0]; want[1] += 2 * f.separation[1]; }
    if (f.alignment) { want[0] += 0.5 * f.alignment[0]; want[1] += 0.5 * f.alignment[1]; }
    if (f.cohesion) { want[0] += 3 * f.cohesion[0]; want[1] += 3 * f.cohesion[1]; }
    assert.ok(Math.abs(f.total[0] - want[0]) < 1e-12 && Math.abs(f.total[1] - want[1]) < 1e-12);
  }
});

test('a weight of 0 silences that behaviour completely', () => {
  const boids = cloud(40, CFG, 6);
  for (let i = 0; i < boids.length; i++) {
    const a = flockForces(i, boids, all(40), { ...CFG, sepWeight: 0, aliWeight: 0, cohWeight: 0 });
    assert.deepEqual(a.total, [0, 0]);
  }
});

test('alone, a boid feels nothing and coasts straight', () => {
  const b = boid(50, 60, 1.5, -0.5);
  const next = stepBoid(0, [b], [0], CFG);
  assert.deepEqual(next.vel, [1.5, -0.5]);
  assert.deepEqual(next.pos, [51.5, 59.5]);
});

test('the view cone hides neighbours behind me, and a boid at rest sees all around', () => {
  const cfg = { ...CFG, fov: Math.PI / 2 }; // 90 degrees: 45 each side of my heading
  const ahead = [boid(100, 100, 2, 0), boid(120, 100, 0, 0)];
  const behind = [boid(100, 100, 2, 0), boid(80, 100, 0, 0)];
  const side = [boid(100, 100, 2, 0), boid(100, 120, 0, 0)];
  assert.equal(flockForces(0, ahead, [0, 1], cfg).nbrCount, 1);
  assert.equal(flockForces(0, behind, [0, 1], cfg).nbrCount, 0);
  assert.equal(flockForces(0, side, [0, 1], cfg).nbrCount, 0, '90 degrees off my heading is outside a 90 degree cone');
  const atRest = [boid(100, 100, 0, 0), boid(80, 100, 0, 0)];
  assert.equal(flockForces(0, atRest, [0, 1], cfg).nbrCount, 1);
  assert.ok(cosHalfFov(2 * Math.PI) < -1, 'a full circle has no blind spot');
  assert.ok(Math.abs(cosHalfFov(Math.PI) - 0) < 1e-12);
});

test('separation sees all around whatever the view cone, so pushes between two boids are mutual', () => {
  const cfg = { ...CFG, fov: Math.PI / 2 };
  // B is directly behind A, 5 px away. Neither follows the other (outside the cone) but both avoid each other.
  const boids = [boid(100, 100, 2, 0), boid(95, 100, 2, 0)];
  const a = flockForces(0, boids, [0, 1], cfg);
  const b = flockForces(1, boids, [0, 1], cfg);
  assert.equal(a.sepCount, 1, 'A feels B behind it');
  assert.equal(b.sepCount, 1, 'B feels A ahead of it');
  assert.equal(a.nbrCount, 0, 'A does not follow B (behind)');
  assert.equal(b.nbrCount, 1, 'B follows A (ahead)');
  assert.ok(a.separation && a.separation[0] > 0, 'A is pushed forward, away from B');
  assert.ok(b.separation && b.separation[0] < 0, 'B is pushed back, away from A');
});

test('neighbours are found across the world edge (wrap)', () => {
  const f = flockForces(0, [boid(395, 150, 1, 0), boid(3, 150, 1, 0)], [0, 1], CFG);
  assert.equal(f.nbrCount, 1);
  assert.ok(f.cohesion && f.cohesion[0] > 0, 'the neighbour is 8 px ahead across the edge, not 392 behind');
});

test('boids on the very same spot are ignored (no direction to push), not turned into NaN', () => {
  const f = flockForces(0, [boid(10, 10, 1, 0), boid(10, 10, 0, 1)], [0, 1], CFG);
  assert.equal(f.nbrCount, 0);
  assert.ok(f.total.every(Number.isFinite));
});

test('opposing neighbours that cancel exactly do not make a boid brake', () => {
  const f = flockForces(1, [boid(90, 100, 0, 0), boid(100, 100, 2, 0), boid(110, 100, 0, 0)], [0, 1, 2], CFG);
  assert.equal(f.separation, null, 'pushes from left and right cancel: no force, not "stop"');
});

test('the speed never exceeds maxSpeed, however strong the weights', () => {
  const cfg = { ...CFG, sepWeight: 4, aliWeight: 4, cohWeight: 4, maxForce: 1 };
  let boids = cloud(200, cfg, 8);
  for (let s = 0; s < 20; s++) {
    boids = stepFlockGrid(boids, cfg);
    for (const b of boids) assert.ok(Math.hypot(b.vel[0], b.vel[1]) <= cfg.maxSpeed + 1e-9);
  }
});

test('the pointer: attract seeks it, predator flees it, both fade with distance, none when off', () => {
  const me = [boid(100, 100, 0, 0)];
  const at = (mode: number, x: number, strength = 4) =>
    flockForces(0, me, [0], { ...CFG, penMode: mode, penX: x, penY: 100, penActive: true, penStrength: strength }).pen;
  const attract = at(PEN_ATTRACT, 130);
  const predator = at(PEN_PREDATOR, 130);
  assert.ok(attract && attract[0] > 0, 'attract: toward the pointer (to the right)');
  assert.ok(predator && predator[0] < 0, 'predator: away from the pointer');
  const nearMag = Math.hypot(...(at(PEN_ATTRACT, 110) as [number, number]));
  const farMag = Math.hypot(...(at(PEN_ATTRACT, 100 + 150) as [number, number]));
  assert.ok(nearMag > farMag * 50, 'the pointer\'s reach falls off like exp(-d^2 / sigma^2)');
  assert.equal(at(PEN_NONE, 130), null);
  const inactive = flockForces(0, me, [0], { ...CFG, penMode: PEN_PREDATOR, penX: 130, penY: 100, penActive: false }).pen;
  assert.equal(inactive, null);
  // The pointer's weight multiplies the force (limited to maxForce before weighting).
  const weak = Math.hypot(...(at(PEN_ATTRACT, 100.001, 1) as [number, number]));
  const strong = Math.hypot(...(at(PEN_ATTRACT, 100.001, 3) as [number, number]));
  assert.ok(Math.abs(strong / weak - 3) < 1e-6);
});

test('a scattered flock with alignment and cohesion organises (polarisation rises)', () => {
  const cfg = { ...CFG, aliWeight: 2, cohWeight: 0.3, sepWeight: 1.5, maxForce: 0.08 };
  let boids = cloud(250, cfg, 21);
  const before = polarisation(boids);
  for (let s = 0; s < 400; s++) boids = stepFlockGrid(boids, cfg);
  const after = polarisation(boids);
  assert.ok(after > before + 0.2, `polarisation ${before.toFixed(2)} to ${after.toFixed(2)}`);
});

test('without alignment the flock stays disordered; without separation boids crowd together', () => {
  const base = { ...CFG, maxForce: 0.08 };
  const run = (cfg: FlockConfig, seed: number) => {
    let boids = cloud(250, cfg, seed);
    for (let s = 0; s < 400; s++) boids = stepFlockGrid(boids, cfg);
    return boids;
  };
  const noAli = run({ ...base, aliWeight: 0, cohWeight: 0 }, 22);
  assert.ok(polarisation(noAli) < 0.3, `polarisation without alignment ${polarisation(noAli).toFixed(2)}`);
  // Nearest-neighbour distance: compare a separated flock with one that has cohesion but no separation.
  const nearest = (boids: Boid[]) => {
    let sum = 0;
    for (let i = 0; i < boids.length; i++) {
      let best = Infinity;
      for (let j = 0; j < boids.length; j++) {
        if (i === j) continue;
        let dx = boids[j].pos[0] - boids[i].pos[0];
        let dy = boids[j].pos[1] - boids[i].pos[1];
        dx -= base.width * Math.round(dx / base.width);
        dy -= base.height * Math.round(dy / base.height);
        best = Math.min(best, Math.hypot(dx, dy));
      }
      sum += best;
    }
    return sum / boids.length;
  };
  const withSep = run({ ...base, sepWeight: 3, cohWeight: 1 }, 23);
  const noSep = run({ ...base, sepWeight: 0, cohWeight: 1 }, 23);
  assert.ok(nearest(noSep) < nearest(withSep), `nearest neighbour ${nearest(noSep).toFixed(2)} without, ${nearest(withSep).toFixed(2)} with separation`);
});

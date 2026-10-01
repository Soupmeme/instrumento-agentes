// Prediction checks for the flock, run on the CPU reference (src/flock/flocking.ts) with a small
// flock at the same density as the 10,000 boids of the GPU measurements (EXPLAINER section 4).
// Each test title starts with the prediction id of src/verify/predictions.ts.
//
// What this covers: that the RULES written in flocking.ts make the structures the predictions
// describe. What it does not cover: the GPU (the self-test compares the GPU with this reference,
// and `__exp.verify()` re-measures a few of these on the GPU), and large flocks (the numbers
// differ with the count: at 10,000 boids a flock with separation 0 collapses to 0.5 px, at 800
// it settles at about 2 px, which is why the thresholds here are ratios, not the GPU numbers).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepFlockGrid, PEN_NONE, PEN_PREDATOR, PEN_ATTRACT, type Boid, type FlockConfig } from '../src/flock/flocking.ts';
import { analyzeFlock } from '../src/flock/metrics.ts';
import { DEFAULT_PARAMS as D } from '../src/physarum/params.ts';

const N = 800;
const STEPS = 250;
// The world for N boids at the density of 10,000 boids on the 1043 x 910 simulation grid.
const AREA = N / (10_000 / (1043 * 910));
const W = Math.round(Math.sqrt(AREA * (1043 / 910)));
const H = Math.round(AREA / W);

const BASE: FlockConfig = {
  width: W, height: H, maxSpeed: D.flockSpeed, maxForce: D.flockForce,
  sepWeight: D.flockSepWeight, aliWeight: D.flockAliWeight, cohWeight: D.flockCohWeight,
  sepRadius: D.flockSepRadius, nbrRadius: D.flockNbrRadius, fov: D.flockFov,
  penMode: PEN_NONE, penX: W / 2, penY: H / 2, penSigma: 0.2 * H, penStrength: D.flockPenStrength, penActive: false,
};

function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Scatter N boids with random headings, run STEPS steps, measure. Same seed, so runs differ only by `over`. */
function run(over: Partial<FlockConfig>, seed = 7) {
  const cfg = { ...BASE, ...over };
  const r = lcg(seed);
  let boids: Boid[] = Array.from({ length: N }, () => {
    const a = r() * Math.PI * 2;
    const sp = cfg.maxSpeed * (0.5 + 0.5 * r());
    return { pos: [r() * cfg.width, r() * cfg.height], vel: [Math.cos(a) * sp, Math.sin(a) * sp] };
  });
  for (let i = 0; i < STEPS; i++) boids = stepFlockGrid(boids, cfg);
  const flat = new Float32Array(N * 4);
  boids.forEach((b, i) => {
    flat[i * 4] = b.pos[0] / cfg.width;
    flat[i * 4 + 1] = b.pos[1] / cfg.height;
    flat[i * 4 + 2] = b.vel[0];
    flat[i * 4 + 3] = b.vel[1];
  });
  const stats = analyzeFlock(flat, N, cfg.width, cfg.height, cfg.sepRadius, cfg.nbrRadius, cfg.maxSpeed);
  let inside = 0;
  for (const b of boids) {
    let dx = b.pos[0] - cfg.penX;
    let dy = b.pos[1] - cfg.penY;
    dx -= cfg.width * Math.round(dx / cfg.width);
    dy -= cfg.height * Math.round(dy / cfg.height);
    if (Math.hypot(dx, dy) < cfg.penSigma) inside++;
  }
  return { ...stats, insidePen: inside / N };
}

const say = (name: string, r: ReturnType<typeof run>) =>
  `${name}: nearest ${r.nearestDistance} px, local alignment ${r.localAlignment}, speed ${r.speedOfMax}, in reach ${r.neighboursWithinNbr}, in pen ${r.insidePen.toFixed(3)}`;

test('[FL-01] a larger separation weight gives more personal space; at 0 the boids pile up', () => {
  const nn = [0, 1, 2, 4].map((w) => run({ sepWeight: w }).nearestDistance);
  assert.ok(nn[0] < nn[1] && nn[1] < nn[2] && nn[2] < nn[3], `nearest distance by weight 0, 1, 2, 4: ${nn.join(', ')}`);
  assert.ok(nn[0] <= 0.5 * nn[2], `weight 0 gives ${nn[0]} px against ${nn[2]} px at the default 2`);
});

test('[FL-02] cohesion equal to separation collapses the flock, cohesion well below it keeps its spacing', () => {
  const healthy = run({ cohWeight: 0.5 });
  const collapsed = run({ cohWeight: D.flockSepWeight });
  assert.ok(healthy.nearestDistance > 3, say('cohesion 0.5', healthy));
  assert.ok(collapsed.nearestDistance < healthy.nearestDistance / 3, `${say('cohesion = separation', collapsed)} against ${healthy.nearestDistance} healthy`);
  assert.ok(collapsed.neighboursWithinNbr > 3 * healthy.neighboursWithinNbr, `${collapsed.neighboursWithinNbr} in reach against ${healthy.neighboursWithinNbr}`);
});

test('[FL-03] alignment is what makes boids share a direction', () => {
  const none = run({ aliWeight: 0 });
  const some = run({ aliWeight: 0.5 });
  assert.ok(none.localAlignment < 0.3, say('alignment 0', none));
  assert.ok(some.localAlignment >= 0.9, say('alignment 0.5', some));
});

test('[FL-04] the separation radius sets the personal space', () => {
  const nn = [4, 12, 30].map((r) => run({ sepRadius: r }).nearestDistance);
  assert.ok(nn[0] < nn[1] && nn[1] < nn[2], `nearest distance at radius 4, 12, 30: ${nn.join(', ')}`);
});

test('[FL-05] a high max force makes the flock noisier, not tighter', () => {
  const calm = run({ maxForce: 0.02 });
  const sharp = run({ maxForce: 0.3 });
  assert.ok(sharp.localAlignment < calm.localAlignment, `${say('force 0.02', calm)}; ${say('force 0.3', sharp)}`);
});

test('[FL-06] max speed only sets the pace', () => {
  const slow = run({ maxSpeed: 1 });
  const fast = run({ maxSpeed: 5 });
  for (const r of [slow, fast]) assert.ok(r.speedOfMax >= 0.85 && r.speedOfMax <= 1, say('speed', r));
  assert.ok(Math.abs(slow.nearestDistance - fast.nearestDistance) / fast.nearestDistance < 0.25, `spacing ${slow.nearestDistance} against ${fast.nearestDistance} px`);
});

test('[FL-07] a predator pointer empties its circle and an attractor fills it', () => {
  // First written as "below half at strength 4"; the first run measured 0.57 on this seed (0.15 to 0.57 over
  // four seeds), so the claim was split: strength 4 reduces, strength 10 (the slider's maximum) empties.
  const none = run({ penMode: PEN_NONE, penActive: true });
  const predator = run({ penMode: PEN_PREDATOR, penActive: true, penStrength: 4 });
  const strong = run({ penMode: PEN_PREDATOR, penActive: true, penStrength: 10 });
  const attractor = run({ penMode: PEN_ATTRACT, penActive: true, penStrength: 4 });
  assert.ok(predator.insidePen < 0.7 * none.insidePen, `${none.insidePen.toFixed(3)} without the pointer, ${predator.insidePen.toFixed(3)} as predator at 4`);
  assert.ok(strong.insidePen < 0.1 * none.insidePen, `${strong.insidePen.toFixed(3)} as predator at 10`);
  assert.ok(attractor.insidePen > 3 * none.insidePen, `${attractor.insidePen.toFixed(3)} as attractor`);
});

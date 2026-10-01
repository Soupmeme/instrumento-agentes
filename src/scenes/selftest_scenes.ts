// Checks of the world-side hooks that the scene system uses, in the in-browser GPU self-test
// (called from src/physarum/selftest.ts). They need a real WebGPU adapter. What they cover:
//   * safe mode's count scale: every family runs exactly its scaled count, and the scale is
//     reversible (counts come back)
//   * the accent's surge: the pointer force on boids rises by the documented factor (GPU against
//     the CPU flock reference with the scaled weight), and the surge fades by itself
//   * the spawn fraction: a burst moves about the requested share of the agents
// What they do not cover: the scene director (pure logic, unit tested in Node), the palette
// crossfade and the rest of the display pass (judged by eye), any other GPU.

import type { Physarum } from '../physarum/physarum';
import { MODE_CLASSIC, MODE_EXTENDED, modeDefaults } from '../physarum/params';
import { stepFlockBrute, PEN_PREDATOR, type Boid, type FlockConfig } from '../flock/flocking.ts';

export type Check = { name: string; ok: boolean; detail: string };
const TAU = Math.PI * 2;

export async function sceneHookChecks(p: Physarum): Promise<Check[]> {
  const checks: Check[] = [];
  const check = (name: string, ok: boolean, detail = '') => checks.push({ name, ok, detail });
  const W = p.gridWidth;
  const H = p.gridHeight;
  const sum = async (buf: GPUBuffer) => new Uint32Array(await p.debugRead(buf, W * H * 4)).reduce((a, b) => a + b, 0);

  // ---- safe mode: the count scale ----
  Object.assign(p.params, modeDefaults(MODE_CLASSIC), {
    mode: MODE_CLASSIC, physarumOn: 1, agentCount: 100_000, followerCount: 40_000, flockCount: 20_000, flowToPhysarum: 0, trailToBoids: 0, flockPenMode: 0,
  });
  p.setPen(0.5, 0.5, false);
  p.countScale = 0.35;
  p.reset(21);
  p.step();
  await p.whenIdle();
  const want = [35_000, 14_000, 7_000];
  const got = [await sum(p.counterBuffer), await sum(p.flow.counterBuffer), await sum(p.flock.counterBuffer)];
  check(
    'safe mode: every family runs exactly its scaled count',
    got.every((g, i) => g === want[i]),
    `Physarum ${got[0]}/${want[0]}, followers ${got[1]}/${want[1]}, boids ${got[2]}/${want[2]}`,
  );
  p.countScale = 1;
  p.step();
  await p.whenIdle();
  const back = [await sum(p.counterBuffer), await sum(p.flow.counterBuffer), await sum(p.flock.counterBuffer)];
  check('safe mode is reversible: leaving it brings every count back', back[0] === 100_000 && back[1] === 40_000 && back[2] === 20_000, `${back.join(', ')}`);

  // ---- the accent's surge on the pointer force of the boids ----
  {
    const N = 3000;
    Object.assign(p.params, {
      physarumOn: 0, followerCount: 0, flockCount: N, flockSpeed: 3, flockForce: 0.08, flockSepWeight: 0, flockAliWeight: 0, flockCohWeight: 0,
      flockSepRadius: 14, flockNbrRadius: 40, flockFov: TAU, flockPenMode: PEN_PREDATOR, flockPenStrength: 1, penRadius: 0.3, trailToBoids: 0,
    });
    let s = 5;
    const rnd = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
    const start = new Float32Array(N * 4);
    for (let i = 0; i < N; i++) {
      const a = rnd() * TAU;
      start.set([0.3 + rnd() * 0.4, 0.3 + rnd() * 0.4, Math.cos(a) * 2, Math.sin(a) * 2], i * 4);
    }
    const boids: Boid[] = Array.from({ length: N }, (_, i) => ({ pos: [start[i * 4] * W, start[i * 4 + 1] * H], vel: [start[i * 4 + 2], start[i * 4 + 3]] }));
    const run = async (surge: number) => {
      p.reset(22);
      p.setPen(0.5, 0.5, true);
      p.debugWriteBuffer(p.flock.boidBuffer, start);
      p.surge(surge);
      p.step();
      return new Float32Array(await p.debugRead(p.flock.boidBuffer, N * 16));
    };
    const cfgFor = (strength: number): FlockConfig => ({
      width: W, height: H, maxSpeed: 3, maxForce: 0.08, sepWeight: 0, aliWeight: 0, cohWeight: 0, sepRadius: 14, nbrRadius: 40, fov: TAU,
      penMode: PEN_PREDATOR, penX: 0.5 * W, penY: 0.5 * H, penSigma: 0.3 * H, penStrength: strength, penActive: true,
    });
    for (const surge of [0, 0.8]) {
      const out = await run(surge);
      const want = stepFlockBrute(boids, cfgFor(1 * (1 + 3 * surge)));
      let worst = 0;
      for (let i = 0; i < N; i++) worst = Math.max(worst, Math.hypot(out[i * 4 + 2] - want[i].vel[0], out[i * 4 + 3] - want[i].vel[1]));
      check(`accent surge ${surge}: the pointer weight on boids is multiplied by ${(1 + 3 * surge).toFixed(1)}`, worst < 1e-3, `worst velocity error ${worst.toExponential(1)}`);
    }
    const a = await run(0);
    const b = await run(1);
    let moreForce = 0;
    for (let i = 0; i < N; i++) {
      const da = Math.hypot(a[i * 4 + 2] - start[i * 4 + 2], a[i * 4 + 3] - start[i * 4 + 3]);
      const db = Math.hypot(b[i * 4 + 2] - start[i * 4 + 2], b[i * 4 + 3] - start[i * 4 + 3]);
      if (db > da) moreForce++;
    }
    check('accent surge: a full surge changes the velocity of the boids more than none', moreForce > N * 0.6, `${moreForce} of ${N} boids pushed harder`);
    // It fades by itself, step after step.
    p.surge(1);
    const before = p.currentSurge;
    for (let i = 0; i < 100; i++) p.step();
    check('accent surge fades by itself: 100 steps leave under 2% of it', before === 1 && p.currentSurge < 0.02, `1 -> ${p.currentSurge.toFixed(4)}`);
  }

  // ---- the spawn fraction ----
  {
    const N = 100_000;
    Object.assign(p.params, modeDefaults(MODE_EXTENDED), {
      mode: MODE_EXTENDED, physarumOn: 1, agentCount: N, followerCount: 0, flockCount: 0, respawnRate: 0, penRadius: 0.2, presetSeconds: 0, inertia: 0,
    });
    const moved = async (fraction: number) => {
      p.reset(23);
      p.setPen(0.5, 0.5, true);
      p.step();
      await p.whenIdle();
      const a = new Float32Array(await p.debugRead(p.agentBuffer, N * 16));
      p.spawn('center', fraction);
      p.step();
      const b = new Float32Array(await p.debugRead(p.agentBuffer, N * 16));
      let n = 0;
      for (let i = 0; i < N; i++) if (Math.abs(b[i * 4] - a[i * 4]) * W > 12 || Math.abs(b[i * 4 + 1] - a[i * 4 + 1]) * H > 12) n++;
      return n / N;
    };
    const small = await moved(0.05);
    const big = await moved(0.3);
    check('spawn burst: the share of agents that jump follows the requested fraction', Math.abs(small - 0.05) < 0.02 && Math.abs(big - 0.3) < 0.03, `0.05 -> ${small.toFixed(3)}, 0.3 -> ${big.toFixed(3)}`);
  }

  p.countScale = 1;
  return checks;
}

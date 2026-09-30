// Coupling and rendering checks of the in-browser GPU self-test (called from
// src/physarum/selftest.ts). They need a real WebGPU adapter. What they cover:
//   * flow -> Physarum: the classic agent and the extended agent, stepped once on an empty trail
//     with the coupling on, against the CPU references (reference.ts, extended.ts) using the
//     GPU's own field as data; plus that weight 0 and a field of strength 0 change nothing
//   * trail -> boids: one flock step against the all-pairs CPU reference with a trail to climb
//   * the delayed trail (colour trick): two diffuse steps against the CPU formula
//   * everything on at once: counters, health and bit-identical determinism
// What they do not cover: the display pass (palette, change colour, vignette), which is judged by
// eye; any GPU other than the one running them.

import type { Physarum } from '../physarum/physarum';
import { MODE_CLASSIC, MODE_EXTENDED, modeDefaults } from '../physarum/params';
import { stepAgent, wrap, type AgentState, type StepParams } from '../physarum/reference.ts';
import { pixelScaleFor, stepAgentExtended } from '../physarum/extended.ts';
import { presetOfSlot } from '../physarum/presets';
import { sampleField, KIND_NOISE_ANGLE, PEN_NONE as FIELD_PEN_NONE } from '../flow/flowfield.ts';
import { stepFlockBrute, PEN_NONE, type Boid, type FlockConfig } from '../flock/flocking.ts';
import { TRAIL_SENSE_PX } from './coupling.ts';

const TAU = Math.PI * 2;
const angleDiff = (a: number, b: number) => wrap(a - b + Math.PI, TAU) - Math.PI;

export type Check = { name: string; ok: boolean; detail: string };

export async function couplingChecks(p: Physarum): Promise<Check[]> {
  const checks: Check[] = [];
  const check = (name: string, ok: boolean, detail = '') => checks.push({ name, ok, detail });
  const W = p.gridWidth;
  const H = p.gridHeight;
  const fw = p.flow.fieldWidth;
  const fh = p.flow.fieldHeight;

  // ---- flow -> Physarum, classic agent ----
  Object.assign(p.params, {
    mode: MODE_CLASSIC, physarumOn: 1, followerCount: 0, flockCount: 0, sensorDistance: 10, sensorAngle: 0.7, rotationAngle: 0.5,
    moveDistance: 2, respawnRate: 0, fieldKind: KIND_NOISE_ANGLE, fieldFrequency: 3, fieldEvolution: 0.1, fieldQuantSteps: 0,
    fieldStrength: 0.8, penFieldMode: FIELD_PEN_NONE,
  });
  const starts: AgentState[] = [
    { x: 0.2 * W + 0.5, y: 0.3 * H + 0.5, heading: 0.3 },
    { x: 0.4 * W + 0.5, y: 0.7 * H + 0.5, heading: 1.8 },
    { x: 0.6 * W + 0.5, y: 0.2 * H + 0.5, heading: 3.4 },
    { x: 0.8 * W + 0.5, y: 0.6 * H + 0.5, heading: 5.0 },
    { x: 0.5 * W + 0.5, y: 0.5 * H + 0.5, heading: 4.2 },
    { x: 4.5, y: 0.4 * H + 0.5, heading: Math.PI + 0.3 }, // near the edge
  ];
  const runClassic = async (weight: number, strength: number) => {
    Object.assign(p.params, { flowToPhysarum: weight, fieldStrength: strength, agentCount: starts.length });
    p.reset(3);
    const data = new Float32Array(starts.length * 4);
    starts.forEach((a, i) => data.set([a.x / W, a.y / H, a.heading, 0], i * 4));
    p.debugWriteAgents(data);
    p.step();
    const out = new Float32Array(await p.debugRead(p.agentBuffer, starts.length * 16));
    const field = new Float32Array(await p.debugRead(p.flow.fieldBuffer, fw * fh * 8));
    return { out, field };
  };
  for (const weight of [1, 0.35]) {
    const { out, field } = await runClassic(weight, 0.8);
    const sp: StepParams = {
      width: W, height: H, sensorDistance: 10, sensorAngle: 0.7, rotationAngle: 0.5, moveDistance: 2, flowBias: weight,
      flowVector: (x, y) => sampleField(field, fw, fh, x / W, y / H),
    };
    let worst = 0;
    let turnedBy = 0;
    starts.forEach((a, i) => {
      const want = stepAgent(a, () => 0, sp, true);
      worst = Math.max(worst, Math.abs(angleDiff(out[i * 4 + 2], want.heading)));
      turnedBy = Math.max(turnedBy, Math.abs(angleDiff(want.heading, a.heading)));
    });
    check(
      `flow -> Physarum (classic), weight ${weight}: heading matches the CPU steering rule`,
      worst < 2e-4 && turnedBy > 0.03,
      `${starts.length} agents, worst heading error ${worst.toExponential(1)} rad, largest turn ${turnedBy.toFixed(3)} rad (must be above 0.03 so the coupling is exercised)`,
    );
  }
  {
    const off = await runClassic(0, 0.8);
    const flat = await runClassic(1, 0);
    let offErr = 0;
    let flatErr = 0;
    starts.forEach((a, i) => {
      offErr = Math.max(offErr, Math.abs(angleDiff(off.out[i * 4 + 2], a.heading)));
      flatErr = Math.max(flatErr, Math.abs(angleDiff(flat.out[i * 4 + 2], a.heading)));
    });
    check('flow -> Physarum: weight 0 leaves every heading alone (empty trail, no turn)', offErr < 1e-6, `largest heading change ${offErr.toExponential(1)} rad`);
    check('flow -> Physarum: a field of strength 0 is silent, it does not steer or brake', flatErr < 1e-6, `largest heading change ${flatErr.toExponential(1)} rad`);
  }

  // ---- flow -> Physarum, extended agent ----
  {
    const BG = 21;
    const PEN = 13;
    Object.assign(p.params, modeDefaults(MODE_EXTENDED), {
      mode: MODE_EXTENDED, physarumOn: 1, backgroundPreset: BG, penPreset: PEN, presetSeconds: 0, respawnRate: 0, inertia: 0,
      flowToPhysarum: 0.8, fieldStrength: 0.8, agentCount: starts.length,
    });
    p.reset(3);
    p.setPen(0.5, 0.5, false);
    const data = new Float32Array(starts.length * 4);
    starts.forEach((a, i) => data.set([a.x / W, a.y / H, a.heading, 0], i * 4));
    p.debugWriteAgents(data);
    p.step();
    const out = new Float32Array(await p.debugRead(p.agentBuffer, starts.length * 16));
    const field = new Float32Array(await p.debugRead(p.flow.fieldBuffer, fw * fh * 8));
    let worst = 0;
    let turnedBy = 0;
    starts.forEach((a, i) => {
      const want = stepAgentExtended(
        a, () => 0,
        {
          width: W, height: H, pixelScale: pixelScaleFor(W, H), background: presetOfSlot(BG), pen: presetOfSlot(PEN), penWeight: 0,
          flowBias: 0.8, flowVector: (x, y) => sampleField(field, fw, fh, x / W, y / H),
        },
        true,
      );
      worst = Math.max(worst, Math.abs(angleDiff(out[i * 4 + 2], want.heading)));
      turnedBy = Math.max(turnedBy, Math.abs(angleDiff(want.heading, a.heading)));
    });
    check(
      'flow -> Physarum (extended), weight 0.8: heading matches the CPU steering rule',
      worst < 3e-4 && turnedBy > 0.03,
      `${starts.length} agents, worst heading error ${worst.toExponential(1)} rad, largest turn ${turnedBy.toFixed(3)} rad`,
    );
  }

  // ---- trail -> boids ----
  {
    const N = 4000;
    Object.assign(p.params, {
      mode: MODE_CLASSIC, physarumOn: 0, followerCount: 0, flowToPhysarum: 0, flockCount: N, flockSpeed: 3, flockForce: 0.08,
      flockSepWeight: 1.5, flockAliWeight: 1, flockCohWeight: 1, flockSepRadius: 14, flockNbrRadius: 40, flockFov: TAU, flockPenMode: 0,
    });
    // A smooth trail with several hills, so the gradient is well defined almost everywhere.
    const trail = new Float32Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        trail[y * W + x] = 0.5 + 0.25 * Math.sin((x / W) * TAU * 3) * Math.cos((y / H) * TAU * 2) + 0.15 * Math.sin((x / W + y / H) * TAU * 5);
      }
    }
    let s = 99;
    const rnd = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
    const start = new Float32Array(N * 4);
    for (let i = 0; i < N; i++) {
      const a = rnd() * TAU;
      const sp = 3 * (0.5 + 0.5 * rnd());
      start.set([rnd() * 0.999, rnd() * 0.999, Math.cos(a) * sp, Math.sin(a) * sp], i * 4);
    }
    const boids: Boid[] = Array.from({ length: N }, (_, i) => ({ pos: [start[i * 4] * W, start[i * 4 + 1] * H], vel: [start[i * 4 + 2], start[i * 4 + 3]] }));
    for (const [name, set, weight] of [
      ['with the three flocking rules', {}, 1],
      ['alone (flocking weights 0)', { flockSepWeight: 0, flockAliWeight: 0, flockCohWeight: 0 }, 2.5],
    ] as const) {
      Object.assign(p.params, { flockSepWeight: 1.5, flockAliWeight: 1, flockCohWeight: 1, trailToBoids: weight }, set);
      p.reset(10);
      p.setPen(0.5, 0.5, false);
      p.debugWriteBuffer(p.flock.boidBuffer, start);
      p.debugWriteTrail(trail);
      p.step();
      const out = new Float32Array(await p.debugRead(p.flock.boidBuffer, N * 16));
      const cfg: FlockConfig = {
        width: W, height: H, maxSpeed: 3, maxForce: 0.08, sepWeight: p.params.flockSepWeight, aliWeight: p.params.flockAliWeight,
        cohWeight: p.params.flockCohWeight, sepRadius: 14, nbrRadius: 40, fov: TAU, penMode: PEN_NONE, penX: 0, penY: 0, penSigma: 1,
        penStrength: 0, penActive: false,
        trail: { at: (ix, iy) => trail[iy * W + ix], weight, sense: TRAIL_SENSE_PX },
      };
      const want = stepFlockBrute(boids, cfg);
      let bad = 0;
      let worst = 0;
      let changed = 0;
      for (let i = 0; i < N; i++) {
        const dv = Math.hypot(out[i * 4 + 2] - want[i].vel[0], out[i * 4 + 3] - want[i].vel[1]);
        worst = Math.max(worst, dv);
        if (dv > 2e-3) bad++;
        if (Math.hypot(start[i * 4 + 2] - want[i].vel[0], start[i * 4 + 3] - want[i].vel[1]) > 1e-6) changed++;
      }
      // A trail pixel read at exactly a pixel boundary can land on the other side for float32 and
      // float64 (as with the radius in the flock checks): a handful per thousand may differ.
      const allowed = Math.ceil(N * 0.002);
      check(
        `trail -> boids, weight ${weight} ${name}: matches the CPU reference`,
        bad <= allowed && changed > N / 2,
        `${N} boids, ${bad} differ by more than 2e-3 (allowed ${allowed}), velocity worst ${worst.toExponential(1)}, ${changed} changed velocity`,
      );
    }
    Object.assign(p.params, { flockSepWeight: 2, flockAliWeight: 1.5, flockCohWeight: 0.6, trailToBoids: 0 });
  }

  // ---- the delayed trail ----
  {
    Object.assign(p.params, { physarumOn: 0, flockCount: 0, followerCount: 0, decay: 0.9 });
    p.reset(5);
    const trail = new Float32Array(W * H);
    for (let i = 0; i < trail.length; i++) trail[i] = ((i * 2654435761) >>> 0) % 1000 / 1000;
    p.debugWriteTrail(trail);
    const blurDecay = (t: Float32Array) => {
      const o = new Float32Array(t.length);
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          let sum = 0;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) sum += t[((y + dy + H) % H) * W + ((x + dx + W) % W)];
          o[y * W + x] = (sum / 9) * 0.9;
        }
      }
      return o;
    };
    const now1 = blurDecay(trail);
    const want1 = now1.map((v) => 0.8 * v);
    p.step();
    const got1 = new Float32Array(await p.debugRead(p.delayedBuffer, W * H * 4));
    const now2 = blurDecay(now1);
    const want2 = now2.map((v, i) => 0.8 * v + 0.2 * want1[i]);
    p.step();
    const got2 = new Float32Array(await p.debugRead(p.delayedBuffer, W * H * 4));
    let e1 = 0;
    let e2 = 0;
    for (let i = 0; i < got1.length; i++) {
      e1 = Math.max(e1, Math.abs(got1[i] - want1[i]));
      e2 = Math.max(e2, Math.abs(got2[i] - want2[i]));
    }
    check('delayed trail: delayed = 0.8 * trail + 0.2 * delayed, first and second step', e1 < 1e-5 && e2 < 1e-5, `worst error ${e1.toExponential(1)} then ${e2.toExponential(1)}`);
  }

  // ---- everything on at once: counters, health, determinism ----
  {
    const NA = 100_000;
    const NF = 50_000;
    const NB = 20_000;
    Object.assign(p.params, modeDefaults(MODE_CLASSIC), {
      mode: MODE_CLASSIC, physarumOn: 1, agentCount: NA, followerCount: NF, flockCount: NB, flowToPhysarum: 0.6, trailToBoids: 1.5,
      fieldKind: 1, fieldStrength: 1, flockPenMode: 0, followerRespawn: 0.002, respawnRate: 0.001, decay: 0.9,
      sensorDistance: 16, sensorAngle: (45 * Math.PI) / 180, rotationAngle: (45 * Math.PI) / 180, moveDistance: 1.5,
      flockSepWeight: 2, flockAliWeight: 1.5, flockCohWeight: 0.6,
    });
    p.setPen(0.5, 0.5, false);
    const run = async () => {
      p.reset(61);
      for (let i = 0; i < 20; i++) p.step();
      await p.whenIdle();
      return {
        agents: new Float32Array(await p.debugRead(p.agentBuffer, NA * 16)),
        boids: new Float32Array(await p.debugRead(p.flock.boidBuffer, NB * 16)),
      };
    };
    const first = await run();
    const sum = async (buf: GPUBuffer) => (new Uint32Array(await p.debugRead(buf, W * H * 4))).reduce((a, b) => a + b, 0);
    const counts = [await sum(p.counterBuffer), await sum(p.flow.counterBuffer), await sum(p.flock.counterBuffer)];
    check('all couplings on: every family counted exactly once', counts[0] === NA && counts[1] === NF && counts[2] === NB, `Physarum ${counts[0]}/${NA}, followers ${counts[1]}/${NF}, boids ${counts[2]}/${NB}`);
    let bad = 0;
    for (const arr of [first.agents, first.boids]) for (let i = 0; i < arr.length; i += 4) if (!(Number.isFinite(arr[i]) && Number.isFinite(arr[i + 1]) && Number.isFinite(arr[i + 2]) && arr[i] >= 0 && arr[i] < 1 && arr[i + 1] >= 0 && arr[i + 1] < 1)) bad++;
    check('all couplings on: no NaN, positions in [0,1)', bad === 0, `${bad} bad agents or boids`);
    const second = await run();
    let diff = 0;
    for (let i = 0; i < first.agents.length; i++) if (first.agents[i] !== second.agents[i]) diff++;
    for (let i = 0; i < first.boids.length; i++) if (first.boids[i] !== second.boids[i]) diff++;
    check('all couplings on: same seed and steps give identical agents and boids', diff === 0, `${diff} differing values`);
  }

  return checks;
}

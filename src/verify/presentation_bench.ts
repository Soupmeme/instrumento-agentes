// Cost of a scene at a given canvas size (M8): wall time per simulation step and per display
// pass, and the GPU time of each pass. Dev only.
//
//   await __exp.presentationBench({ scene: 1 })        a placeholder scene (index), full quality
//   await __exp.presentationBench({ scene: 'heavy' })  1M extended agents, 500k followers, 100k boids
//   await __exp.presentationBench({ scene: 1, safe: true })
//
// Open the page with ?res=1920x1080 to draw to a canvas of that size whatever the window is. The
// timings are only worth reading with the machine otherwise idle: another program using the GPU
// (a game) makes a step 3 times slower and the rounds disagree (M7, TL-05).

import type { Physarum } from '../physarum/physarum';
import type { Director } from '../scenes/director';
import type { SceneData } from '../scenes/types';
import { MODE_EXTENDED, modeDefaults } from '../physarum/params';

export interface BenchOptions {
  scene: number | 'heavy';
  /** Safe mode: the counts scaled as the S key does (the canvas scale is the page's, set with ?res and the S key). */
  safe?: boolean;
  blocks?: number;
  stepsPerBlock?: number;
  /** Send the result to the development server, to evidence/presentation/ (default false). */
  save?: boolean;
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const r = (v: number, d = 3) => +v.toFixed(d);

export async function presentationBench(p: Physarum, o: BenchOptions) {
  const { blocks = 12, stepsPerBlock = 100 } = o;
  const director = (window as unknown as { __director?: Director }).__director;
  if (!director) throw new Error('no director hook (dev server only)');
  const savedScale = p.countScale;
  const wasPaused = p.paused;
  const savedIndex = director.index;
  p.paused = true;
  try {
    if (o.scene === 'heavy') {
      Object.assign(p.params, modeDefaults(MODE_EXTENDED), {
        mode: MODE_EXTENDED, physarumOn: 1, backgroundPreset: 21, penPreset: 21, presetSeconds: 0, agentCount: 1_000_000,
        followerCount: 500_000, fieldKind: 1, flockCount: 100_000, flowToPhysarum: 0.25,
      });
    } else {
      director.setScenes(director.scenes as SceneData[], o.scene);
    }
    p.countScale = o.safe ? 0.35 : 1;
    p.setPen(0.5, 0.5, false);
    p.reset(7);
    for (let i = 0; i < 300; i++) p.step();
    await p.whenIdle();

    const step: number[] = [];
    for (let b = 0; b < blocks; b++) {
      const t0 = performance.now();
      for (let i = 0; i < stepsPerBlock; i++) {
        p.step();
        if (i % 50 === 49) await p.whenIdle();
      }
      await p.whenIdle();
      step.push((performance.now() - t0) / stepsPerBlock);
    }
    const display = await p.benchRender(60);

    // GPU time of each pass: one frame at a time with the timestamps on, averaged.
    p.wantTimings = true;
    const sums: Record<string, number> = {};
    let n = 0;
    for (let i = 0; i < 90; i++) {
      p.step();
      await p.benchRender(1, true);
      await new Promise((res) => setTimeout(res, 2)); // the timestamps arrive through mapAsync
      if (i < 20) continue;
      for (const [k, v] of Object.entries(p.timings)) if (Number.isFinite(v)) sums[k] = (sums[k] ?? 0) + v;
      n++;
    }
    p.wantTimings = false;
    const passes = Object.fromEntries(Object.entries(sums).map(([k, v]) => [k, r(v / n)]));
    const gpuTotal = r(Object.values(passes).reduce((a, b) => a + b, 0));
    const result = {
      measuredAt: new Date().toISOString(),
      scene: o.scene === 'heavy' ? 'heavy' : director.scenes[o.scene].name,
      safe: !!o.safe,
      canvas: [p.canvasPixels[0], p.canvasPixels[1]],
      grid: [p.gridWidth, p.gridHeight],
      counts: { physarum: Math.floor(p.params.agentCount * p.countScale), followers: Math.floor(p.params.followerCount * p.countScale), boids: Math.floor(p.params.flockCount * p.countScale) },
      stepMs: { min: r(Math.min(...step)), median: r(median(step)), max: r(Math.max(...step)) },
      displayMs: r(display),
      gpuPassMs: passes,
      gpuTotalMs: gpuTotal,
    };
    if (o.save) {
      const name = `bench-${result.canvas[0]}x${result.canvas[1]}-${o.scene === 'heavy' ? 'heavy' : `scene${o.scene}`}${o.safe ? '-safe' : ''}.json`;
      await fetch(`/__evidence?path=${encodeURIComponent(`presentation/${name}`)}`, { method: 'POST', body: JSON.stringify(result, null, 2) });
    }
    return result;
  } finally {
    p.countScale = savedScale;
    p.wantTimings = false;
    director.setScenes(director.scenes as SceneData[], savedIndex);
    p.reset();
    p.paused = wasPaused;
  }
}

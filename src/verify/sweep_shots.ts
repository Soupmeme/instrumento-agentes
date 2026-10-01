// Parameter sweep tool (SPEC 10.3). Steps one parameter across a range, runs each value from the
// same seed, and saves a screenshot at fixed simulation times, so a prediction ("larger sensor
// distance gives fatter veins") can be compared with what happened by looking at files that
// anyone can open, and the logbook can point at them.
//
//   await __exp.sweepShots('sensorDistance', [8, 16, 32], { times: [300, 900] })
//
// The screenshots are the real display (palette, tone, vignette), rendered off-screen at a fixed
// size, not a drawing of the data. With the development server they are saved to
// evidence/sweeps/<label>/ (see vite.config.ts) together with a manifest that records every
// parameter used, the seed, the grid, the adapter and a hash of each file. The runs are
// deterministic, so the same sweep saves byte-identical files (TL-04 checks this).
//
// Dev only (never in the production bundle). Reads back pixels, which is fine for a test tool.

import type { Physarum } from '../physarum/physarum';
import { DEFAULT_PARAMS, type PhysarumParams } from '../physarum/params';

export interface SweepShotsOptions {
  seed?: number;
  /** Simulation steps at which to take a screenshot (60 steps = 1 simulated second). */
  times?: number[];
  /** Overrides applied to the default parameters before the swept one (for example `{ flockCount: 20000, physarumOn: 0 }`). */
  set?: Partial<PhysarumParams>;
  /** Screenshot width in pixels; the height follows the simulation grid's aspect. */
  width?: number;
  /** Folder under evidence/sweeps/. Default: the key and a time stamp. */
  label?: string;
  /** Send the files to the development server (default true). false only hashes them. */
  save?: boolean;
}

export interface SweepShot {
  value: number;
  step: number;
  file: string;
  bytes: number;
  sha256: string;
}

const ANGLE_KEYS = new Set(['sensorAngle', 'rotationAngle', 'flockFov']);
const valueLabel = (key: string, v: number) => (ANGLE_KEYS.has(key) ? `${Math.round((v * 180) / Math.PI)}deg` : String(v));

async function sha256(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function save(path: string, body: Blob | string): Promise<void> {
  const res = await fetch(`/__evidence?path=${encodeURIComponent(path)}`, { method: 'POST', body });
  if (!res.ok) throw new Error(`could not save ${path}: ${res.status} ${await res.text()}`);
}

export async function sweepShots(p: Physarum, key: keyof PhysarumParams, values: number[], opts: SweepShotsOptions = {}) {
  const { seed = 7, times = [300, 900], set = {}, width = 480, save: doSave = true } = opts;
  const label = opts.label ?? `${String(key)}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}`;
  const steps = [...times].sort((a, b) => a - b);
  const height = Math.round((width * p.gridHeight) / p.gridWidth);
  const saved = { ...p.params };
  const wasPaused = p.paused;
  const wasView = p.viewMode;
  p.paused = true;
  p.viewMode = 0;
  p.setPen(0.5, 0.5, false);
  const shots: SweepShot[] = [];
  try {
    for (const v of values) {
      Object.assign(p.params, DEFAULT_PARAMS, set, { [key]: v });
      p.reset(seed);
      let done = 0;
      for (const at of steps) {
        while (done < at) {
          p.step();
          done++;
          if (done % 100 === 0) await p.whenIdle();
        }
        await p.whenIdle();
        const image = await p.renderToPixels(width, height);
        const canvas = new OffscreenCanvas(width, height);
        canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(image.data), width, height), 0, 0);
        const blob = await canvas.convertToBlob({ type: 'image/png' });
        const file = `${String(key)}_${valueLabel(String(key), v)}_t${at}.png`;
        shots.push({ value: v, step: at, file, bytes: blob.size, sha256: await sha256(await blob.arrayBuffer()) });
        if (doSave) await save(`sweeps/${label}/${file}`, blob);
      }
    }
    const manifest = {
      tool: 'sweepShots',
      label,
      key,
      values,
      times: steps,
      seed,
      screenshot: { width, height },
      grid: { width: p.gridWidth, height: p.gridHeight },
      adapter: (await navigator.gpu.requestAdapter())?.info?.description ?? 'unknown',
      parameters: { ...DEFAULT_PARAMS, ...set },
      note: 'Each file is the real display of that value after that many steps from the seed; parameters lists the defaults and the overrides, and the swept key takes each of values.',
      shots,
    };
    if (doSave) await save(`sweeps/${label}/manifest.json`, JSON.stringify(manifest, null, 2));
    return manifest;
  } finally {
    Object.assign(p.params, saved);
    p.viewMode = wasView;
    p.reset();
    p.paused = wasPaused;
  }
}

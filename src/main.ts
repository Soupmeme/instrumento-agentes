import { initGpu, resizeCanvas, GpuUnavailableError, type Gpu } from './gpu';
import { Hud } from './hud';
import { Song } from './audio';
import { showMessage, hideMessage, toggleFullscreen } from './ui';
import { Physarum, simSizeFor } from './physarum/physarum';
import { DEFAULT_PARAMS, PARAM_SPECS, type PhysarumParams } from './physarum/params';
import { runSelfTest } from './physarum/selftest';
import { buildTuning } from './tuning';

// M1: classic Physarum on the GPU, with a tuning panel. Device init, resize, fixed-step
// simulation, display, fps HUD, song picker, fullscreen, device-lost recovery.

const MAX_RECOVERY_ATTEMPTS = 3;

// The simulation advances in fixed steps, not once per screen refresh, so it runs at the same
// speed on a 60 Hz and a 144 Hz monitor. If the machine cannot keep up, it slows down rather
// than spiralling: at most MAX_STEPS_PER_FRAME steps are taken and the backlog is dropped.
const STEPS_PER_SECOND = 60;
const STEP_MS = 1000 / STEPS_PER_SECOND;
const MAX_STEPS_PER_FRAME = 2;

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
};

const canvas = $<HTMLCanvasElement>('stage');
const messageEl = $('message');
const setupEl = $('setup');
const tuningEl = $('tuning');

let gpu: Gpu | null = null;
let physarum: Physarum | null = null;
let resolutionScale = 1; // becomes a live control with the quality presets (SPEC section 9)
let validationErrors = 0;
let lostCount = 0;
let lastFrame = 0;
let stepAccumulator = 0;

// Kept outside the Physarum object so the settings survive a device loss.
const params: PhysarumParams = { ...DEFAULT_PARAMS };

const fmt = (ms: number) => (Number.isFinite(ms) ? ms.toFixed(2) : '?');

const hud = new Hud($('hud'), () => {
  if (!gpu) return 'no GPU device';
  const info = gpu.adapter.info;
  const t = physarum?.timings;
  return (
    `canvas ${canvas.width}x${canvas.height} (scale ${resolutionScale}), grid ${physarum?.gridWidth}x${physarum?.gridHeight}\n` +
    `agents ${Math.floor(params.agentCount).toLocaleString()}\n` +
    (gpu.hasTimestampQuery && t
      ? `GPU ms: agents ${fmt(t.agent)}, deposit ${fmt(t.deposit)}, diffuse ${fmt(t.diffuse)}, display ${fmt(t.render)}\n`
      : 'GPU timing unavailable (no timestamp-query)\n') +
    `adapter ${info.vendor || '?'} ${info.architecture || ''} ${info.description || ''}\n` +
    `validation errors ${validationErrors}, device losses ${lostCount}`
  );
});

const song = new Song({
  fileInput: $<HTMLInputElement>('song-file'),
  linkInput: $<HTMLInputElement>('song-link'),
  linkButton: $<HTMLButtonElement>('btn-link'),
  status: $('song-status'),
  audio: $<HTMLAudioElement>('song'),
  embedHost: $('embed-host'),
});
void song; // referenced by the cue panel in M6

buildTuning(tuningEl, params, PARAM_SPECS, DEFAULT_PARAMS, () => physarum?.reset());

function attachDevice(g: Gpu): void {
  gpu = g;
  resizeCanvas(canvas, resolutionScale);
  const [w, h] = simSizeFor(canvas.width, canvas.height);
  physarum = new Physarum(g, params, w, h);
  if (import.meta.env.DEV) {
    // Console hooks for checks only, never used by the app itself.
    const dbg = window as unknown as Record<string, unknown>;
    dbg.__song = song;
    dbg.__physarum = physarum;
    dbg.__physarumSelfTest = () => runSelfTest(physarum!);
  }

  // Validation errors must be visible, not silent: the smoke test in M7 reads this counter.
  g.device.addEventListener('uncapturederror', (ev) => {
    validationErrors++;
    console.error('WebGPU uncaptured error:', (ev as GPUUncapturedErrorEvent).error.message);
  });
  void g.device.lost.then((info) => {
    if (gpu !== g) return; // an older device that we already replaced
    void handleDeviceLost(info);
  });
}

async function handleDeviceLost(info: GPUDeviceLostInfo): Promise<void> {
  lostCount++;
  gpu = null;
  physarum = null;
  console.error(`WebGPU device lost (${info.reason}): ${info.message}`);
  // reason "destroyed" means we did it on purpose, nothing to recover.
  if (info.reason === 'destroyed') return;

  for (let attempt = 1; attempt <= MAX_RECOVERY_ATTEMPTS; attempt++) {
    showMessage(messageEl, `The GPU device was lost.\nTrying to recover (${attempt} of ${MAX_RECOVERY_ATTEMPTS})...`);
    await new Promise((r) => setTimeout(r, 500 * attempt));
    try {
      attachDevice(await initGpu(canvas));
      hideMessage(messageEl);
      return;
    } catch (err) {
      console.error('Recovery attempt failed:', err);
    }
  }
  showMessage(messageEl, 'The GPU device was lost and could not be recovered.\nReload the page (F5).');
}

function frame(now: number): void {
  requestAnimationFrame(frame);
  if (!gpu || !physarum) return;

  // First frame after load or after a hidden tab has no meaningful delta.
  const dt = lastFrame === 0 ? 0 : Math.min(now - lastFrame, 100);
  if (lastFrame !== 0) hud.push(now - lastFrame, now);
  lastFrame = now;

  if (resizeCanvas(canvas, resolutionScale)) {
    const [w, h] = simSizeFor(canvas.width, canvas.height);
    physarum.resize(w, h);
  }

  // Fixed-step simulation (see STEPS_PER_SECOND).
  stepAccumulator += dt;
  let steps = 0;
  while (stepAccumulator >= STEP_MS && steps < MAX_STEPS_PER_FRAME) {
    physarum.step();
    stepAccumulator -= STEP_MS;
    steps++;
  }
  stepAccumulator = Math.min(stepAccumulator, STEP_MS);

  physarum.wantTimings = hud.visible;
  const encoder = gpu.device.createCommandEncoder({ label: 'frame' });
  physarum.render(encoder, gpu.context.getCurrentTexture().createView(), canvas.width, canvas.height);
  gpu.device.queue.submit([encoder.finish()]);
  physarum.afterSubmit();
}

function onKey(ev: KeyboardEvent): void {
  if (ev.repeat || ev.ctrlKey || ev.altKey || ev.metaKey) return;
  // Enter also activates a focused button, which would toggle twice.
  if (ev.target instanceof HTMLButtonElement || ev.target instanceof HTMLInputElement) return;
  switch (ev.key) {
    case 'Enter':
      ev.preventDefault();
      toggleFullscreen();
      break;
    case 'd':
    case 'D':
      hud.toggle();
      break;
    case 'p':
    case 'P':
      setupEl.classList.toggle('stealth');
      break;
    case 't':
    case 'T':
      tuningEl.hidden = !tuningEl.hidden;
      break;
    case 'r':
    case 'R':
      // Reset (SPEC 8.2): agents scatter and the trail clears.
      physarum?.reset();
      break;
  }
}

async function main(): Promise<void> {
  $('btn-fullscreen').addEventListener('click', (ev) => {
    toggleFullscreen();
    (ev.currentTarget as HTMLElement).blur();
  });
  window.addEventListener('keydown', onKey);

  // After a hidden tab, rAF timestamps jump; drop history so the HUD stays truthful.
  document.addEventListener('visibilitychange', () => {
    lastFrame = 0;
    stepAccumulator = 0;
    hud.reset();
  });

  try {
    attachDevice(await initGpu(canvas));
  } catch (err) {
    const text = err instanceof GpuUnavailableError ? err.message : `Could not start WebGPU.\n${String(err)}`;
    showMessage(messageEl, text);
    console.error(err);
    return;
  }
  requestAnimationFrame(frame);
}

// Offline support for the deployed site: once visited, it reloads with no connection.
// Only in production builds, because a caching worker gets in the way of hot reload.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js')
      .then(() => navigator.serviceWorker.ready)
      .then((reg) => {
        const urls = [location.href.split('#')[0]];
        for (const e of performance.getEntriesByType('resource')) {
          if (e.name.startsWith(location.origin)) urls.push(e.name);
        }
        reg.active?.postMessage({ type: 'precache', urls });
      })
      .catch((err) => console.warn('Service worker not registered:', err));
  });
}

void main();

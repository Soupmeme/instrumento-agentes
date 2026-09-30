import { initGpu, resizeCanvas, GpuUnavailableError, type Gpu } from './gpu';
import { Hud } from './hud';
import { Song } from './audio';
import { showMessage, hideMessage, toggleFullscreen } from './ui';
import { Physarum, simSizeFor, SIM_HZ } from './physarum/physarum';
import { DEFAULT_PARAMS, PARAM_SPECS, MODE_EXTENDED, setMode, type PhysarumParams } from './physarum/params';
import { runSelfTest } from './physarum/selftest';
import { buildTuning, type Tuning } from './tuning';

// M2: Physarum on the GPU in two modes (classic, extended with presets and a pen), with a
// tuning panel. Device init, resize, fixed-step simulation, display, pointer pen, fps HUD, song
// picker, fullscreen, device-lost recovery.

const MAX_RECOVERY_ATTEMPTS = 3;

// The simulation advances in fixed steps, not once per screen refresh, so it runs at the same
// speed on a 60 Hz and a 144 Hz monitor. If the machine cannot keep up, it slows down rather
// than spiralling: at most MAX_STEPS_PER_FRAME steps are taken and the backlog is dropped.
const STEP_MS = 1000 / SIM_HZ;
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
const penRing = $('pen-ring');

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
    `agents ${Math.floor(params.agentCount).toLocaleString()}, rule ${
      params.mode === MODE_EXTENDED
        ? `extended (background ${params.backgroundPreset}, pen ${params.penPreset}${physarum?.transitioning ? ', easing' : ''}, waves ${physarum?.activeWaves ?? 0})`
        : 'classic'
    }\n` +
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

const tuning: Tuning = buildTuning(tuningEl, params, PARAM_SPECS, () => physarum);

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
    dbg.__setMode = (m: number) => {
      setMode(params, m);
      physarum!.reset();
      tuning.refresh();
    };
    // Experiment harness (sweeps, soak tests). Loaded on demand so it never ships.
    void import('./physarum/experiments').then((m) => m.installExperiments(physarum!));
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
  if (physarum.paused) stepAccumulator = 0;
  else stepAccumulator += dt;
  let steps = 0;
  while (stepAccumulator >= STEP_MS && steps < MAX_STEPS_PER_FRAME) {
    physarum.step();
    stepAccumulator -= STEP_MS;
    steps++;
  }
  stepAccumulator = Math.min(stepAccumulator, STEP_MS);

  updatePenRing();

  physarum.wantTimings = hud.visible;
  const encoder = gpu.device.createCommandEncoder({ label: 'frame' });
  physarum.render(encoder, gpu.context.getCurrentTexture().createView(), canvas.width, canvas.height);
  gpu.device.queue.submit([encoder.finish()]);
  physarum.afterSubmit();
}

/**
 * The soft ring at the pointer: it shows the audience (and the performer) where the pen is and
 * how big. Its radius is the pen sigma, the distance at which the pen preset still has 37%
 * weight, so the alternate state visibly fades out around it.
 */
function updatePenRing(): void {
  const show = !!physarum && params.mode === MODE_EXTENDED && physarum.pen.active;
  penRing.hidden = !show;
  if (!show || !physarum) return;
  const r = params.penRadius * canvas.clientHeight;
  penRing.style.width = penRing.style.height = `${2 * r}px`;
  penRing.style.left = `${physarum.pen.x * canvas.clientWidth}px`;
  penRing.style.top = `${physarum.pen.y * canvas.clientHeight}px`;
}

const PEN_MIN = 0.05;
const PEN_MAX = 0.9;

/**
 * Pointer input on the picture (SPEC 8.2): move = the pen, wheel = pen size (temporary until the
 * intensity macro of M6), left click = a wave, right button held and moving = stir. Only in the
 * extended mode: the classic rule has no pen.
 */
function setUpPointer(): void {
  const norm = (ev: PointerEvent) => ({ x: ev.clientX / canvas.clientWidth, y: ev.clientY / canvas.clientHeight });

  canvas.addEventListener('pointermove', (ev) => {
    if (!physarum || params.mode !== MODE_EXTENDED) return;
    const { x, y } = norm(ev);
    physarum.setPen(x, y, true);
    if (ev.buttons & 2) {
      // 40 CSS pixels of movement in one event is full strength (length 1). The push fades by
      // itself a few frames after the pointer stops.
      physarum.addStir(ev.movementX / 40, ev.movementY / 40);
    }
  });
  canvas.addEventListener('pointerleave', () => physarum?.setPen(physarum.pen.x, physarum.pen.y, false));
  canvas.addEventListener('pointerdown', (ev) => {
    if (!physarum || params.mode !== MODE_EXTENDED) return;
    const { x, y } = norm(ev);
    physarum.setPen(x, y, true);
    if (ev.button === 0) physarum.triggerWave(x, y);
  });
  canvas.addEventListener('contextmenu', (ev) => ev.preventDefault());
  canvas.addEventListener(
    'wheel',
    (ev) => {
      if (params.mode !== MODE_EXTENDED) return;
      ev.preventDefault();
      params.penRadius = Math.min(PEN_MAX, Math.max(PEN_MIN, params.penRadius * Math.exp(-ev.deltaY * 0.001)));
      tuning.refresh();
    },
    { passive: false },
  );
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
  setUpPointer();

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

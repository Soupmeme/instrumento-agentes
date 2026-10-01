import { initGpu, resizeCanvas, GpuUnavailableError, type Gpu } from './gpu';
import { Hud } from './hud';
import { Song } from './audio';
import { showMessage, hideMessage, toggleFullscreen } from './ui';
import { Physarum, simSizeFor, SIM_HZ } from './physarum/physarum';
import { DEFAULT_PARAMS, PARAM_SPECS, MODE_EXTENDED, setMode, type PhysarumParams } from './physarum/params';
import { runSelfTest } from './physarum/selftest';
import { buildTuning, type Tuning } from './tuning';
import { Director } from './scenes/director';
import { loadShippedScenes, onScenesFileChanged } from './scenes';
import { actionForKey } from './scenes/keys';
import { saveAutosave } from './scenes/storage';
import { CuePanel } from './cue';
import { buildHelp } from './help';
import { SceneTools } from './scene_tools';
import { Inspector } from './inspect';
import { familyReadout } from './inspect_text';
import type { SceneData } from './scenes/types';

// M6: the instrument. Physarum (two modes), flow followers and a flock in one shared picture,
// played through scenes (src/scenes): keyboard and mouse as in SPEC 8.2, a cue panel, a help
// overlay and a rehearsal panel. Device init, resize, fixed-step simulation, display, fps HUD,
// song picker, fullscreen, device-lost recovery.

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
const helpEl = $('help');
const cueEl = $('cue');
const badgeEl = $('badge');

let gpu: Gpu | null = null;
let physarum: Physarum | null = null;
let resolutionScale = 1; // becomes a live control with the quality presets (SPEC section 9)
let validationErrors = 0;
let lostCount = 0;
let lastFrame = 0;
let lastSliderRefresh = 0;
let lastIntensity = 0.5;
let stepAccumulator = 0;
let director: Director | null = null;
let sceneList: SceneData[] = loadShippedScenes().scenes;
let sceneIndex = 0;
let safeMode = false;
let sceneStarted = false;
/** Safe mode runs this fraction of the agents, followers and boids, at SAFE_RESOLUTION of the canvas size. */
const SAFE_COUNT_SCALE = 0.35;
const SAFE_RESOLUTION = 0.6;

// Kept outside the Physarum object so the settings survive a device loss.
const params: PhysarumParams = { ...DEFAULT_PARAMS };

const fmt = (ms: number) => (Number.isFinite(ms) ? ms.toFixed(2) : '?');

const inspector = new Inspector($('probe'), $('view-label'), () => physarum);

const hud = new Hud($('hud'), () => {
  if (!gpu) return 'no GPU device';
  const info = gpu.adapter.info;
  const t = physarum?.timings;
  return (
    `canvas ${canvas.width}x${canvas.height} (scale ${resolutionScale}), grid ${physarum?.gridWidth}x${physarum?.gridHeight}\n` +
    (director?.scene
      ? `scene ${director.index + 1}/${director.scenes.length} "${director.scene.name}", wheel ${director.intensity.toFixed(2)}, ${director.progress === null ? 'settled' : `transition ${(director.progress * 100).toFixed(0)}%`}, ${physarum?.paused ? 'FROZEN, ' : ''}${safeMode ? 'SAFE MODE' : 'full quality'}\n`
      : '') +
    `agents ${Math.floor(params.agentCount).toLocaleString()}, rule ${
      params.mode === MODE_EXTENDED
        ? `extended (background ${params.backgroundPreset}, pen ${params.penPreset}${physarum?.transitioning ? ', easing' : ''}, waves ${physarum?.activeWaves ?? 0})`
        : 'classic'
    }\n` +
    (gpu.hasTimestampQuery && t
      ? `GPU ms: agents ${fmt(t.agent)}, followers ${fmt(t.followers)}, field ${fmt(t.field)}, flock grid ${fmt(t.flockGrid)}, flock ${fmt(t.flock)}, deposit ${fmt(t.deposit)}, diffuse ${fmt(t.diffuse)}, display ${fmt(t.render)}\n`
      : 'GPU timing unavailable (no timestamp-query)\n') +
    `followers ${Math.floor(params.followerCount).toLocaleString()}, boids ${Math.floor(params.flockCount).toLocaleString()}, Physarum ${params.physarumOn ? 'on' : 'off'}, field arrows ${physarum?.fieldArrows ? 'on' : 'off'}, flock overlay ${physarum?.flockDebug ? 'on' : 'off'}\n` +
    `${familyReadout(params)}\n` +
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

// The cue panel shows the song's elapsed time, read from the audio element: display only, it
// triggers nothing (CLAUDE.md rule 2).
const cue = new CuePanel(cueEl, () => director, () => (song.hasSong ? song.elapsed : null));
buildHelp(helpEl);

// Edits made in the rehearsal panel are remembered by the current scene, and the scenes are
// autosaved (a convenience: storage may be blocked, see scenes/storage.ts).
let autosaveTimer = 0;
function scheduleAutosave(): void {
  window.clearTimeout(autosaveTimer);
  autosaveTimer = window.setTimeout(() => {
    if (director) saveAutosave(director.scenes);
  }, 600);
}
let sceneTools: SceneTools | null = null;
// Development only: saving src/scenes/scenes.json re-applies the scenes at once, in the scene
// the performer is in (no transition, no reset).
onScenesFileChanged((scenes) => {
  sceneList = scenes;
  if (!director) return;
  director.setScenes(scenes, sceneIndex);
  cue.refresh();
  sceneTools?.refresh();
  tuning.refresh();
});
const tuning: Tuning = buildTuning(tuningEl, params, PARAM_SPECS, () => physarum, {
  onEdit: (key, value) => {
    director?.edit(key, value);
    scheduleAutosave();
  },
  onBulk: () => {
    director?.capture(false);
    scheduleAutosave();
  },
  addSceneTools: (container) => {
    sceneTools = new SceneTools(container, {
      director: () => director,
      onScenesChanged: () => {
        cue.refresh();
        scheduleAutosave();
      },
      refreshSliders: () => tuning.refresh(),
    });
  },
});

function attachDevice(g: Gpu): void {
  gpu = g;
  resizeCanvas(canvas, resolutionScale);
  const [w, h] = simSizeFor(canvas.width, canvas.height);
  physarum = new Physarum(g, params, w, h);
  physarum.countScale = safeMode ? SAFE_COUNT_SCALE : 1;
  // The director sits between the performer's inputs and the parameters. On the first device it
  // enters scene 1; after a recovered device loss it re-applies the scene the performer was in.
  director = new Director(physarum, sceneList);
  director.onChange(() => {
    if (!director) return;
    sceneIndex = director.index;
    sceneList = director.scenes as SceneData[];
    cue.refresh();
    sceneTools?.refresh();
    updateBadge();
  });
  if (!sceneStarted) {
    sceneStarted = true;
    director.goto(0);
  } else director.setScenes(sceneList, sceneIndex);
  if (import.meta.env.DEV) {
    // Console hooks for checks only, never used by the app itself.
    const dbg = window as unknown as Record<string, unknown>;
    dbg.__song = song;
    dbg.__physarum = physarum;
    dbg.__director = director;
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
  director = null;
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
    director?.update(); // a transition or the wheel's glide advances by one step, then the world steps
    physarum.step();
    stepAccumulator -= STEP_MS;
    steps++;
  }
  stepAccumulator = Math.min(stepAccumulator, STEP_MS);

  updatePenRing();
  cue.tick(now);
  // While the rehearsal panel is open, keep its sliders in step with a transition or the wheel.
  if (!tuningEl.hidden && director && (director.progress !== null || director.intensity !== lastIntensity) && now - lastSliderRefresh > 200) {
    lastSliderRefresh = now;
    lastIntensity = director.intensity;
    tuning.refresh();
  }

  physarum.wantTimings = hud.visible;
  inspector.update(now);
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
  const show = !!physarum && physarum.penUsed && physarum.pen.active;
  penRing.hidden = !show;
  if (!show || !physarum) return;
  const r = params.penRadius * canvas.clientHeight;
  penRing.style.width = penRing.style.height = `${2 * r}px`;
  penRing.style.left = `${physarum.pen.x * canvas.clientWidth}px`;
  penRing.style.top = `${physarum.pen.y * canvas.clientHeight}px`;
}

/**
 * Pointer input on the picture (SPEC 8.2): move = the pen, wheel = the intensity macro, left
 * click = the scene's accent, right button held and moving = stir. The pen exists when the
 * current regime gives it a meaning (extended rule, pen-edited followers, boids with a pointer role).
 */
function setUpPointer(): void {
  const norm = (ev: PointerEvent) => ({ x: ev.clientX / canvas.clientWidth, y: ev.clientY / canvas.clientHeight });

  canvas.addEventListener('pointermove', (ev) => {
    if (!physarum || !physarum.penUsed) return;
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
    if (!physarum) return;
    const { x, y } = norm(ev);
    if (physarum.penUsed) physarum.setPen(x, y, true);
    if (ev.button === 0) director?.accent(x, y); // the accent: what it looks like belongs to the scene
  });
  canvas.addEventListener('contextmenu', (ev) => ev.preventDefault());
  canvas.addEventListener(
    'wheel',
    (ev) => {
      ev.preventDefault();
      // Browsers report a notch as 100 pixels, or as 3 lines (Firefox), or as pages.
      const unit = ev.deltaMode === 1 ? 33 : ev.deltaMode === 2 ? 800 : 1;
      director?.onWheel(ev.deltaY * unit);
    },
    { passive: false },
  );
}

function toggleFreeze(): void {
  if (!physarum) return;
  physarum.paused = !physarum.paused;
  updateBadge();
}

/**
 * Safe mode (SPEC 9): drop the agent, follower and boid counts and the resolution at once, for a
 * stutter during a performance. Leaving it restores them; nothing in the scenes changes. It also
 * resumes a frozen picture.
 */
function toggleSafeMode(): void {
  safeMode = !safeMode;
  // The smaller canvas restarts the trail, which a frozen world could not redraw: resume.
  if (physarum) physarum.paused = false;
  resolutionScale = safeMode ? SAFE_RESOLUTION : 1;
  if (physarum) physarum.countScale = safeMode ? SAFE_COUNT_SCALE : 1;
  updateBadge();
}

function updateBadge(): void {
  const parts: string[] = [];
  if (physarum?.paused) parts.push('FROZEN');
  if (safeMode) parts.push('SAFE MODE');
  badgeEl.textContent = parts.join('  ');
  badgeEl.hidden = parts.length === 0;
}

function onKey(ev: KeyboardEvent): void {
  // Enter also activates a focused button, which would toggle twice.
  if (ev.target instanceof HTMLButtonElement || ev.target instanceof HTMLInputElement || ev.target instanceof HTMLSelectElement) return;
  const action = actionForKey(ev);
  if (!action) return;
  if (action.type === 'fullscreen' && document.fullscreenElement === null) ev.preventDefault();
  if (action.type === 'next') ev.preventDefault(); // Space would scroll the page
  switch (action.type) {
    case 'next':
      director?.next();
      break;
    case 'previous':
      director?.previous();
      break;
    case 'jump':
      director?.goto(action.scene);
      break;
    case 'freeze':
      toggleFreeze();
      break;
    case 'reset':
      // Reset (SPEC 8.2): agents scatter and the trail clears, the scene stays.
      physarum?.reset();
      break;
    case 'safe':
      toggleSafeMode();
      break;
    case 'help':
      helpEl.hidden = !helpEl.hidden;
      break;
    case 'cue':
      cue.toggle();
      break;
    case 'fullscreen':
      toggleFullscreen();
      break;
    case 'hud':
      hud.toggle();
      break;
    case 'setup':
      setupEl.classList.toggle('stealth');
      break;
    case 'tuning':
      tuningEl.hidden = !tuningEl.hidden;
      break;
    case 'fieldArrows':
      // Debug overlay: the flow field as arrows (not part of the live vocabulary).
      if (physarum) physarum.fieldArrows = !physarum.fieldArrows;
      break;
    case 'flockOverlay':
      // Debug overlay: the flock's spatial grid and what the boid nearest the pointer perceives.
      void inspector.toggleFlock();
      break;
    case 'probeAgent':
      // Debug overlay: the sensors of the Physarum agent nearest the pointer, and what it decided.
      void inspector.toggleAgent();
      break;
    case 'bufferView':
      // Debug: the display shows a raw buffer (trail, delayed trail, change, agents per pixel).
      inspector.cycleView();
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

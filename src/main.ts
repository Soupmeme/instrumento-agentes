import { initGpu, resizeCanvas, GpuUnavailableError, type Gpu } from './gpu';
import { Hud } from './hud';
import { Song } from './audio';
import { showMessage, hideMessage, toggleFullscreen } from './ui';

// M0 scaffold: device init, resize, clear-to-color render loop, fps HUD, song picker,
// fullscreen, device-lost recovery. No simulation yet.

// A dark blue-grey, close to the page background so the first paint does not flash.
const CLEAR_COLOR: GPUColor = { r: 0.043, g: 0.051, b: 0.078, a: 1 };

const MAX_RECOVERY_ATTEMPTS = 3;

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
};

const canvas = $<HTMLCanvasElement>('stage');
const messageEl = $('message');
const setupEl = $('setup');

let gpu: Gpu | null = null;
let resolutionScale = 1; // becomes a live control with the quality presets (SPEC section 9)
let validationErrors = 0;
let lostCount = 0;
let lastFrame = 0;

const hud = new Hud($('hud'), () => {
  if (!gpu) return 'no GPU device';
  const info = gpu.adapter.info;
  return (
    `canvas ${canvas.width}x${canvas.height} (scale ${resolutionScale})\n` +
    `adapter ${info.vendor || '?'} ${info.architecture || ''} ${info.description || ''}\n` +
    `timestamp-query ${gpu.hasTimestampQuery ? 'yes' : 'no (CPU frame timing only)'}\n` +
    `validation errors ${validationErrors}, device losses ${lostCount}`
  );
});

const song = new Song($<HTMLInputElement>('song-file'), $<HTMLAudioElement>('song'), $('song-name'));
void song; // referenced by the cue panel in M6

function attachDevice(g: Gpu): void {
  gpu = g;
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
  if (!gpu) return;

  // First frame after load or after a hidden tab has no meaningful delta.
  if (lastFrame !== 0) hud.push(now - lastFrame, now);
  lastFrame = now;

  resizeCanvas(canvas, resolutionScale); // resolution-dependent textures will be rebuilt here later

  const encoder = gpu.device.createCommandEncoder();
  const pass = encoder.beginRenderPass({
    colorAttachments: [
      {
        view: gpu.context.getCurrentTexture().createView(),
        clearValue: CLEAR_COLOR,
        loadOp: 'clear',
        storeOp: 'store',
      },
    ],
  });
  pass.end();
  gpu.device.queue.submit([encoder.finish()]);
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
      setupEl.hidden = !setupEl.hidden;
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

void main();

// Presentation resolution (SPEC 9, M8). Two separate sizes:
//
//   canvas      what is drawn to: the window or the screen, times the device pixel ratio, times the
//               resolution scale (safe mode lowers it). It costs only the display pass.
//   simulation  the grid the agents live on (trail, counters, flow field, boid grid). It decides
//               the look, because every distance in the rules is in simulation pixels (sensor
//               distance, boid radii, follower speed), and most of the cost.
//
// Until M7 the grid followed the canvas, so the same scene looked and cost different on a window,
// on a 1920 x 1080 projector and on a 2560 x 1440 monitor (the grid was capped at 1920 on its long
// side, which is 2.2 times the area every scene was tuned at). Now the grid has a fixed AREA,
// about that of the 1043 x 910 window everything was tuned and measured on, and takes the
// canvas's aspect ratio. The canvas is then only an upscale of it, so what is seen in rehearsal is
// what the audience sees, at any resolution, and the cost does not grow with the screen.

/** Simulation pixels, 1280 x 720. The area of the grid everything was tuned on was 0.95 million. */
export const SIM_AREA = 921_600;
/** The longest side the grid may have (a very wide window must not make a very long grid). */
export const MAX_GRID_SIDE = 1920;

const params = typeof location === 'undefined' ? new URLSearchParams() : new URLSearchParams(location.search);

/**
 * Rehearsal tools, in the address: `?res=1920x1080` draws to a canvas of that size whatever the
 * window is (to test a projector's resolution on a laptop), `?sim=1.5` multiplies the simulation
 * area (to see what a sharper, costlier grid looks like). Neither is needed in a performance.
 */
export function forcedCanvasSize(): [number, number] | null {
  const m = /^(\d{3,5})x(\d{3,5})$/.exec(params.get('res') ?? '');
  return m ? [Number(m[1]), Number(m[2])] : null;
}

export function simAreaScale(): number {
  const v = Number(params.get('sim'));
  return Number.isFinite(v) && v >= 0.25 && v <= 4 ? v : 1;
}

/**
 * The simulation grid for a canvas: the canvas's aspect ratio and a fixed area, the longest side
 * at most MAX_GRID_SIDE (then the area shrinks).
 */
export function simGridFor(canvasWidth: number, canvasHeight: number, areaScale = 1): [number, number] {
  const aspect = Math.max(0.1, canvasWidth) / Math.max(0.1, canvasHeight);
  const area = SIM_AREA * areaScale;
  let h = Math.sqrt(area / aspect);
  let w = aspect * h;
  const long = Math.max(w, h);
  if (long > MAX_GRID_SIDE) {
    w *= MAX_GRID_SIDE / long;
    h *= MAX_GRID_SIDE / long;
  }
  return [Math.max(8, Math.round(w)), Math.max(8, Math.round(h))];
}

/**
 * The size whose aspect ratio gives the simulation grid: the forced size, else the canvas's size on
 * the page. It is the display size, not the backing store, so safe mode's lower resolution scale
 * and the device pixel ratio never change the grid (a changed grid clears the trail).
 */
export function displaySize(canvas: HTMLCanvasElement): [number, number] {
  return forcedCanvasSize() ?? [canvas.clientWidth, canvas.clientHeight];
}

// The simulation grid for a screen (src/presentation.ts). CPU only. Each title starts with the
// prediction id of src/verify/predictions.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_GRID_SIDE, SIM_AREA, forcedCanvasSize, simAreaScale, simGridFor } from '../src/presentation.ts';

const SCREENS: [string, number, number][] = [
  ['720p', 1280, 720], ['1080p', 1920, 1080], ['1440p', 2560, 1440], ['4K', 3840, 2160],
  ['16:10', 1920, 1200], ['4:3 projector', 1024, 768], ['square', 900, 900], ['dev pane', 800, 697],
  ['portrait', 720, 1280], ['21:9', 3440, 1440],
];

test('[PR-01] the grid has a fixed area whatever the screen, and the longest side is capped', () => {
  for (const [name, w, h] of SCREENS) {
    const [gw, gh] = simGridFor(w, h);
    assert.ok(Math.abs((gw * gh) / SIM_AREA - 1) < 0.01, `${name}: ${gw} x ${gh} is ${gw * gh} pixels`);
    assert.ok(Math.max(gw, gh) <= MAX_GRID_SIDE, `${name}: ${gw} x ${gh}`);
  }
  // Every 16:9 screen gets exactly 1280 x 720, so one scene is the same scene on all of them.
  for (const [w, h] of [[1280, 720], [1920, 1080], [2560, 1440], [3840, 2160]]) assert.deepEqual(simGridFor(w, h), [1280, 720]);
  // A very wide window cannot make a very long grid: the area shrinks instead.
  const [ww, wh] = simGridFor(8000, 1000);
  assert.equal(Math.max(ww, wh), MAX_GRID_SIDE);
  assert.ok(ww * wh < SIM_AREA);
  // The area multiplier of the rehearsal tool scales it.
  const [bw, bh] = simGridFor(1920, 1080, 2);
  assert.ok(Math.abs((bw * bh) / (2 * SIM_AREA) - 1) < 0.01);
});

test('[PR-02] the grid takes the aspect ratio of the display', () => {
  for (const [name, w, h] of SCREENS) {
    const [gw, gh] = simGridFor(w, h);
    // Each side was rounded to a whole pixel, which moves the ratio by at most this much.
    const aspect = w / h;
    assert.ok(Math.abs(gw / gh - aspect) <= (0.5 + 0.5 * aspect) / gh + 1e-9, `${name}: ${gw}/${gh} against ${w}/${h}`);
  }
});

test('the rehearsal address options are off by default and parsed strictly', () => {
  // In Node there is no address bar: nothing is forced, the area is not scaled.
  assert.equal(forcedCanvasSize(), null);
  assert.equal(simAreaScale(), 1);
});

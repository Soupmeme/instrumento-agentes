// Help overlay (SPEC 8.2, key H). The whole live vocabulary on one screen, written for someone
// who has never seen the instrument: it is enough to walk through the scenes and shape each one.
// The keyboard list comes from keys.ts, so the help can never disagree with the bindings.

import { LIVE_KEYS } from './scenes/keys';

function row(parent: HTMLElement, key: string, what: string): void {
  const k = document.createElement('kbd');
  k.textContent = key;
  const d = document.createElement('span');
  d.textContent = what;
  parent.append(k, d);
}

function section(parent: HTMLElement, title: string): HTMLElement {
  const h = document.createElement('h3');
  h.textContent = title;
  const grid = document.createElement('div');
  grid.className = 'help-grid';
  parent.append(h, grid);
  return grid;
}

export function buildHelp(el: HTMLElement): void {
  const title = document.createElement('h2');
  title.textContent = 'How to play';
  const intro = document.createElement('p');
  intro.textContent =
    'Everything you see is made by autonomous agents, and every change comes from you. Nothing listens to the music. ' +
    'The piece is a list of scenes; you move between them and shape each one with the pen and the wheel.';
  el.append(title, intro);

  const mouse = section(el, 'Right hand: the mouse');
  row(mouse, 'Move', 'the pen: a soft circle where the world runs another state. What it does depends on the scene (see the cue panel, C)');
  row(mouse, 'Wheel', 'intensity: one knob that moves several things together. Up for more, down for less. It also grows and shrinks the pen');
  row(mouse, 'Click', 'accent: a hit at the pointer (a wave, a burst or a ring, depending on the scene)');
  row(mouse, 'Right drag', 'stir: hold the right button and move, and your drag pushes the world inside the pen');

  const keys = section(el, 'Left hand: the keyboard');
  for (const [k, what] of LIVE_KEYS) row(keys, k, what);

  const rehearsal = section(el, 'Rehearsal only (not needed in a performance)');
  row(rehearsal, 'T', 'rehearsal panel: every parameter, scene capture, export and import');
  row(rehearsal, 'D', 'debug readout (frame time, agent counts)');
  row(rehearsal, 'P', 'show or hide the song panel');
  row(rehearsal, 'V / G', 'flow field arrows / flock overlay (the boid nearest the pointer)');
  row(rehearsal, 'A', 'sensors of the Physarum agent nearest the pointer, and what it decided');
  row(rehearsal, 'O', 'buffer views: trail, delayed trail, change, agents per pixel');
  row(rehearsal, 'Enter', 'full screen');

  const start = document.createElement('p');
  start.className = 'help-start';
  start.textContent = 'To start: press Space to go to the next scene, move the mouse over the picture, scroll, click. Press H to close this.';
  el.append(start);
}

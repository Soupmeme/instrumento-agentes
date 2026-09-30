// Tuning panel (toggle with T): one slider per parameter, for rehearsal and for the
// defense ("what happens if I change SA?"). NOT part of the live vocabulary: during a
// performance the performer never touches raw parameters (SPEC 8.1). This is the seed of the
// hidden tuning panel of milestone M6.

import type { ParamSpec, PhysarumParams } from './physarum/params';

const RAD = Math.PI / 180;
const STEPS = 1000; // slider resolution

/** Slider position (0..STEPS) to a value in display units, honouring log scale and step. */
function fromPosition(spec: ParamSpec, pos: number): number {
  const t = pos / STEPS;
  const raw = spec.log ? spec.min * Math.pow(spec.max / spec.min, t) : spec.min + t * (spec.max - spec.min);
  const snapped = Math.round(raw / spec.step) * spec.step;
  return Math.min(spec.max, Math.max(spec.min, snapped));
}

function toPosition(spec: ParamSpec, value: number): number {
  const v = Math.min(spec.max, Math.max(spec.min, value));
  const t = spec.log ? Math.log(v / spec.min) / Math.log(spec.max / spec.min) : (v - spec.min) / (spec.max - spec.min);
  return Math.round(t * STEPS);
}

function decimals(step: number): number {
  const s = String(step);
  return s.includes('.') ? s.split('.')[1].length : 0;
}

export interface Tuning {
  /** Push the current parameter values into the sliders (after Defaults or a scene change). */
  refresh(): void;
}

export function buildTuning(
  container: HTMLElement,
  params: PhysarumParams,
  specs: readonly ParamSpec[],
  defaults: Readonly<PhysarumParams>,
  onReset: () => void,
): Tuning {
  const refreshers: (() => void)[] = [];

  const title = document.createElement('h2');
  title.textContent = 'Physarum tuning';
  container.appendChild(title);

  for (const spec of specs) {
    const row = document.createElement('label');
    row.className = 'tune-row';
    row.title = `${spec.hint} (one seed, developer machine; Kiwi to verify)`;

    const name = document.createElement('span');
    name.className = 'tune-name';
    name.textContent = spec.label;

    const out = document.createElement('output');
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0';
    slider.max = String(STEPS);

    const show = () => {
      const ui = spec.deg ? params[spec.key] / RAD : params[spec.key];
      slider.value = String(toPosition(spec, ui));
      out.textContent = ui.toFixed(decimals(spec.step)) + (spec.deg ? '°' : '');
    };
    slider.addEventListener('input', () => {
      const ui = fromPosition(spec, Number(slider.value));
      params[spec.key] = spec.deg ? ui * RAD : ui;
      out.textContent = ui.toFixed(decimals(spec.step)) + (spec.deg ? '°' : '');
    });
    // A slider that keeps focus would swallow the live keys, so let go after each drag.
    slider.addEventListener('change', () => slider.blur());

    row.append(name, slider, out);
    container.appendChild(row);
    refreshers.push(show);
    show();
  }

  const buttons = document.createElement('div');
  buttons.className = 'tune-buttons';
  const mk = (text: string, fn: () => void) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    b.addEventListener('click', () => {
      fn();
      b.blur();
    });
    buttons.appendChild(b);
  };
  mk('Defaults', () => {
    Object.assign(params, defaults);
    refreshers.forEach((r) => r());
  });
  mk('Reset agents (R)', onReset);
  container.appendChild(buttons);

  return { refresh: () => refreshers.forEach((r) => r()) };
}

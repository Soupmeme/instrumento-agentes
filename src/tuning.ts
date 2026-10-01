// Rehearsal panel (toggle with T): one slider per parameter of the current scene, for rehearsal
// and for the defense ("what happens if I change SA?"), plus the scene tools (capture, export,
// import, rehearse). NOT part of the live vocabulary: during a performance the performer never
// touches raw parameters (SPEC 8.1). An edit here changes the current scene in memory (the
// director remembers it), and the wheel still drives the parameters the scene binds to it.

import {
  MODE_CLASSIC, MODE_EXTENDED, resetToDefaults, setMode, type ParamSpec, type PhysarumParams,
} from './physarum/params';
import { CURATED_SLOTS, SLOT_COUNT, slotLabel } from './physarum/presets';
import type { Physarum } from './physarum/physarum';

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
  /** Push the current parameter values into the controls (after a reset, or a wheel change). */
  refresh(): void;
}

export interface TuningHooks {
  /** One parameter was changed by hand. */
  onEdit?: (key: keyof PhysarumParams, value: number) => void;
  /** Many parameters changed at once (a new agent rule, "Defaults"). */
  onBulk?: () => void;
  /** Add the scene tools at the top of the panel; returns a function that refreshes them. */
  addSceneTools?: (container: HTMLElement) => void;
}

export function buildTuning(
  container: HTMLElement,
  params: PhysarumParams,
  specs: readonly ParamSpec[],
  getPhysarum: () => Physarum | null,
  hooks: TuningHooks = {},
): Tuning {
  const refreshers: (() => void)[] = [];
  const rows: { row: HTMLElement; only?: 'classic' | 'extended' }[] = [];
  const extendedOnly: HTMLElement[] = [];

  const title = document.createElement('h2');
  title.textContent = 'Rehearsal panel';
  container.appendChild(title);
  hooks.addSceneTools?.(container);

  const applyVisibility = () => {
    const extended = params.mode === MODE_EXTENDED;
    for (const { row, only } of rows) row.hidden = only === 'classic' ? extended : only === 'extended' ? !extended : false;
    extendedOnly.forEach((el) => (el.hidden = !extended));
  };

  const button = (parent: HTMLElement, text: string, fn: () => void, title?: string) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    if (title) b.title = title;
    b.addEventListener('click', () => {
      fn();
      b.blur(); // a focused button would swallow the live keys
    });
    parent.appendChild(b);
    return b;
  };

  const select = (label: string, options: { value: number; text: string }[], get: () => number, set: (v: number) => void, hint: string) => {
    const row = document.createElement('label');
    row.className = 'tune-row tune-select';
    row.title = hint;
    const name = document.createElement('span');
    name.className = 'tune-name';
    name.textContent = label;
    const sel = document.createElement('select');
    for (const o of options) {
      const opt = document.createElement('option');
      opt.value = String(o.value);
      opt.textContent = o.text;
      sel.appendChild(opt);
    }
    sel.addEventListener('change', () => {
      set(Number(sel.value));
      sel.blur();
    });
    row.append(name, sel);
    container.appendChild(row);
    refreshers.push(() => (sel.value = String(get())));
    sel.value = String(get());
    return row;
  };

  // ---- mode ----
  select(
    'agent rule',
    [
      { value: MODE_CLASSIC, text: 'classic (4 sliders)' },
      { value: MODE_EXTENDED, text: 'extended (36 points presets)' },
    ],
    () => params.mode,
    (m) => {
      setMode(params, m);
      getPhysarum()?.reset();
      hooks.onBulk?.();
      refresh();
    },
    'Classic: the textbook rule, four numbers you set. Extended: agents adapt their sensing and movement to the trail under them, described by 15-number presets, with a pen region, waves and inertia. Switching resets the agents.',
  );

  // ---- presets (extended) ----
  const slotOptions = Array.from({ length: SLOT_COUNT }, (_, slot) => ({
    value: slot,
    text: `${CURATED_SLOTS.includes(slot) ? '* ' : ''}${slotLabel(slot)}`,
  }));
  extendedOnly.push(
    select('background preset', slotOptions, () => params.backgroundPreset, (v) => { params.backgroundPreset = v; hooks.onEdit?.('backgroundPreset', v); },
      'The rules that apply everywhere except under the pen. Changing it eases over the transition time. A star marks curated presets.'),
    select('pen preset', slotOptions, () => params.penPreset, (v) => { params.penPreset = v; hooks.onEdit?.('penPreset', v); },
      'The rules that apply under the pen (the pointer). The pen and the background blend smoothly.'),
  );

  // ---- sliders and choices, straight from the parameter list ----
  for (const spec of specs) {
    if (spec.group) {
      const heading = document.createElement('h3');
      heading.className = 'tune-group';
      heading.textContent = spec.group;
      container.appendChild(heading);
    }
    if (spec.options) {
      const choiceRow = select(
        spec.label,
        spec.options,
        () => params[spec.key],
        (v) => {
          params[spec.key] = v;
          hooks.onEdit?.(spec.key, v);
        },
        `${spec.hint} (one seed, developer machine; Kiwi to verify)`,
      );
      rows.push({ row: choiceRow, only: spec.only });
      continue;
    }
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
      hooks.onEdit?.(spec.key, params[spec.key]);
      out.textContent = ui.toFixed(decimals(spec.step)) + (spec.deg ? '°' : '');
    });
    // A slider that keeps focus would swallow the live keys, so let go after each drag.
    slider.addEventListener('change', () => slider.blur());

    row.append(name, slider, out);
    container.appendChild(row);
    rows.push({ row, only: spec.only });
    refreshers.push(show);
    show();
  }

  // ---- buttons ----
  const buttons = document.createElement('div');
  buttons.className = 'tune-buttons';
  button(buttons, 'Defaults', () => {
    resetToDefaults(params);
    hooks.onBulk?.();
    refresh();
  });
  button(buttons, 'Reset agents (R)', () => getPhysarum()?.reset());
  container.appendChild(buttons);

  const effects = document.createElement('div');
  effects.className = 'tune-buttons';
  button(effects, 'Wave', () => getPhysarum()?.triggerWave(), 'An expanding front from the pen (also: left click on the picture).');
  button(effects, 'Ring burst', () => getPhysarum()?.spawn('ring'), 'A tenth of the agents jump to a ring around the pen for one step.');
  button(effects, 'Center burst', () => getPhysarum()?.spawn('center'), 'A tenth of the agents jump onto the pen for one step.');
  container.appendChild(effects);
  extendedOnly.push(effects);

  const hintLine = document.createElement('p');
  hintLine.className = 'tune-hint';
  hintLine.textContent = 'Picture: move = pen (it acts when the extended rule, pen-edited followers or boids use it), wheel = pen size, right drag = stir; left click = wave (extended rule). With boids on, the pointer is their predator or attractor.';
  container.appendChild(hintLine);

  function refresh(): void {
    refreshers.forEach((r) => r());
    applyVisibility();
  }
  applyVisibility();

  return { refresh };
}

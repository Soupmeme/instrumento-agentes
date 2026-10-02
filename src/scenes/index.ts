// The scenes the instrument starts with: src/scenes/scenes.json, checked by the validator. A
// problem in the file is logged, never fatal: a scene that cannot be rescued is dropped, and if
// nothing is left a single default scene keeps the instrument alive.

import placeholders from './scenes.json';
import godComplex from './scenes.god-complex.json';
import { validateScenes } from './validate.ts';
import type { SceneData } from './types.ts';

const fallback: SceneData = {
  id: 'default',
  name: 'Default scene',
  note: 'Used because scenes.json had no valid scene.',
  dominant: 'physarum',
  params: { mode: 1 },
  pen: { radius: 0.25, description: 'The pen runs the pen preset inside the circle.' },
  macro: { entry: 0.5, description: 'Nothing is bound to the wheel in this scene.', entries: [], returnSeconds: 0 },
  accent: { type: 'wave', strength: 0.6, size: 1 },
  entry: { seconds: 1.5, easing: 'smooth', burst: 'none', switchAt: 0.5 },
};

/**
 * Which set starts the instrument. scenes.json (the placeholders the tests and the checks use) is
 * the default; `?set=god-complex` starts the draft scenes of SONG_BRIEF.md, until Kiwi approves them
 * and they replace the placeholders.
 */
const chosen = (): unknown =>
  typeof location !== 'undefined' && new URLSearchParams(location.search).get('set') === 'god-complex' ? godComplex : placeholders;

export function loadShippedScenes(data: unknown = chosen()): { scenes: SceneData[]; problems: string[] } {
  const r = validateScenes(data);
  if (r.problems.length) console.warn('scenes.json:', r.problems.join('\n'));
  return { scenes: r.scenes.length ? r.scenes : [fallback], problems: r.problems };
}

type Listener = (scenes: SceneData[], problems: string[]) => void;
const EVENT = 'scenes-file-changed';

/**
 * Hot reload (SPEC 8.7, development server only): when scenes.json is edited and saved, the
 * callback receives the newly validated scenes, so a change can be seen without restarting. In a
 * production build nothing ever fires. It goes through a window event because the development
 * server can hold two instances of this module (an old and an updated one), and only an event
 * reaches the listener whichever instance the update arrives in.
 */
export function onScenesFileChanged(callback: Listener): void {
  window.addEventListener(EVENT, (ev) => {
    const { scenes, problems } = (ev as CustomEvent<{ scenes: SceneData[]; problems: string[] }>).detail;
    callback(scenes, problems);
  });
}

// Vite only recognises a dependency accept at module level, inside this exact form.
if (import.meta.hot) {
  import.meta.hot.accept('./scenes.json', (mod) => {
    if (!mod) return;
    const r = loadShippedScenes((mod as unknown as { default: unknown }).default);
    window.dispatchEvent(new CustomEvent(EVENT, { detail: { scenes: r.scenes, problems: r.problems } }));
  });
  import.meta.hot.accept('./scenes.god-complex.json', (mod) => {
    if (!mod) return;
    const r = loadShippedScenes((mod as unknown as { default: unknown }).default);
    window.dispatchEvent(new CustomEvent(EVENT, { detail: { scenes: r.scenes, problems: r.problems } }));
  });
}

// The scenes the instrument starts with: src/scenes/scenes.json, checked by the validator. A
// problem in the file is logged, never fatal: a scene that cannot be rescued is dropped, and if
// nothing is left a single default scene keeps the instrument alive.

import shipped from './scenes.json';
import placeholders from './scenes.placeholder.json';
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
  accent: { type: 'wave', strength: 0.6, size: 1, glow: 0 },
  entry: { seconds: 1.5, easing: 'smooth', burst: 'none', switchAt: 0.5 },
};

/**
 * Which set starts the instrument. scenes.json is the performer's set (the God Complex scenes of
 * SONG_BRIEF.md). scenes.placeholder.json is the three PLACEHOLDER scenes the engine's tests and
 * checks use; `?set=placeholder` in the address starts the instrument with them (a rehearsal and
 * development aid, never needed in a performance).
 */
const chosen = (): unknown =>
  typeof location !== 'undefined' && new URLSearchParams(location.search).get('set') === 'placeholder' ? placeholders : shipped;

/** The three placeholder scenes, validated, for the dev checks (they must not depend on the performer's scenes). */
export function placeholderScenes(): SceneData[] {
  return validateScenes(placeholders).scenes;
}

/** The performer's shipped scenes, validated (scenes.json), whichever set the page started with. */
export function shippedScenes(): SceneData[] {
  return validateScenes(shipped).scenes;
}

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
    if (!mod || new URLSearchParams(location.search).get('set') === 'placeholder') return; // a placeholder session ignores edits to the performer's file
    const r = loadShippedScenes((mod as unknown as { default: unknown }).default);
    window.dispatchEvent(new CustomEvent(EVENT, { detail: { scenes: r.scenes, problems: r.problems } }));
  });
}

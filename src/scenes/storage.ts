// Saving, exporting and importing scenes (SPEC 8.7). Every storage access is wrapped: the
// browser's storage can be empty, full or blocked (a private window, cleared site data, a
// thumbnail capture), and the instrument must run the same without it.
//
// The autosave is a convenience for rehearsal, never loaded by itself: the shipped scenes.json
// (or an import) is what starts the instrument, so an old autosave can never silently override
// an edited scene file. The tuning panel offers "restore autosave" and says when it was saved.

import type { SceneData } from './types.ts';
import { validateScenes } from './validate.ts';

const KEY = 'instrumento-agentes.scenes.v1';

export interface Autosave {
  scenes: SceneData[];
  savedAt: number;
  problems: string[];
}

export function saveAutosave(scenes: readonly SceneData[], now = Date.now()): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify({ savedAt: now, scenes }));
    return true;
  } catch {
    return false;
  }
}

export function loadAutosave(): Autosave | null {
  try {
    const text = localStorage.getItem(KEY);
    if (!text) return null;
    const raw = JSON.parse(text) as { savedAt?: unknown; scenes?: unknown };
    const { scenes, problems } = validateScenes(raw.scenes);
    if (!scenes.length) return null;
    return { scenes, savedAt: typeof raw.savedAt === 'number' ? raw.savedAt : 0, problems };
  } catch {
    return null;
  }
}

/** The text of an exported file: a list of scenes, readable and editable by hand. */
export function sceneFileText(scenes: readonly SceneData[]): string {
  return JSON.stringify(scenes, null, 2) + '\n';
}

/** Parse an imported file. Returns the valid scenes and everything that was wrong with the rest. */
export function parseSceneFile(text: string): { scenes: SceneData[]; problems: string[] } {
  try {
    return validateScenes(JSON.parse(text));
  } catch (err) {
    return { scenes: [], problems: [`the file is not valid JSON (${(err as Error).message})`] };
  }
}

/** Offer a text file for download (browser only). */
export function downloadText(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Let the user pick a JSON file and return its text, or null if they cancel (browser only). */
export function pickTextFile(): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      file.text().then(resolve, () => resolve(null));
    });
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

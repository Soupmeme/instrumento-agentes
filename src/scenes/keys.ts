// The keyboard, in one place (SPEC 8.2). Pure: a key name in, an action out, so the rules are
// unit tested: every binding is a single key, none uses a modifier, and no two share a key.
//
// Live vocabulary (the performer's left hand): Space next, B previous, 1 to 9 jump, F freeze,
// R reset, S safe mode (Escape too, when the browser passes it on: in full screen the browser
// keeps Escape for leaving full screen), H help, C cue panel. Rehearsal and debug keys are
// separate and never needed in a performance: Enter full screen, T tuning panel, P setup
// panel, D debug readout, V flow field arrows, G flock overlay, A agent sensors, O buffer views.

export type Action =
  | { type: 'next' }
  | { type: 'previous' }
  | { type: 'jump'; scene: number } // 0 based
  | { type: 'freeze' }
  | { type: 'reset' }
  | { type: 'safe' }
  | { type: 'help' }
  | { type: 'cue' }
  | { type: 'fullscreen' }
  | { type: 'tuning' }
  | { type: 'setup' }
  | { type: 'hud' }
  | { type: 'fieldArrows' }
  | { type: 'flockOverlay' }
  | { type: 'probeAgent' }
  | { type: 'bufferView' };

/** Every key binding: key (lower case) to action. The help overlay is generated from LIVE_KEYS. */
export const BINDINGS: Readonly<Record<string, Action>> = {
  ' ': { type: 'next' },
  b: { type: 'previous' },
  f: { type: 'freeze' },
  r: { type: 'reset' },
  s: { type: 'safe' },
  Escape: { type: 'safe' },
  h: { type: 'help' },
  c: { type: 'cue' },
  Enter: { type: 'fullscreen' },
  t: { type: 'tuning' },
  p: { type: 'setup' },
  d: { type: 'hud' },
  v: { type: 'fieldArrows' },
  g: { type: 'flockOverlay' },
  a: { type: 'probeAgent' },
  o: { type: 'bufferView' },
  ...Object.fromEntries(Array.from({ length: 9 }, (_, i) => [String(i + 1), { type: 'jump', scene: i } as Action])),
};

/** The keys a performance uses, as shown in the help overlay: [key label, what it does]. */
export const LIVE_KEYS: readonly (readonly [string, string])[] = [
  ['Space', 'next scene'],
  ['B', 'previous scene'],
  ['1 to 9', 'jump to that scene'],
  ['F', 'freeze (hold the picture), again to resume'],
  ['R', 'reset: agents scatter, trail clears, same scene'],
  ['S', 'safe mode: fewer agents, lower resolution (again to leave)'],
  ['H', 'this help'],
  ['C', 'cue panel'],
];

export interface KeyLike {
  key: string;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  repeat?: boolean;
}

/** The action for a key press, or null. A press with Ctrl, Alt or Meta held, or a key repeat, is ignored (Shift is how capitals are typed, so it is not). */
export function actionForKey(ev: KeyLike): Action | null {
  if (ev.repeat || ev.ctrlKey || ev.altKey || ev.metaKey) return null;
  const k = ev.key.length === 1 ? ev.key.toLowerCase() : ev.key;
  return BINDINGS[k] ?? null;
}

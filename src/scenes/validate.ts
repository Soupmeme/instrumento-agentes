// Turning untrusted JSON (the shipped scenes.json, an imported file, the autosave) into scenes the
// director can rely on. Nothing here throws on bad input: a bad value is clamped or replaced by
// its default and reported in `problems`, a scene that cannot be rescued is dropped and
// reported, so a typo in a scene file never takes the instrument down.

import { DEFAULT_PARAMS, PARAM_SPECS, type PhysarumParams } from '../physarum/params.ts';
import type { AccentType, CurveName, Dominant, EasingName, EntryBurst, MacroEntry, SceneData } from './types.ts';

const RAD = Math.PI / 180;

/** Allowed range of every parameter a scene may set: the tuning panel's range, plus the few without a slider. */
export function paramRange(key: string): [number, number] | null {
  const spec = PARAM_SPECS.find((s) => s.key === key);
  if (spec) return spec.deg ? [spec.min * RAD, spec.max * RAD] : [spec.min, spec.max];
  switch (key) {
    case 'mode':
    case 'physarumOn':
      return [0, 1];
    case 'backgroundPreset':
    case 'penPreset':
      return [0, 21];
    default:
      return null;
  }
}

/** Parameters that switch at one moment of a transition instead of blending. */
export const DISCRETE_PARAMS: ReadonlySet<string> = new Set([
  'mode', 'physarumOn', 'fieldKind', 'penFieldMode', 'flockPenMode', 'backgroundPreset', 'penPreset', 'palette',
]);

/** Parameters the wheel may drive: the continuous ones a scene can set, except the pen radius (the wheel scales it by itself). */
export function isMacroParam(key: string): boolean {
  return key in DEFAULT_PARAMS && key !== 'penRadius' && !DISCRETE_PARAMS.has(key) && paramRange(key) !== null;
}

const CURVES: readonly CurveName[] = ['linear', 'smooth', 'in', 'out'];
const EASINGS: readonly EasingName[] = ['linear', 'smooth', 'in', 'out'];
const ACCENTS: readonly AccentType[] = ['wave', 'burst', 'ring'];
const BURSTS: readonly EntryBurst[] = ['none', 'ring', 'center'];
const DOMINANTS: readonly Dominant[] = ['physarum', 'followers', 'flock'];

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export interface Validated<T> {
  value: T | null;
  problems: string[];
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T, where: string, problems: string[]): T {
  if (v === undefined) return fallback;
  if (typeof v === 'string' && (allowed as readonly string[]).includes(v)) return v as T;
  problems.push(`${where}: "${String(v)}" is not one of ${allowed.join(', ')}; using ${fallback}`);
  return fallback;
}

function number01(v: unknown, fallback: number, lo: number, hi: number, where: string, problems: string[]): number {
  if (v === undefined) return fallback;
  if (!num(v)) {
    problems.push(`${where}: not a number; using ${fallback}`);
    return fallback;
  }
  if (v < lo || v > hi) problems.push(`${where}: ${v} outside ${lo}..${hi}; clamped`);
  return clamp(v, lo, hi);
}

/** Check one scene. `index` is only used in messages. */
export function validateScene(raw: unknown, index: number): Validated<SceneData> {
  const problems: string[] = [];
  const at = (s: string) => `scene ${index + 1}${isObject(raw) && typeof raw.id === 'string' ? ` (${raw.id})` : ''}: ${s}`;
  if (!isObject(raw)) return { value: null, problems: [at('not an object; dropped')] };
  if (typeof raw.id !== 'string' || !raw.id || typeof raw.name !== 'string' || !raw.name) {
    return { value: null, problems: [at('needs a text id and a text name; dropped')] };
  }
  const warn = (s: string) => problems.push(at(s));
  const local: string[] = [];

  // --- params
  const params: Partial<PhysarumParams> = {};
  if (raw.params !== undefined && !isObject(raw.params)) warn('params is not an object; ignored');
  for (const [key, value] of Object.entries(isObject(raw.params) ? raw.params : {})) {
    const range = paramRange(key);
    if (!(key in DEFAULT_PARAMS) || !range) {
      warn(`params.${key} is not a parameter a scene can set; ignored`);
      continue;
    }
    if (!num(value)) {
      warn(`params.${key} is not a number; ignored`);
      continue;
    }
    if (value < range[0] || value > range[1]) warn(`params.${key} = ${value} outside ${range[0].toFixed(3)}..${range[1].toFixed(3)}; clamped`);
    (params as Record<string, number>)[key] = clamp(value, range[0], range[1]);
  }

  // --- pen
  const penRaw = isObject(raw.pen) ? raw.pen : {};
  const pen = {
    radius: number01(penRaw.radius, DEFAULT_PARAMS.penRadius, 0.05, 0.9, 'pen.radius', local),
    description: typeof penRaw.description === 'string' ? penRaw.description : '',
  };

  // --- macro
  const macroRaw = isObject(raw.macro) ? raw.macro : {};
  const entries: MacroEntry[] = [];
  const list = Array.isArray(macroRaw.entries) ? macroRaw.entries : [];
  list.forEach((e, k) => {
    if (!isObject(e) || typeof e.param !== 'string' || !isMacroParam(e.param)) {
      local.push(`macro.entries[${k}]: "${isObject(e) ? String(e.param) : e}" is not a parameter the wheel can drive; dropped`);
      return;
    }
    const range = paramRange(e.param)!;
    if (!num(e.min) || !num(e.max)) {
      local.push(`macro.entries[${k}] (${e.param}): min and max must be numbers; dropped`);
      return;
    }
    entries.push({
      param: e.param as keyof PhysarumParams,
      min: clamp(e.min, range[0], range[1]),
      max: clamp(e.max, range[0], range[1]),
      curve: oneOf(e.curve, CURVES, 'smooth', `macro.entries[${k}].curve`, local),
    });
  });
  const macro = {
    entry: number01(macroRaw.entry, 0.5, 0, 1, 'macro.entry', local),
    description: typeof macroRaw.description === 'string' ? macroRaw.description : '',
    entries,
    returnSeconds: number01(macroRaw.returnSeconds, 0, 0, 120, 'macro.returnSeconds', local),
  };

  // --- accent and entry
  const accentRaw = isObject(raw.accent) ? raw.accent : {};
  const accent = {
    type: oneOf(accentRaw.type, ACCENTS, 'wave', 'accent.type', local),
    strength: number01(accentRaw.strength, 0.6, 0, 1, 'accent.strength', local),
    size: number01(accentRaw.size, 1, 0.3, 3, 'accent.size', local),
  };
  const entryRaw = isObject(raw.entry) ? raw.entry : {};
  const entry = {
    seconds: number01(entryRaw.seconds, 1.5, 0, 20, 'entry.seconds', local),
    easing: oneOf(entryRaw.easing, EASINGS, 'smooth', 'entry.easing', local),
    burst: oneOf(entryRaw.burst, BURSTS, 'none', 'entry.burst', local),
    switchAt: number01(entryRaw.switchAt, 0.5, 0, 1, 'entry.switchAt', local),
  };
  const dominant = oneOf(raw.dominant, DOMINANTS, 'physarum', 'dominant', local);
  local.forEach(warn);

  const scene: SceneData = {
    id: raw.id,
    name: raw.name,
    note: typeof raw.note === 'string' ? raw.note : '',
    placeholder: raw.placeholder === true ? true : undefined,
    dominant,
    params,
    pen,
    macro,
    accent,
    entry,
  };
  return { value: scene, problems };
}

/** Check a whole scene list (the JSON of scenes.json or an exported file: an array, or {scenes: [...]}). */
export function validateScenes(raw: unknown): { scenes: SceneData[]; problems: string[] } {
  const list = Array.isArray(raw) ? raw : isObject(raw) && Array.isArray(raw.scenes) ? raw.scenes : null;
  if (!list) return { scenes: [], problems: ['the file is not a list of scenes (expected an array or {"scenes": [...]})'] };
  const scenes: SceneData[] = [];
  const problems: string[] = [];
  const seen = new Set<string>();
  list.forEach((item, i) => {
    const r = validateScene(item, i);
    problems.push(...r.problems);
    if (!r.value) return;
    if (seen.has(r.value.id)) {
      problems.push(`scene ${i + 1}: duplicate id "${r.value.id}"; dropped`);
      return;
    }
    seen.add(r.value.id);
    scenes.push(r.value);
  });
  return { scenes, problems };
}

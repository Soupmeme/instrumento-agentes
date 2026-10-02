// The scene director: the one piece of logic between the performer's inputs and the parameters
// of the world. Pure TypeScript, no GPU and no DOM, so every rule here is unit tested in Node.
//
// What it does, and all it does (SPEC 8.1 to 8.5):
//   * a scene key starts an eased transition from the current parameters to the scene's regime
//   * the wheel moves one intensity value, which the current scene turns into several parameters
//     through its curves (a macro)
//   * a click fires the scene's accent
// Nothing here runs on its own: every change starts with a performer input and ends by itself
// within the transition time. There is no timer that starts a transition, no song clock, no LFO
// (CLAUDE.md rule 2 and 6). The only thing that moves without input is the optional slow return
// of the wheel that a scene can ask for (`macro.returnSeconds`, off by default), which is part
// of the SPEC's definition of a macro.

import { DEFAULT_PARAMS, modeDefaults, type PhysarumParams } from '../physarum/params.ts';
import { clamp01, curve, lerp } from './curves.ts';
import { DISCRETE_PARAMS, paramRange, validateScene } from './validate.ts';
import type { ParamVector, SceneData } from './types.ts';

/** Simulation steps per second (the same value as SIM_HZ in physarum.ts, repeated so this file needs no GPU imports). */
export const STEPS_PER_SECOND = 60;

/** The wheel scales the pen radius by this factor, from `PEN_SCALE_MIN` at 0 to `PEN_SCALE_MAX` at 1 (SPEC 8.2). */
export const PEN_SCALE_MIN = 0.75;
export const PEN_SCALE_MAX = 1.35;
export const penScale = (intensity: number): number => lerp(PEN_SCALE_MIN, PEN_SCALE_MAX, clamp01(intensity));

/** How much one wheel notch (deltaY of 100) moves the intensity. Twelve notches cover the range. */
export const WHEEL_PER_PIXEL = 0.0008;
/** Fraction of the gap to the wheel target that the intensity closes each step (about 0.15 s to settle). */
const INTENSITY_SMOOTHING = 0.12;

/** What the director needs from the world. Physarum (physarum.ts) provides it; tests provide a fake. */
export interface SceneHost {
  params: PhysarumParams;
  pen: { x: number; y: number; active: boolean };
  reset(): void;
  spawn(mode: 'ring' | 'center', fraction?: number): void;
  triggerWave(x?: number, y?: number, sizeMultiplier?: number): void;
  /** The accent's momentary surge of the pointer's forces, 0..1 (decays by itself in the world). */
  surge(amount: number): void;
  /** The accent's glow (display only). Optional so a host without it still works. */
  glow?(amount: number): void;
}

export interface Change {
  key: string;
  from: number;
  to: number;
}

interface Transition {
  from: ParamVector;
  step: number;
  total: number;
  changing: Change[];
}

const NON_SCENE_KEYS: ReadonlySet<string> = new Set(['paletteB', 'paletteMix']);

/** The complete parameter vector of a scene with the wheel at `intensity`: defaults, then the scene, then the wheel. */
export function resolveScene(scene: SceneData, intensity: number): ParamVector {
  const mode = scene.params.mode ?? DEFAULT_PARAMS.mode;
  const v: ParamVector = { ...(DEFAULT_PARAMS as unknown as ParamVector), ...(modeDefaults(mode) as ParamVector), ...(scene.params as ParamVector) };
  v.penRadius = scene.pen.radius * penScale(intensity);
  for (const e of scene.macro.entries) v[e.param] = lerp(e.min, e.max, curve(e.curve, intensity));
  v.paletteB = v.palette;
  v.paletteMix = 0;
  return v;
}

const snapshot = (p: PhysarumParams): ParamVector => {
  const v: ParamVector = {};
  for (const [k, x] of Object.entries(p)) if (typeof x === 'number') v[k] = x;
  return v;
};

export class Director {
  private host: SceneHost;
  private list: SceneData[];
  private current = 0;
  private wheelTarget = 0.5;
  private wheel = 0.5;
  private idleSteps = 0;
  private transition: Transition | null = null;
  private listeners: (() => void)[] = [];
  /** Changes made by the most recent scene switch, for the rehearsal readout. */
  lastChanges: Change[] = [];

  constructor(host: SceneHost, scenes: SceneData[]) {
    this.host = host;
    this.list = scenes;
  }

  /** Point the director at a new world (after the GPU device was recovered). Nothing else changes. */
  setHost(host: SceneHost): void {
    this.host = host;
  }

  // ---- reading the state

  get scenes(): readonly SceneData[] {
    return this.list;
  }
  get index(): number {
    return this.current;
  }
  get scene(): SceneData | undefined {
    return this.list[this.current];
  }
  get nextScene(): SceneData | undefined {
    return this.list[this.current + 1];
  }
  get intensity(): number {
    return this.wheel;
  }
  /** 0..1 while a transition runs, null otherwise. */
  get progress(): number | null {
    return this.transition ? this.transition.step / this.transition.total : null;
  }
  onChange(fn: () => void): void {
    this.listeners.push(fn);
  }
  private changed(): void {
    this.listeners.forEach((fn) => fn());
  }

  // ---- scene keys

  /** Switch to scene `i` (0 based, clamped). The same scene again re-enters it, which returns to its default state. */
  goto(i: number): void {
    if (!this.list.length) return;
    const index = Math.min(this.list.length - 1, Math.max(0, Math.floor(i)));
    const scene = this.list[index];
    // A scene key pressed in the middle of a palette crossfade cannot blend three palettes, so the
    // palette is committed to whichever of the two is nearer (a small visible step, only when
    // the performer interrupts a transition) and the new crossfade starts from it.
    if (this.host.params.paletteMix >= 0.5) this.host.params.palette = this.host.params.paletteB;
    this.host.params.paletteMix = 0;
    const from = snapshot(this.host.params);
    this.current = index;
    this.wheelTarget = scene.macro.entry;
    this.idleSteps = 0;

    const modeChanges = (scene.params.mode ?? DEFAULT_PARAMS.mode) !== from.mode;
    const seconds = scene.entry.seconds;
    if (modeChanges || seconds <= 0) {
      // A hard cut: a different agent rule cannot be blended (the agents are different things),
      // and a zero-second scene asks for it. Everything lands at once and the agents restart.
      this.wheel = this.wheelTarget;
      const to = resolveScene(scene, this.wheel);
      this.lastChanges = this.diff(from, to);
      this.write(to);
      this.transition = null;
      if (modeChanges) this.host.reset();
    } else {
      const to = resolveScene(scene, this.wheel);
      this.lastChanges = this.diff(from, to);
      this.transition = { from, step: 0, total: Math.max(1, Math.round(seconds * STEPS_PER_SECOND)), changing: this.lastChanges };
      // The Physarum presets ease themselves over presetSeconds, so they are pointed at the target
      // now and given the scene's transition time. The palette crossfades (see update()).
      this.host.params.presetSeconds = seconds;
      this.host.params.backgroundPreset = to.backgroundPreset;
      this.host.params.penPreset = to.penPreset;
      this.host.params.paletteB = to.palette;
      this.host.params.paletteMix = 0;
    }
    if (scene.entry.burst !== 'none') this.host.spawn(scene.entry.burst);
    this.changed();
  }

  /** The next scene, or nothing at the last one (it does not wrap: a stray press at the end must not restart the piece). */
  next(): boolean {
    if (this.current >= this.list.length - 1) return false;
    this.goto(this.current + 1);
    return true;
  }
  previous(): boolean {
    if (this.current <= 0) return false;
    this.goto(this.current - 1);
    return true;
  }

  // ---- the wheel and the accent

  /** One wheel event. deltaY > 0 (scroll down) lowers the intensity, like turning a knob down. */
  onWheel(deltaY: number): void {
    this.wheelTarget = clamp01(this.wheelTarget - deltaY * WHEEL_PER_PIXEL);
    this.idleSteps = 0;
  }

  /** Set the wheel directly, with no smoothing (tests and experiments, never a live input). */
  setIntensity(value: number): void {
    this.wheelTarget = this.wheel = clamp01(value);
    this.idleSteps = 0;
    const scene = this.scene;
    if (!scene) return;
    const to = resolveScene(scene, this.wheel);
    const out: ParamVector = { penRadius: to.penRadius };
    for (const e of scene.macro.entries) out[e.param] = to[e.param];
    this.write(out);
  }

  /** A click: the scene's accent. `x`, `y` are the pointer position, 0..1. */
  accent(x: number, y: number): void {
    const scene = this.scene;
    if (!scene) return;
    const a = scene.accent;
    this.host.surge(a.strength);
    if (a.glow > 0) this.host.glow?.(a.glow);
    const fraction = 0.04 + 0.16 * a.strength;
    if (a.type === 'wave') this.host.triggerWave(x, y, a.size);
    else this.host.spawn(a.type === 'burst' ? 'center' : 'ring', fraction);
  }

  // ---- stepping

  /** Call once per simulation step. Advances a transition and the wheel, and writes the parameters that changed. */
  update(): void {
    const scene = this.scene;
    if (!scene) return;

    // The wheel: the value the performer set, smoothed so the picture glides instead of jumping.
    let moved = false;
    if (scene.macro.returnSeconds > 0 && this.idleSteps > STEPS_PER_SECOND / 2) {
      this.wheelTarget += (scene.macro.entry - this.wheelTarget) / (scene.macro.returnSeconds * STEPS_PER_SECOND);
    }
    this.idleSteps++;
    if (this.wheel !== this.wheelTarget) {
      const d = this.wheelTarget - this.wheel;
      this.wheel = Math.abs(d) < 1e-4 ? this.wheelTarget : this.wheel + d * INTENSITY_SMOOTHING;
      moved = true;
    }

    const t = this.transition;
    if (t) {
      t.step++;
      const p = Math.min(1, t.step / t.total);
      const e = curve(scene.entry.easing, p);
      const to = resolveScene(scene, this.wheel);
      const out: ParamVector = {};
      for (const key of Object.keys(to)) {
        const a = t.from[key];
        const b = to[key];
        if (a === undefined || NON_SCENE_KEYS.has(key)) continue;
        // The presets and their time are set at the start (the world eases them), and the palette
        // is crossfaded by paletteMix: none of them may also switch here.
        if (key === 'backgroundPreset' || key === 'penPreset' || key === 'presetSeconds' || key === 'palette') continue;
        if (DISCRETE_PARAMS.has(key)) out[key] = e >= scene.entry.switchAt ? b : a;
        else out[key] = lerp(a, b, e);
      }
      this.write(out);
      this.host.params.paletteMix = e;
      if (p >= 1) {
        this.write(to); // land exactly, including the palette and the preset time
        this.transition = null;
      }
    } else if (moved) {
      // Only what the wheel drives: the macro parameters and the pen radius. Anything else stays
      // where the performer or the tuning panel left it.
      const to = resolveScene(scene, this.wheel);
      const keys = ['penRadius', ...scene.macro.entries.map((e) => e.param as string)];
      const out: ParamVector = {};
      for (const k of keys) out[k] = to[k];
      this.write(out);
    }
  }

  private write(v: ParamVector): void {
    const params = this.host.params as unknown as Record<string, number>;
    for (const [k, x] of Object.entries(v)) params[k] = x;
  }

  private diff(from: ParamVector, to: ParamVector): Change[] {
    const out: Change[] = [];
    for (const key of Object.keys(to)) {
      if (NON_SCENE_KEYS.has(key) || from[key] === undefined) continue;
      if (Math.abs(from[key] - to[key]) > 1e-9 * Math.max(1, Math.abs(to[key]))) out.push({ key, from: from[key], to: to[key] });
    }
    const rel = (c: Change) => Math.abs(c.to - c.from) / Math.max(1e-9, Math.abs(c.from), Math.abs(c.to));
    return out.sort((a, b) => rel(b) - rel(a));
  }

  // ---- rehearsal tools (never used live)

  /** The panel changed a parameter: remember it in the current scene, so the next capture and the wheel agree with it. */
  edit(key: string, value: number): void {
    (this.host.params as unknown as Record<string, number>)[key] = value;
    const scene = this.scene;
    if (!scene || NON_SCENE_KEYS.has(key)) return;
    if (key === 'penRadius') scene.pen.radius = Math.min(0.9, Math.max(0.05, value / penScale(this.wheel)));
    else if (paramRange(key)) (scene.params as Record<string, number>)[key] = value;
  }

  /**
   * Snapshot the live state as a scene: a complete parameter set, with the pen, wheel, accent and
   * entry settings of the current scene carried over. Overwrites the current scene, or appends
   * a new one. Set the wheel to the scene's entry value first: the snapshot takes the state as it is.
   */
  capture(asNew: boolean): SceneData | null {
    const base = this.scene;
    if (!base) return null;
    const params: Record<string, number> = {};
    for (const [k, x] of Object.entries(snapshot(this.host.params))) {
      if (NON_SCENE_KEYS.has(k) || k === 'penRadius' || !paramRange(k)) continue;
      params[k] = x;
    }
    const n = this.list.length + 1;
    const raw = {
      ...JSON.parse(JSON.stringify(base)),
      params,
      pen: { ...base.pen, radius: this.host.params.penRadius / penScale(this.wheel) },
      ...(asNew ? { id: `captured-${n}`, name: `Captured scene ${n}`, note: 'Captured from the live state.', placeholder: undefined } : {}),
    };
    const checked = validateScene(raw, asNew ? n - 1 : this.current);
    if (!checked.value) return null;
    if (asNew) {
      this.list.push(checked.value);
      this.current = this.list.length - 1;
    } else this.list[this.current] = checked.value;
    this.changed();
    return checked.value;
  }

  /** Replace the scene list (import, hot reload) and re-enter the current scene without a transition or a reset. */
  setScenes(scenes: SceneData[], index = this.current): void {
    this.list = scenes;
    this.current = Math.min(Math.max(0, index), Math.max(0, scenes.length - 1));
    const scene = this.scene;
    this.transition = null;
    if (scene) {
      this.wheelTarget = this.wheel = scene.macro.entry;
      this.write(resolveScene(scene, this.wheel));
    }
    this.changed();
  }
}

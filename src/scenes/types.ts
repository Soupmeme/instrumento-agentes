// Scene data (SPEC 8.3). A scene is data, not code: adding or editing one never touches the
// simulation. It is a complete regime of the world: any parameter it does not name takes the
// value from DEFAULT_PARAMS plus the defaults of its agent rule (modeDefaults), so entering a
// scene always lands on a fully defined state.
//
// Parameter names and units are those of PhysarumParams (src/physarum/params.ts), so angles are
// radians. The schema differs from the SPEC's suggestion in one way on purpose: instead of
// nested groups (physarum, flow, flock, coupling, look) that would need a translation layer
// for every parameter, `params` uses the names the code and the tuning panel already use.

import type { PhysarumParams } from '../physarum/params';

export type CurveName = 'linear' | 'smooth' | 'in' | 'out';
export type EasingName = 'linear' | 'smooth' | 'in' | 'out';
export type AccentType = 'wave' | 'burst' | 'ring';
export type EntryBurst = 'none' | 'ring' | 'center';
export type Dominant = 'physarum' | 'followers' | 'flock';

/** One thing the wheel moves in a scene: param goes from min (wheel 0) to max (wheel 1) along a curve. */
export interface MacroEntry {
  param: keyof PhysarumParams;
  min: number;
  max: number;
  curve: CurveName;
}

export interface SceneData {
  id: string;
  /** A phrase the performer would say out loud. */
  name: string;
  /** The performer's own words about the feeling. Kept in the file, shown in the cue panel. */
  note: string;
  /** True for the shipped test scenes. Shown in the cue panel; to be replaced by the performer's scenes. */
  placeholder?: boolean;
  /** Which family carries the scene (SPEC 8.9.6: at most one dominant driver). Documentation and cue panel. */
  dominant: Dominant;
  /** The regime: any PhysarumParams value. Missing ones take the defaults. */
  params: Partial<PhysarumParams>;
  pen: {
    /** Pen radius at the middle of the wheel, as a fraction of the screen height. The wheel scales it. */
    radius: number;
    /** What the region around the pointer means in this scene (SPEC 8.4). */
    description: string;
  };
  macro: {
    /** Wheel value when the scene is entered, 0..1 (usually the middle). */
    entry: number;
    /** One sentence for the performer: what turning it up and down does in this scene. */
    description: string;
    entries: MacroEntry[];
    /** If above 0, the wheel drifts back to `entry` over about this many seconds after it stops. 0: stays. */
    returnSeconds: number;
  };
  accent: {
    type: AccentType;
    /** 0..1: how hard the click hits (pointer forces surge and the burst size scale with it). */
    strength: number;
    /** Scales the wave width. 1 is the pen size. */
    size: number;
  };
  entry: {
    /** Seconds of eased transition when the performer switches to this scene. */
    seconds: number;
    easing: EasingName;
    burst: EntryBurst;
    /** Progress (0..1) at which discrete parameters switch. Default 0.5. */
    switchAt: number;
  };
}

/** What the tuning panel and the director both need to know about a live parameter vector. */
export type ParamVector = Record<string, number>;

// Physarum parameters and their descriptions. The `hint` texts started as draft predictions
// and were then checked against measurements (LOGBOOK.md, 2026-09-30). Where a hint says
// "Measured", it comes from one seed (7) on the developer machine, 900 steps (15 s) after a
// reset unless stated. That is evidence, not proof: Kiwi verifies and owns the final wording.
// Angles are stored in radians, the panel shows degrees.

/** Which agent rule runs. Numbers, so a mode can be stored and sent to the GPU as is. */
export const MODE_CLASSIC = 0;
export const MODE_EXTENDED = 1;

export interface PhysarumParams {
  /** MODE_CLASSIC or MODE_EXTENDED. Extended uses presets, the pen, waves and inertia; the
   *  sensor, turn and move parameters below then come from the presets, not from sliders. */
  mode: number;
  /** Extended mode: preset slot (0..21) that rules everywhere except under the pen. */
  backgroundPreset: number;
  /** Extended mode: preset slot that rules under the pen. */
  penPreset: number;
  /** Extended mode: pen radius (sigma) as a fraction of the screen height. */
  penRadius: number;
  /** Extended mode: how much agents keep their velocity (0 none, 1 a lot). */
  inertia: number;
  /** Extended mode: seconds to ease from one preset to another when a slot changes. */
  presetSeconds: number;
  /** How many agents are simulated (the buffer holds MAX_AGENTS, the rest sleep). */
  agentCount: number;
  /** SD: how far ahead the three sensors sit, in simulation pixels. */
  sensorDistance: number;
  /** SA: angle between the forward sensor and each side sensor (radians). */
  sensorAngle: number;
  /** RA: how far an agent turns in one step (radians). */
  rotationAngle: number;
  /** MD: distance travelled per step, in simulation pixels. */
  moveDistance: number;
  /** Trail multiplier per step after blurring (0..1). Lower means the trail fades faster. */
  decay: number;
  /** How much trail one agent leaves (scaled by sqrt of the agent count in a pixel). */
  depositFactor: number;
  /** Fraction of the way to a random teleport gained per step (0 disables teleporting). */
  respawnRate: number;
  /** Display only: brightness gain before the tone curve. Does not change the simulation. */
  displayGain: number;
}

export const DEFAULT_PARAMS: Readonly<PhysarumParams> = {
  mode: MODE_CLASSIC,
  backgroundPreset: 21,
  penPreset: 4,
  penRadius: 0.25,
  inertia: 0,
  presetSeconds: 0.5,
  agentCount: 400_000,
  sensorDistance: 16,
  sensorAngle: (45 * Math.PI) / 180,
  rotationAngle: (45 * Math.PI) / 180,
  moveDistance: 1.5,
  decay: 0.9,
  depositFactor: 0.05,
  respawnRate: 0.001,
  displayGain: 6,
};

/**
 * The values that go with each mode. The two modes leave different amounts of trail, so the
 * trail-related numbers differ: extended uses the reference values (decay 0.75, deposit 0.003,
 * with the deposit density compensation of extended.ts) and needs a higher display gain to
 * look equally bright. The extended presets were tuned for a dense swarm: at 400k agents
 * several curated presets visibly degrade (grainy multiscale network, blurred stripes, broken
 * maze; measured in LOGBOOK.md), so extended starts at 1M agents. Pen settings are left alone.
 */
export function modeDefaults(
  mode: number,
): Pick<PhysarumParams, 'decay' | 'depositFactor' | 'displayGain' | 'respawnRate' | 'agentCount'> {
  return mode === MODE_EXTENDED
    ? { decay: 0.75, depositFactor: 0.003, displayGain: 30, respawnRate: 0.001, agentCount: 1_000_000 }
    : { decay: 0.9, depositFactor: 0.05, displayGain: 6, respawnRate: 0.001, agentCount: 400_000 };
}

/** Switch mode and load that mode's trail defaults. */
export function setMode(p: PhysarumParams, mode: number): void {
  p.mode = mode;
  Object.assign(p, modeDefaults(mode));
}

/** Everything back to its default for the current mode. */
export function resetToDefaults(p: PhysarumParams): void {
  Object.assign(p, DEFAULT_PARAMS, { mode: p.mode }, modeDefaults(p.mode));
}

export interface ParamSpec {
  key: keyof PhysarumParams;
  label: string;
  min: number;
  max: number;
  step: number;
  /** Slider moves logarithmically (for values spanning orders of magnitude). */
  log?: boolean;
  /** Stored in radians, shown in degrees. */
  deg?: boolean;
  /** What to expect, with measurements where we have them. */
  hint: string;
  /** Which mode the slider belongs to: the classic-only sliders are hidden in extended mode. */
  only?: 'classic' | 'extended';
}

export const PARAM_SPECS: readonly ParamSpec[] = [
  {
    key: 'agentCount', label: 'agents', min: 10_000, max: 2_000_000, step: 1000, log: true,
    hint: 'Measured: 50k agents give a sparse network (26 closed cells, 8% coverage), 400k give 63 cells, 2M give 102 finer cells and brighter veins. At 2M, up to 671 agents pile into one pixel on the vein cores.',
  },
  {
    key: 'sensorDistance', label: 'sensor distance (SD)', min: 1, max: 60, step: 0.5, only: 'classic',
    hint: 'Measured: SD 4 gives sparse, thin, long curving lines (few closed cells, 6% coverage); 16 a honeycomb; 48 fat, blurry veins with more coverage (16%). A small SD does NOT give a fine tangle.',
  },
  {
    key: 'sensorAngle', label: 'sensor angle (SA)', min: 5, max: 120, step: 1, deg: true, only: 'classic',
    hint: 'Measured: 15 deg gives long, straighter filaments meeting at hubs with fewer closed cells and a churning pattern; 45 deg a honeycomb; 90 deg thick meandering labyrinth bands, very stable (only 10% of agents turn per step).',
  },
  {
    key: 'rotationAngle', label: 'turn angle (RA)', min: 5, max: 120, step: 1, deg: true, only: 'classic',
    hint: 'Measured: agents turn about 3 deg per step at RA 15, 11 at 45, 38 at 90. Small RA: smooth, fine, very stable honeycomb (125 cells). Large RA: ragged, kinked veins and coarser cells (41 cells).',
  },
  {
    key: 'moveDistance', label: 'move distance (MD)', min: 0.2, max: 6, step: 0.1, only: 'classic',
    hint: 'Measured: larger MD gives coarser cells and thinner lines (94, 47, 50 cells at MD 0.5, 1.5, 4 once mature). The pattern changes faster from 0.5 to 1.5, but 4 was not faster than 1.5.',
  },
  {
    key: 'decay', label: 'trail decay', min: 0.5, max: 0.99, step: 0.01,
    hint: 'Measured, the strongest control: 0.6 dim, fine and volatile (96 cells, 1 s correlation 0.25); 0.9 default; 0.97 thick, bright, large cells (31) and stable (correlation 0.87).',
  },
  {
    key: 'depositFactor', label: 'deposit', min: 0.005, max: 0.5, step: 0.005, log: true,
    hint: 'Checked: brightness only. Cell count and coverage are unchanged. Doubling the deposit gives bit-identical agent paths and an exactly doubled trail, because agents only compare trail values.',
  },
  {
    key: 'respawnRate', label: 'respawn rate', min: 0, max: 0.02, step: 0.0005,
    hint: 'Measured over 100 s: 0 collapses the picture onto a few lines (cells 31 to 9, agents in crowded pixels 20% to 47%, one line left in view); 0.001 stays stable; 0.01 is uniform and dense (about 130 cells, no clumping).',
  },
  {
    key: 'displayGain', label: 'display gain', min: 0.5, max: 30, step: 0.5, log: true,
    hint: 'Checked: brightness only. The simulation is bit-identical for any gain.',
  },
  {
    key: 'penRadius', label: 'pen radius', min: 0.05, max: 0.9, step: 0.01, only: 'extended',
    hint: 'Size of the region around the pointer that runs the pen preset, as a fraction of the screen height. The edge is soft: the blend is exp(-d^2 / radius^2), so at one radius from the centre the pen preset still has 37% weight.',
  },
  {
    key: 'inertia', label: 'inertia', min: 0, max: 1, step: 0.05, only: 'extended',
    hint: 'Draft: agents keep more of their velocity, so paths are smoother and swing wider around bends.',
  },
  {
    key: 'presetSeconds', label: 'preset transition (s)', min: 0, max: 5, step: 0.1, only: 'extended',
    hint: 'Seconds to ease from the old preset to the new one when a preset changes. 0 switches at once.',
  },
];

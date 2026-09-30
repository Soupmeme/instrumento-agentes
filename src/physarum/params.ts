// Physarum parameters and their descriptions. The `hint` texts started as draft predictions
// and were then checked against measurements (LOGBOOK.md, 2026-09-30). Where a hint says
// "Measured", it comes from one seed (7) on the developer machine, 900 steps (15 s) after a
// reset unless stated. That is evidence, not proof: Kiwi verifies and owns the final wording.
// Angles are stored in radians, the panel shows degrees.

export interface PhysarumParams {
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
}

export const PARAM_SPECS: readonly ParamSpec[] = [
  {
    key: 'agentCount', label: 'agents', min: 10_000, max: 2_000_000, step: 1000, log: true,
    hint: 'Measured: 50k agents give a sparse network (26 closed cells, 8% coverage), 400k give 63 cells, 2M give 102 finer cells and brighter veins. At 2M, up to 671 agents pile into one pixel on the vein cores.',
  },
  {
    key: 'sensorDistance', label: 'sensor distance (SD)', min: 1, max: 60, step: 0.5,
    hint: 'Measured: SD 4 gives sparse, thin, long curving lines (few closed cells, 6% coverage); 16 a honeycomb; 48 fat, blurry veins with more coverage (16%). A small SD does NOT give a fine tangle.',
  },
  {
    key: 'sensorAngle', label: 'sensor angle (SA)', min: 5, max: 120, step: 1, deg: true,
    hint: 'Measured: 15 deg gives long, straighter filaments meeting at hubs with fewer closed cells and a churning pattern; 45 deg a honeycomb; 90 deg thick meandering labyrinth bands, very stable (only 10% of agents turn per step).',
  },
  {
    key: 'rotationAngle', label: 'turn angle (RA)', min: 5, max: 120, step: 1, deg: true,
    hint: 'Measured: agents turn about 3 deg per step at RA 15, 11 at 45, 38 at 90. Small RA: smooth, fine, very stable honeycomb (125 cells). Large RA: ragged, kinked veins and coarser cells (41 cells).',
  },
  {
    key: 'moveDistance', label: 'move distance (MD)', min: 0.2, max: 6, step: 0.1,
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
];

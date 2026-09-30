// Physarum parameters and their descriptions. The `hint` texts are DRAFT predictions of the
// visible effect, to be verified by Kiwi (EXPLAINER.md repeats them). Angles are stored in
// radians, the panel shows degrees.

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
  /** Draft prediction of the visible effect. */
  hint: string;
}

export const PARAM_SPECS: readonly ParamSpec[] = [
  {
    key: 'agentCount', label: 'agents', min: 10_000, max: 2_000_000, step: 1000, log: true,
    hint: 'More agents: denser, brighter, more connected network. Fewer: thin isolated filaments.',
  },
  {
    key: 'sensorDistance', label: 'sensor distance (SD)', min: 1, max: 60, step: 0.5,
    hint: 'Larger SD: agents react to farther trails, so the network gets coarser with longer straight links. Smaller: fine, tangled texture.',
  },
  {
    key: 'sensorAngle', label: 'sensor angle (SA)', min: 5, max: 120, step: 1, deg: true,
    hint: 'Seen once (one seed): 15 deg gives long, straighter filaments meeting at hubs with fewer closed cells; 45 deg a honeycomb of closed cells; 90 deg thick meandering labyrinth bands.',
  },
  {
    key: 'rotationAngle', label: 'turn angle (RA)', min: 5, max: 120, step: 1, deg: true,
    hint: 'Larger RA: sharper turns, curlier and more jittery paths. Smaller: smooth, gently curving paths.',
  },
  {
    key: 'moveDistance', label: 'move distance (MD)', min: 0.2, max: 6, step: 0.1,
    hint: 'Larger MD: agents move faster, so the pattern evolves quickly and looks stretched. Smaller: slow, detailed growth.',
  },
  {
    key: 'decay', label: 'trail decay', min: 0.5, max: 0.99, step: 0.01,
    hint: 'Higher decay factor (closer to 1): trails linger, network becomes thick and stable. Lower: trails vanish fast, only fresh paths show.',
  },
  {
    key: 'depositFactor', label: 'deposit', min: 0.005, max: 0.5, step: 0.005, log: true,
    hint: 'More deposit: brighter and stronger attraction contrast. Fewer: dim network. Acts like a display gain for the trail values, sensing compares relative values.',
  },
  {
    key: 'respawnRate', label: 'respawn rate', min: 0, max: 0.02, step: 0.0005,
    hint: 'Higher: agents teleport more often, which keeps the pattern alive and uniform. Zero: the network gradually collapses onto a few strong lines.',
  },
  {
    key: 'displayGain', label: 'display gain', min: 0.5, max: 30, step: 0.5, log: true,
    hint: 'Brightness only. The simulation is unchanged.',
  },
];

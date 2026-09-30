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
  /** 1: the Physarum agents run; 0: only the other agent families (followers) are simulated. */
  physarumOn: number;
  /** Flow followers: how many (0 = the family is off). */
  followerCount: number;
  /** Followers' maxSpeed, in simulation pixels per step. */
  followerSpeed: number;
  /** Followers' maxForce: the most a follower can change its velocity in one step. */
  followerForce: number;
  /** Steps ahead at which a follower samples the field (0 = where it is). */
  followerLookahead: number;
  /** Chance per step that a follower teleports to a random place. */
  followerRespawn: number;
  /** How much trail a follower leaves (the same role as depositFactor for Physarum agents). */
  followerDeposit: number;
  /** Boids (the flock): how many (0 = the family is off). */
  flockCount: number;
  /** Boids' maxSpeed, in simulation pixels per step. */
  flockSpeed: number;
  /** Boids' maxForce: the most a boid can change its velocity in one step, per behaviour. */
  flockForce: number;
  /** Weight of separation (steer away from close neighbours). */
  flockSepWeight: number;
  /** Weight of alignment (steer toward the neighbours' average heading). */
  flockAliWeight: number;
  /** Weight of cohesion (steer toward the neighbours' centre). */
  flockCohWeight: number;
  /** Separation radius in simulation pixels. */
  flockSepRadius: number;
  /** Alignment and cohesion radius in simulation pixels. */
  flockNbrRadius: number;
  /** View cone, full angle in radians. A boid does not see neighbours outside it. */
  flockFov: number;
  /** What the pointer does to boids: 0 nothing, 1 attract, 2 predator. */
  flockPenMode: number;
  /** Weight of the steering force of the pointer, at the pointer. */
  flockPenStrength: number;
  /** How much trail a boid leaves (the same role as depositFactor for Physarum agents). */
  boidDeposit: number;
  /** Flow field construction: FIELD_NOISE_ANGLE or FIELD_CURL (see flowfield.ts). */
  fieldKind: number;
  /** Noise features per screen height. Larger: a busier field with tighter curves. */
  fieldFrequency: number;
  /** How fast the field drifts through time, in noise units per second. 0 freezes it. */
  fieldEvolution: number;
  /** 0: smooth angles. n: angles snapped to multiples of 360/n degrees. */
  fieldQuantSteps: number;
  /** Length of every field vector, 0..1. It scales the followers' desired speed. */
  fieldStrength: number;
  /** What the pen does to the field near it: 0 nothing, 1 swirl, 2 attract, 3 repel. */
  penFieldMode: number;
  /** How strongly the pen's edit replaces the noise direction at the pen, 0..1. */
  penFieldStrength: number;
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
  /** Coupling, flow -> Physarum: how strongly the flow field steers Physarum agents (0 off, 1 about 14 degrees per step at most). */
  flowToPhysarum: number;
  /** Coupling, trail -> boids: weight of the boids' steering up the trail's gradient (0 off). */
  trailToBoids: number;
  /** Display only: colour palette index (see render/palettes.ts). */
  palette: number;
  /** Display only: how strongly growing or fading trail tints the colour, 0..1. */
  changeColour: number;
}

export const DEFAULT_PARAMS: Readonly<PhysarumParams> = {
  mode: MODE_CLASSIC,
  backgroundPreset: 21,
  penPreset: 4,
  penRadius: 0.25,
  inertia: 0,
  presetSeconds: 0.5,
  physarumOn: 1,
  followerCount: 0,
  followerSpeed: 2.5,
  followerForce: 0.12,
  followerLookahead: 0,
  followerRespawn: 0.002,
  followerDeposit: 0.05,
  flockCount: 0,
  flockSpeed: 2.5,
  flockForce: 0.08,
  flockSepWeight: 2,
  flockAliWeight: 1.5,
  flockCohWeight: 0.6,
  flockSepRadius: 12,
  flockNbrRadius: 40,
  flockFov: (270 * Math.PI) / 180,
  flockPenMode: 2,
  flockPenStrength: 4,
  boidDeposit: 0.15,
  fieldKind: 0,
  fieldFrequency: 3,
  fieldEvolution: 0.08,
  fieldQuantSteps: 0,
  fieldStrength: 1,
  penFieldMode: 1,
  penFieldStrength: 0.9,
  agentCount: 400_000,
  sensorDistance: 16,
  sensorAngle: (45 * Math.PI) / 180,
  rotationAngle: (45 * Math.PI) / 180,
  moveDistance: 1.5,
  decay: 0.9,
  depositFactor: 0.05,
  respawnRate: 0.001,
  displayGain: 6,
  flowToPhysarum: 0,
  trailToBoids: 0,
  palette: 0,
  changeColour: 0.5,
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
): Pick<PhysarumParams, 'decay' | 'depositFactor' | 'displayGain' | 'respawnRate' | 'agentCount' | 'followerDeposit' | 'boidDeposit'> {
  return mode === MODE_EXTENDED
    ? { decay: 0.75, depositFactor: 0.003, displayGain: 30, respawnRate: 0.001, agentCount: 1_000_000, followerDeposit: 0.02, boidDeposit: 0.06 }
    : { decay: 0.9, depositFactor: 0.05, displayGain: 6, respawnRate: 0.001, agentCount: 400_000, followerDeposit: 0.05, boidDeposit: 0.15 };
}

export const FIELD_NOISE_ANGLE = 0;
export const FIELD_CURL = 1;

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
  /** A heading shown above this control in the panel (starts a new group). */
  group?: string;
  /** Present: shown as a dropdown of these choices instead of a slider (min and max unused). */
  options?: { value: number; text: string }[];
}

export const PARAM_SPECS: readonly ParamSpec[] = [
  {
    key: 'physarumOn', label: 'Physarum agents', min: 0, max: 1, step: 1, group: 'Physarum',
    options: [
      { value: 1, text: 'on' },
      { value: 0, text: 'off' },
    ],
    hint: 'Turn the Physarum agents off to see the other agent families alone.',
  },
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

  // ---- flow followers (steering agents that read the flow field) ----
  {
    key: 'followerCount', label: 'followers', min: 0, max: 1_000_000, step: 1000, group: 'Flow followers',
    hint: 'How many steering agents follow the flow field. 0 turns the family off.',
  },
  {
    key: 'followerSpeed', label: 'max speed', min: 0.3, max: 8, step: 0.1,
    hint: 'Measured (curl field, force 0.12): mean speed is about 92% of this at field strength 1. A faster follower turns wider (turning radius is about speed squared over force), so its alignment with the field falls: 1.00 at speed 1, 0.97 at 2.5, 0.62 at 6.',
  },
  {
    key: 'followerForce', label: 'max force', min: 0.005, max: 1, step: 0.005, log: true,
    hint: 'Measured (noise field): force 0.02 cannot keep up (alignment with the field 0.48, speed 55% of max); 0.12 follows well (0.96); 1 snaps onto the field (0.999).',
  },
  {
    key: 'followerLookahead', label: 'look-ahead (steps)', min: 0, max: 40, step: 1,
    hint: 'Measured (noise field): 10 steps lifts alignment a little (0.96 to 0.974); 30 steps hurts it (0.82) and slows followers to 66% of max speed, because they read the field too far away to matter.',
  },
  {
    key: 'followerRespawn', label: 'follower respawn', min: 0, max: 0.05, step: 0.0005,
    hint: 'Draft: chance per step that a follower jumps to a random place, at rest. Keeps followers from gathering only along the field sinks.',
  },
  {
    key: 'followerDeposit', label: 'follower trail', min: 0.002, max: 0.5, step: 0.002, log: true,
    hint: 'How much trail one follower leaves. It is the followers\' share of the shared picture.',
  },

  // ---- boids (the flock) ----
  {
    key: 'flockCount', label: 'boids', min: 0, max: 150_000, step: 1000, group: 'Flock',
    hint: 'Measured (radius 40, with 400k Physarum agents and 200k followers also running): GPU time per step 2.6 ms at 20k boids, 3.7 ms at 50k, 4.7 ms at 100k, 4.9 ms at 150k. A work guard caps the cost (about 200 million neighbour tests per step): with every boid packed into the pointer circle (attract held still) 150k boids still cost 4.5 ms, where 50k cost 55 ms without the guard. Above about 50k boids the guard can sample crowded cells, so the flock is then an approximation.',
  },
  {
    key: 'flockSpeed', label: 'boid max speed', min: 0.3, max: 8, step: 0.1,
    hint: 'Measured (10k boids, 3 seeds, 15 s): the structure hardly changes between 1 and 5 pixels per step; it sets how fast flocks travel (mean speed stays 90 to 96% of max).',
  },
  {
    key: 'flockForce', label: 'boid max force', min: 0.005, max: 1, step: 0.005, log: true,
    hint: 'Measured: a high force makes the flock jitterier, not tighter (0.3: 85% of max speed, local alignment 0.986). A low force gives the smoothest, most ordered flock (0.02: 97% of max speed, local alignment 1.000) but dodges the pointer slowly. Spacing hardly changes. (I predicted the opposite.)',
  },
  {
    key: 'flockSepWeight', label: 'separation weight', min: 0, max: 4, step: 0.05,
    hint: 'Measured (10k boids, 3 seeds, 15 s): 0 collapses the flock (nearest neighbour 0.5 px, about 1800 neighbours in reach); 1 gives 3.9 px, 2 gives 5.6 px, 4 gives 7.7 px and a slower flock (79% of max speed). More separation spreads the flock out.',
  },
  {
    key: 'flockAliWeight', label: 'alignment weight', min: 0, max: 4, step: 0.05,
    hint: 'Measured: 0 gives no order at all (local alignment 0.04, boids crawl at 41% of max speed, no clumps either, just an even gas); 0.5 already aligns neighbours (0.99, but only 69% of max speed); 4 makes the whole world head one way (global polarisation 1.00 in all 3 seeds).',
  },
  {
    key: 'flockCohWeight', label: 'cohesion weight', min: 0, max: 4, step: 0.05,
    hint: 'Measured: 0 spreads boids evenly (nearest 7.8 px, 62 neighbours); 1.5 draws them tight (2.7 to 4.2 px; one of 3 seeds nearly collapsed). At 2, equal to the separation weight, the flock collapsed in all 3 seeds (0.2 to 0.5 px, over 3,800 boids in one grid cell): keep cohesion clearly below separation.',
  },
  {
    key: 'flockSepRadius', label: 'separation radius', min: 4, max: 60, step: 1,
    hint: 'Measured: the distance to the nearest neighbour is 2.5 px at radius 4, 5.6 at 12 and 8.7 at 30.',
  },
  {
    key: 'flockNbrRadius', label: 'neighbour radius', min: 8, max: 120, step: 1,
    hint: 'Measured: a boid has 9 neighbours in reach at radius 15, 146 at 40 and 694 at 100 (the cost per step grows with that number). At 100 all 3 seeds agreed on one heading (global polarisation 1.00); at 40 they did not (0.33 to 0.82). At this density no radius split the boids into many separate flocks. It also sets the grid cell size.',
  },
  {
    key: 'flockFov', label: 'view angle', min: 30, max: 360, step: 5, deg: true,
    hint: 'Measured: 180 to 360 degrees look alike. A narrow 60 degree cone fragments the flock into about 6 groups (against 1) with denser clumps (fullest grid cell 162 against 70 to 107). It applies to alignment and cohesion only: boids always avoid crowding from every side.',
  },
  {
    key: 'flockPenMode', label: 'pointer and boids', min: 0, max: 2, step: 1,
    options: [
      { value: 0, text: 'nothing' },
      { value: 1, text: 'attract (seek)' },
      { value: 2, text: 'predator (flee)' },
    ],
    hint: 'Measured (10k boids, pen radius 0.2, 15 s, one seed): with no pointer 13% of the boids are inside the pen circle. Predator: 3% at strength 1, 0% at 4 (they flee and leave a hole). Attract: 5.5% at strength 1 but all of them at 4: the whole flock gathers. Both fade with the same soft circle as the Physarum pen.',
  },
  {
    key: 'flockPenStrength', label: 'pointer strength', min: 0, max: 10, step: 0.25,
    hint: 'Measured: predator empties the circle from strength 1 up. Attract gathers 5.5% of the boids at 1 and all of them at 4 and 10, so use about 1 for a gentle pull.',
  },
  {
    key: 'boidDeposit', label: 'boid trail', min: 0.002, max: 0.5, step: 0.002, log: true,
    hint: 'How much trail one boid leaves. Measured trail-energy shares with all three families on (default weights): boids 17 to 31%, followers 13 to 22%, Physarum 50 to 69% (400k to 1M Physarum agents, 60k to 100k followers, 20k to 40k boids). Raising it also lowers the trail -> boids cliff.',
  },

  // ---- the flow field itself ----
  {
    key: 'fieldKind', label: 'field kind', min: 0, max: 1, step: 1, group: 'Flow field',
    options: [
      { value: 0, text: 'noise angle' },
      { value: 1, text: 'curl noise' },
    ],
    hint: 'Seen: noise angle gathers followers into a few bright rivers (alignment 0.96); curl keeps them spread over vortices (alignment 0.974). Curl is incompressible, so a dense swarm averages into grain: use fewer followers and a slower trail decay to see strokes.',
  },
  {
    key: 'fieldFrequency', label: 'noise frequency', min: 0.5, max: 20, step: 0.1, log: true,
    hint: 'Measured (curl field): turning per step 0.8, 1.5 and 2.5 degrees at 1.5, 3 and 8 features per screen height; alignment with the field 0.99, 0.97, 0.88.',
  },
  {
    key: 'fieldEvolution', label: 'field drift (per s)', min: 0, max: 1, step: 0.01,
    hint: 'Measured (curl field): 0 freezes the field and leaves 14% of followers stalled at stagnation points; 0.08 is best aligned (0.974); 0.8 lowers alignment to 0.91.',
  },
  {
    key: 'fieldQuantSteps', label: 'angle steps', min: 0, max: 16, step: 1,
    hint: 'Seen: 0 keeps directions smooth. n snaps every direction to a multiple of 360/n degrees; 4 gives right-angle streams, like a circuit board.',
  },
  {
    key: 'fieldStrength', label: 'field strength', min: 0, max: 1, step: 0.05,
    hint: 'Measured: mean follower speed is proportional to it: 0.24, 0.47, 0.92 of max speed at 0.25, 0.5, 1. At 0 they have nothing to follow and coast to a stop.',
  },
  {
    key: 'penFieldMode', label: 'pen edits field', min: 0, max: 3, step: 1,
    options: [
      { value: 0, text: 'nothing' },
      { value: 1, text: 'swirl' },
      { value: 2, text: 'attract' },
      { value: 3, text: 'repel' },
    ],
    hint: 'Measured against a nearly uniform field: swirl raises circulation around the pen from 0.23 to 0.87; attract drives followers inward (radial motion -0.83); repel empties the pen (followers inside 15.5k to 9k) with a mild outward drift (+0.26). The drag direction (stir) also bends the field near the pen.',
  },
  {
    key: 'penFieldStrength', label: 'pen edit strength', min: 0, max: 1, step: 0.05,
    hint: 'Measured (swirl): circulation around the pen 0.36 at 0.3 and 0.87 at 0.9.',
  },

  // ---- coupling: who perceives whom (SPEC 6) ----
  {
    key: 'flowToPhysarum', label: 'flow steers Physarum', min: 0, max: 1, step: 0.05, group: 'Coupling',
    hint: 'Measured (400k classic Physarum agents, 3 seeds, 15 s): alignment of agent headings with the field (0 unrelated, 1 along it) is 0.07 to 0.18 at 0.25, 0.35 to 0.51 at 0.5, 0.74 to 0.78 at 1. Closed network cells: 53 at 0 and 0.25, 23 to 29 at 0.5, 9 to 16 at 1; agents in crowded pixels rise from 37% to 68 to 75% (a noise-angle field, which has sinks, collapses more). Extended mode (1M agents, curl): alignment 0.55 at 0.5 and 0.86 at 1, cells 343, 80, 27. No measurable cost. The first force value overshot (alignment 0.92 at 1, network collapsed), so the range was halved.',
  },
  {
    key: 'trailToBoids', label: 'trail attracts boids', min: 0, max: 2, step: 0.05,
    hint: 'Measured (20k boids, 400k Physarum agents, boid trail 0.15, 3 seeds): the trail under the boids against the world average is 1.3 at 0, 1.5 at 1, 1.9 at 1.25, 2.9 at 1.5 (spacing 3.1 px, 69% of max speed), then a cliff: 9 at 1.75 and 19 at 2 (spacing 0.6 px, boids locked onto the veins, up to 2000 in one grid cell, network down to 8 cells). Boids climb a trail that they also write, so it tips over. Keep it below about 1.5.',
  },
  // The other coupling channels are the trail weights already in the family groups: "deposit"
  // (Physarum), "follower trail" and "boid trail" set how much each family writes into the
  // shared trail, which every family can sense.

  // ---- look (display only) ----
  {
    key: 'palette', label: 'palette', min: 0, max: 5, step: 1, group: 'Look',
    options: [
      { value: 0, text: 'Abyss (blue, teal, cream)' },
      { value: 1, text: 'Ember (red, orange)' },
      { value: 2, text: 'Orchid (violet, pink)' },
      { value: 3, text: 'Verdigris (green, gold)' },
      { value: 4, text: 'Bone (monochrome)' },
      { value: 5, text: 'Tide (blue, teal, amber)' },
    ],
    hint: 'One colour ramp for the whole picture: every family is drawn through the same palette. A discrete regime switch; scenes will pick it.',
  },
  {
    key: 'changeColour', label: 'change colour', min: 0, max: 1, step: 0.05,
    hint: 'Seen, not measured: tints the picture where the trail is growing (the accent colour of the palette) and darkens it where it is fading, using a delayed copy of the trail. Strongest in the mid-tones, so bright veins stay clean. 0 shows the trail only. Display only: the simulation is unchanged.',
  },
];

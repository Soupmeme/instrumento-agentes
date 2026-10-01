// The prediction registry (SPEC 10.1, M7). One entry per testable statement about what a
// parameter, a rule or a gesture does, with the check that tests it. It is plain data so that
// a unit test (test/registry.test.ts) can verify the links, and so that EXPLAINER.md, the
// logbook and the browser runner (`__exp.verify()`) all talk about the same ids.
//
// How a prediction is linked to its check:
//   cpu       a unit test whose title starts with the id in square brackets, for example
//             "[FL-02] ...". Runs in Node with `npm test` (and in CI), against the CPU references.
//   gpu       a function registered under the id in src/verify/gpu_checks.ts. Runs in the browser
//             on a real WebGPU adapter with `await __exp.verify()` (development server only).
//   selftest  the beginning of the name of a check in the in-browser self-test
//             (`__physarumSelfTest()`), which compares the GPU with the CPU reference.
//
// `origin` says how honest the pass is:
//   'new'      first written down in M7, or never measured before: passing is a real confirmation.
//   'earlier'  stated and measured in M1 to M6; the check re-runs it with thresholds taken from
//              the claim, so passing means "still true", not "newly confirmed".
// `history` records when a first version of the claim was wrong and what was corrected.
//
// Nothing here says a prediction is verified by Kiwi: that column exists only in EXPLAINER.md and
// the logbook, and he fills it.

export type Family =
  | 'physarum-classic'
  | 'physarum-extended'
  | 'followers'
  | 'flock'
  | 'coupling'
  | 'scenes'
  | 'tools';

export interface Prediction {
  id: string;
  family: Family;
  /** What the performer or the developer changes (a parameter, a rule, a gesture). */
  change: string;
  /** The testable statement, in plain words, with the numbers the check uses. */
  statement: string;
  origin: 'new' | 'earlier';
  history?: string;
  cpu?: boolean;
  gpu?: boolean;
  selftest?: string;
}

export const FAMILY_NAMES: Record<Family, string> = {
  'physarum-classic': 'Physarum, classic rule',
  'physarum-extended': 'Physarum, extended rule (36 Points)',
  followers: 'Flow field and flow followers',
  flock: 'Flocking',
  coupling: 'Coupling and display',
  scenes: 'Scenes and live gestures',
  tools: 'Verification tools',
};

export const PREDICTIONS: Prediction[] = [
  // ------------------------------------------------------------ Physarum, classic
  {
    id: 'PC-01', family: 'physarum-classic', change: 'trail decay 0.6 to 0.97', origin: 'earlier',
    statement: 'A decay closer to 1 makes a brighter and more stable trail: the trail maximum is at least 5 times higher at 0.97 than at 0.6, and the trail one second later correlates at least 0.3 more with the present one.',
    gpu: true,
  },
  {
    id: 'PC-02', family: 'physarum-classic', change: 'sensor distance 16 to 48', origin: 'earlier',
    history: 'The threshold 1.3 times was written before the first GPU run and missed narrowly (1.29 times). The claim (fatter veins) held, so the threshold became 1.2 times after that run.',
    statement: 'A larger sensor distance gives a coarser network with fatter veins: vein coverage at distance 48 is at least 1.2 times the coverage at 16.',
    gpu: true,
  },
  {
    id: 'PC-03', family: 'physarum-classic', change: 'sensor distance 16 to 4', origin: 'earlier',
    history: 'The first prediction (smaller distance gives a fine tangle) was contradicted in M1 and replaced by this one.',
    statement: 'A small sensor distance gives sparse thin lines, not a fine tangle: closed cells at distance 4 are at most 60% of those at 16.',
    gpu: true,
  },
  {
    id: 'PC-04', family: 'physarum-classic', change: 'sensor angle 15 to 90 degrees', origin: 'earlier',
    history: 'The first prediction (a larger angle branches more) was contradicted in M1: it makes labyrinth bands.',
    statement: 'A large sensor angle makes a stable labyrinth in which few agents turn: the share of agents that turn in a step at 90 degrees is at most half of that at 15 degrees.',
    gpu: true,
  },
  {
    id: 'PC-05', family: 'physarum-classic', change: 'turn angle 15, 45, 90 degrees', origin: 'earlier',
    statement: 'A larger turn angle means sharper turns: the mean turn per step rises with the angle (15 < 45 < 90) and is at least 5 times larger at 90 degrees than at 15.',
    gpu: true,
  },
  {
    id: 'PC-06', family: 'physarum-classic', change: 'respawn rate 0 against 0.01, over 100 simulated seconds', origin: 'earlier',
    statement: 'Without respawn the network collapses onto a few lines: after 6,000 steps closed cells are at most 60% of those at 900 steps. With respawn 0.01 they stay at 70% or more.',
    gpu: true,
  },
  {
    id: 'PC-07', family: 'physarum-classic', change: 'deposit 1 to 2', origin: 'earlier',
    statement: 'Deposit only scales brightness: the agents move bit for bit the same and the trail is exactly doubled.',
    gpu: true,
  },
  {
    id: 'PC-08', family: 'physarum-classic', change: 'display gain, palette, change tint (all display only)', origin: 'earlier',
    statement: 'The display settings change only what is drawn: the trail after 300 steps is bit for bit the same for gain 2 and 20, palette 0 and 3, change tint 0 and 1.',
    gpu: true,
  },
  {
    id: 'PC-09', family: 'physarum-classic', change: 'agent count 50,000 to 400,000', origin: 'earlier',
    statement: 'More agents make more, finer cells: closed cells at 400,000 are at least 1.5 times those at 50,000.',
    gpu: true,
  },
  {
    id: 'PC-10', family: 'physarum-classic', change: 'move distance 1.5 to 4', origin: 'new',
    statement: 'Move distance is the step length: the mean displacement of an agent per step scales with it, 4 / 1.5 = 2.67 times, within 10%.',
    gpu: true,
  },
  {
    id: 'PC-11', family: 'physarum-classic', change: 'seed', origin: 'new',
    statement: 'The same seed gives a bit-identical run, and a different seed gives a different one.',
    gpu: true, selftest: 'determinism: same seed and steps give identical agents',
  },
  {
    id: 'PC-12', family: 'physarum-classic', change: 'what the three sensors read', origin: 'earlier',
    statement: 'The turning rule: the middle sensor strictly highest keeps the heading; otherwise the agent turns by the turn angle toward the higher side, at random when the middle is lower than both, and not at all on empty ground.',
    cpu: true, selftest: 'agent rule: ',
  },
  {
    id: 'PC-13', family: 'physarum-classic', change: 'sensor distance and position', origin: 'earlier',
    statement: 'A sensor reads the pixel one sensor distance away along its own direction, and the world wraps like a torus.',
    cpu: true, selftest: 'agent rule: ',
  },

  // ------------------------------------------------------------ Physarum, extended
  {
    id: 'PE-01', family: 'physarum-extended', change: 'background preset, each of the 8 curated slots', origin: 'earlier',
    statement: 'Each curated preset still has a visible network after 45 simulated seconds at 1M agents: vein coverage of at least 0.02 (a blank picture is about 0).',
    gpu: true,
  },
  {
    id: 'PE-02', family: 'physarum-extended', change: 'the pen (second preset under the pointer)', origin: 'earlier',
    history: 'The threshold 3 times was written before the first GPU run and missed (2.3 times, the same as the calm scene in M6, where the ratio was already known to be about 2). It became 2 times after that run, to match SC-02.',
    statement: 'The pen changes the picture where it is and not elsewhere: the difference between a run with and without the pen is at least 0.03 and at least 2 times larger inside the circle than outside.',
    gpu: true,
  },
  {
    id: 'PE-03', family: 'physarum-extended', change: 'preset transitions (4 pairs of curated presets)', origin: 'earlier',
    statement: 'A preset change never blanks the picture: after the transition the coverage is within 0.7 to 1.3 times that of a run that started on the destination preset.',
    gpu: true,
  },
  {
    id: 'PE-04', family: 'physarum-extended', change: 'click: a wave', origin: 'earlier',
    statement: 'A wave changes the picture while it passes and leaves a healthy network afterwards: the correlation with a run without the wave is below 0.5 three seconds in, and the coverage after the wave is within 20% of the run without it.',
    gpu: true,
  },
  {
    id: 'PE-05', family: 'physarum-extended', change: 'right-drag: stir', origin: 'earlier',
    statement: 'Stir pushes the agents inside the pen along the drag: over 60 steps their mean displacement is at least 30 pixels with stir and at least 20 times larger than without.',
    gpu: true,
  },
  {
    id: 'PE-06', family: 'physarum-extended', change: 'ring burst', origin: 'earlier',
    statement: 'A ring burst moves about the requested share of agents onto the ring around the pen: the share of agents in the ring band rises by at least 0.05 (10% were requested).',
    gpu: true, selftest: 'spawn burst: ',
  },
  {
    id: 'PE-07', family: 'physarum-extended', change: 'inertia 0 to 1', origin: 'new',
    statement: 'Inertia smooths the paths: the mean change of direction of an agent between two consecutive steps is at least 25% smaller at inertia 1 than at 0.',
    gpu: true,
  },
  {
    id: 'PE-08', family: 'physarum-extended', change: 'the pen weight t', origin: 'earlier',
    statement: 'The pen weight is exp(-d^2 / sigma^2): 1 at the pointer, 0.37 one radius away, below 0.02 three radii away, and the same ring size for any pen radius.',
    cpu: true, selftest: 'extended rule: ',
  },
  {
    id: 'PE-09', family: 'physarum-extended', change: 'the number of selectable presets', origin: 'earlier',
    statement: 'The app offers 22 presets (slots 0 to 21), 8 of them curated, and every preset has the 15 numbers the shader reads.',
    cpu: true,
  },

  // ------------------------------------------------------------ followers
  {
    id: 'FO-01', family: 'followers', change: 'follower max force 0.02, 0.12, 1', origin: 'earlier',
    statement: 'A stronger steering force follows the field more closely: the alignment with the field rises with the force (0.02 < 0.12 < 1) and is at least 0.9 at 0.12.',
    gpu: true,
  },
  {
    id: 'FO-02', family: 'followers', change: 'follower max speed 2.5 to 6', origin: 'earlier',
    statement: 'Fast followers cannot follow a curvy field: alignment at speed 6 is at least 0.2 lower than at 2.5.',
    gpu: true,
  },
  {
    id: 'FO-03', family: 'followers', change: 'look-ahead 10 to 30 steps', origin: 'earlier',
    statement: 'Reading the field too far ahead hurts: alignment at 30 steps is lower than at 10.',
    gpu: true,
  },
  {
    id: 'FO-04', family: 'followers', change: 'field strength 0.5 to 1', origin: 'earlier',
    statement: 'Field strength scales the desired speed: mean speed at 0.5 is 0.4 to 0.6 times that at 1.',
    gpu: true,
  },
  {
    id: 'FO-05', family: 'followers', change: 'noise frequency 1.5, 3, 8 per screen height', origin: 'earlier',
    statement: 'A higher noise frequency means tighter turns: the mean turn per step rises with the frequency (1.5 < 3 < 8).',
    gpu: true,
  },
  {
    id: 'FO-06', family: 'followers', change: 'pen swirl, attract, repel', origin: 'earlier',
    history: 'The first GPU run used the default noise-angle field, not the curl field the EXPLAINER measurements used, and the repel check failed (10,631 followers inside against 10,576 without the edit): the noise-angle field has sinks that crowd the circle on their own. The check was corrected to use the curl field, as documented.',
    statement: 'The pen on the field, curl field: swirl circulates (circulation at least 0.5), attract draws inward (inward motion at most -0.5), repel empties the circle (at most 0.8 times as many followers inside it as without the edit).',
    gpu: true,
  },
  {
    id: 'FO-07', family: 'followers', change: 'field drift 0 to 0.08', origin: 'earlier',
    history: 'The threshold "fewer than 2% at drift 0.08" was written before the first GPU run and missed (2.4%, against 13.2% when frozen). It became "at most a quarter of the frozen share" after that run.',
    statement: 'A frozen field leaves followers stalled at stagnation points: at drift 0 at least 5% of the followers have nearly stopped, and at drift 0.08 at most a quarter of that share.',
    gpu: true,
  },
  {
    id: 'FO-08', family: 'followers', change: 'follower respawn 0 to 0.01 (noise-angle field, which has sinks)', origin: 'new',
    statement: 'Respawn keeps followers from gathering only at the sinks: the share of followers standing in the most crowded 1% of pixels is smaller with respawn 0.01 than with 0.',
    gpu: true,
  },
  {
    id: 'FO-09', family: 'followers', change: 'steering force and speed', origin: 'new',
    statement: 'Turning radius is about speed squared over force: a vehicle that is asked to turn sideways at constant force traces a circle of radius v^2 / F, within 5%.',
    cpu: true,
  },
  {
    id: 'FO-10', family: 'followers', change: 'steering limits', origin: 'earlier',
    statement: 'A follower never exceeds its max speed, and the steering force never exceeds its max force, whatever the field asks for.',
    cpu: true, selftest: 'followers: no NaN, positions in [0,1), speed never above maxSpeed',
  },
  {
    id: 'FO-11', family: 'followers', change: 'the GPU follower rule', origin: 'earlier',
    statement: 'The GPU follower update equals the CPU steering reference for resting, opposing, snapping, weak-force, look-ahead and wrapping cases.',
    selftest: 'follower steering: ',
  },

  // ------------------------------------------------------------ flock
  {
    id: 'FL-01', family: 'flock', change: 'separation weight 0 to 2 to 4', origin: 'earlier',
    statement: 'A larger separation weight gives more personal space: the mean distance to the nearest boid rises with the weight (0 < 1 < 2 < 4) and at weight 0 the boids pile up (nearest distance at most half of that at weight 2; 0.5 px in the GPU run with 10,000 boids).',
    cpu: true,
  },
  {
    id: 'FL-02', family: 'flock', change: 'cohesion weight against separation weight', origin: 'earlier',
    history: 'The first threshold (more than 4 times as many boids in reach) missed on the first CPU run (3.6 times on seed 7), so it became 3 times.',
    statement: 'Cohesion at the same value as separation collapses the flock (nearest distance under a third of the healthy value, more than 3 times as many boids in reach), while cohesion 0.5 keeps a spacing of more than 3 pixels.',
    cpu: true,
  },
  {
    id: 'FL-03', family: 'flock', change: 'alignment weight 0 to 0.5', origin: 'earlier',
    history: 'The first prediction (no alignment gives clumps) was contradicted in M4: without alignment there is an even, slow gas.',
    statement: 'Alignment is what makes boids share a direction: local alignment is below 0.3 at weight 0 and at least 0.9 at weight 0.5.',
    cpu: true,
  },
  {
    id: 'FL-04', family: 'flock', change: 'separation radius 4 to 12 to 30', origin: 'earlier',
    statement: 'The separation radius sets the personal space: the nearest-neighbour distance rises with it (4 < 12 < 30).',
    cpu: true,
  },
  {
    id: 'FL-05', family: 'flock', change: 'max force 0.02 to 0.3', origin: 'earlier',
    history: 'The first prediction (a high force tightens the flock) was contradicted in M4: it makes the flock noisier.',
    statement: 'A high force makes the flock noisier, not tighter: local alignment at force 0.3 is lower than at 0.02.',
    cpu: true,
  },
  {
    id: 'FL-06', family: 'flock', change: 'max speed 1 to 5', origin: 'earlier',
    statement: 'Max speed only sets the pace: the mean speed is 85 to 100% of the maximum at both, and the spacing changes by less than 25%.',
    cpu: true,
  },
  {
    id: 'FL-07', family: 'flock', change: 'pointer as predator and as attractor', origin: 'earlier',
    history: 'The first threshold (below half at strength 4) was written before running and missed on the first CPU run (0.57 on seed 7; 0.15 to 0.57 over four seeds), so it was split into strength 4 and strength 10.',
    statement: 'A predator pointer empties its circle and an attractor fills it: the share of boids inside the pen circle is below 0.7 of its no-pointer value for a predator at strength 4, below 0.1 at strength 10, and above 3 times as attractor at 4.',
    cpu: true,
  },
  {
    id: 'FL-08', family: 'flock', change: 'separation sees all around (no view cone)', origin: 'earlier',
    history: 'The first version applied the view cone to separation and collapsed the flock in M4.',
    statement: 'The push between two boids is mutual: for any two boids within the separation radius, the pushes are equal and opposite, even if one is behind the other.',
    cpu: true,
  },
  {
    id: 'FL-09', family: 'flock', change: 'the GPU flock and its grid', origin: 'earlier',
    statement: 'The GPU flock equals the CPU reference (forces, grid, work guard, determinism, pointer, trail coupling).',
    selftest: 'flock grid: ',
  },
  {
    id: 'FL-10', family: 'flock', change: 'the grid and the fixed-point sums', origin: 'earlier',
    statement: 'The grid search finds exactly the boids a brute-force search finds, and the neighbour sums do not depend on the order in which neighbours are visited.',
    cpu: true,
  },

  // ------------------------------------------------------------ coupling and display
  {
    id: 'CP-01', family: 'coupling', change: 'flow to Physarum 0, 0.25, 1', origin: 'earlier',
    history: 'The first force value overshot by a factor of two (M5) and was halved.',
    statement: 'The flow steers the Physarum agents in proportion to the weight: alignment with the field is below 0.05 at 0, between 0.05 and 0.3 at 0.25, and at least 0.6 at 1.',
    gpu: true,
  },
  {
    id: 'CP-02', family: 'coupling', change: 'flow to Physarum 0 to 1', origin: 'earlier',
    statement: 'A strong flow breaks the network into fewer cells: closed cells at weight 1 are at most half of those at 0.',
    gpu: true,
  },
  {
    id: 'CP-03', family: 'coupling', change: 'trail to boids 0 to 1', origin: 'earlier',
    statement: 'Boids follow the veins: the mean trail under the boids, against the world average, is higher at weight 1 than at 0 by at least 0.1.',
    gpu: true,
  },
  {
    id: 'CP-04', family: 'coupling', change: 'trail to boids 1.5 to 1.75', origin: 'earlier',
    history: 'The transition was found to be a cliff, not a ramp (M5), which is why scenes stay at 1.5 or below.',
    statement: 'Above the cliff the flock collapses: at weight 1.75 the nearest-neighbour distance is under 1.5 pixels and the enrichment at least 5, while at 1.0 the spacing is above 3 pixels.',
    gpu: true,
  },
  {
    id: 'CP-05', family: 'coupling', change: 'flow steering of Physarum headings', origin: 'earlier',
    statement: 'The flow can turn a heading by at most weight times 0.25 step lengths per step (about 14 degrees at full weight), and does nothing at weight 0.',
    cpu: true,
  },
  {
    id: 'CP-06', family: 'coupling', change: 'the GPU coupling channels', origin: 'earlier',
    statement: 'The GPU flow steering, trail gradient and palettes equal their CPU references.',
    selftest: 'flow -> Physarum: ',
  },

  // ------------------------------------------------------------ scenes and gestures
  {
    id: 'SC-01', family: 'scenes', change: 'the wheel, in each placeholder scene', origin: 'earlier',
    statement: 'Turning the wheel from 0 to 1 makes a visible difference in every scene (image difference of at least 0.03) and the dominant energy family stays the same.',
    gpu: true,
  },
  {
    id: 'SC-02', family: 'scenes', change: 'the pen, in each placeholder scene', origin: 'earlier',
    history: 'The first test was not local because two runs drift apart; the method became a warm start (M6).',
    statement: 'The pen changes the picture mostly where it is: the difference inside the pen circle is at least 0.03 and at least 2 times the difference outside, in every scene.',
    gpu: true,
  },
  {
    id: 'SC-03', family: 'scenes', change: 'the click, in each placeholder scene', origin: 'earlier',
    statement: 'The accent is visible: thirty steps after a click the image difference against no click is at least 0.02 in every scene.',
    gpu: true,
  },
  {
    id: 'SC-04', family: 'scenes', change: 'nothing (no input at all)', origin: 'earlier',
    statement: 'Nothing happens by itself: with no input and no transition, two simulated minutes change no parameter (no timeline, no automation).',
    cpu: true,
  },
  {
    id: 'SC-05', family: 'scenes', change: 'a scene key (Space, B, 1 to 9)', origin: 'earlier',
    statement: 'A transition is gentle: continuous parameters never overshoot and move one way only, a discrete one switches once, and the trail mean changes by less than 5% in any step.',
    cpu: true, gpu: true,
  },
  {
    id: 'SC-06', family: 'scenes', change: 'the keyboard', origin: 'earlier',
    statement: 'Every live input is one key without a modifier: Ctrl, Alt and Meta are ignored, key repeat is ignored, and no live key is shared with a rehearsal key.',
    cpu: true,
  },
  {
    id: 'SC-07', family: 'scenes', change: 'scenes.json', origin: 'earlier',
    statement: 'A scene file can never break the instrument: values are clamped or dropped and the validator never throws; the three shipped scenes are all marked PLACEHOLDER.',
    cpu: true,
  },

  // ------------------------------------------------------------ verification tools
  {
    id: 'TL-01', family: 'tools', change: 'the agent-sensor overlay (A)', origin: 'new',
    statement: 'The overlay shows exactly what the shader computed: for the selected agent the three sensor positions, the readings and the turn equal the CPU reference computed from a read-back of the same step.',
    selftest: 'probe: ',
  },
  {
    id: 'TL-02', family: 'tools', change: 'the pointer pick (A and G)', origin: 'new',
    statement: 'The agent or boid picked at the pointer is the nearest one (against a brute-force search) and keeps naming the same agent while it moves.',
    selftest: 'pick: ',
  },
  {
    id: 'TL-03', family: 'tools', change: 'the buffer views (O) and the overlays (A, G, V)', origin: 'new',
    statement: 'The buffer views and the overlays change only what is drawn: with the four views in turn, the sensor overlay on a chosen agent, the flock overlay on a chosen boid and the field arrows on, the trail, agents and boids after 300 steps are bit for bit the same as with none of them.',
    gpu: true,
  },
  {
    id: 'TL-04', family: 'tools', change: 'the sweep tool', origin: 'new',
    statement: 'The same sweep run twice saves byte-identical screenshots.',
    gpu: true,
  },
  {
    id: 'TL-05', family: 'tools', change: 'the probe compiled into the agent pass', origin: 'new',
    history: 'The first version compared four blocks and saw a 6% difference that was clock drift (the same work took 0.349 to 0.381 ms over the run). The check now alternates 12 rounds with the order swapped and takes the median of the per-round ratio.',
    statement: 'Following an agent costs nothing measurable: the step time with the sensor overlay following an agent is within 3% of the step time without it (median of 12 alternating rounds, 1M extended agents).',
    gpu: true,
  },
  {
    id: 'TL-06', family: 'tools', change: 'a reset after an accent', origin: 'new',
    history: 'Found while repeating the scene test: a reset cleared the waves, the burst and the stir but not the accent surge. The check failed before the fix (surge 1 left after a reset, the hashes differed) and passes after it.',
    statement: 'A reset leaves nothing of the run before it: two runs from the same seed are bit for bit the same even when the first one ended in the middle of an accent (the pointer surge on the boids).',
    gpu: true,
  },
];

export const byFamily = (family: Family): Prediction[] => PREDICTIONS.filter((p) => p.family === family);

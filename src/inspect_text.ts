// Text for the debug readouts (SPEC 10.2): the per-family parameter lines of the debug HUD (key D)
// and the description of what the followed Physarum agent perceived and decided (key A). Pure
// functions of numbers, so the wording is unit tested (test/inspect.test.ts) and cannot drift
// from what the shaders write.

import { MODE_EXTENDED, type PhysarumParams } from './physarum/params.ts';
import { PALETTES } from './render/palettes.ts';

const deg = (rad: number) => `${((rad * 180) / Math.PI).toFixed(0)} deg`;
const num = (v: number, digits = 2) => (Number.isInteger(v) ? String(v) : v.toFixed(digits));
const KIND_NAMES = ['noise angle', 'curl'];
const PEN_FIELD = ['no edit', 'swirl', 'attract', 'repel'];
const FLOCK_PEN = ['pointer ignored', 'pointer attracts', 'pointer is a predator'];

/**
 * The live value of the main parameter of each family, one line per family, in the words the
 * EXPLAINER uses. With the extended rule the Physarum line names the presets, because the sensor
 * numbers then come from them and vary with the trail under each agent.
 */
export function familyReadout(p: PhysarumParams): string {
  const lines: string[] = [];
  if (p.physarumOn) {
    lines.push(
      p.mode === MODE_EXTENDED
        ? `Physarum (extended): background preset ${p.backgroundPreset}, pen preset ${p.penPreset}, pen radius ${num(p.penRadius)}, inertia ${num(p.inertia)}, decay ${num(p.decay)}, respawn ${num(p.respawnRate, 4)}`
        : `Physarum (classic): sensor distance ${num(p.sensorDistance, 1)} px, sensor angle ${deg(p.sensorAngle)}, turn ${deg(p.rotationAngle)}, move ${num(p.moveDistance, 1)} px, decay ${num(p.decay)}, deposit ${num(p.depositFactor, 3)}, respawn ${num(p.respawnRate, 4)}`,
    );
  } else {
    lines.push('Physarum: off');
  }
  lines.push(
    p.followerCount > 0
      ? `Followers: force ${num(p.followerForce, 3)}, speed ${num(p.followerSpeed, 1)}, look-ahead ${num(p.followerLookahead, 0)} steps, field ${KIND_NAMES[p.fieldKind] ?? p.fieldKind} at ${num(p.fieldFrequency, 1)} per screen height, drift ${num(p.fieldEvolution)}, strength ${num(p.fieldStrength)}, pen ${PEN_FIELD[p.penFieldMode] ?? p.penFieldMode}`
      : 'Followers: off',
  );
  lines.push(
    p.flockCount > 0
      ? `Boids: separation ${num(p.flockSepWeight)} (radius ${num(p.flockSepRadius, 0)}), alignment ${num(p.flockAliWeight)}, cohesion ${num(p.flockCohWeight)} (radius ${num(p.flockNbrRadius, 0)}), view ${deg(p.flockFov)}, force ${num(p.flockForce, 3)}, speed ${num(p.flockSpeed, 1)}, ${FLOCK_PEN[p.flockPenMode] ?? p.flockPenMode} x${num(p.flockPenStrength)}`
      : 'Boids: off',
  );
  lines.push(
    `Coupling: flow to Physarum ${num(p.flowToPhysarum)}, trail to boids ${num(p.trailToBoids)}; look: palette ${PALETTES[Math.floor(p.palette)]?.name ?? p.palette}, change tint ${num(p.changeColour)}, display gain ${num(p.displayGain, 1)}`,
  );
  return lines.join('\n');
}

/** Words of the probe buffer, named (the layout is documented in move.wgsl). */
export interface Probe {
  agent: number;
  step: number;
  x: number;
  y: number;
  heading: number;
  S: number;
  sensorDistance: number;
  sensorAngle: number;
  rotationAngle: number;
  moveDistance: number;
  plus: { x: number; y: number; reading: number };
  middle: { x: number; y: number; reading: number };
  minus: { x: number; y: number; reading: number };
  turn: number;
  nextX: number;
  nextY: number;
}

/** The probe buffer as an object, or null when nothing has been written yet (word 1 is the step plus one). */
export function readProbeWords(w: ArrayLike<number>): Probe | null {
  if (!(w[1] >= 1)) return null;
  return {
    agent: w[0], step: w[1] - 1, x: w[2], y: w[3], heading: w[4], S: w[5],
    sensorDistance: w[6], sensorAngle: w[7], rotationAngle: w[8], moveDistance: w[9],
    plus: { x: w[10], y: w[11], reading: w[12] },
    middle: { x: w[13], y: w[14], reading: w[15] },
    minus: { x: w[16], y: w[17], reading: w[18] },
    turn: w[19], nextX: w[22], nextY: w[23],
  };
}

/**
 * What the followed agent perceived and decided, in the order the shader does it: where it is, the
 * four numbers that govern it, the three readings, and the turn. The reason for a decision is
 * stated from the readings by the same comparison the rule makes (the rule itself is in
 * reference.ts and the shaders).
 */
export function describeProbe(p: Probe | null, extended: boolean): string {
  if (!p) return 'Agent sensors: waiting for the first step (press A again to hide)';
  const { plus, middle, minus } = p;
  const r = (v: number) => v.toFixed(3);
  let decision: string;
  if (Math.abs(p.turn) > 1e-9) {
    const side = p.turn > 0 ? 'plus' : 'minus';
    const lowest = middle.reading < plus.reading && middle.reading < minus.reading;
    decision = lowest
      ? `middle is lower than both sides: turned ${deg(Math.abs(p.turn))} to the ${side} side, picked at random`
      : `turned ${deg(Math.abs(p.turn))} toward the ${side} side, the higher reading`;
  } else if (middle.reading > plus.reading && middle.reading > minus.reading) {
    decision = 'middle is strictly highest: kept its heading';
  } else {
    decision = 'no side stands out (equal readings, for example on empty ground): kept its heading';
  }
  return [
    `Agent ${p.agent.toFixed(0)} at (${p.x.toFixed(1)}, ${p.y.toFixed(1)}) px, heading ${deg(((p.heading % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI))}  (key A again to hide)`,
    `sensor distance ${p.sensorDistance.toFixed(1)} px, sensor angle ${deg(p.sensorAngle)}, turn ${deg(p.rotationAngle)}, move ${p.moveDistance.toFixed(2)} px${extended ? `, S (trail under it) ${r(p.S)}` : ''}`,
    `reads: plus side ${r(plus.reading)}, middle ${r(middle.reading)}, minus side ${r(minus.reading)}`,
    `decision: ${decision}`,
    `moved to (${p.nextX.toFixed(1)}, ${p.nextY.toFixed(1)}) px`,
  ].join('\n');
}

export const VIEW_NAMES = ['picture', 'trail (raw)', 'delayed trail', 'change (growing green, fading magenta)', 'agents per pixel'] as const;

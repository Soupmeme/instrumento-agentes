// CPU reference of the two coupling channels that change how agents MOVE (SPEC 6). The third
// channel, "who writes the trail", is the deposit pass (each family's weight) and needs no code
// here. The GPU versions are flowBiasedHeading in flow_bias.wgsl and the trail term in flock.wgsl.
//
// Every channel is a "how strongly does X perceive Y" scalar, which is what the brief calls
// intervening on perception. Both are written as steering, so they reuse the library's one line:
//     steer = limit(desired - velocity, maxForce)
// and both stay silent (return the input unchanged) when there is nothing to perceive, instead
// of returning a zero desired velocity, which would brake the agent.

import { steerToward, type Vec2 } from '../steering/steering.ts';

/**
 * Flow -> Physarum. How strong the flow's pull is at weight 1, as a fraction of the agent's own
 * step length: at weight 1 an agent may change its velocity by a quarter of a step per step, which
 * turns it by at most about 14 degrees toward the field. A Physarum agent's own turn is about 45,
 * but the flow pulls the same way every step while the trail's turns alternate, so the flow wins
 * much more easily than the numbers suggest (measured in M5: a first value of 0.5 collapsed the
 * network at weight 1, so the slider's range was moved to this one). (Steering works on the difference
 * between desired and current velocity, so an agent heading straight against the field is mostly
 * slowed, not turned, and a constant-speed agent ignores that: the flow bends agents that are
 * sideways to it, which is exactly the veins that cross it.)
 */
export const FLOW_FORCE = 0.25;

/**
 * The heading of a Physarum agent after the flow has bent it. The agent has a velocity of length
 * `moveDistance` along `heading`; the field gives a direction; the steering rule applies a
 * force of at most weight * FLOW_FORCE * moveDistance toward moving along the field.
 * `field` is the field vector at the agent (null, or zero length: nothing to follow).
 */
export function flowBiasedHeading(heading: number, moveDistance: number, field: Vec2 | null, weight: number): number {
  if (weight <= 0 || !field) return heading;
  const len = Math.hypot(field[0], field[1]);
  if (len < 1e-6) return heading;
  const vel: Vec2 = [Math.cos(heading) * moveDistance, Math.sin(heading) * moveDistance];
  const desired: Vec2 = [(field[0] / len) * moveDistance, (field[1] / len) * moveDistance];
  const steer = steerToward(desired, vel, weight * FLOW_FORCE * moveDistance);
  return Math.atan2(vel[1] + steer[1], vel[0] + steer[0]);
}

/** Trail -> boids. How far from the boid the trail is compared on each side to get a gradient (pixels). */
export const TRAIL_SENSE_PX = 8;

/**
 * The trail's gradient at a position: the trail a little to the right minus a little to the left,
 * and below minus above (nearest pixel, wrapping). It points uphill. `trailAt(ix, iy)` reads one
 * pixel of the trail. A boid perceives only this one vector, not the trail picture.
 */
export function trailGradient(trailAt: (ix: number, iy: number) => number, pos: Vec2, sense: number, width: number, height: number): Vec2 {
  const wrap = (v: number, n: number) => ((v % n) + n) % n;
  const read = (x: number, y: number) => trailAt(wrap(Math.floor(x), width), wrap(Math.floor(y), height));
  return [
    read(pos[0] + sense, pos[1]) - read(pos[0] - sense, pos[1]),
    read(pos[0], pos[1] + sense) - read(pos[0], pos[1] - sense),
  ];
}

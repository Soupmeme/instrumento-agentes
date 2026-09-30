// Flow -> Physarum coupling (SPEC 6.1). The CPU twin is flowBiasedHeading in coupling.ts.
// Prepended after common.wgsl, steering.wgsl and field_sample.wgsl in the two Physarum agent
// shaders, which declare the field buffer and fieldDims().
//
// What the agent perceives here: one more thing, the flow field's direction at its own position.
// How it acts: steering. Its velocity is its heading times its step length; the field gives a
// desired velocity of the same length; the force is limited to weight * 0.25 step lengths:
//     steer = limit(desired - velocity, flowBias * FLOW_FORCE * stepLength)
// so at weight 1 the flow can turn an agent by about 14 degrees per step, against a Physarum
// agent's own 45 or so (the flow pulls the same way every step, so it is stronger than that
// sounds), and at weight 0 it does nothing. An agent with a zero field (strength 0)
// or no field is left alone instead of being asked to stop.

const FLOW_FORCE: f32 = 0.25;

fn flowBiasedHeading(heading: f32, stepLength: f32, posPx: vec2f, size: vec2f) -> f32 {
  if (params.flowBias <= 0.0) { return heading; }
  let f = fieldAt(posPx / size);
  let len = length(f);
  if (len < 0.000001) { return heading; }
  let vel = vec2f(cos(heading), sin(heading)) * stepLength;
  let desired = f / len * stepLength;
  let steer = steerToward(desired, vel, params.flowBias * FLOW_FORCE * stepLength);
  let nv = vel + steer;
  return atan2(nv.y, nv.x);
}

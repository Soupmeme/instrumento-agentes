// Steering library (Reynolds, "Steering Behaviors For Autonomous Characters", 1999; Nature of
// Code chapter 5). Shared by every agent family that steers: the flow followers now, the
// flock (milestone M4) next. Prepended as text to those shaders (WGSL has no includes).
// The CPU twin is src/steering/steering.ts; keep the two in step.
//
// The one idea behind every behaviour here: an agent has a velocity, it wants a DESIRED
// velocity, and the force it applies is the difference between the two, capped at maxForce:
//
//     steer = limit(desired - velocity, maxForce)
//
// A behaviour is nothing but a rule for choosing `desired`. Because the force is capped, an
// agent cannot change direction instantly: it turns as sharply as maxForce allows. Adding the
// field vector straight to the acceleration (as some sketches do) is not steering, it ignores
// the current velocity.
//
// A behaviour with nothing to say must NOT return a zero desired velocity (that would brake the
// agent to a stop). Behaviours that can be silent are simply not applied by the caller.

/** Shorten v to at most maxLen, keeping its direction. */
fn limitLength(v: vec2f, maxLen: f32) -> vec2f {
  let l = length(v);
  if (l > maxLen && l > 0.0) { return v * (maxLen / l); }
  return v;
}

/** v with length exactly len (a zero vector stays zero). */
fn withLength(v: vec2f, len: f32) -> vec2f {
  let l = length(v);
  if (l == 0.0) { return vec2f(0.0); }
  return v * (len / l);
}

/** The steering force: what to add to the velocity, given what the agent wants. */
fn steerToward(desired: vec2f, velocity: vec2f, maxForce: f32) -> vec2f {
  return limitLength(desired - velocity, maxForce);
}

/** Shortest offset from a to b on a world that wraps at `size` on both axes. */
fn wrappedOffset(a: vec2f, b: vec2f, size: vec2f) -> vec2f {
  var d = b - a;
  d = d - size * round(d / size);
  return d;
}

/** Seek: run straight at the target at full speed. */
fn seekDesired(offsetToTarget: vec2f, maxSpeed: f32) -> vec2f {
  return withLength(offsetToTarget, maxSpeed);
}

/** Flee: the opposite of seek. */
fn fleeDesired(offsetToTarget: vec2f, maxSpeed: f32) -> vec2f {
  return -withLength(offsetToTarget, maxSpeed);
}

/** Arrive: like seek, but inside slowRadius the desired speed falls linearly to zero. */
fn arriveDesired(offsetToTarget: vec2f, maxSpeed: f32, slowRadius: f32) -> vec2f {
  let d = length(offsetToTarget);
  var speed = maxSpeed;
  if (d < slowRadius) { speed = maxSpeed * d / slowRadius; }
  return withLength(offsetToTarget, speed);
}

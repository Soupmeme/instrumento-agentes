// Agent pass, one thread per agent: sense, turn, move, deposit (SPEC 5.1, classic algorithm).
// The CPU twin of this file is reference.ts; keep the two in step.
//
// What an agent perceives: the trail value at three single pixels, at distance SD ahead of
// it, one straight ahead and two rotated by +SA and -SA. Nothing else. It does not see other
// agents, only what they left behind in the trail. That indirection (agents write to a shared
// field, agents read the field) is what produces the emergent network.
//
// How it computes its action: compare the three readings (F, L, R) and turn by RA toward the
// higher one, then step forward by MD. Then it adds itself to the per-pixel counter.
// With the flow -> Physarum coupling on it also perceives the flow field's direction at its own
// position and is steered a little toward it after the turn.

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read_write> agents: array<Agent>;
@group(0) @binding(2) var<storage, read> trail: array<f32>;
@group(0) @binding(3) var<storage, read_write> counter: array<atomic<u32>>;
@group(0) @binding(4) var<storage, read> field: array<vec2f>; // flow field, read when flowBias > 0

fn fieldDims() -> vec2u { return vec2u(params.fieldW, params.fieldH); }

// Trail value under a sensor placed SD pixels from `p` in direction `angle`.
// Nearest pixel, no interpolation (as in the reference); the world wraps like a torus.
fn sense(p: vec2f, angle: f32) -> f32 {
  let q = p + vec2f(cos(angle), sin(angle)) * params.sensorDistance;
  let w = i32(params.width);
  let h = i32(params.height);
  // The double modulo makes negative coordinates wrap correctly (WGSL % keeps the sign).
  let x = ((i32(floor(q.x)) % w) + w) % w;
  let y = ((i32(floor(q.y)) % h) + h) % h;
  return trail[u32(y) * params.width + u32(x)];
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3u, @builtin(num_workgroups) nwg: vec3u) {
  let i = linearIndex(gid, nwg);
  if (i >= params.agentCount) { return; }

  var a = agents[i];
  // Per agent, per step random stream.
  var s = pcg((i * 747796405u) ^ pcg(params.frame + params.seed * 2654435761u));

  // Respawn: when progress reaches 1 the agent teleports to a random place and heading.
  a.progress += params.respawnRate;
  if (a.progress >= 1.0) {
    a.progress -= 1.0;
    s = pcg(s); a.pos.x = to01(s);
    s = pcg(s); a.pos.y = to01(s);
    s = pcg(s); a.heading = to01(s) * TAU;
  }

  let size = vec2f(f32(params.width), f32(params.height));
  var p = a.pos * size; // work in pixels

  // 1. Sense.
  let f = sense(p, a.heading);
  let l = sense(p, a.heading + params.sensorAngle);
  let r = sense(p, a.heading - params.sensorAngle);

  // 2. Turn (the classic rule).
  if (f > l && f > r) {
    // Middle strictly highest: keep going straight.
  } else if (f < l && f < r) {
    // Middle lower than both sides: pick a side at random.
    s = pcg(s);
    if (to01(s) < 0.5) { a.heading += params.rotationAngle; } else { a.heading -= params.rotationAngle; }
  } else if (l > r) {
    a.heading += params.rotationAngle; // toward the higher side
  } else if (r > l) {
    a.heading -= params.rotationAngle;
  }
  // (l == r and the middle is not an extreme: no preference, keep heading.)

  // 2b. Coupling: the flow field bends the heading (steering, see flow_bias.wgsl). Off at weight 0.
  a.heading = flowBiasedHeading(a.heading, params.moveDistance, p, size);
  a.heading = a.heading - TAU * floor(a.heading / TAU); // keep in [0, 2pi) so precision stays high

  // 3. Move, wrapping around the world.
  p += vec2f(cos(a.heading), sin(a.heading)) * params.moveDistance;
  p = p - size * floor(p / size);

  // 4. Deposit: count this agent in its pixel. The trail is updated from the counts later.
  let ix = min(u32(p.x), params.width - 1u);
  let iy = min(u32(p.y), params.height - 1u);
  atomicAdd(&counter[iy * params.width + ix], 1u);

  // p / size can round up to exactly 1.0 when p is within about 6e-5 px of the far edge
  // (seen twice in 4 million samples). Keep positions strictly inside [0, 1) as documented.
  // 0.99999994 is the largest f32 below 1.
  a.pos = min(p / size, vec2f(0.99999994));
  agents[i] = a;
}

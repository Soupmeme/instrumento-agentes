// Flow follower pass, one thread per follower. The CPU twin is stepFollower in flowfield.ts.
// This shader is concatenated after common.wgsl, steering.wgsl and flow_common.wgsl.
//
// What a follower perceives: the flow field vector at one place, its own position, or, if
// `lookahead` is above 0, the place it will reach in that many steps if it keeps its velocity
// (Reynolds' prediction). The field is interpolated between its cells. Nothing else: not other
// agents, not the trail.
//
// How it computes its action (steering, Reynolds / Nature of Code chapter 5):
//     desired  = fieldVector * maxSpeed          the rule that consults the field
//     steer    = limit(desired - velocity, maxForce)
//     velocity = limit(velocity + steer, maxSpeed)
//     position = position + velocity
// The field says WHICH WAY to go; the steering rule decides HOW the agent gets there. A low
// maxForce makes it turn wide and lazily, a high one makes it snap onto the field.
//
// Then it adds itself to its own per-pixel counter. The deposit pass turns that counter into
// trail with its own weight, so followers draw into the same material as the Physarum agents.

@group(0) @binding(0) var<uniform> flow: Flow;
@group(0) @binding(1) var<storage, read_write> vehicles: array<vec4f>; // xy position 0..1, zw velocity px/step
@group(0) @binding(2) var<storage, read> field: array<vec2f>;
@group(0) @binding(3) var<storage, read_write> counter: array<atomic<u32>>;

fn cellAt(x: i32, y: i32) -> vec2f {
  let w = i32(flow.fieldW);
  let h = i32(flow.fieldH);
  let xi = ((x % w) + w) % w;
  let yi = ((y % h) + h) % h;
  return field[u32(yi) * flow.fieldW + u32(xi)];
}

// Field vector at a normalised position, interpolated between the four nearest cells. Vector
// interpolation (not angle interpolation) has no wrap-around problem at 0 / 2pi. The world wraps.
fn fieldAt(n: vec2f) -> vec2f {
  let cells = vec2f(f32(flow.fieldW), f32(flow.fieldH));
  let g = (n - floor(n)) * cells - 0.5;
  let b = floor(g);
  let f = g - b;
  let x0 = i32(b.x);
  let y0 = i32(b.y);
  let top = mix(cellAt(x0, y0), cellAt(x0 + 1, y0), f.x);
  let bottom = mix(cellAt(x0, y0 + 1), cellAt(x0 + 1, y0 + 1), f.x);
  return mix(top, bottom, f.y);
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3u, @builtin(num_workgroups) nwg: vec3u) {
  let i = linearIndex(gid, nwg);
  if (i >= flow.followerCount) { return; }

  var v = vehicles[i];
  var s = pcg((i * 747796405u) ^ pcg(flow.frame + flow.seed * 2654435761u));

  // Respawn: now and then a follower teleports to a random place, at rest. Without it,
  // followers gather along the field's sinks and the picture empties out elsewhere.
  s = pcg(s);
  if (to01(s) < flow.respawn) {
    s = pcg(s); v.x = to01(s);
    s = pcg(s); v.y = to01(s);
    v.z = 0.0;
    v.w = 0.0;
  }

  let size = vec2f(f32(flow.gridW), f32(flow.gridH));
  var p = v.xy * size;
  var vel = v.zw;

  let ahead = p + vel * flow.lookahead;
  let desired = fieldAt(ahead / size) * flow.maxSpeed;
  let force = steerToward(desired, vel, flow.maxForce);
  vel = limitLength(vel + force, flow.maxSpeed);
  p = p + vel;
  p = p - size * floor(p / size); // wrap around the world

  let ix = min(u32(p.x), flow.gridW - 1u);
  let iy = min(u32(p.y), flow.gridH - 1u);
  atomicAdd(&counter[iy * flow.gridW + ix], 1u);

  vehicles[i] = vec4f(min(p / size, vec2f(0.99999994)), vel);
}

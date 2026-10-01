// Pick the agent (or boid) nearest to a point, on the GPU (debug overlays, keys A and G).
// Both agents and boids store their position first, normalised to 0..1, in a 16-byte item, so one
// shader serves both. Two passes, so the answer does not depend on thread order:
//   pickDistance: every item takes an atomicMin of its squared distance to the point (as raw bits:
//             for non-negative floats the bit pattern grows with the value)
//   pickIndex:    the items whose distance equals that minimum take an atomicMin of their index, so a
//             tie goes to the lowest index
// Distances are in simulation pixels and wrap around the world, like every other perception.

struct PickParams {
  aim: vec2f,      // 0..1 across the world
  size: vec2f,     // world size in pixels
  count: u32,      // items that are awake
  pad0: u32,
  pad1: u32,
  pad2: u32,
}

@group(0) @binding(0) var<uniform> pick: PickParams;
@group(0) @binding(1) var<storage, read> items: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> best: array<atomic<u32>>; // [0] smallest squared distance (bits), [1] its lowest index

fn distanceSquared(i: u32) -> f32 {
  var d = (items[i].xy - pick.aim) * pick.size;
  d = d - pick.size * round(d / pick.size);
  return dot(d, d);
}

@compute @workgroup_size(256)
fn pickDistance(@builtin(global_invocation_id) gid: vec3u, @builtin(num_workgroups) nwg: vec3u) {
  let i = gid.x + gid.y * nwg.x * 256u;
  if (i >= pick.count) { return; }
  atomicMin(&best[0], bitcast<u32>(distanceSquared(i)));
}

@compute @workgroup_size(256)
fn pickIndex(@builtin(global_invocation_id) gid: vec3u, @builtin(num_workgroups) nwg: vec3u) {
  let i = gid.x + gid.y * nwg.x * 256u;
  if (i >= pick.count) { return; }
  if (bitcast<u32>(distanceSquared(i)) == atomicLoad(&best[0])) { atomicMin(&best[1], i); }
}

// Scatters the boids: random positions, random headings at about cruising speed. Runs on the GPU
// (no CPU per-agent loops). Concatenated after common.wgsl and flock_common.wgsl.

@group(0) @binding(0) var<uniform> flock: Flock;
@group(0) @binding(1) var<storage, read_write> boids: array<vec4f>; // xy position 0..1, zw velocity px/step

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3u, @builtin(num_workgroups) nwg: vec3u) {
  let i = linearIndex(gid, nwg);
  if (i >= arrayLength(&boids)) { return; }
  var s = pcg(i ^ pcg(flock.seed * 2654435761u + 13u));
  s = pcg(s); let x = to01(s);
  s = pcg(s); let y = to01(s);
  s = pcg(s); let heading = to01(s) * TAU;
  s = pcg(s); let speed = flock.maxSpeed * (0.5 + 0.5 * to01(s));
  boids[i] = vec4f(x, y, cos(heading) * speed, sin(heading) * speed);
}

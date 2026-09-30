// Deposit pass, one thread per pixel: turn the agent counts into trail.
//
// Bleuje's saturation: a pixel with n agents gains sqrt(n) * depositFactor, not n. So a
// crowd of agents in one spot cannot make the trail explode, and thin single-file lines still
// count for something. The count is capped at 100 for the same reason.

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> counter: array<u32>;
@group(0) @binding(2) var<storage, read_write> trail: array<f32>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= params.width || gid.y >= params.height) { return; }
  let idx = gid.y * params.width + gid.x;
  let n = f32(min(counter[idx], 100u));
  trail[idx] = trail[idx] + sqrt(n) * params.depositFactor;
}

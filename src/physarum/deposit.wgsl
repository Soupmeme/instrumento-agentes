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
  // countScale is 1 in classic mode. In extended mode it makes fewer agents leave the same
  // trail as the reference density would, so the presets (tuned on that trail) still work.
  let n = min(f32(counter[idx]) * params.countScale, 100.0);
  trail[idx] = trail[idx] + sqrt(n) * params.depositFactor;
}

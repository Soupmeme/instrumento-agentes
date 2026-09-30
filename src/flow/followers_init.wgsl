// Scatters the followers: random positions, at rest. Runs on the GPU (no CPU per-agent loops).
// Concatenated after common.wgsl and flow_common.wgsl.

@group(0) @binding(0) var<uniform> flow: Flow;
@group(0) @binding(1) var<storage, read_write> vehicles: array<vec4f>;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3u, @builtin(num_workgroups) nwg: vec3u) {
  let i = linearIndex(gid, nwg);
  if (i >= arrayLength(&vehicles)) { return; }
  var s = pcg(i ^ pcg(flow.seed * 2654435761u + 7u));
  s = pcg(s); let x = to01(s);
  s = pcg(s); let y = to01(s);
  vehicles[i] = vec4f(x, y, 0.0, 0.0);
}

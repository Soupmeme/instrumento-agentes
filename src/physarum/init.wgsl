// Seeds every agent with a random position, heading and respawn progress. Runs on the GPU
// (CLAUDE.md forbids CPU per-agent loops). Used at start and for Reset.

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read_write> agents: array<Agent>;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3u, @builtin(num_workgroups) nwg: vec3u) {
  let i = linearIndex(gid, nwg);
  if (i >= arrayLength(&agents)) { return; }

  var s = pcg(i ^ pcg(params.seed * 2654435761u + 1u));
  s = pcg(s); let x = to01(s);
  s = pcg(s); let y = to01(s);
  s = pcg(s); let heading = to01(s) * TAU;
  // Random starting progress spreads the teleports over time instead of all at once.
  s = pcg(s); let progress = to01(s);

  agents[i] = Agent(vec2f(x, y), heading, progress);
}

// Diffuse and decay pass, one thread per pixel: 3x3 box blur, then multiply by the decay.
//
// Blur spreads each deposit into its neighbours, so a line of agents becomes a soft ridge
// that agents can sense from a distance. Decay makes old paths fade. Together they set how
// far and how long an agent's trace can influence the others. The world wraps like a torus.
//
// It also keeps a delayed copy of the trail (SPEC 5.1, the colour trick): delayed = 0.8 * now +
// 0.2 * delayed. The display colours the difference between the trail and its delayed copy, so
// places where the trail is growing or fading look different from stable ones. Each pixel only
// reads and writes its own delayed value, so it is updated in place.

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> trailIn: array<f32>;
@group(0) @binding(2) var<storage, read_write> trailOut: array<f32>;
@group(0) @binding(3) var<storage, read_write> delayed: array<f32>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= params.width || gid.y >= params.height) { return; }
  let w = i32(params.width);
  let h = i32(params.height);
  let cx = i32(gid.x);
  let cy = i32(gid.y);

  var sum = 0.0;
  for (var dy = -1; dy <= 1; dy++) {
    let y = (cy + dy + h) % h;
    for (var dx = -1; dx <= 1; dx++) {
      let x = (cx + dx + w) % w;
      sum += trailIn[u32(y) * params.width + u32(x)];
    }
  }
  let idx = gid.y * params.width + gid.x;
  let now = (sum / 9.0) * params.decay;
  trailOut[idx] = now;
  delayed[idx] = 0.8 * now + 0.2 * delayed[idx];
}

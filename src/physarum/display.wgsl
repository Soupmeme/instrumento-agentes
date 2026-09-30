// Display pass: draw the trail to the canvas. One temporary palette for M1; the shared
// palette system and the delayed-trail colour trick arrive with milestone M5.
//
// The simulation grid can be smaller than the canvas, so the trail is sampled with a manual
// bilinear filter (the buffer is plain floats, there is no texture sampler to do it).

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> trail: array<f32>;

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  // One big triangle that covers the screen.
  let p = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u));
  return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}

fn trailAt(x: i32, y: i32) -> f32 {
  let w = i32(params.width);
  let h = i32(params.height);
  return trail[u32((y + h) % h) * params.width + u32((x + w) % w)];
}

fn palette(v: f32) -> vec3f {
  let c0 = vec3f(0.043, 0.051, 0.078); // same as the page background
  let c1 = vec3f(0.10, 0.28, 0.55);
  let c2 = vec3f(0.35, 0.85, 0.75);
  let c3 = vec3f(1.00, 0.97, 0.85);
  if (v < 0.35) { return mix(c0, c1, v / 0.35); }
  if (v < 0.70) { return mix(c1, c2, (v - 0.35) / 0.35); }
  return mix(c2, c3, (v - 0.70) / 0.30);
}

@fragment
fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let size = vec2f(f32(params.width), f32(params.height));
  let uv = pos.xy / vec2f(params.canvasWidth, params.canvasHeight);
  let g = uv * size - 0.5; // sample centres sit at pixel centres
  let base = floor(g);
  let fr = g - base;
  let ix = i32(base.x);
  let iy = i32(base.y);

  let t = mix(
    mix(trailAt(ix, iy), trailAt(ix + 1, iy), fr.x),
    mix(trailAt(ix, iy + 1), trailAt(ix + 1, iy + 1), fr.x),
    fr.y);

  // tanh saturates smoothly, so bright cores do not clip harshly (SPEC 7).
  return vec4f(palette(tanh(params.displayGain * t)), 1.0);
}

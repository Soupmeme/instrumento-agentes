// Display pass: draw the trail to the canvas (SPEC 7). The same three steps for every agent
// family, because the families all write the same trail:
//   1. tone: tanh(gain * trail), a smooth saturation so bright cores do not clip harshly
//   2. colour: the chosen palette (palettes.ts, prepended as PALETTE_STOPS / PALETTE_ACCENTS)
//   3. change: where the trail is growing the palette's accent colour is added, where it is
//      fading the colour darkens, judged by the trail against its delayed copy (diffuse.wgsl)
// then a faint vignette. Display only: nothing here feeds back into the simulation.
//
// The simulation grid can be smaller than the canvas, so the trail is sampled with a manual
// bilinear filter (the buffer is plain floats, there is no texture sampler to do it).

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> trail: array<f32>;
@group(0) @binding(2) var<storage, read> delayed: array<f32>;

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  // One big triangle that covers the screen.
  let p = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u));
  return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}

fn cellIndex(x: i32, y: i32) -> u32 {
  let w = i32(params.width);
  let h = i32(params.height);
  return u32((y + h) % h) * params.width + u32((x + w) % w);
}

fn trailAt(x: i32, y: i32) -> f32 { return trail[cellIndex(x, y)]; }
fn delayedAt(x: i32, y: i32) -> f32 { return delayed[cellIndex(x, y)]; }

// Colour of palette `index` at trail level v in 0..1: linear between its five stops.
fn palette(index: u32, v: f32) -> vec3f {
  let f = clamp(v, 0.0, 1.0) * 4.0;
  let i = min(u32(f), 3u);
  let base = index * 5u + i;
  return mix(PALETTE_STOPS[base], PALETTE_STOPS[base + 1u], f - f32(i));
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
  let d = mix(
    mix(delayedAt(ix, iy), delayedAt(ix + 1, iy), fr.x),
    mix(delayedAt(ix, iy + 1), delayedAt(ix + 1, iy + 1), fr.x),
    fr.y);

  // 1. tone, 2. colour
  let v = tanh(params.displayGain * t);
  var colour = palette(params.palette, v);
  var accent = PALETTE_ACCENTS[params.palette];
  // During a scene transition the palette crossfades to the next scene's palette.
  if (params.paletteMix > 0.0) {
    colour = mix(colour, palette(params.paletteB, v), params.paletteMix);
    accent = mix(accent, PALETTE_ACCENTS[params.paletteB], params.paletteMix);
  }

  // 3. change: t - d is about a fifth of how much the trail moved, and after the tone gain it is
  // typically 0.01 to 0.03 (measured in M5), so it is scaled up by 25 before tanh. Growing trail
  // glows in the accent colour (more where there is already some), fading trail darkens.
  let rate = tanh(params.displayGain * (t - d) * 25.0);
  let growing = max(rate, 0.0) * params.changeGain;
  let fading = max(-rate, 0.0) * params.changeGain;
  // Both effects are strongest in the mid-tones, where the palette has its colour: on a saturated
  // white-hot vein a tint or a darkening reads as grit (seen in M5), and in the dark there is
  // nothing to tint.
  let mid = 4.0 * v * (1.0 - v);
  colour = colour + accent * growing * mid * 0.9;
  colour = colour * (1.0 - 0.4 * fading * mid);

  // A faint vignette: the corners are a little darker, which keeps the eye on the middle.
  let r = length((uv - 0.5) * 2.0);
  colour = colour * (1.0 - params.vignette * smoothstep(0.6, 1.5, r));

  return vec4f(clamp(colour, vec3f(0.0), vec3f(1.0)), 1.0);
}

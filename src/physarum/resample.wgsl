// Carry a trail over to a grid of another size (the window became full screen, or its shape
// changed). One thread per pixel of the NEW grid reads the OLD grid at the same place on the
// screen, with a bilinear filter. Agents keep their normalised positions, so the picture only
// stretches a little and then regrows at the new size, instead of starting from black.

struct Resample {
  oldW: u32,
  oldH: u32,
  newW: u32,
  newH: u32,
}

@group(0) @binding(0) var<uniform> dims: Resample;
@group(0) @binding(1) var<storage, read> source: array<f32>;
@group(0) @binding(2) var<storage, read_write> dest: array<f32>;

fn at(x: i32, y: i32) -> f32 {
  let cx = clamp(x, 0, i32(dims.oldW) - 1);
  let cy = clamp(y, 0, i32(dims.oldH) - 1);
  return source[u32(cy) * dims.oldW + u32(cx)];
}

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= dims.newW || gid.y >= dims.newH) { return; }
  // Centre of this new pixel as a place on the screen, then as a position in the old grid.
  let uv = (vec2f(gid.xy) + 0.5) / vec2f(f32(dims.newW), f32(dims.newH));
  let p = uv * vec2f(f32(dims.oldW), f32(dims.oldH)) - 0.5;
  let base = floor(p);
  let f = p - base;
  let ix = i32(base.x);
  let iy = i32(base.y);
  let v = mix(mix(at(ix, iy), at(ix + 1, iy), f.x), mix(at(ix, iy + 1), at(ix + 1, iy + 1), f.x), f.y);
  dest[gid.y * dims.newW + gid.x] = v;
}

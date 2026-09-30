// Debug overlay: the flow field drawn as arrows, one per cell (toggle with V). Not part of the
// picture the audience is meant to see; it lets the performer (and the professor) look at the
// field as data, separately from the agents that consult it.
//
// Every arrow has the same length so the direction is easy to read; its opacity shows the
// vector's length (strength).

struct ArrowUniform {
  canvas: vec2f,
  fieldSize: vec2f,
}

@group(0) @binding(0) var<uniform> u: ArrowUniform;
@group(0) @binding(1) var<storage, read> field: array<vec2f>;

struct VOut {
  @builtin(position) position: vec4f,
  @location(0) alpha: f32,
}

@vertex
fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  let fw = u32(u.fieldSize.x);
  let cell = vec2f(f32(ii % fw), f32(ii / fw));
  let centre = (cell + 0.5) / u.fieldSize * u.canvas; // pixels
  let cellPx = u.canvas.x / u.fieldSize.x;

  let v = field[ii];
  let mag = length(v);
  var dir = vec2f(1.0, 0.0);
  if (mag > 1e-5) { dir = v / mag; }
  let perp = vec2f(-dir.y, dir.x);

  let halfLen = cellPx * 0.42;
  let tail = centre - dir * halfLen;
  let tip = centre + dir * halfLen;
  let neck = tip - dir * halfLen * 0.55;
  let w = 1.1;                 // half width of the shaft, pixels
  let hw = halfLen * 0.3;      // half width of the head

  // 9 vertices: a shaft quad (2 triangles), then the head (1 triangle).
  var p: vec2f;
  switch (vi) {
    case 0u: { p = tail + perp * w; }
    case 1u: { p = tail - perp * w; }
    case 2u: { p = neck + perp * w; }
    case 3u: { p = neck + perp * w; }
    case 4u: { p = tail - perp * w; }
    case 5u: { p = neck - perp * w; }
    case 6u: { p = neck + perp * hw; }
    case 7u: { p = neck - perp * hw; }
    default: { p = tip; }
  }

  var out: VOut;
  out.position = vec4f(p.x / u.canvas.x * 2.0 - 1.0, 1.0 - p.y / u.canvas.y * 2.0, 0.0, 1.0);
  out.alpha = 0.3 + 0.5 * min(mag, 1.0);
  return out;
}

@fragment
fn fs(vin: VOut) -> @location(0) vec4f {
  return vec4f(1.0, 1.0, 1.0, vin.alpha);
}

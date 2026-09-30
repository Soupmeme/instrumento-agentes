// Sampling the flow field (prepended as text, WGSL has no includes). The CPU twin is sampleField
// in flowfield.ts. The including shader declares the field buffer
//     var<storage, read> field: array<vec2f>;
// and a function fieldDims() -> vec2u giving the number of cells in x and y.

fn cellAt(x: i32, y: i32) -> vec2f {
  let dims = fieldDims();
  let w = i32(dims.x);
  let h = i32(dims.y);
  let xi = ((x % w) + w) % w;
  let yi = ((y % h) + h) % h;
  return field[u32(yi) * dims.x + u32(xi)];
}

// Field vector at a normalised position, interpolated between the four nearest cells. Vector
// interpolation (not angle interpolation) has no wrap-around problem at 0 / 2pi. The world wraps.
fn fieldAt(n: vec2f) -> vec2f {
  let cells = vec2f(fieldDims());
  let g = (n - floor(n)) * cells - 0.5;
  let b = floor(g);
  let f = g - b;
  let x0 = i32(b.x);
  let y0 = i32(b.y);
  let top = mix(cellAt(x0, y0), cellAt(x0 + 1, y0), f.x);
  let bottom = mix(cellAt(x0, y0 + 1), cellAt(x0 + 1, y0 + 1), f.x);
  return mix(top, bottom, f.y);
}

// 3D Perlin gradient noise, used to build the flow field. The CPU twin is noise3 in
// flowfield.ts (same integer hash, same gradients, same interpolation); keep the two in step.
//
// Perlin noise: random gradient vectors sit on the integer lattice, and the value at any point
// is a smooth blend of "how far along the gradient of each corner am I" over the 8 corners of
// the cube it lies in. It is exactly 0 at lattice points, roughly in [-1, 1], and smooth.
// Three dimensions: x and y are space, z is time, so the field drifts without jumping.

fn hash3(p: vec3i) -> u32 {
  var v = bitcast<vec3u>(p);
  v = v * 1664525u + vec3u(1013904223u);
  v.x += v.y * v.z;
  v.y += v.z * v.x;
  v.z += v.x * v.y;
  v = v ^ (v >> vec3u(16u));
  v.x += v.y * v.z;
  v.y += v.z * v.x;
  v.z += v.x * v.y;
  return v.x;
}

var<private> GRADS: array<vec3f, 12> = array<vec3f, 12>(
  vec3f(1.0, 1.0, 0.0), vec3f(-1.0, 1.0, 0.0), vec3f(1.0, -1.0, 0.0), vec3f(-1.0, -1.0, 0.0),
  vec3f(1.0, 0.0, 1.0), vec3f(-1.0, 0.0, 1.0), vec3f(1.0, 0.0, -1.0), vec3f(-1.0, 0.0, -1.0),
  vec3f(0.0, 1.0, 1.0), vec3f(0.0, -1.0, 1.0), vec3f(0.0, 1.0, -1.0), vec3f(0.0, -1.0, -1.0));

fn fade(t: vec3f) -> vec3f {
  return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}

fn cornerValue(cell: vec3i, offset: vec3i, d: vec3f) -> f32 {
  let g = GRADS[hash3(cell + offset) % 12u];
  return dot(g, d - vec3f(offset));
}

fn perlin3(p: vec3f) -> f32 {
  let fl = floor(p);
  let cell = vec3i(fl);
  let d = p - fl;
  let u = fade(d);
  let n000 = cornerValue(cell, vec3i(0, 0, 0), d);
  let n100 = cornerValue(cell, vec3i(1, 0, 0), d);
  let n010 = cornerValue(cell, vec3i(0, 1, 0), d);
  let n110 = cornerValue(cell, vec3i(1, 1, 0), d);
  let n001 = cornerValue(cell, vec3i(0, 0, 1), d);
  let n101 = cornerValue(cell, vec3i(1, 0, 1), d);
  let n011 = cornerValue(cell, vec3i(0, 1, 1), d);
  let n111 = cornerValue(cell, vec3i(1, 1, 1), d);
  return mix(
    mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
    mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y),
    u.z);
}

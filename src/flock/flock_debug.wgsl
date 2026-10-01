// Flock debug overlay (toggle with G). Not part of the live vocabulary: it is for rehearsal and
// for the defense ("what does one boid see?"). Concatenated after common.wgsl and flock_common.wgsl.
//
// It draws, over the picture:
//   * the spatial grid (cells at least as wide as the largest radius)
//   * for the selected boid (the one nearest the pointer when G was pressed): its separation circle (red), its neighbour circle (green)
//     and the edges of its view cone, with the visible part of the neighbour circle tinted
//   * every boid as a small dot: the selected boid white, the boids it counts for separation
//     red, the boids it counts for alignment and cohesion green, all others dim.
// The colours use the same test as flock.wgsl (distance, then view cone), so what you see is
// what the selected boid perceives.

@group(0) @binding(0) var<uniform> flock: Flock;
@group(0) @binding(1) var<storage, read> boids: array<vec4f>;
@group(0) @binding(2) var<uniform> dbg: vec4f; // canvas width and height in pixels, then the index of the selected boid

fn worldSize() -> vec2f { return vec2f(f32(flock.gridW), f32(flock.gridH)); }

fn wrapOffset(a: vec2f, b: vec2f) -> vec2f {
  let size = worldSize();
  var d = b - a;
  d = d - size * round(d / size);
  return d;
}

// How the selected boid counts a point at offset `off`? 0 not at all, 1 for separation, 2 for alignment and cohesion.
fn relation(off: vec2f, vel: vec2f) -> u32 {
  let d2 = dot(off, off);
  let speed = length(vel);
  let reach = max(flock.sepRadius, flock.nbrRadius);
  if (d2 == 0.0 || d2 >= reach * reach) { return 0u; }
  // Separation sees all around; alignment and cohesion only inside the view cone.
  if (d2 < flock.sepRadius * flock.sepRadius) { return 1u; }
  if (speed > 0.000001 && dot(off, vel) / (sqrt(d2) * speed) < flock.cosHalfFov) { return 0u; }
  if (d2 < flock.nbrRadius * flock.nbrRadius) { return 2u; }
  return 0u;
}

@vertex
fn vsGrid(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u));
  return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}

@fragment
fn fsGrid(@builtin(position) frag: vec4f) -> @location(0) vec4f {
  let size = worldSize();
  let world = frag.xy / dbg.xy * size;
  let px = size.x / dbg.x; // simulation pixels per screen pixel
  var colour = vec4f(0.0);

  // Grid lines.
  let cell = size / vec2f(f32(flock.cellsX), f32(flock.cellsY));
  let g = world / cell;
  let lineDist = abs(fract(g + 0.5) - 0.5) * cell;
  if (min(lineDist.x, lineDist.y) < 0.6 * px) { colour = vec4f(0.6, 0.7, 1.0, 0.22); }

  // The selected boid's perception.
  let me = boids[u32(dbg.z)];
  let off = wrapOffset(me.xy * size, world);
  let d = length(off);
  let vel = me.zw;
  let speed = length(vel);

  var inCone = true;
  var halfAngle = 3.2;
  if (flock.cosHalfFov >= -1.0 && speed > 0.000001) {
    let signedAngle = atan2(vel.x * off.y - vel.y * off.x, dot(vel, off));
    halfAngle = acos(clamp(flock.cosHalfFov, -1.0, 1.0));
    inCone = abs(signedAngle) <= halfAngle;
    // Edges of the cone, out to the neighbour radius.
    if (d < flock.nbrRadius && d * abs(abs(signedAngle) - halfAngle) < 0.8 * px) { colour = vec4f(1.0, 1.0, 1.0, 0.7); }
  }
  if (d < flock.nbrRadius && inCone) { colour = vec4f(colour.rgb + vec3f(0.0, 0.25, 0.1), max(colour.a, 0.07)); }
  if (abs(d - flock.nbrRadius) < 0.8 * px) { colour = vec4f(0.2, 1.0, 0.45, 0.85); }
  if (abs(d - flock.sepRadius) < 0.8 * px) { colour = vec4f(1.0, 0.3, 0.25, 0.85); }
  return colour;
}

struct BoidOut {
  @builtin(position) pos: vec4f,
  @location(0) colour: vec4f,
  @location(1) corner: vec2f,
}

@vertex
fn vsBoid(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> BoidOut {
  var corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0),
  );
  let c = corners[vi];
  let b = boids[ii];
  let size = worldSize();
  let me = boids[u32(dbg.z)];

  var colour = vec4f(0.55, 0.65, 0.9, 0.35);
  var radius = 2.0;
  if (ii == u32(dbg.z)) {
    colour = vec4f(1.0, 1.0, 1.0, 1.0);
    radius = 5.0;
  } else {
    let r = relation(wrapOffset(me.xy * size, b.xy * size), me.zw);
    if (r == 1u) { colour = vec4f(1.0, 0.3, 0.25, 1.0); radius = 3.5; }
    if (r == 2u) { colour = vec4f(0.2, 1.0, 0.45, 1.0); radius = 3.5; }
  }

  let centre = b.xy * 2.0 - 1.0;
  let offset = c * radius * 2.0 / dbg.xy;
  var out: BoidOut;
  out.pos = vec4f(centre.x + offset.x, -centre.y + offset.y * 1.0, 0.0, 1.0);
  out.colour = colour;
  out.corner = c;
  return out;
}

@fragment
fn fsBoid(v: BoidOut) -> @location(0) vec4f {
  let r = length(v.corner);
  if (r > 1.0) { discard; }
  return vec4f(v.colour.rgb, v.colour.a * (1.0 - 0.4 * r));
}

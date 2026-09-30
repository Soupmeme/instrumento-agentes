// Shared by the flock shaders (prepended as text after common.wgsl, and steering.wgsl where used).

// Mirrors the uniform buffer written by FlockLayer.writeUniform. 24 four-byte fields, 96 bytes.
struct Flock {
  gridW: u32,          // simulation grid in pixels (boids move in these units)
  gridH: u32,
  cellsX: u32,         // spatial grid: cells per side (each cell is at least as wide as the largest radius)
  cellsY: u32,
  count: u32,          // boids awake this step
  frame: u32,
  seed: u32,
  penMode: u32,        // 0 none, 1 attract (seek), 2 predator (flee)
  maxSpeed: f32,       // pixels per step
  maxForce: f32,
  sepWeight: f32,
  aliWeight: f32,
  cohWeight: f32,
  sepRadius: f32,      // pixels
  nbrRadius: f32,      // pixels, alignment and cohesion
  cosHalfFov: f32,     // cos(view cone / 2); below -1 means no blind spot
  penX: f32,           // pen position, 0..1
  penY: f32,
  penSigma: f32,       // pen radius in screen heights
  penActive: f32,      // 1 when the pen exists
  penStrength: f32,    // weight of the pointer's force
  cellCap: u32,        // most boids of one grid cell that a boid examines (work guard, see flocking.ts)
  trailWeight: f32,    // trail -> boids coupling: weight of the steering up the trail's gradient (0 off)
  trailSense: f32,     // pixels between the two trail readings on each side of the boid
}

// Which grid cell a normalised position (0..1) falls in. The min() guards a position that
// rounds up to exactly 1.0.
fn cellCoord(n: vec2f, cells: vec2u) -> vec2u {
  return min(vec2u(n * vec2f(cells)), cells - vec2u(1u));
}

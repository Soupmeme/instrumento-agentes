// Shared by every Physarum shader (prepended as text, WGSL has no includes).

// Mirrors the uniform buffer written by Physarum.writeParams. All scalars, 28 fields = 112 bytes.
struct Params {
  width: u32,          // simulation grid size in pixels
  height: u32,
  agentCount: u32,     // agents that are awake this step
  frame: u32,          // step counter, feeds the random numbers
  seed: u32,           // user seed, feeds the random numbers (fixed in tests)
  sensorDistance: f32, // SD, pixels
  sensorAngle: f32,    // SA, radians
  rotationAngle: f32,  // RA, radians
  moveDistance: f32,   // MD, pixels
  depositFactor: f32,
  decay: f32,
  respawnRate: f32,
  displayGain: f32,
  canvasWidth: f32,    // only the display pass uses these two
  canvasHeight: f32,
  countScale: f32,     // deposit density compensation (1 in classic mode, see extended.ts)
  followerDeposit: f32, // trail left per follower (sqrt of the follower count in a pixel times this)
  boidDeposit: f32,     // trail left per boid (same role as followerDeposit)
  fieldW: u32,          // flow field cells (the Physarum agents read the field when flowBias > 0)
  fieldH: u32,
  flowBias: f32,        // flow -> Physarum coupling weight, 0..1 (see coupling.ts)
  palette: u32,         // colour palette index (display only)
  changeGain: f32,      // how strongly growing or fading trail tints the colour (display only)
  vignette: f32,        // edge darkening, 0 = none (display only)
  paletteB: u32,        // palette being faded toward during a scene transition (display only)
  paletteMix: f32,      // 0 = all `palette`, 1 = all `paletteB` (display only)
  probe: u32,           // index of the agent the sensor overlay follows, or 0xFFFFFFFF for none (debug only)
  viewMode: u32,        // display buffer view: 0 picture, 1 trail, 2 delayed trail, 3 change, 4 agents per pixel (debug only)
}

// One agent. pos is NORMALISED (0..1 across the world) so the simulation grid can be resized
// without moving agents. heading is in radians. progress climbs from 0 to 1 and, at 1, the
// agent teleports to a random place (keeps the pattern from collapsing onto a few lines).
struct Agent {
  pos: vec2f,
  heading: f32,
  progress: f32,
}

const TAU: f32 = 6.283185307179586;
const WORKGROUP: u32 = 256u;

// PCG hash: a good, cheap 32-bit random number generator. Same inputs give the same output,
// which is what makes seeded, repeatable runs possible.
fn pcg(v: u32) -> u32 {
  let s = v * 747796405u + 2891336277u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}

// u32 to a float in [0, 1). Using the top 24 bits keeps the result exactly representable, so
// it can never round up to 1.0.
fn to01(x: u32) -> f32 {
  return f32(x >> 8u) * (1.0 / 16777216.0);
}

// A one-dimensional dispatch is limited to 65535 workgroups, so large agent counts use a 2D
// dispatch. This turns the 2D thread id back into one linear agent index.
fn linearIndex(gid: vec3u, nwg: vec3u) -> u32 {
  return gid.x + gid.y * nwg.x * WORKGROUP;
}

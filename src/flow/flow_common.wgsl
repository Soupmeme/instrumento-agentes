// Shared by the flow field and follower shaders (prepended as text after common.wgsl).

// Mirrors the uniform buffer written by FlowLayer.writeUniform. 32 four-byte fields, 128 bytes.
struct Flow {
  gridW: u32,          // simulation grid in pixels (followers move in these units)
  gridH: u32,
  fieldW: u32,         // flow field cells
  fieldH: u32,
  kind: u32,           // 0 noise angle, 1 curl
  quantSteps: u32,     // 0 smooth, n = angles snapped to multiples of 2pi/n
  followerCount: u32,
  frame: u32,
  seed: u32,
  penMode: u32,        // 0 none, 1 swirl, 2 attract, 3 repel
  pad0: u32,
  pad1: u32,
  frequency: f32,      // noise features per screen height
  evolution: f32,      // noise units per second along the third (time) axis
  strength: f32,       // length of every field vector
  time: f32,           // simulation seconds
  penX: f32,           // pen position, 0..1
  penY: f32,
  penSigma: f32,       // pen radius in screen heights
  penActive: f32,      // 1 when the pen exists
  penStrength: f32,    // how much the pen edit replaces the noise at the pen
  stirX: f32,          // stir push, length 0..1
  stirY: f32,
  maxSpeed: f32,       // follower steering limits, pixels per step
  maxForce: f32,
  lookahead: f32,      // steps ahead at which the field is sampled
  respawn: f32,        // chance per step that a follower teleports to a random place
  pad2: f32,
  pad3: f32,
  pad4: f32,
  pad5: f32,
  pad6: f32,
}

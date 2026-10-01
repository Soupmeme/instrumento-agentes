// Extended agent pass ("36 Points" style), one thread per agent. A port of the move shader in
// Bleuje's web port (bleuje.com/web-interactive-physarum, CC BY-NC-SA 3.0, after Sage Jenson),
// restructured for WebGPU. The CPU twin of the core rule is extended.ts.
//
// What an agent perceives:
//   1. the trail under itself, shifted by the preset offsets SB1 and SB2, times SF. Call it S,
//      clamped to (0, 1]. It means "how much trail is here";
//   2. at a distance that depends on S, the trail at three points ahead (left, middle, right).
// It also feels, weakly, the pen (a region where another preset applies), waves passing
// through, the stir push and, when the coupling is on, the direction of the flow field. It does not see other agents, only their trail.
//
// How it computes its action:
//   - the 15-vector that describes its behaviour is a blend of the background preset and the
//     pen preset, weighted by t = exp(-d^2 / sigma^2), d = distance to the pen. Far from the
//     pen t is 0 (background rules), at the pen t is 1 (pen rules);
//   - sensor distance, sensor angle, turn angle and move distance are each A + B * S^C;
//   - turn toward the higher of the two side sensors (same rule as the classic mode);
//   - move. Optionally mix in inertia (the agent keeps some velocity), a stir push near the
//     pen, and a wave (a travelling front that raises S and adds inertia for a while).

struct Ext {
  bg: array<vec4f, 4>,     // background preset, 15 values (the 16th is unused)
  pen: array<vec4f, 4>,    // pen preset
  waves: array<vec4f, 5>,  // x, y (0..1), trigger time (s), pen sigma at trigger
  penPos: vec2f,           // 0..1 across the world
  penSigma: f32,           // pen radius as a fraction of the world height
  penActive: f32,          // 1 when the pen exists, else 0
  stir: vec2f,             // push near the pen, length 0..1 (times 5 px inside the shader)
  inertia: f32,            // 0..1
  time: f32,               // simulation seconds
  pixelScale: f32,         // distance scale of the presets
  spawnMode: u32,          // 0 none, 1 ring around the pen, 2 burst at the pen
  spawnFraction: f32,      // share of agents that teleport in a spawn step
  pad: f32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read_write> agents: array<Agent>;
@group(0) @binding(2) var<storage, read> trail: array<f32>;
@group(0) @binding(3) var<storage, read_write> counter: array<atomic<u32>>;
@group(0) @binding(4) var<uniform> ext: Ext;
@group(0) @binding(5) var<storage, read_write> velocities: array<vec2f>;
@group(0) @binding(6) var<storage, read> field: array<vec2f>; // flow field, read when flowBias > 0
@group(0) @binding(7) var<storage, read_write> probe: array<f32>; // what the selected agent perceived and decided (sensor overlay, debug)

fn fieldDims() -> vec2u { return vec2u(params.fieldW, params.fieldH); }

// Smooth value noise in 3 dimensions (x, y, time). Same construction as the reference: a
// hash-based random number at each integer lattice point, smoothly interpolated. It gives the
// pen edge a slowly moving wobble and makes the stir push uneven.
fn random3(v: vec3f) -> f32 {
  return fract(sin(dot(v, vec3f(12.9898, 78.233, 151.7182))) * 43758.5453123);
}

fn noise3(v: vec3f) -> f32 {
  let cell = floor(v);
  let f = fract(v);
  let a = random3(cell);
  let b = random3(cell + vec3f(1.0, 0.0, 0.0));
  let c = random3(cell + vec3f(0.0, 1.0, 0.0));
  let d = random3(cell + vec3f(1.0, 1.0, 0.0));
  let e = random3(cell + vec3f(0.0, 0.0, 1.0));
  let g = random3(cell + vec3f(1.0, 0.0, 1.0));
  let h = random3(cell + vec3f(0.0, 1.0, 1.0));
  let k = random3(cell + vec3f(1.0, 1.0, 1.0));
  let s = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(a, b, s.x), mix(c, d, s.x), s.y),
    mix(mix(e, g, s.x), mix(h, k, s.x), s.y),
    s.z);
}

// Component k (0..14) of the background or pen preset.
fn bgAt(k: u32) -> f32 { return ext.bg[k >> 2u][k & 3u]; }
fn penAt(k: u32) -> f32 { return ext.pen[k >> 2u][k & 3u]; }

// Trail value at a position, nearest pixel, wrapping like a torus.
fn gridValue(q: vec2f) -> f32 {
  let w = i32(params.width);
  let h = i32(params.height);
  let x = ((i32(floor(q.x)) % w) + w) % w;
  let y = ((i32(floor(q.y)) % h) + h) % h;
  return trail[u32(y) * params.width + u32(x)];
}

fn senseAt(p: vec2f, angle: f32, dist: f32) -> f32 {
  return gridValue(p + dist * vec2f(cos(angle), sin(angle)));
}

// One wave front: a Gaussian bump that is nonzero only behind the front (x <= 0).
fn propagatedWave(x: f32, sigma: f32) -> f32 {
  let ws = 0.15 + 0.4 * sigma;
  return select(0.0, exp(-x * x / (ws * ws)), x <= 0.0);
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3u, @builtin(num_workgroups) nwg: vec3u) {
  let i = linearIndex(gid, nwg);
  if (i >= params.agentCount) { return; }

  var a = agents[i];
  var velocity = velocities[i];
  var s = pcg((i * 747796405u) ^ pcg(params.frame + params.seed * 2654435761u));

  // Respawn: at progress 1 the agent teleports to a random place and heading.
  a.progress += params.respawnRate;
  if (a.progress >= 1.0) {
    a.progress -= 1.0;
    s = pcg(s); a.pos.x = to01(s);
    s = pcg(s); a.pos.y = to01(s);
    s = pcg(s); a.heading = to01(s) * TAU;
  }

  let size = vec2f(f32(params.width), f32(params.height));
  let aspect = size.x / size.y;
  var p = a.pos * size;
  let dir = vec2f(cos(a.heading), sin(a.heading));

  // Positions for the noise fields: aspect corrected so the noise is not stretched.
  var noisePos = a.pos;
  noisePos.x *= aspect;
  let broadNoisePos = noisePos * 6.0;
  noisePos *= 20.0;

  // Pen weight t: 1 at the pen, 0 far away. The distance is wobbled by slow noise so the
  // pen boundary is alive, and measured in units of the screen height.
  var toPen = a.pos - ext.penPos;
  toPen.x *= aspect;
  let distanceNoise = 0.9 + 0.2 * noise3(vec3f(broadNoisePos, 0.6 * ext.time));
  let d = length(toPen) * distanceNoise;
  let t = ext.penActive * exp(-d * d / (ext.penSigma * ext.penSigma));

  // Waves: up to 5 fronts, each alive for 5 seconds after it was triggered.
  var waveSum = 0.0;
  let waveNoise = 0.95 + 0.1 * noise3(vec3f(noisePos, 0.3 * ext.time));
  for (var w = 0u; w < 5u; w++) {
    let wave = ext.waves[w];
    let age = ext.time - wave.z;
    if (age <= 5.0) {
      var delta = a.pos - wave.xy;
      delta.x *= aspect;
      let waveDistance = length(delta);
      let centreAngle = atan2(delta.y, delta.x);
      let directionSign = select(-1.0, 1.0, (w % 2u) == 0u);
      let delay = -0.1 + waveDistance / 0.3 * waveNoise
        + 0.4 * pow(0.5 + 0.5 * cos(18.0 * centreAngle + 10.0 * directionSign * waveDistance), 0.3);
      let wavePosition = delay - age;
      let sigmaVariation = pow(wave.w, 0.75);
      waveSum += 0.6 * propagatedWave(wavePosition, wave.w)
        * max(0.0, 1.0 - 0.3 * waveDistance / sigmaVariation * waveNoise);
    }
  }
  waveSum = 1.7 * tanh(waveSum / 1.7) + 0.4 * tanh(4.0 * waveSum);

  // S: how much trail is under this agent. A wave makes it feel a little denser.
  let sensorScale = mix(bgAt(14u), penAt(14u), t) * (1.0 + 0.3 * waveSum);
  let bias1 = mix(bgAt(12u), penAt(12u), t);
  let bias2 = mix(bgAt(13u), penAt(13u), t);
  let S = clamp(gridValue(p + bias2 * dir + vec2f(0.0, bias1)) * sensorScale, 1e-9, 1.0);

  // The four behaviour parameters, each A + B * S^C, blended between the two presets.
  let sensorDistance = mix(bgAt(0u), penAt(0u), t)
    + mix(bgAt(2u), penAt(2u), t) * pow(S, mix(bgAt(1u), penAt(1u), t)) * ext.pixelScale;
  let sensorAngle = mix(bgAt(3u), penAt(3u), t)
    + mix(bgAt(5u), penAt(5u), t) * pow(S, mix(bgAt(4u), penAt(4u), t));
  let rotationAngle = mix(bgAt(6u), penAt(6u), t)
    + mix(bgAt(8u), penAt(8u), t) * pow(S, mix(bgAt(7u), penAt(7u), t));
  let moveDistance = mix(bgAt(9u), penAt(9u), t)
    + mix(bgAt(11u), penAt(11u), t) * pow(S, mix(bgAt(10u), penAt(10u), t)) * ext.pixelScale;

  // Sense three points ahead and turn toward the higher side.
  let left = senseAt(p, a.heading - sensorAngle, sensorDistance);
  let middle = senseAt(p, a.heading, sensorDistance);
  let right = senseAt(p, a.heading + sensorAngle, sensorDistance);
  var heading = a.heading;
  var turn = 0.0;
  if (middle > left && middle > right) {
    // straight ahead wins: keep the heading
  } else if (middle < left && middle < right) {
    s = pcg(s);
    if (to01(s) < 0.5) { turn = -rotationAngle; } else { turn = rotationAngle; }
  } else if (right < left) {
    turn = -rotationAngle;
  } else if (left < right) {
    turn = rotationAngle;
  }
  heading += turn;

  // Coupling: the flow field bends the heading (steering, see flow_bias.wgsl). Off at weight 0.
  heading = flowBiasedHeading(heading, moveDistance, p, size);

  // Stir: near the pen, a noisy push in the drag direction.
  let moveNoise = noise3(vec3f(noisePos, 0.8 * ext.time));
  let moveBias = 5.0 * t * moveNoise * ext.stir;
  let newDir = vec2f(cos(heading), sin(heading));
  let classicPosition = p + moveDistance * newDir + moveBias;

  // Inertia: the agent keeps 98% of its velocity and adds its heading each step. Waves also
  // pull agents toward this smoother motion, which is what makes a wave look like a swell.
  velocity *= 0.98;
  velocity += newDir + 0.2 * ext.inertia * moveBias;
  let dt = 0.07 * pow(moveDistance, 1.4);
  let inertiaPosition = p + dt * velocity + moveBias;
  var next = mix(classicPosition, inertiaPosition, 0.6 * ext.inertia + 0.8 * waveSum);

  // Spawn burst: a fraction of the agents teleport around (or onto) the pen for this step.
  if (ext.spawnMode > 0u) {
    s = pcg(s);
    if (to01(s) < ext.spawnFraction) {
      s = pcg(s); let r1 = to01(s);
      s = pcg(s); let theta = to01(s) * TAU;
      let penPx = ext.penPos * size;
      if (ext.spawnMode == 1u) {
        let radius = ext.penSigma * 0.55 * (0.95 + 0.1 * r1) * size.y;
        next = penPx + radius * vec2f(cos(theta), sin(theta));
      } else {
        let radius = ext.penSigma * 0.2 * sqrt(r1) * size.y;
        next = penPx + radius * vec2f(cos(theta), sin(theta));
      }
    }
  }

  next = next - size * floor(next / size); // wrap around the world
  heading = heading - TAU * floor(heading / TAU);

  let ix = min(u32(next.x), params.width - 1u);
  let iy = min(u32(next.y), params.height - 1u);
  atomicAdd(&counter[iy * params.width + ix], 1u);

  // Sensor overlay (debug, key A): the selected agent writes down what it sensed and decided.
  // Same layout as move.wgsl: the sensors are named by their side of the heading (plus = heading +
  // SA, which is the "right" reading here), and word 5 is S, the trail under the agent.
  if (i == params.probe) {
    let h0 = a.heading;
    probe[0] = f32(i);
    probe[1] = f32(params.frame + 1u);
    probe[2] = p.x; probe[3] = p.y; probe[4] = h0; probe[5] = S;
    probe[6] = sensorDistance; probe[7] = sensorAngle; probe[8] = rotationAngle; probe[9] = moveDistance;
    let plus = p + vec2f(cos(h0 + sensorAngle), sin(h0 + sensorAngle)) * sensorDistance;
    let mid = p + vec2f(cos(h0), sin(h0)) * sensorDistance;
    let minus = p + vec2f(cos(h0 - sensorAngle), sin(h0 - sensorAngle)) * sensorDistance;
    probe[10] = plus.x; probe[11] = plus.y; probe[12] = right;
    probe[13] = mid.x; probe[14] = mid.y; probe[15] = middle;
    probe[16] = minus.x; probe[17] = minus.y; probe[18] = left;
    probe[19] = turn;
    probe[22] = next.x; probe[23] = next.y;
  }

  a.pos = min(next / size, vec2f(0.99999994));
  a.heading = heading;
  agents[i] = a;
  velocities[i] = velocity;
}

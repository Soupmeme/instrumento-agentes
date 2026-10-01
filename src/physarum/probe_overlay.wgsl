// Sensor overlay (debug, key A): draws what one Physarum agent perceives and decides, over the
// picture. The numbers are not recomputed here: the agent pass writes them into the probe buffer
// while it runs (move.wgsl, move_extended.wgsl), so what you see is exactly what the shader used.
// Concatenated after common.wgsl.
//
//   white ring and tick   the agent and its heading
//   three discs           the three sensors, each ahead of the agent at the sensor distance, one
//                         along the heading and two rotated by plus and minus the sensor angle.
//                         The disc is brighter the more trail the sensor reads.
//   green ring            the sensor the agent turned toward (none: it kept its heading)
//   dashed line           from the agent to its next position
//
// The words of the probe buffer are listed in move.wgsl.

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> probe: array<f32>;

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u));
  return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}

// Distance in screen pixels from `aim` (world pixels) to the fragment, taking the shortest way
// around the wrapping world.
fn screenDistance(frag: vec2f, aim: vec2f, worldToScreen: vec2f, size: vec2f) -> f32 {
  var d = frag / worldToScreen - aim;
  d = d - size * round(d / size);
  return length(d * worldToScreen);
}

fn ring(dist: f32, radius: f32) -> f32 { return 1.0 - smoothstep(0.0, 1.2, abs(dist - radius)); }
fn disc(dist: f32, radius: f32) -> f32 { return 1.0 - smoothstep(radius - 1.0, radius, dist); }

@fragment
fn fs(@builtin(position) frag: vec4f) -> @location(0) vec4f {
  if (probe[1] < 0.5) { return vec4f(0.0); } // nothing written yet
  let size = vec2f(f32(params.width), f32(params.height));
  let worldToScreen = vec2f(params.canvasWidth, params.canvasHeight) / size;
  let f = frag.xy;
  // Marker sizes grow with the canvas, so the overlay stays legible on a projector (700 px high is 1).
  let u = max(1.0, params.canvasHeight / 700.0);

  let me = vec2f(probe[2], probe[3]);
  let heading = probe[4];
  let turn = probe[19];
  var colour = vec3f(0.0);
  var alpha = 0.0;

  // The three sensors: plus (heading + SA), middle, minus (heading - SA).
  var reading = array<f32, 3>(probe[12], probe[15], probe[18]);
  var spot = array<vec2f, 3>(vec2f(probe[10], probe[11]), vec2f(probe[13], probe[14]), vec2f(probe[16], probe[17]));
  // Which one the agent turned toward: the sign of the turn picks plus or minus, none keeps going.
  var chosen = 1u;
  if (turn > 1e-6) { chosen = 0u; }
  if (turn < -1e-6) { chosen = 2u; }
  for (var k = 0u; k < 3u; k = k + 1u) {
    let d = screenDistance(f, spot[k], worldToScreen, size);
    // Brightness: the reading as the picture shows it (same tone curve), so a bright disc is a vein.
    let tone = tanh(params.displayGain * reading[k]);
    let fill = disc(d, 4.5 * u);
    colour = mix(colour, vec3f(0.15 + 0.85 * tone), fill);
    alpha = max(alpha, fill * (0.45 + 0.5 * tone));
    let outline = ring(d, 6.5 * u);
    if (k == chosen && chosen != 1u) {
      colour = mix(colour, vec3f(0.25, 1.0, 0.45), outline);
      alpha = max(alpha, outline);
    } else if (k == 1u && chosen == 1u) {
      colour = mix(colour, vec3f(0.25, 1.0, 0.45), outline * 0.8);
      alpha = max(alpha, outline * 0.8);
    } else {
      colour = mix(colour, vec3f(0.6, 0.65, 0.8), outline * 0.6);
      alpha = max(alpha, outline * 0.6);
    }
  }

  // Lines from the agent to its sensors, and a faint circle at the sensor distance: the geometry stays
  // readable even when the sensors are only a few pixels from the agent.
  var relMe = f / worldToScreen - me;
  relMe = relMe - size * round(relMe / size);
  relMe = relMe * worldToScreen;
  for (var k = 0u; k < 3u; k = k + 1u) {
    let reach = (spot[k] - me) * worldToScreen;
    let along = clamp(dot(relMe, reach) / max(dot(reach, reach), 1e-6), 0.0, 1.0);
    let line = 1.0 - smoothstep(0.4 * u, 1.4 * u, length(relMe - reach * along));
    let lineColour = select(vec3f(0.6, 0.65, 0.8), vec3f(0.25, 1.0, 0.45), k == chosen);
    colour = mix(colour, lineColour, line * 0.7);
    alpha = max(alpha, line * 0.7);
  }
  let sdRing = ring(length(relMe), length(probe[6] * worldToScreen));
  colour = mix(colour, vec3f(0.6, 0.65, 0.8), sdRing * 0.35);
  alpha = max(alpha, sdRing * 0.35);

  // The agent: a ring and a short tick along its heading.
  let dMe = screenDistance(f, me, worldToScreen, size);
  let ringMe = ring(dMe, 10.0 * u);
  colour = mix(colour, vec3f(1.0), ringMe);
  alpha = max(alpha, ringMe);
  var rel = f / worldToScreen - me;
  rel = rel - size * round(rel / size);
  rel = rel * worldToScreen;
  let tickAlong = dot(rel, vec2f(cos(heading), sin(heading)));
  let across = abs(dot(rel, vec2f(-sin(heading), cos(heading))));
  if (tickAlong > 10.0 * u && tickAlong < 22.0 * u && across < 1.0 * u) { colour = vec3f(1.0); alpha = 1.0; }

  return vec4f(colour, alpha);
}

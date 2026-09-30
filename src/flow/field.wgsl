// Flow field pass, one thread per field cell: build the field, a direction per cell.
// The CPU twin is fieldVector in flowfield.ts.
//
// THE FIELD is data: a buffer with one vector per cell (length = strength). It is rebuilt every
// step from noise, which drifts slowly with time, plus the edits the pen makes. Keeping it as
// data (not as an inline function of the agent's position) is what lets it be drawn as arrows,
// painted by the pen, and later read by other agent families.
//
// Two constructions:
//   noise angle  direction = angle from noise, mapped to 0..4pi. (Mapping to 0..2pi would prefer
//                 flowing left, because Perlin noise hugs the middle of its range. Nature of Code.)
//   curl         direction = the noise gradient turned by 90 degrees. Agents then travel along
//                 the contour lines of the noise, and the field has no sinks (nowhere they pile up).

@group(0) @binding(0) var<uniform> flow: Flow;
@group(0) @binding(1) var<storage, read_write> field: array<vec2f>;

const CURL_EPS: f32 = 0.01;

fn safeNormalize(v: vec2f, fallback: vec2f) -> vec2f {
  let l = length(v);
  if (l < 1e-5) { return fallback; }
  return v / l;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= flow.fieldW || gid.y >= flow.fieldH) { return; }

  // Cell centre in 0..1 across the world, and the noise coordinates. The world is scaled by its
  // aspect ratio so the noise is not stretched, and the third axis is time.
  let n = vec2f((f32(gid.x) + 0.5) / f32(flow.fieldW), (f32(gid.y) + 0.5) / f32(flow.fieldH));
  let aspect = f32(flow.gridW) / f32(flow.gridH);
  let px = n.x * aspect * flow.frequency;
  let py = n.y * flow.frequency;
  let z = flow.time * flow.evolution;

  var angle: f32;
  if (flow.kind == 1u) {
    let dpsiDy = perlin3(vec3f(px, py + CURL_EPS, z)) - perlin3(vec3f(px, py - CURL_EPS, z));
    let dpsiDx = perlin3(vec3f(px + CURL_EPS, py, z)) - perlin3(vec3f(px - CURL_EPS, py, z));
    let d = safeNormalize(vec2f(dpsiDy, -dpsiDx), vec2f(1.0, 0.0));
    angle = atan2(d.y, d.x);
  } else {
    let v = clamp(perlin3(vec3f(px, py, z)), -1.0, 1.0);
    angle = (0.5 + 0.5 * v) * 2.0 * TAU;
  }
  if (flow.quantSteps > 0u) {
    let q = TAU / f32(flow.quantSteps);
    angle = round(angle / q) * q;
  }
  var dir = vec2f(cos(angle), sin(angle));

  // Pen edits: near the pen the direction is blended toward the edit direction.
  var toPen = vec2f((n.x - flow.penX) * aspect, n.y - flow.penY);
  let d = length(toPen);
  let t = select(0.0, exp(-(d * d) / (flow.penSigma * flow.penSigma)), flow.penActive > 0.5);
  if (flow.penMode != 0u && t > 0.0) {
    var edit = dir;
    if (flow.penMode == 1u) { edit = safeNormalize(vec2f(-toPen.y, toPen.x), dir); }   // swirl
    if (flow.penMode == 2u) { edit = safeNormalize(-toPen, dir); }                      // attract
    if (flow.penMode == 3u) { edit = safeNormalize(toPen, dir); }                       // repel
    let w = clamp(t * flow.penStrength, 0.0, 1.0);
    dir = safeNormalize(mix(dir, edit, w), edit);
  }
  // Stir: the drag direction bends the field toward it, in proportion to the drag strength.
  let stirLen = length(vec2f(flow.stirX, flow.stirY));
  if (stirLen > 0.001 && t > 0.0) {
    let s = vec2f(flow.stirX, flow.stirY) / stirLen;
    let w = clamp(t * stirLen, 0.0, 1.0);
    dir = safeNormalize(mix(dir, s, w), s);
  }

  field[gid.y * flow.fieldW + gid.x] = dir * flow.strength;
}

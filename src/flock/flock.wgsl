// Flock pass, one thread per boid. The CPU twin is flockForces / stepBoid in flocking.ts.
// Concatenated after common.wgsl, steering.wgsl and flock_common.wgsl.
//
// What a boid perceives: the other boids within a radius, found through the spatial grid
// (flock_grid.wgsl). For alignment and cohesion only those in front of it count (inside a view
// cone centred on its velocity); separation sees all around (see flocking.ts for why). It reads their
// positions and velocities, nothing else: no leader, no global information. The exceptions: the
// shared trail, but only when the trail -> boids coupling is on, and the pointer, and only when the performer uses it.
//
// How it computes its action (Reynolds 1999, Nature of Code chapter 5). Three behaviours, each
// a rule for choosing a DESIRED velocity, each turned into a steering force with the library's
// one line, steer = limit(desired - velocity, maxForce):
//   separation  desired = away from close neighbours, nearer ones weigh more (1/d)
//   alignment   desired = the neighbours' average heading, at full speed
//   cohesion    desired = toward the neighbours' centre (seek)
// The forces are weighted and added to the velocity, then the speed is capped. The weights are
// the live controls: competition (separation) against cooperation (alignment, cohesion).
//
// The sums over neighbours use fixed-point integers. Integer addition does not depend on order,
// and the GPU visits neighbours in an arbitrary order (the grid is built with atomics), so this
// makes the flock reproducible: same seed, same flock, bit for bit. Float sums would not be.
//
// Then the boid adds itself to its own per-pixel counter, so boids draw into the shared trail
// with their own weight, like the other agent families.

@group(0) @binding(0) var<uniform> flock: Flock;
@group(0) @binding(1) var<storage, read_write> boidsIn: array<vec4f>;  // xy position 0..1, zw velocity px/step
@group(0) @binding(2) var<storage, read_write> boidsOut: array<vec4f>; // next state (a boid must not see a neighbour that already moved)
@group(0) @binding(3) var<storage, read_write> cellCount: array<u32>;
@group(0) @binding(4) var<storage, read_write> cellStart: array<u32>;
@group(0) @binding(5) var<storage, read_write> rank: array<u32>;
@group(0) @binding(6) var<storage, read_write> sortedBoids: array<vec4f>; // boid states ordered by cell (flock_grid.wgsl)
@group(0) @binding(7) var<storage, read_write> counter: array<atomic<u32>>;
@group(0) @binding(8) var<storage, read_write> trail: array<f32>; // the shared trail, read for the trail -> boids coupling

// Trail value at a position in pixels: nearest pixel, the world wraps.
fn trailAt(q: vec2f) -> f32 {
  let w = i32(flock.gridW);
  let h = i32(flock.gridH);
  let x = ((i32(floor(q.x)) % w) + w) % w;
  let y = ((i32(floor(q.y)) % h) + h) % h;
  return trail[u32(y) * flock.gridW + u32(x)];
}

const FIXED: f32 = 1024.0; // fixed-point scale of the neighbour sums (1/1024 pixel)

fn toFixed(v: vec2f) -> vec2i {
  return vec2i(round(v * FIXED));
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3u, @builtin(num_workgroups) nwg: vec3u) {
  let i = linearIndex(gid, nwg);
  if (i >= flock.count) { return; }

  let size = vec2f(f32(flock.gridW), f32(flock.gridH));
  let cells = vec2u(flock.cellsX, flock.cellsY);
  let me = boidsIn[i];
  let pos = me.xy * size;
  let vel = me.zw;
  let speed = length(vel);
  let reach = max(flock.sepRadius, flock.nbrRadius);

  var sepSum = vec2i(0);
  var sepN = 0;
  var aliSum = vec2i(0);
  var cohSum = vec2i(0);
  var nbrN = 0;

  // The 3 x 3 cells around this boid (they wrap with the world).
  let home = vec2i(cellCoord(me.xy, cells));
  // My own place in the cell-ordered list, so I can skip myself.
  let mySlot = cellStart[u32(home.y) * flock.cellsX + u32(home.x)] + rank[i];
  let cellsI = vec2i(cells);
  for (var dy = -1; dy <= 1; dy = dy + 1) {
    for (var dx = -1; dx <= 1; dx = dx + 1) {
      let c = (home + vec2i(dx, dy) + cellsI) % cellsI;
      let cell = u32(c.y) * flock.cellsX + u32(c.x);
      let start = cellStart[cell];
      let inCell = cellCount[cell];
      let end = start + inCell;
      // Work guard: a crowded cell is sampled at an even stride (a different offset for each
      // boid) instead of read in full. Cells under the cap are read in full, as always.
      var stride = 1u;
      var first = start;
      if (inCell > flock.cellCap) {
        stride = (inCell + flock.cellCap - 1u) / flock.cellCap;
        first = start + (i % stride);
      }
      for (var k = first; k < end; k = k + stride) {
        if (k == mySlot) { continue; }
        let other = sortedBoids[k];
        let off = wrappedOffset(pos, other.xy * size, size);
        let d2 = dot(off, off);
        if (d2 == 0.0 || d2 >= reach * reach) { continue; }
        if (d2 < flock.sepRadius * flock.sepRadius) {
          // Away from the neighbour, weighted 1/d: off / d is a unit vector, / d again is the weight.
          sepSum = sepSum + toFixed(-off / max(d2, 0.01));
          sepN = sepN + 1;
        }
        // View cone (alignment and cohesion only): the neighbour must be within fov / 2 of where I
        // am heading. A boid at rest has no heading and sees all around.
        let inView = speed <= 0.000001 || dot(off, vel) / (sqrt(d2) * speed) >= flock.cosHalfFov;
        if (d2 < flock.nbrRadius * flock.nbrRadius && inView) {
          aliSum = aliSum + toFixed(other.zw);
          cohSum = cohSum + toFixed(off);
          nbrN = nbrN + 1;
        }
      }
    }
  }

  // A behaviour with nothing to perceive stays silent (it does not brake the boid). The same when
  // what it perceives cancels out exactly: a zero desired velocity would mean "stop".
  var accel = vec2f(0.0);
  if (sepN > 0 && any(sepSum != vec2i(0))) {
    accel = accel + flock.sepWeight * steerToward(withLength(vec2f(sepSum) / FIXED, flock.maxSpeed), vel, flock.maxForce);
  }
  if (nbrN > 0 && any(aliSum != vec2i(0))) {
    accel = accel + flock.aliWeight * steerToward(withLength(vec2f(aliSum) / FIXED, flock.maxSpeed), vel, flock.maxForce);
  }
  if (nbrN > 0 && any(cohSum != vec2i(0))) {
    let toCentre = vec2f(cohSum) / FIXED / f32(nbrN);
    accel = accel + flock.cohWeight * steerToward(seekDesired(toCentre, flock.maxSpeed), vel, flock.maxForce);
  }

  // Coupling, trail -> boids: steer up the gradient of the shared trail (seek toward where the
  // trail is thicker). The trail carries the marks of every family, so this is how the flock feels
  // the Physarum veins, the followers' strokes and its own wake. One vector is perceived: the
  // difference between the trail a little to the right and left, and below and above. A flat
  // trail has no uphill, so the behaviour stays silent there.
  if (flock.trailWeight > 0.0) {
    let d = flock.trailSense;
    let g = vec2f(
      trailAt(pos + vec2f(d, 0.0)) - trailAt(pos - vec2f(d, 0.0)),
      trailAt(pos + vec2f(0.0, d)) - trailAt(pos - vec2f(0.0, d)));
    if (any(g != vec2f(0.0))) {
      accel = accel + flock.trailWeight * steerToward(seekDesired(g, flock.maxSpeed), vel, flock.maxForce);
    }
  }

  // The pointer: the same soft circle the Physarum pen uses (full weight at the pointer, 37% one
  // sigma away). Attract is seek, predator is flee.
  if (flock.penActive > 0.5 && flock.penMode != 0u) {
    let off = wrappedOffset(pos, vec2f(flock.penX, flock.penY) * size, size);
    let sigma = flock.penSigma * f32(flock.gridH);
    let weight = exp(-dot(off, off) / (sigma * sigma));
    var desired = seekDesired(off, flock.maxSpeed);
    if (flock.penMode == 2u) { desired = fleeDesired(off, flock.maxSpeed); }
    accel = accel + steerToward(desired, vel, flock.maxForce) * flock.penStrength * weight;
  }

  let newVel = limitLength(vel + accel, flock.maxSpeed);
  var p = pos + newVel;
  p = p - size * floor(p / size); // wrap around the world

  let ix = min(u32(p.x), flock.gridW - 1u);
  let iy = min(u32(p.y), flock.gridH - 1u);
  atomicAdd(&counter[iy * flock.gridW + ix], 1u);

  boidsOut[i] = vec4f(min(p / size, vec2f(0.99999994)), newVel);
}

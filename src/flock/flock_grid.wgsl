// Spatial grid for the flock: a counting sort of the boids by cell, in three passes. The CPU twin
// is buildGrid in flocking.ts. Concatenated after common.wgsl and flock_common.wgsl.
//
// Why a grid: a boid only perceives neighbours within a radius, but finding them by testing
// every other boid costs N x N. The grid cuts the world into cells at least as wide as the
// largest radius, so every neighbour of a boid lies in the 3 x 3 cells around it (Reynolds'
// bin-lattice). Each boid then tests only those boids. The result is exact, not approximate.
//
//   pass 1 (count)    one thread per boid: atomicAdd into its cell's counter; the value the
//                     atomic returns is the boid's rank inside the cell
//   pass 2 (scan)     one workgroup: exclusive prefix sum of the counts gives each cell's start
//   pass 3 (scatter)  one thread per boid: sortedBoids[cellStart + rank] = the boid's state
// Afterwards the boids of cell c are sortedBoids[cellStart[c] .. cellStart[c] + cellCount[c]],
// stored next to each other. A boid's neighbours are then read from consecutive memory, which
// is what makes the flock pass fast (an index list would make every read a random access).

@group(0) @binding(0) var<uniform> flock: Flock;
@group(0) @binding(1) var<storage, read_write> boidsIn: array<vec4f>;
@group(0) @binding(3) var<storage, read_write> cellCount: array<atomic<u32>>;
@group(0) @binding(4) var<storage, read_write> cellStart: array<u32>;
@group(0) @binding(5) var<storage, read_write> rank: array<u32>;
@group(0) @binding(6) var<storage, read_write> sortedBoids: array<vec4f>; // boid states ordered by cell

fn cellOfBoid(i: u32) -> u32 {
  let c = cellCoord(boidsIn[i].xy, vec2u(flock.cellsX, flock.cellsY));
  return c.y * flock.cellsX + c.x;
}

@compute @workgroup_size(256)
fn count(@builtin(global_invocation_id) gid: vec3u, @builtin(num_workgroups) nwg: vec3u) {
  let i = linearIndex(gid, nwg);
  if (i >= flock.count) { return; }
  rank[i] = atomicAdd(&cellCount[cellOfBoid(i)], 1u);
}

// One workgroup of 256 threads. Each thread owns a run of consecutive cells: it adds them up,
// the 256 run totals are prefix-summed together (Hillis-Steele, 8 rounds), and each thread then
// walks its run writing the start of every cell.
var<workgroup> runTotals: array<u32, 256>;

@compute @workgroup_size(256)
fn scan(@builtin(local_invocation_index) t: u32) {
  let cells = flock.cellsX * flock.cellsY;
  let run = (cells + 255u) / 256u;
  let first = t * run;
  let last = min(first + run, cells);

  var total = 0u;
  for (var c = first; c < last; c = c + 1u) { total = total + atomicLoad(&cellCount[c]); }
  runTotals[t] = total;
  workgroupBarrier();

  for (var offset = 1u; offset < 256u; offset = offset << 1u) {
    var add = 0u;
    if (t >= offset) { add = runTotals[t - offset]; }
    workgroupBarrier();
    runTotals[t] = runTotals[t] + add;
    workgroupBarrier();
  }

  var running = runTotals[t] - total; // exclusive: everything before this run
  for (var c = first; c < last; c = c + 1u) {
    cellStart[c] = running;
    running = running + atomicLoad(&cellCount[c]);
  }
}

@compute @workgroup_size(256)
fn scatter(@builtin(global_invocation_id) gid: vec3u, @builtin(num_workgroups) nwg: vec3u) {
  let i = linearIndex(gid, nwg);
  if (i >= flock.count) { return; }
  sortedBoids[cellStart[cellOfBoid(i)] + rank[i]] = boidsIn[i];
}

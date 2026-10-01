# evidence

Files saved by the development tools, kept because the documents point to them. Nothing here is read by the instrument. All of it was produced on one machine (one NVIDIA GeForce RTX 4070, Chrome in the Claude desktop app), seed 7, simulation grid 1043 x 910, on 2026-09-30 (the UTC time stamps in the names are one day later after 19:00 local).

## verify/

Reports of `await __exp.verify()` (src/verify/gpu_checks.ts). Each file lists, for every check that ran, the prediction id, pass or fail, the seconds it took and the numbers behind it. They are listed in the order they were made:

| File | What it is |
|---|---|
| `verify-2026-10-01-02-12-48.json` | **The first run**, 37 GPU checks, all thresholds as written before running. 32 passed, 5 failed (PC-02, PE-02, FO-06, FO-07, TL-05). Never overwrite it: the corrections are judged against it |
| `verify-2026-10-01-02-18-57.json` | The second full run, after the thresholds of PC-02, PE-02 and FO-07 were revised, FO-06 was corrected to the curl field and TL-05 was redesigned. 37 of 37. Its TL-05 passed with rounds ranging from 0.65 to 3.2 times, which is why the noise guard was added |
| `verify-2026-10-01-02-21-53.json` | TL-05 alone, once more (passed, rounds disagreed by 9.5%) |
| `verify-2026-10-01-02-23-26.json`, `verify-2026-10-01-02-23-42.json` | SC-01 alone, twice, looking at the dense scene's wheel number changing between runs |
| `verify-2026-10-01-02-25-06.json` | TL-06 alone, **before the fix**: fails (surge 1 left after a reset, the two hashes differ) |
| `verify-2026-10-01-02-26-44.json` | **The final run**, all 38 GPU checks after every code change. 37 passed; TL-05 is inconclusive because another program was using the GPU |
| `verify-2026-10-01-02-28-59.json`, `...-02-29-15.json`, `...-02-29-30.json` | SC-01 to SC-03 three times in a row after the fix (the pen and accent numbers are identical each time, the dense wheel number is 0.107 to 0.108) |

## sweeps/

Screenshots from `await __exp.sweepShots(key, values, {times, ...})` (src/verify/sweep_shots.ts): the real display after the given number of steps from seed 7, one file per value, plus `manifest.json` with every parameter, the seed, the grid, the adapter and a SHA-256 of each file. The same sweep run twice gives identical hashes (TL-04).

| Folder | Prediction | What it shows |
|---|---|---|
| `PC-02-03-sensor-distance/` | PC-02, PC-03 | Sensor distance 4, 16, 48 after 900 steps: thin curling lines with few closed cells, the honeycomb, coarse fat veins |
| `PC-04-sensor-angle/` | PC-04 | Sensor angle 15, 45, 90 degrees after 900 steps |
| `PC-01-decay/` | PC-01 | Decay 0.6, 0.9, 0.97 after 900 steps |
| `FL-01-separation-weight-boids-only/` | FL-01 | 10,000 boids alone (Physarum and followers off), separation weight 0, 2, 4 after 600 steps: at 0 the flock has piled into a few bright dense streaks, at 4 it is spread evenly and loosely over the world |

To remake one: run the call in the dev server console; the folder is named by `label` (default: the key and a time stamp).

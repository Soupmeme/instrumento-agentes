// Easing and response curves for transitions and the wheel. All map 0..1 to 0..1 with 0 -> 0 and
// 1 -> 1, and are monotonic, so a transition never overshoots the two scenes it connects.

import type { CurveName } from './types';

export const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

export function curve(name: CurveName, x: number): number {
  const t = clamp01(x);
  switch (name) {
    case 'in': // slow start, fast end
      return t * t;
    case 'out': // fast start, slow end
      return 1 - (1 - t) * (1 - t);
    case 'smooth': // flat at both ends, steepest in the middle (smoothstep)
      return t * t * (3 - 2 * t);
    default:
      return t;
  }
}

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

// The 36-Points preset matrix (SPEC 5.1). Values are Bleuje's, copied from
// https://bleuje.com/web-interactive-physarum/src/parameters.js (CC BY-NC-SA 3.0, derived
// from Sage Jenson's work; credited in README and in the on-screen credits).
//
// Each row is a 15-vector. The shader indexes it by position, in this order (this is the
// order used by the shader, the names in Bleuje's file are shifted by one):
//   0 SD0   1 SDE   2 SDA     sensor distance = SD0 + SDA * S^SDE * pixelScale
//   3 SA0   4 SAE   5 SAA     sensor angle    = SA0 + SAA * S^SAE
//   6 RA0   7 RAE   8 RAA     rotation angle  = RA0 + RAA * S^RAE
//   9 MD0  10 MDE  11 MDA     move distance   = MD0 + MDA * S^MDE * pixelScale
//  12 SB1  13 SB2  14 SF      S is the trail sensed at the agent (offset by SB1 sideways and
//                             SB2 forward), times SF, clamped to (1e-9, 1]
// So an agent adapts how far it looks, how wide, how sharply it turns and how fast it moves
// to how much trail is under it. That is the whole idea of the extended mode.

export const PARAM_COUNT = 15;

const DE_SD = 2.0;
const DE_SA = 1.0;
const DE_RA = 1.0;
const DE_MD = 3.0;

export const PARAMETER_MATRIX: readonly (readonly number[])[] = [
  [0.0, 4.0, 0.3, 0.1, 51.32, 20.0, 0.41, 4.0, 0.0, 0.1, 6.0, 0.1, 0.0, 0.0, 22.0],
  [0.0, 28.04, 14.53, 0.09, DE_SA, 0.0, 0.01, 1.4, 1.12, 0.83, DE_MD, 0.0, 0.57, 0.03, 36.0],
  [17.92, DE_SD, 0.0, 0.52, DE_SA, 0.0, 0.18, DE_RA, 0.0, 0.1, 6.05, 0.17, 0.0, 0.0, 18.0],
  [3.0, 10.17, 0.4, 1.03, 2.3, 2.0, 1.42, 20.0, 0.75, 0.83, 1.56, 0.11, 1.07, 0.0, 13.0],
  [0.0, 8.51, 0.19, 0.61, DE_SA, 0.0, 3.35, DE_RA, 0.0, 0.75, 12.62, 0.06, 0.0, 0.0, 34.0],
  [0.0, 0.82, 0.03, 0.18, DE_SA, 0.0, 0.26, DE_RA, 0.0, 0.0, 20.0, 0.65, 0.2, 0.9, 31.5],
  [1.5, 1.94, 0.28, 1.73, 1.12, 0.71, 0.18, 2.22, 0.85, 0.5, 4.13, 0.11, 1.12, 0.0, 15.0],
  [2.87, 3.04, 0.28, 0.09, DE_SA, 0.0, 0.44, 0.85, 0.0, 0.0, 2.22, 0.14, 0.3, 0.85, 11.0],
  [0.14, 1.12, 0.19, 0.27, 1.4, 0.0, 1.13, 2.0, 0.39, 0.75, 2.22, 0.19, 0.0, 7.14, 9.0],
  [0.001, 2.54, 0.08, 0.0, DE_SA, 0.0, 3.35, DE_RA, 0.0, 0.1, 12.62, 0.06, 0.0, 0.0, 30.5],
  [0.0, 28.04, 20.0, 0.18, 26.74, 20.0, 0.01, 1.4, 1.12, 0.83, DE_MD, 0.0, 2.54, 0.0, 39.0],
  [0.0, 20.0, 3.0, 0.26, 2.15, 4.76, 0.41, 6.6, 12.62, 0.3, 6.6, 0.037, 0.4, 0.04, 28.0],
  [27.5, 2.0, 2.54, 0.88, 26.74, 0.0, 0.09, 2.0, 1.4, 0.1, 5.0, 7.41, 1.4, 14.25, 12.0],
  [0.0, 6.0, 100.0, 0.157, 1.0, 1.07, 0.0, 1.0, 5.0, 0.83, 5.0, 20.0, 0.4, 0.0, 8.0],
  [0.0, 15.0, 8.6, 0.03, DE_SA, 0.0, 0.34, 2.0, 1.07, 0.22, 15.0, 0.1, 2.3, 0.82, 38.0],
  [0.0, 32.88, 402.0, 0.41, 3.0, 0.0, 0.1, DE_RA, 0.0, 0.3, 6.0, 0.0, 0.0, 0.0, 32.0],
  [0.0, 0.8, 0.02, 5.2, DE_SA, 0.0, 0.26, 0.1, 2.79, 0.83, 32.88, 37.74, 0.09, 0.33, 22.0],
  [3.0, 10.17, 0.4, 1.03, 0.308, 0.0, 0.148, 20.0, 0.75, 0.83, 1.56, 0.11, 1.07, 0.04, 9.0],
  [0.0, 5.0, 0.05, 0.9, 2.8, 0.0, 0.006, 0.84, 1.11, 0.75, 1.2, 0.0, 0.0, 0.0, 21.0],
  [27.5, 28.04, 0.0, 0.39, 1.4, 0.0, 0.09, 0.846, 1.4, 0.1, 2.031, 0.07, 1.4, 0.03, 15.3],
  [0.0, 8.5, 0.029, 0.27, 0.0, 0.0, 0.41, 0.0, 0.0, 0.75, 12.62, 0.06, 0.84, 0.0, 31.8],
  [0.0, 6.37, 5.425, 1.03, 0.0, 0.0, 0.18, 0.289, 0.443, 0.3, 2.2, 0.065, 1.07, 0.04, 19.0],
  [1.464, 20.0, 80.0, 0.26, 2.15, 4.76, 1.513, 2.0, 12.62, 0.385, 12.62, 0.037, 1.0, 0.0, 25.0],
  [0.0, 6.0, 100.0, 0.65, 0.175, 1.284, 0.0, 0.6, 5.0, 0.83, 5.395, 20.0, 0.4, 0.0, 8.6],
];

/**
 * The 22 rows the reference app offers, in its order. The instrument speaks in "slots"
 * (positions in this list, 0 to 21); `rowOfSlot` turns a slot into a matrix row.
 */
export const SELECTED_POINTS: readonly number[] = [0, 5, 2, 15, 3, 4, 6, 1, 7, 8, 9, 10, 11, 12, 14, 16, 13, 17, 18, 19, 20, 21];
export const SLOT_COUNT = SELECTED_POINTS.length;

export const rowOfSlot = (slot: number): number => SELECTED_POINTS[((Math.round(slot) % SLOT_COUNT) + SLOT_COUNT) % SLOT_COUNT];

export const presetOfSlot = (slot: number): readonly number[] => PARAMETER_MATRIX[rowOfSlot(slot)];

/**
 * Slots that have been looked at in this implementation and kept (see DECISIONS.md and
 * LOGBOOK.md for how they were chosen and what was rejected). Each looked clearly structured
 * and distinct from the others, and stayed alive for 100 simulated seconds:
 *   0 multiscale leaf network      2 vertebrata (large cells)     4 star network (blobs, tendrils)
 *  13 labyrinth                   14 stripes                     15 curly worms
 *  19 branching tree              21 ribbed rivers (the reference default)
 */
export const CURATED_SLOTS: readonly number[] = [0, 2, 4, 13, 14, 15, 19, 21];

/** Names known from the reference source and the SPEC. Other rows are just numbered. */
const ROW_NAMES: Record<number, string> = {
  0: 'pure multiscale',
  1: 'hex hole open',
  2: 'vertebrata',
  3: 'star network',
  4: 'enmeshed singularities',
  5: 'waves upturn',
};

export function slotLabel(slot: number): string {
  const row = rowOfSlot(slot);
  return `${slot}: row ${row}${ROW_NAMES[row] ? ` (${ROW_NAMES[row]})` : ''}`;
}

/**
 * Bleuje's own list of pen and background pairs that "start the demo on something attractive".
 * Two letters, A to V, each naming a slot (A is slot 0), pen first, then background. The
 * trailing digit is a colour mode we do not use. Used here only as a starting list for our own
 * curation; nothing is trusted until it has been looked at in our implementation.
 */
const LANDING_CODES = [
  'LU2', 'OQ6', 'OB4', 'OS6', 'PO7', 'CO4', 'GB3', 'OG4', 'CL5', 'BA10', 'DG2', 'FS10',
  'KM2', 'KQ3', 'DV3', 'OP4', 'CQ6', 'CR4', 'QU5', 'RS4', 'VN6', 'AV7', 'RV2',
];

export const LANDING_PAIRS: readonly { code: string; penSlot: number; backgroundSlot: number }[] = LANDING_CODES.map((code) => ({
  code,
  penSlot: code.charCodeAt(0) - 65,
  backgroundSlot: code.charCodeAt(1) - 65,
}));

// The instrument's colour system (SPEC 7): one scalar-to-colour mapping applied to the combined
// trail, so every agent family is drawn in the same colours. A palette is five stops from the
// background up to white-hot, plus one accent colour for areas that are changing (the delayed
// trail trick, see display.wgsl). Palettes are discrete regime switches: a scene picks one.
//
// This file is the only place the colours are written. paletteWgsl() turns it into WGSL constants
// for the display shader, so the shader and the tests read the same numbers.
//
// Design rules: every palette starts at the page background (so the canvas and the page match and
// an empty world is the same dark in every palette), brightens steadily (luminance rises at every
// stop, so "brighter trail" always reads as "more"), and uses one or two hue families, never a
// rainbow ramp.

export type Rgb = readonly [number, number, number];

export interface Palette {
  name: string;
  /** Five stops, from the background (trail 0) to the brightest (saturated trail). */
  stops: readonly [Rgb, Rgb, Rgb, Rgb, Rgb];
  /** Colour added where the trail is growing fast (and the complement of what fades). */
  accent: Rgb;
}

/** The page background, which is also the first stop of every palette. */
export const BACKGROUND: Rgb = [0.043, 0.051, 0.078];

export const PALETTES: readonly Palette[] = [
  {
    name: 'Abyss',
    stops: [BACKGROUND, [0.07, 0.18, 0.42], [0.14, 0.4, 0.68], [0.35, 0.85, 0.75], [1.0, 0.97, 0.85]],
    accent: [1.0, 0.6, 0.3],
  },
  {
    name: 'Ember',
    stops: [BACKGROUND, [0.3, 0.06, 0.1], [0.75, 0.2, 0.12], [1.0, 0.62, 0.22], [1.0, 0.95, 0.8]],
    accent: [0.3, 0.8, 1.0],
  },
  {
    name: 'Orchid',
    stops: [BACKGROUND, [0.18, 0.09, 0.36], [0.55, 0.16, 0.55], [0.95, 0.5, 0.7], [1.0, 0.93, 0.97]],
    accent: [0.4, 0.95, 0.85],
  },
  {
    name: 'Verdigris',
    stops: [BACKGROUND, [0.05, 0.25, 0.22], [0.2, 0.6, 0.48], [0.78, 0.9, 0.55], [1.0, 0.98, 0.85]],
    accent: [1.0, 0.5, 0.4],
  },
  {
    name: 'Bone',
    stops: [BACKGROUND, [0.18, 0.18, 0.22], [0.45, 0.45, 0.52], [0.82, 0.8, 0.76], [1.0, 1.0, 1.0]],
    accent: [0.9, 0.75, 0.4],
  },
  {
    name: 'Tide',
    stops: [BACKGROUND, [0.06, 0.2, 0.36], [0.12, 0.55, 0.62], [0.92, 0.7, 0.25], [1.0, 0.96, 0.8]],
    accent: [0.6, 0.4, 0.95],
  },
];

export const PALETTE_COUNT = PALETTES.length;

/** Relative luminance (Rec. 709 weights on the given channel values). */
export const luminance = (c: Rgb): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/** Colour of palette `index` at trail level v in [0, 1]: linear between the five stops. */
export function paletteColour(index: number, v: number): [number, number, number] {
  const p = PALETTES[Math.max(0, Math.min(PALETTE_COUNT - 1, Math.floor(index)))];
  const f = Math.max(0, Math.min(1, v)) * 4;
  const i = Math.min(3, Math.floor(f));
  const t = f - i;
  const a = p.stops[i];
  const b = p.stops[i + 1];
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

const vec = (c: Rgb) => `vec3f(${c.map((x) => x.toFixed(4)).join(', ')})`;

/** WGSL for the display shader: the stops and accents as private arrays. */
export function paletteWgsl(): string {
  const stops = PALETTES.flatMap((p) => p.stops).map(vec).join(',\n  ');
  const accents = PALETTES.map((p) => vec(p.accent)).join(',\n  ');
  return (
    `var<private> PALETTE_STOPS = array<vec3f, ${PALETTE_COUNT * 5}>(\n  ${stops},\n);\n` +
    `var<private> PALETTE_ACCENTS = array<vec3f, ${PALETTE_COUNT}>(\n  ${accents},\n);\n`
  );
}

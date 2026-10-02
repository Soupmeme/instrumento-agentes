// Prints the table of the performer's shipped scenes (src/scenes/scenes.json) for EXPLAINER.md
// section 6, so the document is generated from the data and cannot disagree with it.
//
//   node scripts/scenes_markdown.ts > scenes_table.md

import { readFileSync } from 'node:fs';

interface Scene {
  id: string;
  name: string;
  note: string;
  params: Record<string, number>;
  pen: { description: string };
  macro: { description: string; entry: number };
  accent: { type: string; strength: number; glow?: number };
  entry: { seconds: number };
}

const scenes: Scene[] = JSON.parse(readFileSync(new URL('../src/scenes/scenes.json', import.meta.url), 'utf8'));
const PALETTES = ['Abyss', 'Ember', 'Orchid', 'Verdigris', 'Bone', 'Tide'];
const esc = (s: string) => s.replace(/\|/g, '\\|');

console.log('| Key | Scene | Palette, preset, agents | Pen | Wheel | Click | Enters |');
console.log('|---|---|---|---|---|---|---|');
scenes.forEach((s, i) => {
  const p = s.params;
  const look = `${PALETTES[p.palette] ?? p.palette}, preset ${p.backgroundPreset}, ${Number(p.agentCount).toLocaleString('en-US')} agents${p.flockCount ? `, ${Number(p.flockCount).toLocaleString('en-US')} boids` : ''}${p.followerCount ? `, ${Number(p.followerCount).toLocaleString('en-US')} followers` : ''}`;
  const click = `${s.accent.type}${s.accent.glow ? `, warm glow ${s.accent.glow}` : ''}`;
  const enters = s.entry.seconds <= 0.1 ? 'a hard cut' : `a melt of ${s.entry.seconds} s`;
  console.log(`| ${i + 1} | ${esc(s.name)} | ${esc(look)} | ${esc(s.pen.description)} | ${esc(s.macro.description)} | ${click} | ${enters} |`);
});

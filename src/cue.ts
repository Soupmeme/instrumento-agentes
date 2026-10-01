// Cue panel (SPEC 8.6, key C): a lookup aid for the performer, not automation. It shows the
// current scene (name and the performer's note), the next scene, the song's elapsed time and the
// scene list. The clock is read from the audio element and displayed, nothing else: it triggers
// nothing, ever (CLAUDE.md rule 2).

import type { Director } from './scenes/director';
import type { SceneData } from './scenes/types';

function text(tag: string, cls: string, content: string): HTMLElement {
  const el = document.createElement(tag);
  el.className = cls;
  el.textContent = content;
  return el;
}

function mmss(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export class CuePanel {
  private clock = text('div', 'cue-clock', '--:--');
  private body = document.createElement('div');
  private lastClock = 0;

  constructor(
    private el: HTMLElement,
    private getDirector: () => Director | null,
    /** Seconds played, or null when there is no readable clock (nothing loaded, or a YouTube embed before it plays). */
    private elapsed: () => number | null,
  ) {
    el.append(this.clock, this.body);
  }

  get visible(): boolean {
    return !this.el.hidden;
  }

  toggle(): void {
    this.el.hidden = !this.el.hidden;
    if (!this.el.hidden) this.refresh();
  }

  private sceneBlock(label: string, scene: SceneData | undefined): HTMLElement {
    const block = document.createElement('div');
    block.className = 'cue-block';
    block.append(text('div', 'cue-label', label));
    if (!scene) {
      block.append(text('div', 'cue-end', 'end of the scenes'));
      return block;
    }
    const title = text('div', 'cue-name', scene.name);
    if (scene.placeholder) title.append(text('span', 'cue-badge', 'placeholder'));
    block.append(title);
    if (scene.note) block.append(text('div', 'cue-note', scene.note));
    return block;
  }

  /** Rebuild the panel (a scene switch, an edit, an import). */
  refresh(): void {
    const d = this.getDirector();
    this.body.replaceChildren();
    if (!d || !d.scene) return;
    this.body.append(this.sceneBlock(`NOW  ${d.index + 1} / ${d.scenes.length}`, d.scene), this.sceneBlock('NEXT', d.nextScene));
    const list = document.createElement('ol');
    list.className = 'cue-list';
    d.scenes.forEach((s, i) => {
      const li = document.createElement('li');
      li.textContent = `${i + 1}  ${s.name}`;
      if (i === d.index) li.className = 'cue-current';
      list.append(li);
    });
    this.body.append(list);
  }

  /** Call every frame with a timestamp; the clock text updates four times a second. */
  tick(now: number): void {
    if (this.el.hidden || now - this.lastClock < 250) return;
    this.lastClock = now;
    const t = this.elapsed();
    this.clock.textContent = t === null ? '--:--' : mmss(t);
  }
}

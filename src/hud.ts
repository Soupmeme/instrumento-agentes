// Debug HUD (toggle with D). Frame timing here is CPU frame-to-frame time from
// requestAnimationFrame timestamps. That is what the browser actually presented, so it is a
// fair fps measure, but it does NOT separate GPU time from CPU time. GPU timestamp queries
// (if the adapter offers them) will be added when there is GPU work worth measuring.

const WINDOW = 120; // frames kept for the rolling stats

export class Hud {
  private el: HTMLElement;
  private times = new Float32Array(WINDOW);
  private count = 0;
  private head = 0;
  private lastText = 0;
  private extra: () => string;

  constructor(el: HTMLElement, extra: () => string) {
    this.el = el;
    this.extra = extra;
  }

  get visible(): boolean {
    return !this.el.hidden;
  }

  toggle(): void {
    this.el.hidden = !this.el.hidden;
  }

  /** Feed the delta between two frames, in milliseconds. */
  push(dtMs: number, now: number): void {
    this.times[this.head] = dtMs;
    this.head = (this.head + 1) % WINDOW;
    this.count = Math.min(this.count + 1, WINDOW);

    // Rewriting text 60 times a second would itself cost time; 4 Hz is readable.
    if (!this.visible || now - this.lastText < 250) return;
    this.lastText = now;

    let sum = 0;
    let max = 0;
    for (let i = 0; i < this.count; i++) {
      sum += this.times[i];
      if (this.times[i] > max) max = this.times[i];
    }
    const avg = sum / this.count;
    this.el.textContent =
      `${(1000 / avg).toFixed(1)} fps\n` +
      `frame ${avg.toFixed(2)} ms (worst ${max.toFixed(1)} ms, last ${this.count} frames)\n` +
      this.extra();
  }

  /** Forget history, e.g. after the tab was hidden so the first delta is not a huge spike. */
  reset(): void {
    this.count = 0;
    this.head = 0;
  }
}

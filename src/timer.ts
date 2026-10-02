// On-screen timer (key K): a small clock for the performer, display only. It shows the song's
// elapsed time when a song is loaded and playing from a readable clock, and otherwise a
// stopwatch that starts the moment the timer is switched on. It triggers nothing, ever: nothing in
// the instrument reads it (CLAUDE.md rule 2).

/** Seconds as m:ss ("0:44", "12:05"); negative or not a number reads as 0:00. */
export function mmss(seconds: number): string {
  const s = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export class OnScreenTimer {
  private startedAt = 0;
  private lastText = 0;
  private el: HTMLElement;
  /** Seconds played, or null when there is no readable song clock. */
  private songSeconds: () => number | null;

  constructor(el: HTMLElement, songSeconds: () => number | null) {
    this.el = el;
    this.songSeconds = songSeconds;
  }

  get visible(): boolean {
    return !this.el.hidden;
  }

  /** Switch on or off. Switching on starts the stopwatch from zero (it is only used without a song clock). */
  toggle(now: number): void {
    this.el.hidden = !this.el.hidden;
    if (!this.el.hidden) {
      this.startedAt = now;
      this.lastText = 0;
      this.tick(now);
    }
  }

  /** Call every frame; the text updates four times a second. */
  tick(now: number): void {
    if (this.el.hidden || now - this.lastText < 250) return;
    this.lastText = now;
    const song = this.songSeconds();
    if (song !== null && song > 0) {
      this.el.textContent = mmss(song);
      this.el.title = 'song clock';
    } else {
      this.el.textContent = mmss((now - this.startedAt) / 1000);
      this.el.title = 'stopwatch (no song clock)';
    }
  }
}

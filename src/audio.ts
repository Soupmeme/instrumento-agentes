// Audio: a plain HTMLAudioElement fed from a file picker. That is the whole audio story.
// Hard rule (CLAUDE.md 2): no AudioContext, no AnalyserNode, no FFT. Nothing in the picture
// may ever be derived from the sound. The element clock is exposed for the cue panel only,
// as a display value, and triggers nothing.

export class Song {
  private audio: HTMLAudioElement;
  private nameEl: HTMLElement;
  private url: string | null = null;

  constructor(input: HTMLInputElement, audio: HTMLAudioElement, nameEl: HTMLElement) {
    this.audio = audio;
    this.nameEl = nameEl;
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (file) this.load(file);
      // Let the same file be chosen again later.
      input.value = '';
    });
  }

  private load(file: File): void {
    // Free the previous blob URL, otherwise every song change leaks the whole file.
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = URL.createObjectURL(file);
    this.audio.src = this.url;
    this.nameEl.textContent = file.name;
  }

  /** Elapsed seconds, for display only (cue panel, milestone M6). */
  get elapsed(): number {
    return this.audio.currentTime;
  }

  get hasSong(): boolean {
    return this.url !== null;
  }
}

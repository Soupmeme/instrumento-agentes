// Small DOM helpers shared by the app: full-screen message overlay and fullscreen toggle.

export function showMessage(el: HTMLElement, text: string): void {
  el.textContent = text;
  el.hidden = false;
}

export function hideMessage(el: HTMLElement): void {
  el.hidden = true;
}

/** requestFullscreen needs a user gesture, so this is only called from key or click handlers. */
export function toggleFullscreen(): void {
  if (document.fullscreenElement) {
    void document.exitFullscreen();
  } else {
    void document.documentElement.requestFullscreen().catch((err) => {
      console.warn('Fullscreen request was refused:', err);
    });
  }
}

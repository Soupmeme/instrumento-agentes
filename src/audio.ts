// Song source: a local file, a direct audio link, or a YouTube link.
//
// Hard rule (CLAUDE.md 2): nothing in the picture may ever be derived from the sound.
// No AudioContext, no AnalyserNode, no FFT. For local files and direct links the element is
// a plain HTMLAudioElement and we never read its samples. YouTube plays inside its own
// iframe, which cannot be analysed from the page at all. Kiwi approved the YouTube embed
// on 2026-09-29 (DECISIONS.md). The only thing this module exposes about playback is
// `elapsed`, a display-only clock for the cue panel (M6). It triggers nothing, ever.
//
// Online and offline: a local file needs no network. The other two do, and the YouTube script
// is fetched only when a YouTube link is pasted, so the app itself never depends on it.
// (A Spotify embed was tried and removed, see DECISIONS.md 2026-09-30.)

import { parseSource, type Source } from './source';

/** One playing thing. `elapsed` is seconds; `dispose` must release everything it holds. */
interface Backend {
  elapsed(): number;
  dispose(): void;
}

export interface SongElements {
  fileInput: HTMLInputElement;
  linkInput: HTMLInputElement;
  linkButton: HTMLButtonElement;
  status: HTMLElement;
  audio: HTMLAudioElement;
  embedHost: HTMLElement;
}

const SCRIPT_TIMEOUT_MS = 10_000;

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tag = document.createElement('script');
    const timer = setTimeout(() => {
      tag.remove();
      reject(new Error('timeout'));
    }, SCRIPT_TIMEOUT_MS);
    tag.src = src;
    tag.async = true;
    tag.onload = () => {
      clearTimeout(timer);
      resolve();
    };
    tag.onerror = () => {
      clearTimeout(timer);
      tag.remove();
      reject(new Error('blocked or offline'));
    };
    document.head.appendChild(tag);
  });
}

// The YouTube script announces itself through a global callback, so the promise is created
// once and shared. It is cleared on failure so a later attempt (back online) can retry.
let youtubeApi: Promise<NonNullable<Window['YT']>> | null = null;
function getYouTubeApi(): Promise<NonNullable<Window['YT']>> {
  youtubeApi ??= new Promise((resolve, reject) => {
    if (window.YT?.Player) return resolve(window.YT);
    window.onYouTubeIframeAPIReady = () => resolve(window.YT!);
    loadScript('https://www.youtube.com/iframe_api').catch((err) => {
      youtubeApi = null;
      reject(err);
    });
  });
  return youtubeApi;
}

const YOUTUBE_ERRORS: Record<number, string> = {
  2: 'YouTube says the video id is invalid.',
  5: 'YouTube could not play that video in this browser.',
  100: 'That YouTube video was removed or is private.',
  101: 'The owner of that YouTube video does not allow embedding it.',
  150: 'The owner of that YouTube video does not allow embedding it.',
};

export class Song {
  private els: SongElements;
  private backend: Backend | null = null;
  private label = '';
  /** Guards against a slow script load finishing after the performer chose something else. */
  private loadId = 0;

  constructor(els: SongElements) {
    this.els = els;

    els.fileInput.addEventListener('change', () => {
      const file = els.fileInput.files?.[0];
      if (file) this.loadFile(file);
      // Let the same file be chosen again later.
      els.fileInput.value = '';
    });

    const submit = () => {
      void this.loadLink(els.linkInput.value);
      // Focus left in a text field would swallow the live keys (Space = next scene).
      els.linkInput.blur();
    };
    els.linkButton.addEventListener('click', (ev) => {
      submit();
      (ev.currentTarget as HTMLElement).blur();
    });
    els.linkInput.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') submit();
      if (ev.key === 'Escape') els.linkInput.blur();
    });

    // Live keys must always reach the page. A click inside a player (audio controls or the
    // YouTube iframe) would otherwise keep keyboard focus there and Space would stop working.
    els.audio.addEventListener('focus', () => els.audio.blur());
    window.addEventListener('blur', () => {
      setTimeout(() => {
        const active = document.activeElement;
        if (active instanceof HTMLIFrameElement) active.blur();
      }, 0);
    });
  }

  /** Elapsed seconds, for display only (cue panel, milestone M6). */
  get elapsed(): number {
    return this.backend?.elapsed() ?? 0;
  }

  get hasSong(): boolean {
    return this.backend !== null;
  }

  /** Name of the current song, or the link kind, for the cue panel. */
  get name(): string {
    return this.label;
  }

  private setStatus(text: string, isError = false): void {
    this.els.status.textContent = text;
    this.els.status.classList.toggle('error', isError);
  }

  /** Stop and release whatever is loaded, then hide both player surfaces. */
  private clear(): void {
    this.loadId++;
    this.backend?.dispose();
    this.backend = null;
    this.els.audio.hidden = true;
    this.els.embedHost.replaceChildren();
  }

  private loadFile(file: File): void {
    this.clear();
    // Revoked in dispose, otherwise every song change leaks the whole file in memory.
    const url = URL.createObjectURL(file);
    this.playInAudioElement(url, () => URL.revokeObjectURL(url));
    this.label = file.name;
    this.setStatus(`Local file: ${file.name}`);
  }

  private playInAudioElement(url: string, onDispose: () => void): void {
    const { audio } = this.els;
    audio.onerror = () => {
      // Direct links fail for ordinary reasons: not audio, blocked by the server, offline.
      this.setStatus(
        navigator.onLine
          ? 'Could not play that link (not an audio file, or the server refuses it).'
          : 'You are offline. Links need a connection; choose a local file instead.',
        true,
      );
    };
    audio.src = url;
    audio.hidden = false;
    this.backend = {
      elapsed: () => audio.currentTime,
      dispose: () => {
        audio.onerror = null;
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
        onDispose();
      },
    };
  }

  private async loadLink(text: string): Promise<void> {
    const source: Source = parseSource(text);
    if (source.kind === 'invalid') {
      this.setStatus(source.reason, true);
      return;
    }

    this.clear();
    const id = this.loadId;

    if (source.kind === 'url') {
      this.playInAudioElement(source.url, () => {});
      this.label = source.url;
      this.setStatus('Direct audio link. Press play.');
      return;
    }

    // YouTube needs its vendor script, so it needs the internet.
    if (!navigator.onLine) {
      this.setStatus('You are offline. YouTube links need a connection; choose a local file instead.', true);
      return;
    }
    this.setStatus('Loading player...');
    try {
      const backend = await this.loadYouTube(source.id);
      if (id !== this.loadId) {
        backend.dispose(); // the performer moved on while this was loading
        return;
      }
      this.backend = backend;
    } catch (err) {
      if (id !== this.loadId) return;
      console.error('Player failed to load:', err);
      this.els.embedHost.replaceChildren();
      this.setStatus('Could not load the YouTube player (blocked or offline).', true);
    }
  }

  private async loadYouTube(videoId: string): Promise<Backend> {
    const yt = await getYouTubeApi();
    const mount = document.createElement('div');
    this.els.embedHost.replaceChildren(mount);

    const player = new yt.Player(mount, {
      videoId,
      width: '100%',
      height: 180,
      // origin is required by the IFrame API when the page is served over http(s).
      playerVars: { playsinline: 1, rel: 0, origin: location.origin },
      events: {
        onError: (e) => this.setStatus(YOUTUBE_ERRORS[e.data] ?? `YouTube error ${e.data}.`, true),
      },
    });

    this.label = `YouTube ${videoId}`;
    this.setStatus('YouTube player ready. Press play.');
    return {
      // getCurrentTime does not exist until the player is ready, hence the guard.
      elapsed: () => (typeof player.getCurrentTime === 'function' ? player.getCurrentTime() : 0),
      dispose: () => player.destroy(),
    };
  }
}

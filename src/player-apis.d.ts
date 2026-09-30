// Minimal typings for the two third-party player APIs we load on demand.
// Only what audio.ts uses. Both scripts come from the vendors' own hosts and are loaded
// only when the performer pastes a Spotify or YouTube link.

interface SpotifyPlaybackUpdate {
  data: { isPaused: boolean; isBuffering: boolean; duration: number; position: number }; // ms
}

interface SpotifyEmbedController {
  addListener(event: 'ready', cb: () => void): void;
  addListener(event: 'playback_update', cb: (e: SpotifyPlaybackUpdate) => void): void;
  destroy(): void;
}

interface SpotifyIFrameAPI {
  createController(
    element: HTMLElement,
    options: { uri: string; width?: string | number; height?: string | number },
    callback: (controller: SpotifyEmbedController) => void,
  ): void;
}

interface YouTubePlayer {
  getCurrentTime(): number;
  destroy(): void;
}

interface YouTubePlayerOptions {
  videoId: string;
  width?: string | number;
  height?: string | number;
  playerVars?: Record<string, string | number>;
  events?: {
    onReady?: () => void;
    onError?: (e: { data: number }) => void;
  };
}

interface Window {
  onSpotifyIframeApiReady?: (api: SpotifyIFrameAPI) => void;
  onYouTubeIframeAPIReady?: () => void;
  YT?: { Player: new (element: HTMLElement, options: YouTubePlayerOptions) => YouTubePlayer };
}

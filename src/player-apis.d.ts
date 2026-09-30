// Minimal typings for the YouTube IFrame API, which audio.ts loads on demand from
// youtube.com only when the performer pastes a YouTube link.

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
  onYouTubeIframeAPIReady?: () => void;
  YT?: { Player: new (element: HTMLElement, options: YouTubePlayerOptions) => YouTubePlayer };
}

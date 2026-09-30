// Turns whatever the performer pasted into a description of where the music comes from.
// Pure function, no DOM, so it can be unit tested (test/source.test.ts).
//
// Only http(s) URLs are ever accepted as direct audio. Anything else (javascript:, data:,
// file:) is rejected, because the string ends up in an element's src.
//
// Spotify is recognised only to give a helpful message: its embedded player could not be
// made to play full tracks reliably, so it was removed (DECISIONS.md, 2026-09-30).

export type Source =
  | { kind: 'youtube'; id: string }
  | { kind: 'url'; url: string } // direct link to an audio file
  | { kind: 'invalid'; reason: string };

const YOUTUBE_ID = /^[\w-]{11}$/;
const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com']);

const SPOTIFY_UNSUPPORTED =
  'Spotify links are not supported. Use a local file, a YouTube link or a direct audio link.';

export function parseSource(input: string): Source {
  const text = input.trim();
  if (!text) return { kind: 'invalid', reason: 'Paste a link first.' };

  if (/^spotify:/i.test(text)) return { kind: 'invalid', reason: SPOTIFY_UNSUPPORTED };

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { kind: 'invalid', reason: 'That is not a link.' };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { kind: 'invalid', reason: 'Only http(s) links are supported.' };
  }

  const host = url.hostname.toLowerCase();

  if (host === 'open.spotify.com') return { kind: 'invalid', reason: SPOTIFY_UNSUPPORTED };

  if (host === 'youtu.be') {
    const id = url.pathname.slice(1).split('/')[0];
    if (YOUTUBE_ID.test(id)) return { kind: 'youtube', id };
    return { kind: 'invalid', reason: 'That YouTube link has no video id.' };
  }
  if (YOUTUBE_HOSTS.has(host)) {
    // The ?v= form, or /shorts/<id>, /embed/<id>, /live/<id>. A playlist id alone is not enough.
    const v = url.searchParams.get('v');
    if (v && YOUTUBE_ID.test(v)) return { kind: 'youtube', id: v };
    const m = /^\/(?:shorts|embed|live)\/([\w-]{11})(?:\/|$)/.exec(url.pathname);
    if (m) return { kind: 'youtube', id: m[1] };
    return { kind: 'invalid', reason: 'That YouTube link has no video id.' };
  }

  return { kind: 'url', url: url.toString() };
}

// Turns whatever the performer pasted into a description of where the music comes from.
// Pure function, no DOM, so it can be unit tested (test/source.test.ts).
//
// Only http(s) URLs are ever accepted as direct audio. Anything else (javascript:, data:,
// file:) is rejected, because the string ends up in an element's src.

export type Source =
  | { kind: 'spotify'; uri: string } // "spotify:track:<id>", the form the embed API wants
  | { kind: 'youtube'; id: string }
  | { kind: 'url'; url: string } // direct link to an audio file
  | { kind: 'invalid'; reason: string };

const SPOTIFY_TYPES = 'track|album|playlist|episode|show|artist';
const SPOTIFY_ID = '[A-Za-z0-9]{22}';
const SPOTIFY_WEB = new RegExp(`^/(?:intl-[a-z-]+/)?(${SPOTIFY_TYPES})/(${SPOTIFY_ID})(?:/|$)`);
const SPOTIFY_URI = new RegExp(`^spotify:(${SPOTIFY_TYPES}):(${SPOTIFY_ID})$`);
const YOUTUBE_ID = /^[\w-]{11}$/;
const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com']);

export function parseSource(input: string): Source {
  const text = input.trim();
  if (!text) return { kind: 'invalid', reason: 'Paste a link first.' };

  const uri = SPOTIFY_URI.exec(text);
  if (uri) return { kind: 'spotify', uri: `spotify:${uri[1]}:${uri[2]}` };

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

  if (host === 'open.spotify.com') {
    const m = SPOTIFY_WEB.exec(url.pathname);
    if (m) return { kind: 'spotify', uri: `spotify:${m[1]}:${m[2]}` };
    return { kind: 'invalid', reason: 'That Spotify link is not a track, album, playlist, episode or show.' };
  }

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

// Run with: npm test  (Node's built-in runner; Node 22.18+ strips TypeScript types itself).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource } from '../src/source.ts';

const ID22 = '4uLU6hMCjMI75M1A2tKUQC';

test('spotify web links, with and without locale prefix and query', () => {
  const want = { kind: 'spotify', uri: `spotify:track:${ID22}` };
  assert.deepEqual(parseSource(`https://open.spotify.com/track/${ID22}`), want);
  assert.deepEqual(parseSource(`https://open.spotify.com/track/${ID22}?si=abc123`), want);
  assert.deepEqual(parseSource(`https://open.spotify.com/intl-es/track/${ID22}?si=x`), want);
  assert.deepEqual(parseSource(`  https://open.spotify.com/track/${ID22}  `), want);
});

test('spotify uri form and other content types', () => {
  assert.deepEqual(parseSource(`spotify:album:${ID22}`), { kind: 'spotify', uri: `spotify:album:${ID22}` });
  assert.deepEqual(parseSource(`https://open.spotify.com/playlist/${ID22}`), {
    kind: 'spotify',
    uri: `spotify:playlist:${ID22}`,
  });
});

test('spotify links that are not playable content are rejected', () => {
  assert.equal(parseSource('https://open.spotify.com/').kind, 'invalid');
  assert.equal(parseSource('https://open.spotify.com/track/short').kind, 'invalid');
  assert.equal(parseSource('https://open.spotify.com/user/someone').kind, 'invalid');
});

test('youtube forms', () => {
  const want = { kind: 'youtube', id: 'dQw4w9WgXcQ' };
  assert.deepEqual(parseSource('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), want);
  assert.deepEqual(parseSource('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123&t=42s'), want);
  assert.deepEqual(parseSource('https://youtu.be/dQw4w9WgXcQ?si=abc'), want);
  assert.deepEqual(parseSource('https://music.youtube.com/watch?v=dQw4w9WgXcQ'), want);
  assert.deepEqual(parseSource('https://m.youtube.com/shorts/dQw4w9WgXcQ'), want);
  assert.deepEqual(parseSource('https://www.youtube.com/embed/dQw4w9WgXcQ'), want);
});

test('youtube links without a video id are rejected', () => {
  assert.equal(parseSource('https://www.youtube.com/playlist?list=PL123').kind, 'invalid');
  assert.equal(parseSource('https://www.youtube.com/watch?v=short').kind, 'invalid');
  assert.equal(parseSource('https://youtu.be/').kind, 'invalid');
});

test('direct audio urls pass through', () => {
  assert.deepEqual(parseSource('https://example.com/a/song.mp3'), { kind: 'url', url: 'https://example.com/a/song.mp3' });
  assert.equal(parseSource('http://example.com/x.wav').kind, 'url');
});

test('dangerous or empty input is rejected', () => {
  for (const bad of ['', '   ', 'not a link', 'javascript:alert(1)', 'data:audio/wav;base64,AAAA', 'file:///C:/x.mp3', 'ftp://x/y.mp3']) {
    assert.equal(parseSource(bad).kind, 'invalid', bad);
  }
});

test('lookalike hosts are not treated as spotify or youtube', () => {
  assert.equal(parseSource(`https://open.spotify.com.evil.test/track/${ID22}`).kind, 'url');
  assert.equal(parseSource('https://notyoutube.com/watch?v=dQw4w9WgXcQ').kind, 'url');
});

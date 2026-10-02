// The on-screen timer's text (src/timer.ts). CPU only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mmss } from '../src/timer.ts';
import { actionForKey } from '../src/scenes/keys.ts';

test('mmss reads whole seconds as m:ss and never goes negative or breaks on bad numbers', () => {
  assert.equal(mmss(0), '0:00');
  assert.equal(mmss(44.9), '0:44');
  assert.equal(mmss(59.99), '0:59');
  assert.equal(mmss(60), '1:00');
  assert.equal(mmss(179), '2:59');
  assert.equal(mmss(725), '12:05');
  assert.equal(mmss(-3), '0:00');
  assert.equal(mmss(Number.NaN), '0:00');
});

test('K is the timer key, a single key like every other', () => {
  assert.deepEqual(actionForKey({ key: 'k' }), { type: 'timer' });
  assert.deepEqual(actionForKey({ key: 'K' }), { type: 'timer' });
  assert.equal(actionForKey({ key: 'k', ctrlKey: true }), null);
});

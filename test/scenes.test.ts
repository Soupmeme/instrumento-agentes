// CPU-only tests of the scene system: validation, curves, the director (transitions, the wheel,
// the accent, capture) against a fake world, and the key map. No GPU is involved: what is and is
// not covered on the real GPU is stated in LOGBOOK.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULT_PARAMS, modeDefaults, type PhysarumParams } from '../src/physarum/params.ts';
import { curve } from '../src/scenes/curves.ts';
import { validateScene, validateScenes, paramRange, isMacroParam } from '../src/scenes/validate.ts';
import { Director, resolveScene, penScale, STEPS_PER_SECOND, PEN_SCALE_MAX, PEN_SCALE_MIN, type SceneHost } from '../src/scenes/director.ts';
import { actionForKey, BINDINGS, LIVE_KEYS } from '../src/scenes/keys.ts';
import type { SceneData } from '../src/scenes/types.ts';

const shipped = JSON.parse(readFileSync(new URL('../src/scenes/scenes.json', import.meta.url), 'utf8'));

function loadShipped(): SceneData[] {
  const r = validateScenes(shipped);
  assert.deepEqual(r.problems, []);
  return r.scenes;
}

class FakeHost implements SceneHost {
  params: PhysarumParams = { ...DEFAULT_PARAMS };
  pen = { x: 0.5, y: 0.5, active: true };
  log: string[] = [];
  resets = 0;
  reset() { this.resets++; }
  spawn(mode: 'ring' | 'center', fraction?: number) { this.log.push(`spawn ${mode} ${fraction ?? ''}`); }
  triggerWave(x?: number, y?: number, size?: number) { this.log.push(`wave ${x} ${y} ${size}`); }
  surge(a: number) { this.log.push(`surge ${a}`); }
}

const num = (p: PhysarumParams) => p as unknown as Record<string, number>;
const steps = (d: Director, n: number) => { for (let i = 0; i < n; i++) d.update(); };

// ---------------------------------------------------------------- curves and validation

test('curves: 0 to 0, 1 to 1, monotonic, clamped, and the named shapes', () => {
  for (const name of ['linear', 'smooth', 'in', 'out'] as const) {
    assert.equal(curve(name, 0), 0);
    assert.equal(curve(name, 1), 1);
    assert.equal(curve(name, -3), 0);
    assert.equal(curve(name, 4), 1);
    let last = -1;
    for (let i = 0; i <= 100; i++) {
      const v = curve(name, i / 100);
      assert.ok(v >= last - 1e-12, `${name} monotonic at ${i}`);
      last = v;
    }
  }
  assert.ok(curve('in', 0.5) < 0.5 && curve('out', 0.5) > 0.5 && curve('smooth', 0.5) === 0.5);
});

test('the shipped scenes.json is valid, has three scenes, and every one is marked PLACEHOLDER', () => {
  const scenes = loadShipped();
  assert.equal(scenes.length, 3);
  for (const s of scenes) {
    assert.equal(s.placeholder, true, s.id);
    assert.ok(s.name.startsWith('PLACEHOLDER'), s.name);
    assert.ok(s.note.includes('PLACEHOLDER'), s.id);
    assert.ok(s.pen.description.length > 10 && s.macro.description.length > 10, `${s.id} documents its pen and its wheel`);
    assert.ok(s.macro.entries.length >= 2 && s.macro.entries.length <= 4, `${s.id} wheel moves two to four parameters`);
  }
  assert.equal(new Set(scenes.map((s) => s.dominant)).size, 3, 'each scene has a different dominant family');
});

test('the shipped scenes stay inside the safe ranges found in M4 and M5', () => {
  for (const s of loadShipped()) {
    for (const v of [0, 0.5, 1]) {
      const p = resolveScene(s, v);
      assert.ok(p.flockCohWeight < p.flockSepWeight, `${s.id} at ${v}: cohesion below separation (equal weights collapse the flock)`);
      assert.ok(p.trailToBoids <= 1.5, `${s.id} at ${v}: trail -> boids below its cliff`);
      assert.ok(p.flowToPhysarum <= 0.6, `${s.id} at ${v}: flow steering below the collapse range`);
      assert.ok(p.flockCount <= 150000 && p.followerCount <= 1000000 && p.agentCount <= 2000000);
    }
  }
});

test('validation clamps, ignores and drops instead of throwing', () => {
  const r = validateScene({
    id: 'x', name: 'X',
    params: { decay: 7, nonsense: 3, agentCount: 'many', flockSepWeight: -1, mode: 1 },
    pen: { radius: 5 },
    macro: { entries: [{ param: 'decay', min: 0.6, max: 0.9 }, { param: 'fieldKind', min: 0, max: 1 }, { param: 'penRadius', min: 0, max: 1 }, { param: 'made_up', min: 0, max: 1 }], entry: 3 },
    accent: { type: 'explode' },
    entry: { seconds: -4, easing: 'wobble' },
  }, 0);
  assert.ok(r.value);
  assert.equal(r.value.params.decay, 0.99);
  assert.equal(r.value.params.flockSepWeight, 0);
  assert.equal('nonsense' in r.value.params, false);
  assert.equal('agentCount' in r.value.params, false);
  assert.equal(r.value.pen.radius, 0.9);
  assert.equal(r.value.macro.entry, 1);
  assert.deepEqual(r.value.macro.entries.map((e) => e.param), ['decay'], 'discrete, unknown and pen-radius entries are dropped');
  assert.equal(r.value.macro.entries[0].curve, 'smooth');
  assert.equal(r.value.accent.type, 'wave');
  assert.equal(r.value.entry.seconds, 0);
  assert.equal(r.value.entry.easing, 'smooth');
  assert.ok(r.problems.length >= 8, `${r.problems.length} problems reported`);
  for (const bad of [null, 3, 'scene', [], { id: 'a' }, { name: 'b' }]) assert.equal(validateScene(bad, 0).value, null);
});

test('validateScenes accepts an array or {scenes}, drops duplicates and reports a non-list', () => {
  const a = { id: 'a', name: 'A' };
  assert.equal(validateScenes([a, a, { id: 'b', name: 'B' }]).scenes.length, 2);
  assert.ok(validateScenes([a, a]).problems.some((p) => p.includes('duplicate')));
  assert.equal(validateScenes({ scenes: [a] }).scenes.length, 1);
  assert.equal(validateScenes('nope').scenes.length, 0);
  assert.ok(validateScenes({ scenes: 5 }).problems.length > 0);
});

test('angles are radians and ranges come from the tuning panel', () => {
  const r = paramRange('flockFov');
  assert.ok(r && Math.abs(r[0] - (30 * Math.PI) / 180) < 1e-12 && Math.abs(r[1] - 2 * Math.PI) < 1e-12);
  assert.deepEqual(paramRange('mode'), [0, 1]);
  assert.equal(paramRange('paletteMix'), null);
  assert.ok(isMacroParam('decay') && !isMacroParam('palette') && !isMacroParam('penRadius') && !isMacroParam('mode'));
});

// ---------------------------------------------------------------- resolving a scene

test('a scene resolves to a complete regime: defaults, then the rule defaults, then the scene, then the wheel', () => {
  const [calm] = loadShipped();
  const v = resolveScene(calm, 0.5);
  for (const k of Object.keys(DEFAULT_PARAMS)) assert.ok(k in v, `${k} present`);
  assert.equal(v.mode, 1);
  assert.equal(v.depositFactor, modeDefaults(1).depositFactor, 'extended rule defaults fill what the scene leaves out');
  assert.equal(v.boidDeposit, modeDefaults(1).boidDeposit);
  assert.equal(v.palette, 0);
  assert.equal(v.paletteMix, 0);
  assert.ok(Math.abs(v.penRadius - calm.pen.radius * penScale(0.5)) < 1e-12);
  const classic = resolveScene({ ...calm, params: { mode: 0 }, macro: { ...calm.macro, entries: [] } }, 0.5);
  assert.equal(classic.decay, modeDefaults(0).decay, 'a classic scene gets the classic defaults');
});

test('the wheel drives the macro parameters along their curves, and scales the pen', () => {
  const [calm] = loadShipped();
  const lo = resolveScene(calm, 0);
  const hi = resolveScene(calm, 1);
  for (const e of calm.macro.entries) {
    assert.ok(Math.abs(lo[e.param] - e.min) < 1e-9 && Math.abs(hi[e.param] - e.max) < 1e-9, e.param);
    assert.ok(Math.abs(resolveScene(calm, 0.5)[e.param] - (e.min + (e.max - e.min) * curve(e.curve, 0.5))) < 1e-9);
  }
  assert.ok(Math.abs(lo.penRadius / calm.pen.radius - PEN_SCALE_MIN) < 1e-12 && Math.abs(hi.penRadius / calm.pen.radius - PEN_SCALE_MAX) < 1e-12);
  assert.equal(lo.followerDeposit, hi.followerDeposit, 'parameters outside the macro do not move');
});

// ---------------------------------------------------------------- the director

function start(index = 0) {
  const host = new FakeHost();
  const d = new Director(host, loadShipped());
  d.goto(index);
  steps(d, 400); // settle the first scene completely
  return { host, d };
}

test('a scene switch is a transition: it starts where the world is and lands exactly on the scene', () => {
  const { host, d } = start(0);
  const before = { ...num(host.params) };
  d.next();
  assert.equal(d.index, 1);
  assert.equal(d.progress, 0);
  assert.deepEqual(num(host.params).decay, before.decay, 'nothing jumps at the moment of the key press');
  const total = Math.round(d.scene!.entry.seconds * STEPS_PER_SECOND);
  steps(d, total);
  assert.equal(d.progress, null);
  assert.equal(d.intensity, 0.5, 'the wheel is back at the entry value');
  const want = resolveScene(d.scene!, d.intensity);
  for (const [k, x] of Object.entries(want)) assert.equal(num(host.params)[k], x, `${k} lands exactly`);
});

test('no parameter overshoots during a transition, and blended ones move one way only', () => {
  const { host, d } = start(0);
  const from = { ...num(host.params) };
  const scene = loadShipped()[1];
  d.next();
  const lo = resolveScene(scene, 0);
  const hi = resolveScene(scene, 1);
  const last: Record<string, number> = { ...from };
  const total = Math.round(scene.entry.seconds * STEPS_PER_SECOND);
  const macro = new Set(scene.macro.entries.map((e) => e.param as string));
  for (let i = 0; i < total; i++) {
    d.update();
    for (const [k, x] of Object.entries(num(host.params))) {
      if (k === 'paletteMix' || k === 'presetSeconds') continue;
      const a = from[k];
      const low = Math.min(a, lo[k], hi[k]);
      const high = Math.max(a, lo[k], hi[k]);
      assert.ok(x >= low - 1e-9 && x <= high + 1e-9, `${k} = ${x} stays within ${low}..${high}`);
      if (!macro.has(k) && k !== 'penRadius') {
        const dir = Math.sign(hi[k] - a);
        if (dir !== 0 && !['fieldKind', 'physarumOn', 'penFieldMode', 'flockPenMode', 'backgroundPreset', 'penPreset', 'palette', 'mode'].includes(k)) {
          assert.ok((x - last[k]) * dir >= -1e-9, `${k} moves monotonically`);
        }
      }
      last[k] = x;
    }
  }
});

test('discrete parameters switch once at switchAt, presets are pointed at the target with the scene time, the palette crossfades', () => {
  const { host, d } = start(0); // calm: fieldKind 1, flockPenMode default 2
  const next = loadShipped()[2]; // scattered: penFieldMode 3, palette 5, presets 13 and 15
  assert.equal(host.params.penFieldMode, 1);
  d.next();
  d.next();
  // Two presses in a row: the second transition starts from the half-made first one.
  assert.equal(d.index, 2);
  steps(d, Math.round(next.entry.seconds * STEPS_PER_SECOND * 0.3));
  assert.equal(host.params.penFieldMode, 1, 'before switchAt the old value holds');
  assert.equal(host.params.backgroundPreset, 13, 'the presets were pointed at the target at the start');
  assert.equal(host.params.presetSeconds, next.entry.seconds);
  assert.equal(host.params.palette, 0, 'the palette value itself does not switch mid-way (it crossfades)');
  assert.equal(host.params.paletteB, 5);
  assert.ok(host.params.paletteMix > 0 && host.params.paletteMix < 1);
  let lastMix = host.params.paletteMix;
  let switched = -1;
  for (let i = 0; i < next.entry.seconds * STEPS_PER_SECOND; i++) {
    d.update();
    if (d.progress !== null) {
      assert.ok(host.params.paletteMix >= lastMix - 1e-12, 'the crossfade only moves forward');
      lastMix = host.params.paletteMix;
    }
    if (switched < 0 && host.params.penFieldMode === 3) switched = i;
  }
  assert.ok(switched >= 0, 'penFieldMode switched');
  assert.equal(host.params.palette, 5);
  assert.equal(host.params.paletteMix, 0);
  assert.equal(host.params.penFieldMode, 3);
  assert.equal(host.params.presetSeconds, DEFAULT_PARAMS.presetSeconds, 'the preset time returns to the scene value');
});

test('a different agent rule is a hard cut with one reset; the same rule never resets', () => {
  const host = new FakeHost();
  const scenes = loadShipped();
  const classic: SceneData = { ...JSON.parse(JSON.stringify(scenes[0])), id: 'classic', name: 'Classic', params: { mode: 0, agentCount: 100000 } };
  const d = new Director(host, [scenes[0], classic, scenes[1]]);
  d.goto(0);
  assert.equal(host.resets, 1, 'the first entry from a host on another rule is a cut with a reset');
  const resets0 = host.resets;
  d.next();
  assert.equal(d.progress, null, 'no transition: the agents are different things');
  assert.equal(host.params.mode, 0);
  assert.equal(host.resets, resets0 + 1);
  d.next();
  assert.equal(host.params.mode, 1);
  assert.equal(host.resets, resets0 + 2);
  const r = host.resets;
  d.goto(2);
  d.goto(2);
  steps(d, 200);
  assert.equal(host.resets, r, 'scenes with the same rule blend and never reset');
});

test('a zero-second scene lands at once; the entry burst fires once when the scene is entered', () => {
  const host = new FakeHost();
  const scenes = loadShipped();
  const cut: SceneData = { ...JSON.parse(JSON.stringify(scenes[1])), id: 'cut', entry: { seconds: 0, easing: 'smooth', burst: 'center', switchAt: 0.5 } };
  const d = new Director(host, [scenes[0], cut]);
  d.goto(0);
  host.log.length = 0;
  d.goto(1);
  assert.equal(d.progress, null);
  assert.equal(host.params.palette, 1);
  assert.deepEqual(host.log, ['spawn center ']);
  const d2 = new Director(new FakeHost(), scenes);
  d2.goto(1);
  assert.deepEqual((d2 as unknown as { host: FakeHost }).host.log, ['spawn ring '], 'the dense scene has a ring entry burst');
});

test('next and previous stop at the ends (no wrap), jump clamps, and the same scene again re-enters it', () => {
  const { host, d } = start(0);
  assert.equal(d.previous(), false);
  assert.equal(d.index, 0);
  assert.equal(d.next(), true);
  assert.equal(d.next(), true);
  assert.equal(d.next(), false, 'a stray press at the last scene does nothing');
  assert.equal(d.index, 2);
  d.goto(99);
  assert.equal(d.index, 2);
  d.goto(-4);
  assert.equal(d.index, 0);
  steps(d, 400);
  host.params.decay = 0.6;
  d.onWheel(-300);
  steps(d, 100);
  assert.ok(d.intensity > 0.5);
  d.goto(0);
  assert.equal(d.index, 0);
  steps(d, 400);
  assert.equal(d.intensity, 0.5, 're-entering returns the wheel to the entry value');
  assert.equal(host.params.decay, resolveScene(d.scene!, 0.5).decay);
});

test('with no input the director changes nothing, however long it runs (no timers, no automation)', () => {
  const { host, d } = start(1);
  const before = JSON.stringify(host.params);
  const log = host.log.length;
  steps(d, 60 * 120);
  assert.equal(JSON.stringify(host.params), before);
  assert.equal(host.log.length, log, 'nothing fires on its own');
  assert.equal(d.progress, null);
});

test('the wheel is bounded, smoothed, takes effect on the very next step, and only moves what the scene says', () => {
  const { host, d } = start(0);
  host.params.followerDeposit = 0.123; // a value the tuning panel set, not driven by the wheel
  const decay0 = host.params.decay;
  d.onWheel(-200); // scroll up
  d.update();
  assert.notEqual(host.params.decay, decay0, 'the picture answers within one step');
  assert.ok(d.intensity > 0.5 && d.intensity < 0.5 + 200 * 0.0008, 'but glides, it does not jump');
  steps(d, 200);
  assert.ok(Math.abs(d.intensity - 0.66) < 1e-3);
  d.onWheel(1e6);
  steps(d, 300);
  assert.equal(d.intensity, 0);
  d.onWheel(-1e6);
  steps(d, 300);
  assert.equal(d.intensity, 1);
  const hi = resolveScene(d.scene!, 1);
  for (const e of d.scene!.macro.entries) assert.ok(Math.abs(num(host.params)[e.param] - hi[e.param]) < 1e-9);
  assert.ok(Math.abs(host.params.penRadius - hi.penRadius) < 1e-12);
  assert.equal(host.params.followerDeposit, 0.123, 'a parameter outside the macro stays where the panel put it');
});

test('a scene may ask for the wheel to drift back to its entry value; the default is to stay', () => {
  const scenes = loadShipped();
  const host = new FakeHost();
  const returning: SceneData = { ...JSON.parse(JSON.stringify(scenes[0])), macro: { ...scenes[0].macro, returnSeconds: 4 } };
  const d = new Director(host, [returning]);
  d.goto(0);
  steps(d, 10);
  d.onWheel(-300);
  steps(d, 60 * 2);
  const high = d.intensity;
  assert.ok(high > 0.6);
  steps(d, 60 * 12);
  assert.ok(Math.abs(d.intensity - 0.5) < 0.02, `drifted back to ${d.intensity}`);
  const { d: stays } = start(0);
  stays.onWheel(-300);
  steps(stays, 60 * 30);
  assert.ok(stays.intensity > 0.7, 'with returnSeconds 0 it stays');
});

test('the accent: a wave or a burst or a ring by scene type, and always a surge of the pointer forces', () => {
  const { host, d } = start(0);
  host.log.length = 0;
  d.accent(0.3, 0.7);
  assert.deepEqual(host.log, ['surge 0.5', 'wave 0.3 0.7 1']);
  const dense = start(1);
  dense.host.log.length = 0;
  dense.d.accent(0.3, 0.7);
  assert.equal(dense.host.log[0], 'surge 0.8');
  assert.ok(dense.host.log[1].startsWith('spawn center'));
  const scattered = start(2);
  scattered.host.log.length = 0;
  scattered.d.accent(0.1, 0.1);
  assert.ok(scattered.host.log[1].startsWith('spawn ring'));
  const big = Number(dense.host.log[1].split(' ')[2]);
  const small = Number(scattered.host.log[1].split(' ')[2]);
  assert.ok(big > small, 'a harder accent spawns a bigger burst');
});

test('tuning-panel edits are remembered by the scene; pen radius edits account for the wheel', () => {
  const { host, d } = start(0);
  d.edit('flockSepWeight', 1.25);
  assert.equal(host.params.flockSepWeight, 1.25);
  assert.equal(d.scene!.params.flockSepWeight, 1.25);
  d.onWheel(-400);
  steps(d, 300);
  d.edit('penRadius', 0.3);
  assert.ok(Math.abs(d.scene!.pen.radius * penScale(d.intensity) - 0.3) < 1e-9);
  d.edit('paletteMix', 0.5);
  assert.equal('paletteMix' in d.scene!.params, false);
});

test('capture makes a complete, valid scene: overwrite the current one or append a new one', () => {
  const { host, d } = start(0);
  host.params.decay = 0.83;
  host.params.flockCount = 4321;
  const n = d.scenes.length;
  const replaced = d.capture(false)!;
  assert.equal(d.scenes.length, n);
  assert.equal(replaced.id, 'placeholder-calm');
  assert.equal(replaced.params.decay, 0.83);
  assert.equal(replaced.params.flockCount, 4321);
  assert.ok(Object.keys(replaced.params).length > 40, 'a complete parameter set');
  assert.equal('paletteMix' in replaced.params, false);
  const added = d.capture(true)!;
  assert.equal(d.scenes.length, n + 1);
  assert.equal(d.index, n);
  assert.equal(added.placeholder, undefined);
  assert.notEqual(added.id, replaced.id);
  assert.deepEqual(validateScenes(d.scenes).problems, [], 'the captured list validates');
  // Round trip: entering the captured scene reproduces the state it was captured from (for
  // parameters the wheel does not drive; the wheel's own parameters follow its curves).
  const again = resolveScene(added, d.intensity);
  assert.equal(again.followerDeposit, host.params.followerDeposit);
  assert.equal(again.flockCount, 4321);
  // The exported JSON loads back the same.
  const json = JSON.parse(JSON.stringify(d.scenes));
  assert.deepEqual(validateScenes(json).scenes, d.scenes);
});

test('setScenes (import, hot reload) applies the current scene without a transition or a reset', () => {
  const { host, d } = start(1);
  const edited = JSON.parse(JSON.stringify(d.scenes)) as SceneData[];
  edited[1].params.decay = 0.6;
  const resets = host.resets;
  d.setScenes(validateScenes(edited).scenes);
  assert.equal(d.index, 1);
  assert.equal(d.progress, null);
  assert.equal(host.resets, resets);
  assert.ok(Math.abs(host.params.decay - 0.6) < 1e-12 || d.scene!.macro.entries.some((e) => e.param === 'decay'));
});

test('rehearsal readout: the changes of a switch are listed, biggest first', () => {
  const { d } = start(0);
  d.next();
  const c = d.lastChanges;
  assert.ok(c.length > 5);
  assert.ok(c.some((x) => x.key === 'flockCount' && x.to > x.from));
  assert.ok(c.every((x) => x.key !== 'paletteMix'));
  const rel = (x: { from: number; to: number }) => Math.abs(x.to - x.from) / Math.max(Math.abs(x.from), Math.abs(x.to));
  for (let i = 1; i < c.length; i++) assert.ok(rel(c[i - 1]) >= rel(c[i]) - 1e-12);
});

// ---------------------------------------------------------------- keys

test('the key map: single keys, no modifiers, nothing shared, digits jump, Escape and S both mean safe', () => {
  const key = (k: string, extra: object = {}) => actionForKey({ key: k, ...extra });
  assert.deepEqual(key(' '), { type: 'next' });
  assert.deepEqual(key('b'), { type: 'previous' });
  assert.deepEqual(key('F'), { type: 'freeze' }, 'Shift is how a capital is typed, not a chord');
  assert.deepEqual(key('3'), { type: 'jump', scene: 2 });
  assert.deepEqual(key('Escape'), { type: 'safe' });
  assert.deepEqual(key('s'), { type: 'safe' });
  for (const k of Object.keys(BINDINGS)) {
    for (const mod of ['ctrlKey', 'altKey', 'metaKey']) assert.equal(key(k, { [mod]: true }), null, `${k} with ${mod} is ignored`);
    assert.equal(key(k, { repeat: true }), null, `${k} held down does not repeat`);
  }
  assert.equal(key('z'), null);
  const live = ['next', 'previous', 'jump', 'freeze', 'reset', 'safe', 'help', 'cue'];
  for (const t of live) assert.ok(Object.values(BINDINGS).some((a) => a.type === t), `${t} is bound`);
  const nonSafe = Object.entries(BINDINGS).filter(([, a]) => a.type !== 'safe' && a.type !== 'jump');
  assert.equal(new Set(nonSafe.map(([, a]) => a.type)).size, nonSafe.length, 'every action has exactly one key (safe has two)');
  assert.ok(LIVE_KEYS.length >= live.length - 1, 'the help overlay lists every live key');
});

test('the live vocabulary has no key that a debug or rehearsal feature also needs', () => {
  const debug = ['fullscreen', 'tuning', 'setup', 'hud', 'fieldArrows', 'flockOverlay'];
  const liveKeys = Object.entries(BINDINGS).filter(([, a]) => !debug.includes(a.type)).map(([k]) => k);
  const debugKeys = Object.entries(BINDINGS).filter(([, a]) => debug.includes(a.type)).map(([k]) => k);
  assert.equal(liveKeys.filter((k) => debugKeys.includes(k)).length, 0);
  assert.ok(penScale(0) < 1 && penScale(1) > 1);
});

test('a scene key in the middle of a palette crossfade commits the nearer palette instead of blending three', () => {
  const { host, d } = start(0);
  d.next(); // calm (Abyss 0) to dense (Ember 1)
  steps(d, 60); // past the middle of a 1.2 s transition
  assert.ok(host.params.paletteMix > 0.5);
  d.next(); // interrupt toward scattered (Tide 5)
  assert.equal(host.params.palette, 1, 'the palette being faded toward is committed');
  assert.equal(host.params.paletteMix, 0);
  assert.equal(host.params.paletteB, 5);
});

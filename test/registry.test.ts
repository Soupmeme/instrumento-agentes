// Integrity of the prediction registry (src/verify/predictions.ts): every prediction is linked to a
// check that exists, and the registry, the tests and EXPLAINER.md agree on the ids. This does not
// run the checks (npm test runs the CPU ones, `__exp.verify()` the GPU ones in the browser); it
// makes sure a prediction cannot lose its check, or a check its prediction, without a test failing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FAMILY_NAMES, PREDICTIONS, byFamily, type Family } from '../src/verify/predictions.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (path: string) => readFileSync(join(root, path), 'utf8');

function walk(dir: string, match: RegExp, out: string[] = []): string[] {
  for (const name of readdirSync(join(root, dir))) {
    const rel = `${dir}/${name}`;
    if (statSync(join(root, rel)).isDirectory()) walk(rel, match, out);
    else if (match.test(name)) out.push(rel);
  }
  return out;
}

const testSource = walk('test', /\.test\.ts$/).map(read).join('\n');
const selftestSource = walk('src', /selftest.*\.ts$/).map(read).join('\n');
const gpuChecks = read('src/verify/gpu_checks.ts');
const explainer = read('EXPLAINER.md');
const PREFIXES = 'PC|PE|FO|FL|CP|SC|PR|TL';
const ID = new RegExp(`\\b(?:${PREFIXES})-\\d{2}\\b`, 'g');

test('ids are unique and well formed, and every prediction says what it changes and what it claims', () => {
  const seen = new Set<string>();
  for (const p of PREDICTIONS) {
    assert.match(p.id, new RegExp(`^(?:${PREFIXES})-\\d{2}$`), p.id);
    assert.ok(!seen.has(p.id), `duplicate id ${p.id}`);
    seen.add(p.id);
    assert.ok(p.change.length > 3 && p.statement.length > 30, `${p.id} needs a change and a statement`);
    assert.ok(['new', 'earlier'].includes(p.origin), p.id);
  }
});

test('every family has predictions, and every prediction has at least one check', () => {
  for (const family of Object.keys(FAMILY_NAMES) as Family[]) {
    assert.ok(byFamily(family).length >= 4, `${family} has ${byFamily(family).length} predictions`);
  }
  for (const p of PREDICTIONS) assert.ok(p.cpu || p.gpu || p.selftest, `${p.id} has no check`);
});

test('every CPU check exists: a unit test whose title starts with the id, and no test carries an unknown id', () => {
  const tagged = new Set([...testSource.matchAll(/test\(\s*'\[((?:PC|PE|FO|FL|CP|SC|PR|TL)-\d{2})\]/g)].map((m) => m[1]));
  for (const p of PREDICTIONS.filter((x) => x.cpu)) assert.ok(tagged.has(p.id), `${p.id} says cpu but no test is titled "[${p.id}] ..."`);
  const known = new Set(PREDICTIONS.map((p) => p.id));
  for (const id of tagged) assert.ok(known.has(id), `a test is tagged [${id}] but the registry has no such prediction`);
  for (const id of tagged) assert.ok(PREDICTIONS.find((p) => p.id === id)?.cpu, `${id} has a test but the registry does not say cpu`);
});

test('every GPU check exists: a function registered under the id in src/verify/gpu_checks.ts, and no unknown ids there', () => {
  const registered = new Set([...gpuChecks.matchAll(new RegExp(`^\\s*'((?:${PREFIXES})-\\d{2})':`, 'gm'))].map((m) => m[1]));
  for (const p of PREDICTIONS.filter((x) => x.gpu)) assert.ok(registered.has(p.id), `${p.id} says gpu but gpu_checks.ts has no '${p.id}':`);
  const known = new Set(PREDICTIONS.map((p) => p.id));
  for (const id of registered) assert.ok(known.has(id), `gpu_checks.ts registers ${id}, which is not in the registry`);
  for (const id of registered) assert.ok(PREDICTIONS.find((p) => p.id === id)?.gpu, `${id} has a GPU check but the registry does not say gpu`);
});

test('every self-test link names a real self-test check', () => {
  for (const p of PREDICTIONS.filter((x) => x.selftest)) {
    assert.ok(selftestSource.includes(p.selftest as string), `${p.id} links to self-test checks starting "${p.selftest}", which no selftest file contains`);
  }
});

test('EXPLAINER.md lists every prediction id, and mentions no id that is not in the registry', () => {
  const known = new Set(PREDICTIONS.map((p) => p.id));
  const mentioned = new Set(explainer.match(ID) ?? []);
  for (const p of PREDICTIONS) assert.ok(mentioned.has(p.id), `EXPLAINER.md does not mention ${p.id}`);
  for (const id of mentioned) assert.ok(known.has(id), `EXPLAINER.md mentions ${id}, which is not in the registry`);
});

test('the registry text has no em dashes (project rule 8)', () => {
  const source = read('src/verify/predictions.ts');
  assert.ok(!source.includes('—'), 'em dash in predictions.ts');
});

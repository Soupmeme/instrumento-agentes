// Prints the prediction tables of EXPLAINER.md section 7 from the registry and from the saved
// reports of `__exp.verify()`, so the document and the evidence cannot drift apart by hand.
//
//   node scripts/predictions_markdown.ts evidence/verify/verify-<first run>.json [later reports...] > tables.md
//
// With several reports the table shows the latest result of each id and says if the first run differed. With one
// report it shows that one; with none, the result column says "not run".
// The "Kiwi's verdict" column is always left empty: it is his to fill.

import { readFileSync } from 'node:fs';
import { FAMILY_NAMES, PREDICTIONS, type Family } from '../src/verify/predictions.ts';

interface Result {
  id: string;
  pass: boolean;
  values: Record<string, unknown>;
  note?: string;
}
const load = (path: string): Map<string, Result> => {
  const report = JSON.parse(readFileSync(path, 'utf8')) as { results: Result[] };
  return new Map(report.results.map((r) => [r.id, r]));
};

const files = process.argv.slice(2);
// The first report is the first run. The others are merged in order, so the latest result of each id wins
// (a later report may hold only some of the ids, for example after one check was corrected and re-run).
const first = files.length > 1 ? load(files[0]) : null;
const latest = new Map<string, Result>();
for (const file of files.length > 1 ? files.slice(1) : files) for (const [id, r] of load(file)) latest.set(id, r);

/** Numbers of a result in a short line: key=value pairs, arrays joined, rounded, cut at about 200 characters. */
function summary(values: Record<string, unknown>): string {
  const show = (v: unknown): string => {
    if (typeof v === 'number') return String(+v.toFixed(3));
    if (Array.isArray(v)) return v.map(show).join(' / ');
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      // A scene row reads as "calm: wheelDifference 0.229, ...", the others as "key value, key value".
      const { scene, ...rest } = o;
      const body = Object.entries(rest).map(([k, x]) => `${k} ${show(x)}`).join(', ');
      return typeof scene === 'string' ? `${scene.replace('PLACEHOLDER: ', '')}: ${body}` : body;
    }
    return String(v);
  };
  const text = Object.entries(values).map(([k, v]) => `${k} ${Array.isArray(v) && v.length && typeof v[0] === 'object' ? v.map(show).join(' | ') : show(v)}`).join('; ');
  return text.length > 200 ? `${text.slice(0, 197)}...` : text;
}

const esc = (s: string) => s.replace(/\|/g, '\\|');

const out: string[] = [];
for (const family of Object.keys(FAMILY_NAMES) as Family[]) {
  const rows = PREDICTIONS.filter((p) => p.family === family);
  out.push(`#### ${FAMILY_NAMES[family]}`, '');
  out.push('| Id | What changes | Predicted (draft, to be verified by Kiwi) | Where it is checked | Last run | Kiwi\'s verdict |');
  out.push('|---|---|---|---|---|---|');
  for (const p of rows) {
    const where: string[] = [];
    if (p.cpu) where.push('unit test');
    if (p.gpu) where.push('GPU run');
    if (p.selftest) where.push('self-test');
    const run = latest.get(p.id);
    let result = p.gpu ? 'not run' : 'passes with `npm test`';
    if (!p.gpu && p.selftest && !p.cpu) result = 'passes in the self-test';
    if (run) {
      result = `${run.pass ? 'pass' : '**FAIL**'}: ${summary(run.values)}${run.note && !run.pass ? ` (${run.note})` : ''}`;
      const before = first?.get(p.id);
      if (before && before.pass !== run.pass) result += ` (first run: ${before.pass ? 'pass' : 'FAIL'})`;
    }
    const note = p.history ? ` *${p.history}*` : '';
    out.push(`| ${p.id} | ${esc(p.change)} | ${esc(p.statement)}${esc(note)}${p.origin === 'new' ? ' *(new in M7)*' : ''} | ${where.join(', ')} | ${esc(result)} | |`);
  }
  out.push('');
}
console.log(out.join('\n'));

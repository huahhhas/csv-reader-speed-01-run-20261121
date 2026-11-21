// The entry's program: the harness runs `node /bot/main.ts` (Node 22). It reads
// every case from /input/cases.json, answers each one alone with run() from
// ./solve.js, and writes /output/answers.json: one answer per case, in the
// cases' order. Outside a container, MAKEFUN_INPUT_DIR and MAKEFUN_OUTPUT_DIR
// stand in for /input and /output.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setFlagsFromString } from 'node:v8';

// The house baseline runs with V8's incremental marking off, and an entry may
// tune V8's flags the same way: set it before solve.js is imported so all of
// the parsing runs under it.
setFlagsFromString('--no-incremental-marking');

/** solve.js, imported by its URL, typed by the contract it keeps. */
const { run } = (await import(new URL('./solve.js', import.meta.url).href)) as {
  run: (input: unknown) => unknown;
};

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const cases = JSON.parse(readFileSync(join(INPUT_DIR, 'cases.json'), 'utf8')) as {
  id: string;
  input: unknown;
}[];

const answers: unknown[] = [];
// Each case is answered alone, in order, with nothing kept from one case to
// the next; the run is deterministic, so the same input writes the same bytes.
for (const c of cases) answers.push(run(c.input));
writeFileSync(join(OUTPUT_DIR, 'answers.json'), JSON.stringify(answers));

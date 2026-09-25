// Checks the JS engine against a snapshot of bc.godfat.org
// (?seed=2020607346&last=47&event=2026-09-30_947&lang=tw).
// Each fixture cell: [label, [[seedAfter, catId]]], where seedAfter is the
// seed the site links to after taking that cell.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const E = require('../src/engine.js');

const ctx = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../data/bc-tw.js'), 'utf8'), ctx);
const data = ctx.window.BC_DATA.tw;
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixture-947.json'), 'utf8'));

const seeds = new E.Seeds(2020607346);
const pool = E.buildPool(data, '2026-09-30_947');
let fail = 0;

for (const [label, [[seedAfter, catId]]] of fixture) {
  const m = /^(\d+)([AB])(R?)(G?)$/.exec(label);
  const k = E.parsePos(m[1] + m[2]);
  let res;
  if (m[3]) {
    const raw = E.rollAt(seeds, pool, k, 0);
    const re = E.rollAt(seeds, pool, k, raw.id);
    res = m[4] ? E.rollMulti(seeds, pool, re.next, re.id, 10, true)
               : { next: re.next, last: re.id };
  } else if (m[4]) {
    res = E.rollMulti(seeds, pool, k, 0, 11, true);
  } else {
    const r = E.rollAt(seeds, pool, k, 0);
    res = { next: r.next, last: r.id };
  }
  const got = [seeds.at(res.next - 1), res.last];
  if (got[0] !== seedAfter || got[1] !== catId) {
    fail++;
    console.log(`FAIL ${label}: expected ${seedAfter}/${catId}, got ${got.join('/')}`);
  }
}
console.log(`${fixture.length - fail}/${fixture.length} cells match`);
process.exit(fail ? 1 : 0);

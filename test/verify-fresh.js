// Exact mode with freshTie: among routes as good as the one found without
// it (same targets, same resources left), it picks one with at least as
// much value from cats the player doesn't own.
const fs = require('fs'), path = require('path'), vm = require('vm');
const E = require('../src/engine.js'), P = require('../src/planner.js');
const ctx = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'data-tw.js'), 'utf8'), ctx);
const data = ctx.window.BC_DATA.tw;
const pools = ['2026-09-28_1004', '2026-09-28_1081', '2026-09-30_947'].map((k) => E.buildPool(data, k));
const ubers = pools[2].slots[E.UBER];
const uniq = (r) => [...new Set(pools.flatMap((p) => p.slots[r]))];
const owned = [...uniq(E.RARE).filter((_, i) => i % 2), ...uniq(E.SUPA).filter((_, i) => i % 3), ...uniq(E.UBER).filter((_, i) => i % 2)];
const fv = { 2: 0.1, 3: 0.5, 4: 1, 5: 2 };
const left = (r) => [r.end.food, r.end.tickets].join('/');
const fresh = (r, targets) => {
  const skip = new Set([...owned, ...targets.map((t) => t.id)]);
  return r.steps.flatMap((s) => s.cats).filter((c) => !skip.has(c.id)).reduce((v, c) => v + (fv[c.rarity] || 0), 0);
};
let fail = 0, more = 0, n = 0;
for (let trial = 0; trial < 30; trial++) {
  const seed = (123456789 + trial * 104729) >>> 0;
  const targets = ubers.slice(trial % 6, trial % 6 + 2).map((id, i) => ({ id, weight: 10 - i, must: i === 0 }));
  for (const keepFood of [false, true]) {
    const base = { seed, lastId: 47, pools, food: 4500 + (trial % 4) * 1500, tickets: 5 + trial % 7, targets,
      cats: data.cats, keepFood, owned, maxRolls: trial % 3 === 0 ? 40 : 0 };
    const a = P.plan(base), b = P.plan({ ...base, freshTie: fv });
    n++;
    if (a.got.length !== b.got.length || left(a) !== left(b) || fresh(b, targets) < fresh(a, targets) - 1e-9) {
      fail++;
      console.log(`FAIL seed ${seed} keepFood=${keepFood}: got ${a.got.length}/${b.got.length} left ${left(a)}/${left(b)} fresh ${fresh(a, targets)}/${fresh(b, targets)}`);
    }
    if (fresh(b, targets) > fresh(a, targets) + 1e-9) more++;
  }
}
console.log(`${n - fail}/${n} ok, ${more} picked more new cats`);
process.exit(fail ? 1 : 0);

// Collection-mode quality check: beam width vs result value, and agreement
// with the exact planner when only targets carry value.
const fs = require('fs'), path = require('path'), vm = require('vm');
const E = require('../src/engine.js'), P = require('../src/planner.js');
const ctx = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../data/bc-tw.js'), 'utf8'), ctx);
const data = ctx.window.BC_DATA.tw;
const keys = ['2026-09-28_1004', '2026-09-28_1081', '2026-09-30_947'];
const pools = keys.map((k) => E.buildPool(data, k));
const food = +(process.argv[2] || 15000), tickets = +(process.argv[3] || 30);
const ubers = pools[2].slots[E.UBER];
const targets = ubers.slice(0, 5).map((id, i) => ({ id, weight: 10 - i, must: i === 0 }));
// Pretend the player owns 2/3 of the rares and half the supers.
const uniq = (r) => [...new Set(pools.flatMap((p) => p.slots[r]))];
const owned = [...uniq(E.RARE).filter((_, i) => i % 3), ...uniq(E.SUPA).filter((_, i) => i % 2)];
const rarityValue = { 2: 0.2, 3: 1, 4: 5, 5: 8 };
const base = { seed: 2020607346, lastId: 47, pools, food, tickets, targets, cats: data.cats, owned, rarityValue };

const value = (r) => {
  const seen = new Set(owned); let v = 0;
  const tg = new Map(targets.map((t) => [t.id, t.weight]));
  for (const s of r.steps) for (const c of s.cats) {
    if (tg.has(c.id)) { if (!seen.has('t' + c.id)) { v += tg.get(c.id); seen.add('t' + c.id); } continue; }
    if (!seen.has(c.id)) { v += rarityValue[c.rarity] || 0; seen.add(c.id); }
  }
  return v;
};
for (const beam of [100, 400, 1500, 5000]) {
  const t0 = Date.now();
  const r = P.planCollect({ ...base, beam });
  const fresh = r.steps.flatMap((s) => s.cats).filter((c) => c.fresh);
  const byR = [2, 3, 4, 5].map((x) => fresh.filter((c) => c.rarity === x).length);
  console.log(`beam ${beam}: ${Date.now() - t0}ms value=${value(r).toFixed(1)} new(R/SR/UR/LR)=${byR} targets=${r.got.length} must=${r.mustOk} left=${r.end.food}/${r.end.tickets}`);
}
// Targets only: beam search should match the exact DP.
const ex = P.plan({ ...base, owned: [], uberBonus: 0, legendBonus: 0 });
const bc = P.planCollect({ ...base, owned: [], rarityValue: {}, beam: 400 });
console.log('targets-only exact', ex.got.length, 'beam', bc.got.length);

// Duplicate values: rescore the chosen path independently and compare.
const dupValue = { 2: 0, 3: 0.1, 4: 1, 5: 2 };
const tDup = targets.map((t, i) => ({ ...t, dup: i === 1 ? 4 : 0 }));
const rescore = (r) => {
  const seen = new Set(), tg = new Map(tDup.map((t) => [t.id, t]));
  let v = 0;
  for (const s of r.steps) for (const c of s.cats) {
    const t = tg.get(c.id), first = !seen.has(c.id);
    seen.add(c.id);
    if (t) v += first ? t.weight + (t.must ? 1e6 : 0) : t.dup;
    else if (first && !owned.includes(c.id)) v += rarityValue[c.rarity] || 0;
    else v += dupValue[c.rarity] || 0;
  }
  return v - 1e6 * tDup.filter((t) => t.must).length;
};
for (const beam of [400, 1500]) {
  const r = P.planCollect({ ...base, targets: tDup, dupValue, beam });
  const cs = r.steps.flatMap((s) => s.cats);
  const dupT = cs.filter((c) => c.id === tDup[1].id).length;
  const internal = r.score - 1e6 * tDup.filter((t) => t.must && r.got.includes(t)).length;
  console.log(`dup beam ${beam}: value=${rescore(r).toFixed(1)} planner=${internal.toFixed(1)} rolls=${cs.length} copies of target#2=${dupT} left=${r.end.food}/${r.end.tickets}`);
}
